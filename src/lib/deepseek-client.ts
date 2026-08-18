import OpenAI from 'openai';

// DeepSeek V4 model identifiers (released April 2026)
// deepseek-chat / deepseek-reasoner aliases are deprecated after July 24 2026
export const DEEPSEEK_FLASH = 'deepseek-v4-flash'; // Fast & cheap — default for all summaries
export const DEEPSEEK_PRO   = 'deepseek-v4-pro';   // Powerful — used as fallback for complex tasks

const MAX_RETRIES = parseInt(process.env.DEEPSEEK_MAX_RETRIES || '3', 10);
const RPM = parseInt(process.env.DEEPSEEK_REQUESTS_PER_MINUTE || '60', 10);
const REQUEST_INTERVAL_MS = Math.ceil((60 * 1000) / RPM);

// Basic queue to serialize and throttle requests
class RequestQueue {
  private lastRequestTime = 0;
  private queue: (() => Promise<any>)[] = [];
  private processing = false;

  async enqueue<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const res = await requestFn();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;
      const delay = Math.max(0, REQUEST_INTERVAL_MS - timeSinceLast);

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const nextTask = this.queue.shift();
      if (nextTask) {
        this.lastRequestTime = Date.now();
        await nextTask();
      }
    }

    this.processing = false;
  }
}

const deepseekQueue = new RequestQueue();

// Garde-fou budget GLOBAL : au tout premier appel DeepSeek d'un process, on vérifie le solde du
// compte. S'il est épuisé (événement de budget attendu, plafond ~10 $/mois — PAS un bug), on sort
// proprement (exit 0) plutôt que d'enchaîner des 402 « Insufficient Balance » qui font échouer le
// cron en rouge. Couvre TOUS les scripts qui utilisent DeepSeek, sans toucher aux workflows. Le
// travail GRATUIT déjà effectué avant le 1er appel IA est préservé.
let budgetChecked = false;
async function ensureBudgetOrExit(): Promise<void> {
  if (budgetChecked) return;
  budgetChecked = true;
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || process.env.DEEPSEEK_SKIP_BUDGET_CHECK === '1') return;
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return; // API solde indisponible → on laisse tenter
    const data = (await res.json()) as { is_available?: boolean; balance_infos?: { total_balance?: string }[] };
    if (data.is_available === false) {
      const bal = data.balance_infos?.[0]?.total_balance ?? '?';
      console.log('='.repeat(72));
      console.log('[BUDGET] Solde DeepSeek epuise (' + bal + ' USD) — etape IA ignoree, sortie propre.');
      console.log('[BUDGET] Recharger https://platform.deepseek.com/top_up pour reactiver l\'IA.');
      console.log('='.repeat(72));
      process.exit(0);
    }
  } catch {
    // Erreur reseau sur la verif → on laisse tenter plutot que de bloquer.
  }
}

export interface DeepSeekMessageParams {
  model: string;
  max_tokens: number;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  system?: string;
  responseFormat?: 'json_object';
}

export interface DeepSeekMessage {
  content: Array<{ type: 'text'; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

// Robust DeepSeek client wrapper — drop-in replacement for ResilientAnthropic
export class ResilientDeepSeek {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || 'dummy-key-for-compilation',
      baseURL: 'https://api.deepseek.com',
    });
  }

  /**
   * Send a message to DeepSeek with rate limiting, timeouts, and exponential backoff retries.
   * Returns a response shaped like Anthropic's Message for minimal call-site changes.
   */
  async createMessage(
    params: DeepSeekMessageParams,
    options?: { timeoutMs?: number }
  ): Promise<DeepSeekMessage> {
    await ensureBudgetOrExit(); // sortie propre si solde epuise (couvre tous les crons)
    const timeoutMs = options?.timeoutMs || 45000; // 45s default timeout

    const executeWithRetryAndTimeout = async (): Promise<DeepSeekMessage> => {
      let attempt = 0;
      let delay = 2000; // start with 2s delay

      while (true) {
        attempt++;
        const startTime = Date.now();

        try {
          console.log(
            `[DeepSeek] Calling model ${params.model} (Attempt: ${attempt}/${MAX_RETRIES})...`
          );

          // Build messages array — inject system prompt if provided as top-level param
          const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
          if (params.system) {
            messages.push({ role: 'system', content: params.system });
          }
          for (const m of params.messages) {
            messages.push({ role: m.role, content: m.content });
          }

          const requestPromise = this.client.chat.completions.create({
            model: params.model,
            max_tokens: params.max_tokens,
            messages,
            response_format: params.responseFormat ? { type: params.responseFormat } : undefined,
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`API request timed out after ${timeoutMs}ms`)),
              timeoutMs
            );
          });

          const response = (await Promise.race([
            requestPromise,
            timeoutPromise,
          ])) as OpenAI.Chat.ChatCompletion;

          const duration = Date.now() - startTime;
          const tokensInput = response.usage?.prompt_tokens || 0;
          const tokensOutput = response.usage?.completion_tokens || 0;

          console.log(
            `[DeepSeek] ✅ Success. Duration: ${duration}ms, Tokens: In=${tokensInput}/Out=${tokensOutput}`
          );

          // Shape response like Anthropic's Message for call-site compatibility
          const text = response.choices[0]?.message?.content || '';
          return {
            content: [{ type: 'text', text }],
            usage: { input_tokens: tokensInput, output_tokens: tokensOutput },
          };
        } catch (err: any) {
          const duration = Date.now() - startTime;
          console.warn(
            `[DeepSeek] ⚠️ Attempt ${attempt} failed after ${duration}ms. Error: ${err.message}`
          );

          const status = err.status ?? err.response?.status;
          const isRateLimit = status === 429;
          const is4xx = status >= 400 && status < 500;

          if (is4xx && !isRateLimit) {
            console.error(
              `[DeepSeek] ❌ NON_RETRYABLE_ERROR: ${err.message} (status: ${status})`
            );
            throw err;
          }

          const isServerError = status >= 500;
          const isTimeout = err.message?.includes('timed out');
          const isNetworkError = !status && err.message?.includes('fetch');

          const shouldRetry =
            attempt < MAX_RETRIES &&
            (isRateLimit || isServerError || isTimeout || isNetworkError);

          if (!shouldRetry) {
            console.error(
              `[DeepSeek] ❌ Request failed permanently after ${attempt} attempts.`
            );
            throw err;
          }

          // Backoff delay with some jitter
          const backoffDelay =
            delay * Math.pow(2, attempt - 1) + Math.random() * 1000;
          console.log(
            `[DeepSeek] Retrying in ${(backoffDelay / 1000).toFixed(1)}s...`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        }
      }
    };

    // Enqueue the request to honour requests-per-minute constraints
    return deepseekQueue.enqueue(executeWithRetryAndTimeout);
  }
}

export const resilientDeepSeek = new ResilientDeepSeek();
