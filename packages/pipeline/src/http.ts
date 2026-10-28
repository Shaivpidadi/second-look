/**
 * Shared Model API transport: retry with backoff for 429/5xx and hung
 * calls, a hard per-run call budget, and per-process call/token stats
 * for eval reports. Real adapters route every HTTP attempt through
 * `postJson`; stub adapters never touch this module, so unit tests
 * stay offline.
 */

export interface CallStats {
  /** Every HTTP attempt, including retries. */
  httpCalls: number;
  /** Attempts that were retries after a 429/5xx. */
  retriedCalls: number;
  inputTokens: number;
  outputTokens: number;
}

const ZERO_STATS: CallStats = {
  httpCalls: 0,
  retriedCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
};

let stats: CallStats = { ...ZERO_STATS };

/** Copy of the per-process stats accumulated by real adapters. */
export function getCallStats(): CallStats {
  return { ...stats };
}

/** Reset per-process stats (tests and fresh CLI runs). */
export function resetCallStats(): void {
  stats = { ...ZERO_STATS };
}

/** Default hard cap on Model API attempts per process. */
export const DEFAULT_CALL_BUDGET = 300;

/**
 * Effective call budget from `SECOND_LOOK_CALL_BUDGET`, defaulting to
 * {@link DEFAULT_CALL_BUDGET}. Non-integer or negative values throw.
 */
export function callBudgetLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SECOND_LOOK_CALL_BUDGET;
  if (raw === undefined || raw === "") return DEFAULT_CALL_BUDGET;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `SECOND_LOOK_CALL_BUDGET must be a non-negative integer, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function takeCallSlot(): void {
  const limit = callBudgetLimit();
  if (stats.httpCalls >= limit) {
    throw new Error(
      `Model API call budget exhausted (${limit} calls); raise SECOND_LOOK_CALL_BUDGET to continue`,
    );
  }
  stats.httpCalls += 1;
}

/** Accumulate token usage parsed from a Model API response payload. */
export function recordUsage(inputTokens: number, outputTokens: number): void {
  if (Number.isFinite(inputTokens) && inputTokens > 0) stats.inputTokens += inputTokens;
  if (Number.isFinite(outputTokens) && outputTokens > 0) stats.outputTokens += outputTokens;
}

export interface RetryOptions {
  /** Retries after the first attempt; default 3. */
  maxRetries?: number;
  /** Base backoff in ms, doubled per retry; default 500. */
  baseMs?: number;
  /** Sleep hook so tests skip real waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Retry-After ceiling in ms; default 30000. */
  maxRetryAfterMs?: number;
  /**
   * Per-attempt timeout in ms; default 60000. A timed-out attempt
   * aborts and retries like a 5xx instead of stalling the run.
   */
  timeoutMs?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(headers: Headers, maxRetryAfterMs: number): number | null {
  const raw = headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, maxRetryAfterMs);
}

async function errorSnippet(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return "";
  }
}

export interface PostJsonOptions {
  fetchImpl: typeof fetch;
  url: string;
  key: string;
  body: unknown;
  /** Error prefix naming the caller, e.g. "spark" or "sam". */
  what: string;
  retry?: RetryOptions;
}

/**
 * POST JSON with the Model API key, retrying 429/5xx and timeouts with
 * exponential backoff. Every attempt consumes one call-budget slot.
 * Transport failures and non-retryable statuses throw immediately
 * with the caller prefix.
 */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const maxRetries = options.retry?.maxRetries ?? 3;
  const baseMs = options.retry?.baseMs ?? 500;
  const maxRetryAfterMs = options.retry?.maxRetryAfterMs ?? 30000;
  const timeoutMs = options.retry?.timeoutMs ?? 60000;
  const sleep = options.retry?.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    takeCallSlot();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timed out"));
      }, timeoutMs);
    });
    let response: Response;
    try {
      response = await Promise.race([
        options.fetchImpl(options.url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(options.body),
          signal: controller.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted && attempt < maxRetries) {
        stats.retriedCalls += 1;
        const wait = baseMs * 2 ** attempt;
        attempt += 1;
        await sleep(wait);
        continue;
      }
      if (controller.signal.aborted) {
        throw new Error(
          `${options.what}: Model API request timed out after ${timeoutMs}ms`,
        );
      }
      throw new Error(
        `${options.what}: Model API request failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    clearTimeout(timer);
    if (response.ok) {
      return (await response.json()) as unknown;
    }
    const status = response.status;
    const retryable = status === 429 || (status >= 500 && status <= 599);
    if (retryable && attempt < maxRetries) {
      stats.retriedCalls += 1;
      const wait = retryAfterMs(response.headers, maxRetryAfterMs) ?? baseMs * 2 ** attempt;
      attempt += 1;
      await sleep(wait);
      continue;
    }
    const snippet = await errorSnippet(response);
    throw new Error(
      `${options.what}: Model API request failed with status ${status}${snippet ? `: ${snippet}` : ""}`,
    );
  }
}
