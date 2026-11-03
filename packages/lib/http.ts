/** Small fetch helpers shared by the pipeline steps: timeouts, retries and a concurrency cap. */

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/142.0.0.0 Safari/537.36';

export interface RetryOptions {
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Extra attempts after the first, for network errors, timeouts, 429 and 5xx. */
  retries?: number;
  /** Delay before the first retry; doubles on each retry. */
  backoffMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpError';
  }
}

/**
 * `fetch` with a per-attempt timeout and retries. Resolves with the last response, whatever its
 * status, once retries run out; rejects only when no response came back at all.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { timeoutMs = 10_000, retries = 2, backoffMs = 500 }: RetryOptions = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const lastAttempt = attempt >= retries;
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (lastAttempt || !isRetryable(response.status)) return response;
      await response.body?.cancel();
    } catch (error) {
      if (lastAttempt) throw describeFetchError(error, url, timeoutMs);
    }
    await sleep(backoffMs * 2 ** attempt);
  }
}

/** Fetches JSON, retrying transient failures, and throws on any non-2xx response. */
export async function fetchJson(url: string, options?: RetryOptions): Promise<unknown> {
  const response = await fetchWithRetry(url, { headers: { accept: 'application/json' } }, options);
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status, url);
  }
  return response.json();
}

/** Returns a function that runs tasks with at most `concurrency` of them in flight. */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active < concurrency) active++;
    // A finishing task hands its slot straight to the next one in the queue.
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await task();
    } finally {
      const waiting = queue.shift();
      if (waiting) waiting();
      else active--;
    }
  };
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function describeFetchError(error: unknown, url: string, timeoutMs: number): Error {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new Error(`Timed out after ${timeoutMs / 1000}s fetching ${url}`);
  }
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Could not fetch ${url}: ${message}`, { cause: error });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
