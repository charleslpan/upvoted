import { fetchJson } from '@upvoted/lib/http';
import { type StoryRef, StoryRefSchema } from '@upvoted/types';
import { ALGOLIA_SEARCH_URL, type AlgoliaHit, AlgoliaSearchSchema, fetchItem, isLive } from './hn';

/** How many of the day's stories to rank; far more than the few we pick and exclude. */
const CANDIDATES = 100;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Picks the `n` biggest stories (most points) submitted in the 24 hours before `now`, biggest
 * first. Skips jobs, dead or deleted items, and any id in `excludeIds`.
 */
export async function selectStories(now: Date, excludeIds: number[], n = 3): Promise<StoryRef[]> {
  const until = Math.floor(now.getTime() / 1000);
  const url = new URL(ALGOLIA_SEARCH_URL);
  url.searchParams.set('tags', 'story');
  url.searchParams.set(
    'numericFilters',
    `created_at_i>${until - DAY_SECONDS},created_at_i<=${until}`,
  );
  url.searchParams.set('hitsPerPage', String(CANDIDATES));
  const { hits } = AlgoliaSearchSchema.parse(await fetchJson(url.href));

  const excluded = new Set(excludeIds);
  const candidates = hits
    .filter((hit) => !hit._tags.includes('job'))
    .flatMap((hit) => toStoryRef(hit) ?? [])
    .filter((ref) => !excluded.has(ref.id))
    .sort(biggestFirst);

  // Algolia doesn't say whether a story is dead or deleted, so check the best candidates
  // against HN's own API, a few at a time, until n of them pass.
  const picked: StoryRef[] = [];
  let next = 0;
  while (picked.length < n && next < candidates.length) {
    const batch = candidates.slice(next, next + n - picked.length);
    next += batch.length;
    const items = await Promise.all(batch.map((ref) => fetchItem(ref.id)));
    batch.forEach((ref, i) => {
      const item = items[i] ?? null;
      if (isLive(item) && item.type !== 'job') picked.push(ref);
    });
  }
  if (picked.length < n) {
    throw new Error(
      `Found only ${picked.length} of ${n} stories from the 24 hours before ${now.toISOString()}`,
    );
  }
  return picked;
}

function toStoryRef(hit: AlgoliaHit): StoryRef | null {
  if (!hit.title || hit.points == null) return null;
  const parsed = StoryRefSchema.safeParse({
    id: Number(hit.objectID),
    title: hit.title,
    url: hit.url || null,
    by: hit.author ?? '',
    points: hit.points,
    numComments: hit.num_comments ?? 0,
    createdAt: new Date(hit.created_at_i * 1000).toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

function biggestFirst(a: StoryRef, b: StoryRef): number {
  return b.points - a.points || b.numComments - a.numComments || a.id - b.id;
}
