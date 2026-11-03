import { createLimiter } from '@upvoted/lib/http';
import type { EpisodeStory } from '@upvoted/types';
import { fetchArticle } from './article';
import { fetchItem, type HnItem, hnItemUrl, isLive } from './hn';
import { htmlToText } from './text';

/**
 * What the agent's read tools return: a story's article, its comments a page at a time, and a
 * comment's replies. Usernames never leave this module, so the script can't read one aloud.
 */

export const DEFAULT_COMMENTS = 12;
export const MAX_COMMENTS = 30;
export const DEFAULT_REPLIES = 5;
export const MAX_REPLIES = 10;
/** At most this many HN API requests in flight per call. */
const CONCURRENCY = 8;

export type StoryKind = 'story' | 'ask' | 'show';

export interface Article {
  id: number;
  title: string;
  kind: StoryKind;
  /** The linked page, or null for a text post. */
  url: string | null;
  domain: string | null;
  /** The post's own text (Ask HN, Show HN and other text posts), as plain text. */
  postText: string | null;
  /** The article's readable text, capped at about 8,000 words. */
  articleText: string | null;
  /** Why the article text is missing, when the story has a url but no text could be read. */
  articleError: string | null;
}

export interface ThreadComment {
  id: number;
  /** Plain text: HTML stripped, entities decoded, paragraphs separated by blank lines. */
  text: string;
  /** Direct replies on HN, dead and deleted ones included, so a few may not be readable. */
  replyCount: number;
}

export interface CommentsPage {
  comments: ThreadComment[];
  /** Pass back as `cursor` for the next page; null after the last comment. */
  nextCursor: string | null;
}

/** The story's linked article and its post text. An unreadable article is an error, not a throw. */
export async function getArticle(id: number): Promise<Article> {
  const item = await fetchStory(id);
  const url = item.url || null;
  const article = url ? await fetchArticle(url) : { text: null, error: null };
  return {
    id,
    title: item.title ?? '',
    kind: storyKind(item.title ?? ''),
    url,
    domain: domainOf(url),
    postText: item.text ? htmlToText(item.text) || null : null,
    articleText: article.text,
    articleError: article.error,
  };
}

/**
 * The story's live top-level comments in HN's own ranking order, `limit` at a time. `cursor` is a
 * previous page's `nextCursor`.
 */
export async function getComments(
  id: number,
  { limit = DEFAULT_COMMENTS, cursor }: { limit?: number; cursor?: string | null } = {},
): Promise<CommentsPage> {
  const item = await fetchStory(id);
  const start = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(start) || start < 0) throw new Error(`Invalid cursor ${cursor}`);
  const kids = item.kids ?? [];
  const { comments, next } = await takeLiveComments(kids, start, clamp(limit, MAX_COMMENTS));
  return { comments, nextCursor: next < kids.length ? String(next) : null };
}

/** A comment's top live replies, in HN's own ranking order. */
export async function getReplies(
  commentId: number,
  { limit = DEFAULT_REPLIES }: { limit?: number } = {},
): Promise<ThreadComment[]> {
  const item = await fetchItem(commentId);
  if (!item) throw new Error(`HN has no item ${commentId}`);
  const { comments } = await takeLiveComments(item.kids ?? [], 0, clamp(limit, MAX_REPLIES));
  return comments;
}

/** Each story's title and links, from HN by id, in the order given. */
export async function lookupStories(ids: number[]): Promise<EpisodeStory[]> {
  return Promise.all(
    ids.map(async (id) => {
      const item = await fetchStory(id);
      const url = item.url || null;
      return { id, title: item.title ?? '', url, domain: domainOf(url), hnUrl: hnItemUrl(id) };
    }),
  );
}

async function fetchStory(id: number): Promise<HnItem> {
  const item = await fetchItem(id);
  if (item?.type !== 'story' || !item.title) throw new Error(`HN has no story ${id}`);
  return item;
}

/**
 * The first `want` live comments among `ids` from index `start`, fetched in order, a batch at a
 * time. `next` is the index after the last id looked at.
 */
async function takeLiveComments(
  ids: number[],
  start: number,
  want: number,
): Promise<{ comments: ThreadComment[]; next: number }> {
  const limit = createLimiter(CONCURRENCY);
  const comments: ThreadComment[] = [];
  let next = start;
  while (comments.length < want && next < ids.length) {
    const batch = ids.slice(next, next + want - comments.length);
    next += batch.length;
    const items = await Promise.all(batch.map((id) => limit(() => fetchItem(id))));
    for (const item of items) {
      if (isLive(item) && item.type === 'comment' && item.text) {
        comments.push({
          id: item.id,
          text: htmlToText(item.text),
          replyCount: item.kids?.length ?? 0,
        });
      }
    }
  }
  return { comments, next };
}

function clamp(limit: number, max: number): number {
  return Math.min(Math.max(1, Math.floor(limit)), max);
}

function storyKind(title: string): StoryKind {
  if (/^ask hn\b/i.test(title)) return 'ask';
  if (/^show hn\b/i.test(title)) return 'show';
  return 'story';
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
