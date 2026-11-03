import { vi } from 'vitest';

/** Answers a request, or returns undefined to fail the test with "unexpected request". */
export type FetchHandler = (
  url: URL,
  init?: RequestInit,
) => Response | undefined | Promise<Response | undefined>;

/**
 * Replaces the global `fetch` for the current test. Returns the mock, so a test can check what
 * was requested. Unhandled requests reject, as they would with no network.
 */
export function stubFetch(handler: FetchHandler) {
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const response = await handler(url, init);
    if (!response) throw new TypeError(`fetch failed: unexpected request to ${url.href}`);
    return response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init?.headers },
  });
}

export function htmlResponse(html: string, init?: ResponseInit): Response {
  return new Response(html, {
    ...init,
    headers: { 'content-type': 'text/html; charset=utf-8', ...init?.headers },
  });
}
