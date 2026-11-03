import { fetchJson } from '@upvoted/lib/http';
import { z } from 'zod';

/** Hacker News APIs: Algolia's search (to rank) and HN's own Firebase API (items, comments). */

export const ALGOLIA_SEARCH_URL = 'https://hn.algolia.com/api/v1/search';

export function firebaseItemUrl(id: number): string {
  return `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
}

export function hnItemUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export const AlgoliaHitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullish(),
  url: z.string().nullish(),
  author: z.string().nullish(),
  points: z.number().nullish(),
  num_comments: z.number().nullish(),
  created_at_i: z.number(),
  _tags: z.array(z.string()).default([]),
});
export type AlgoliaHit = z.infer<typeof AlgoliaHitSchema>;

export const AlgoliaSearchSchema = z.object({ hits: z.array(AlgoliaHitSchema) });

export const HnItemSchema = z.object({
  id: z.number(),
  /** `story`, `comment`, `job`, `poll` or `pollopt`. */
  type: z.string().optional(),
  by: z.string().optional(),
  time: z.number().optional(),
  /** HTML. */
  text: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
  /** Child ids in HN's own ranking order. */
  kids: z.array(z.number()).optional(),
  dead: z.boolean().optional(),
  deleted: z.boolean().optional(),
});
export type HnItem = z.infer<typeof HnItemSchema>;

/** Fetches an item from HN's Firebase API; null when HN has no such item. */
export async function fetchItem(id: number): Promise<HnItem | null> {
  return HnItemSchema.nullable().parse(await fetchJson(firebaseItemUrl(id)));
}

/** True for an item that exists and is neither dead (flagged or killed) nor deleted. */
export function isLive(item: HnItem | null): item is HnItem {
  return item !== null && !item.dead && !item.deleted;
}
