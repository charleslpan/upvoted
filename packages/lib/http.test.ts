import { jsonResponse, stubFetch } from '@upvoted/testing/fetch';
import { describe, expect, it } from 'vitest';
import { createLimiter, fetchJson, fetchWithRetry, HttpError } from './http';

const fast = { backoffMs: 1 };

describe('fetchWithRetry', () => {
  it('retries server errors, then returns the response', async () => {
    const statuses = [503, 502, 200];
    const fetch = stubFetch(() => new Response('ok', { status: statuses.shift() }));

    const response = await fetchWithRetry('https://example.com/', {}, fast);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('returns the last response once retries run out', async () => {
    const fetch = stubFetch(() => new Response('busy', { status: 429 }));

    const response = await fetchWithRetry('https://example.com/', {}, { ...fast, retries: 1 });

    expect(response.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a client error', async () => {
    const fetch = stubFetch(() => new Response('gone', { status: 404 }));

    expect((await fetchWithRetry('https://example.com/', {}, fast)).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries network errors, then throws a readable error', async () => {
    const fetch = stubFetch(() => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
    });

    await expect(fetchWithRetry('https://example.com/', {}, fast)).rejects.toThrow(
      'Could not fetch https://example.com/: getaddrinfo ENOTFOUND',
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('gives each attempt a timeout signal', async () => {
    const fetch = stubFetch(() => new Response('ok'));

    await fetchWithRetry('https://example.com/', {}, fast);

    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('fetchJson', () => {
  it('parses a JSON response', async () => {
    stubFetch(() => jsonResponse({ ok: true }));
    expect(await fetchJson('https://example.com/data.json', fast)).toEqual({ ok: true });
  });

  it('throws an HttpError for a non-2xx response', async () => {
    stubFetch(() => new Response('nope', { status: 403 }));
    await expect(fetchJson('https://example.com/data.json', fast)).rejects.toBeInstanceOf(
      HttpError,
    );
  });
});

describe('createLimiter', () => {
  it('keeps at most the given number of tasks in flight, and runs them all', async () => {
    const limit = createLimiter(2);
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async (value: number) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return value;
    };

    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(() => task(n))));

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxInFlight).toBe(2);
  });

  it('frees the slot when a task fails', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await limit(async () => 'next')).toBe('next');
  });
});
