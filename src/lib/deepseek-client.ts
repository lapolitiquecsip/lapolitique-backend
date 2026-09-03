import OpenAI from 'openai';

// ============================================================================
// Client LLM multi-provider : GRATUIT d'abord, DeepSeek en SECOURS payant.
// ----------------------------------------------------------------------------
// Historiquement ce fichier appelait uniquement DeepSeek. Pour couper le coût,
// on route désormais TOUT le volume vers un modèle GRATUIT compatible OpenAI
// (Gemini Flash par défaut) dès qu'une clé gratuite est fournie via
// LLM_FREE_API_KEY (ou GEMINI_API_KEY). DeepSeek ne sert plus qu'en SECOURS
// payant si le gratuit échoue/sature. Aucun call-site à modifier : l'interface
// `resilientDeepSeek.createMessage(...)` est inchangée.
//
// Si AUCUNE clé gratuite n'est configurée → comportement historique (DeepSeek
// primaire, avec sortie propre quand le solde est épuisé).
// ============================================================================

// Identifiants DeepSeek (secours payant)
export const DEEPSEEK_FLASH = 'deepseek-v4-flash';
export const DEEPSEEK_PRO   = 'deepseek-v4-pro';

const MAX_RETRIES = parseInt(process.env.DEEPSEEK_MAX_RETRIES || '3', 10);

// Scripts d'écriture non latins jamais légitimes dans le contenu français du site (CJK, kana,
// hangul, cyrillique, arabe, hébreu). Sert de détecteur de contamination des sorties LLM gratuites.
const FOREIGN_SCRIPT = /[぀-ヿ㐀-䶿一-鿿가-힯Ѐ-ӿ֐-׿؀-ۿ]/;

// --- Provider GRATUIT (primaire) ---
// Endpoint compatible OpenAI. Par défaut : Gemini (Google AI Studio, quota gratuit).
// Substituable (Groq, Mistral, OpenRouter…) via les variables d'env, sans toucher au code.
const FREE_KEY = process.env.LLM_FREE_API_KEY || process.env.GEMINI_API_KEY || '';
const FREE_BASE_URL = process.env.LLM_FREE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';
// gemini-flash-lite-latest : alias stable (toujours le flash-lite courant), meilleur quota gratuit,
// fiable en texte ET JSON. gemini-2.x-flash sont retirés pour les nouveaux comptes ; les modèles
// « -latest » évitent les dépréciations. Substituable via LLM_FREE_MODEL.
const FREE_MODEL = process.env.LLM_FREE_MODEL || 'gemini-flash-lite-latest';
const FREE_RPM = parseInt(process.env.LLM_FREE_RPM || '15', 10);   // quota gratuit → throttle prudent
const HAS_FREE = !!FREE_KEY;

// --- Provider DeepSeek (secours payant, ou primaire si pas de clé gratuite) ---
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_RPM = parseInt(process.env.DEEPSEEK_REQUESTS_PER_MINUTE || '60', 10);

// File d'attente : sérialise et throttle les requêtes à un débit donné (par provider).
class RequestQueue {
  private lastRequestTime = 0;
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  constructor(private intervalMs: number) {}

  async enqueue<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try { resolve(await requestFn()); } catch (err) { reject(err); }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const delay = Math.max(0, this.intervalMs - (Date.now() - this.lastRequestTime));
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      const nextTask = this.queue.shift();
      if (nextTask) { this.lastRequestTime = Date.now(); await nextTask(); }
    }
    this.processing = false;
  }
}

const freeQueue = new RequestQueue(Math.ceil(60000 / Math.max(1, FREE_RPM)));
const deepseekQueue = new RequestQueue(Math.ceil(60000 / Math.max(1, DEEPSEEK_RPM)));

// Garde-fou budget DeepSeek : n'a de sens QUE lorsque DeepSeek est le provider PRIMAIRE
// (aucune clé gratuite). Quand le gratuit est primaire, un solde DeepSeek à 0 n'est plus
// bloquant : on tourne en gratuit et DeepSeek reste un simple secours optionnel.
let budgetChecked = false;
async function ensureBudgetOrExit(): Promise<void> {
  if (budgetChecked) return;
  budgetChecked = true;
  if (!DEEPSEEK_KEY || process.env.DEEPSEEK_SKIP_BUDGET_CHECK === '1') return;
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${DEEPSEEK_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { is_available?: boolean; balance_infos?: { total_balance?: string }[] };
    if (data.is_available === false) {
      const bal = data.balance_infos?.[0]?.total_balance ?? '?';
      console.log('='.repeat(72));
      console.log('[BUDGET] Solde DeepSeek epuise (' + bal + ' USD) — etape IA ignoree, sortie propre.');
      console.log('[BUDGET] Configurer LLM_FREE_API_KEY (Gemini) pour tourner GRATUITEMENT, ou recharger DeepSeek.');
      console.log('='.repeat(72));
      process.exit(0);
    }
  } catch { /* réseau : on laisse tenter */ }
}

// Cache léger de la disponibilité budgétaire DeepSeek pour le SECOURS (ne fait jamais exit).
let deepseekBudgetOk: boolean | null = null;
async function deepseekHasBudget(): Promise<boolean> {
  if (!DEEPSEEK_KEY) return false;
  if (deepseekBudgetOk !== null) return deepseekBudgetOk;
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${DEEPSEEK_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { deepseekBudgetOk = true; return true; } // solde indispo → on laisse tenter
    const data = (await res.json()) as { is_available?: boolean };
    deepseekBudgetOk = data.is_available !== false;
    return deepseekBudgetOk;
  } catch { deepseekBudgetOk = true; return true; }
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

// Client robuste multi-provider — drop-in (interface inchangée pour les 57 call-sites).
export class ResilientDeepSeek {
  private freeClient: OpenAI | null;
  private deepseekClient: OpenAI;

  constructor() {
    this.freeClient = HAS_FREE ? new OpenAI({ apiKey: FREE_KEY, baseURL: FREE_BASE_URL }) : null;
    this.deepseekClient = new OpenAI({
      apiKey: DEEPSEEK_KEY || 'dummy-key-for-compilation',
      baseURL: 'https://api.deepseek.com',
    });
  }

  async createMessage(params: DeepSeekMessageParams, options?: { timeoutMs?: number }): Promise<DeepSeekMessage> {
    const timeoutMs = options?.timeoutMs || 45000;

    // 1) GRATUIT d'abord (si configuré).
    if (this.freeClient) {
      try {
        return await this.callProvider(this.freeClient, freeQueue, { ...params, model: FREE_MODEL }, timeoutMs, 'FREE');
      } catch (err: any) {
        // 2) SECOURS DeepSeek payant (uniquement si clé présente + solde dispo).
        if (await deepseekHasBudget()) {
          console.warn(`[LLM] Provider gratuit indisponible (${err?.message}) → secours DeepSeek payant.`);
          return await this.callProvider(this.deepseekClient, deepseekQueue, params, timeoutMs, 'DEEPSEEK');
        }
        throw err; // ni gratuit ni budget → l'appelant gère (la plupart des scripts try/catch par item)
      }
    }

    // Pas de clé gratuite → DeepSeek primaire (comportement historique + sortie propre si solde 0).
    await ensureBudgetOrExit();
    return await this.callProvider(this.deepseekClient, deepseekQueue, params, timeoutMs, 'DEEPSEEK');
  }

  private async callProvider(
    client: OpenAI, queue: RequestQueue, params: DeepSeekMessageParams, timeoutMs: number, label: string,
  ): Promise<DeepSeekMessage> {
    const exec = async (): Promise<DeepSeekMessage> => {
      let attempt = 0, delay = 2000;
      while (true) {
        attempt++;
        const startTime = Date.now();
        try {
          console.log(`[LLM/${label}] Appel ${params.model} (essai ${attempt}/${MAX_RETRIES})...`);
          const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
          if (params.system) messages.push({ role: 'system', content: params.system });
          for (const m of params.messages) messages.push({ role: m.role, content: m.content });

          const requestPromise = client.chat.completions.create({
            model: params.model,
            max_tokens: params.max_tokens,
            messages,
            response_format: params.responseFormat ? { type: params.responseFormat } : undefined,
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`API request timed out after ${timeoutMs}ms`)), timeoutMs));
          const response = (await Promise.race([requestPromise, timeoutPromise])) as OpenAI.Chat.ChatCompletion;

          const duration = Date.now() - startTime;
          const tokensInput = response.usage?.prompt_tokens || 0;
          const tokensOutput = response.usage?.completion_tokens || 0;
          console.log(`[LLM/${label}] ✅ OK ${duration}ms — In=${tokensInput}/Out=${tokensOutput}`);
          const text = response.choices[0]?.message?.content || '';
          // Garde-fou QUALITÉ : les LLM laissent parfois fuiter des caractères non latins (idéogrammes
          // CJK, hangul, cyrillique, arabe) dans un texte français — DeepSeek (modèle chinois) autant
          // que Gemini Flash-lite. Le contenu du site est 100 % français → toute contamination = défaut.
          // On réessaie ; si ça persiste on remonte l'erreur : côté FREE → secours DeepSeek ; côté
          // DEEPSEEK → l'appelant saute l'item (mieux vaut pas de résumé qu'un résumé au charabia).
          if (FOREIGN_SCRIPT.test(text)) {
            if (attempt < MAX_RETRIES) {
              console.warn(`[LLM/${label}] ⚠️ sortie contaminée (caractères non latins) — nouvel essai ${attempt + 1}/${MAX_RETRIES}...`);
              await new Promise(r => setTimeout(r, 800));
              continue;
            }
            throw new Error('Sortie non-latine persistante');
          }
          return { content: [{ type: 'text', text }], usage: { input_tokens: tokensInput, output_tokens: tokensOutput } };
        } catch (err: any) {
          const duration = Date.now() - startTime;
          console.warn(`[LLM/${label}] ⚠️ essai ${attempt} échoué (${duration}ms) : ${err.message}`);
          const status = err.status ?? err.response?.status;
          const isRateLimit = status === 429;
          const is4xx = status >= 400 && status < 500;

          if (is4xx && !isRateLimit) {
            // Repli DeepSeek : alias "deepseek-chat" retiré → bascule sur le modèle supporté.
            if (label === 'DEEPSEEK' && params.model === 'deepseek-chat' &&
                /model|support|invalid|not found|404|exist/i.test(err.message || '')) {
              console.warn('[LLM/DEEPSEEK] deepseek-chat indisponible → repli deepseek-v4-flash.');
              params.model = 'deepseek-v4-flash';
              continue;
            }
            throw err; // 4xx non-429 : erreur définitive (remonte pour permettre le secours)
          }

          const isServerError = status >= 500;
          const isTimeout = err.message?.includes('timed out');
          const isNetworkError = !status && err.message?.includes('fetch');
          if (!(attempt < MAX_RETRIES && (isRateLimit || isServerError || isTimeout || isNetworkError))) throw err;

          const backoffDelay = delay * Math.pow(2, attempt - 1) + Math.random() * 1000;
          console.log(`[LLM/${label}] nouvelle tentative dans ${(backoffDelay / 1000).toFixed(1)}s...`);
          await new Promise(r => setTimeout(r, backoffDelay));
        }
      }
    };
    return queue.enqueue(exec);
  }
}

export const resilientDeepSeek = new ResilientDeepSeek();
