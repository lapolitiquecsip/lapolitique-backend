import Anthropic from '@anthropic-ai/sdk';

const MAX_RETRIES = parseInt(process.env.ANTHROPIC_MAX_RETRIES || '3', 10);
const RPM = parseInt(process.env.ANTHROPIC_REQUESTS_PER_MINUTE || '50', 10);
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

const anthropicQueue = new RequestQueue();

// Robust Claude client wrapper
export class ResilientAnthropic {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    });
  }

  /**
   * Send a message to Anthropic Claude with rate limiting, timeouts, and exponential backoff retries.
   */
  async createMessage(params: Anthropic.MessageCreateParams, options?: { timeoutMs?: number }): Promise<Anthropic.Message> {
    const timeoutMs = options?.timeoutMs || 45000; // 45s default timeout

    const executeWithRetryAndTimeout = async (): Promise<Anthropic.Message> => {
      let attempt = 0;
      let delay = 2000; // start with 2s delay

      while (true) {
        attempt++;
        const startTime = Date.now();
        
        try {
          console.log(`[Anthropic SDK] Calling Claude (Model: ${params.model}, Attempt: ${attempt}/${MAX_RETRIES})...`);
          
          // Implement timeout using Promise.race and support simulated 429 errors
          if (process.env.MOCK_ANTHROPIC_429 === 'true' && attempt < MAX_RETRIES) {
            const mockErr = new Error('Rate Limit Exceeded (Simulated 429)');
            (mockErr as any).status = 429;
            throw mockErr;
          }

          const requestPromise = this.client.messages.create(params) as Promise<Anthropic.Message>;
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`API request timed out after ${timeoutMs}ms`)), timeoutMs);
          });

          const response = await Promise.race([requestPromise, timeoutPromise]);
          const duration = Date.now() - startTime;
          const tokensInput = response.usage?.input_tokens || 0;
          const tokensOutput = response.usage?.output_tokens || 0;
          
          console.log(`[Anthropic SDK] ✅ Success. Duration: ${duration}ms, Tokens: In=${tokensInput}/Out=${tokensOutput}`);
          return response;
        } catch (err: any) {
          const duration = Date.now() - startTime;
          console.warn(`[Anthropic SDK] ⚠️ Attempt ${attempt} failed after ${duration}ms. Error: ${err.message}`);

          // Determine if we should retry (rate limit, server error, timeout)
          const isRateLimit = err.status === 429;
          const is4xx = err.status >= 400 && err.status < 500;

          if (is4xx && !isRateLimit) {
            console.error(`[Anthropic SDK] ❌ NON_RETRYABLE_ERROR: ${err.message} (status: ${err.status})`);
            throw err;
          }

          const isServerError = err.status >= 500;
          const isTimeout = err.message?.includes('timed out');
          const isNetworkError = !err.status && err.message?.includes('fetch');

          const shouldRetry = attempt < MAX_RETRIES && (isRateLimit || isServerError || isTimeout || isNetworkError);

          if (!shouldRetry) {
            console.error(`[Anthropic SDK] ❌ Request failed permanently after ${attempt} attempts.`);
            throw err;
          }

          // Backoff delay with some jitter
          const backoffDelay = delay * Math.pow(2, attempt - 1) + Math.random() * 1000;
          console.log(`[Anthropic SDK] Retrying in ${(backoffDelay / 1000).toFixed(1)}s...`);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        }
      }
    };

    // Enqueue the request to honor requests per minute constraints
    return anthropicQueue.enqueue(executeWithRetryAndTimeout);
  }
}

export const resilientAnthropic = new ResilientAnthropic();
