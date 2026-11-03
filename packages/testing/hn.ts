import { jsonResponse, stubFetch } from './fetch';
import { readJsonFixture } from './fixtures';

/**
 * Recordings of the Hacker News APIs, made on Nov 3, 2026:
 * - `algolia`: the top 25 hits of Algolia's search for stories from the 24 hours before
 *   2026-11-03T08:00:00Z (`_highlightResult` dropped).
 * - `items`: HN Firebase items keyed by id: the top 6 of those stories, and for story
 *   50337608 ("WTF Ubuntu?") its first 14 top-level comments with up to 3 replies each.
 * Each call returns fresh copies, so a test may edit them.
 */
export function hnFixtures() {
  return {
    algolia: readJsonFixture<{ hits: Record<string, unknown>[] }>('hn/algolia-search.json'),
    items: readJsonFixture<Record<string, HnFixtureItem | null>>('hn/items.json'),
  };
}

export interface HnFixtureItem {
  id: number;
  type?: string;
  by?: string;
  text?: string;
  url?: string;
  title?: string;
  kids?: number[];
  dead?: boolean;
  deleted?: boolean;
  [key: string]: unknown;
}

/**
 * Stubs `fetch` with fake Algolia and Firebase APIs serving the given data, plus any other
 * pages by exact URL. A request for anything else fails the test.
 */
export function stubHnApi({
  algolia = hnFixtures().algolia,
  items = hnFixtures().items,
  pages = {},
}: {
  algolia?: unknown;
  items?: Record<string, HnFixtureItem | null>;
  pages?: Record<string, () => Response | Promise<Response>>;
} = {}) {
  return stubFetch((url) => {
    if (url.hostname === 'hn.algolia.com' && url.pathname === '/api/v1/search') {
      return jsonResponse(algolia);
    }
    const item = /^\/v0\/item\/(\d+)\.json$/.exec(url.pathname);
    if (url.hostname === 'hacker-news.firebaseio.com' && item?.[1] && item[1] in items) {
      return jsonResponse(items[item[1]]);
    }
    return pages[url.href]?.();
  });
}
