import { createLimiter } from '@upvoted/lib/http';
import {
  type Comment,
  type Story,
  type StoryKind,
  type StoryRef,
  StorySchema,
} from '@upvoted/types';
import { fetchArticle } from './article';
import { fetchItem, type HnItem, hnItemUrl, isLive } from './hn';
import { htmlToText } from './text';

export const TOP_COMMENTS = 12;
export const REPLIES_PER_COMMENT = 2;
/** At most this many HN API requests in flight per story. */
const CONCURRENCY = 8;

/**
 * Gathers what the script writer needs about one story: the article's text, the post's own
 * text, and the top comments in HN's ranking order. An article that can't be read is recorded
 * in `articleError`, never thrown; a failing HN API is thrown, so the step can be retried.
 */
export async function gatherStory(ref: StoryRef): Promise<Story> {
  const limit = createLimiter(CONCURRENCY);
  const item = await fetchItem(ref.id);
  const [article, comments] = await Promise.all([
    ref.url ? fetchArticle(ref.url) : { text: null, error: null },
    gatherComments(item?.kids ?? [], (id) => limit(() => fetchItem(id))),
  ]);
  return StorySchema.parse({
    ...ref,
    domain: domainOf(ref.url),
    hnUrl: hnItemUrl(ref.id),
    kind: storyKind(ref.title),
    selfText: item?.text ? htmlToText(item.text) || null : null,
    articleText: article.text,
    articleError: article.error,
    comments,
  });
}

/** The top live comments under a story, each with its top live replies, in HN's order. */
async function gatherComments(
  kids: number[],
  fetchComment: (id: number) => Promise<HnItem | null>,
): Promise<Comment[]> {
  const topLevel = await takeLiveComments(kids, TOP_COMMENTS, fetchComment);
  return Promise.all(
    topLevel.map(async (comment) => {
      const replies = await takeLiveComments(comment.kids ?? [], REPLIES_PER_COMMENT, fetchComment);
      return { ...toComment(comment), replies: replies.map(toComment) };
    }),
  );
}

type LiveComment = HnItem & { by: string; text: string };

/** The first `want` live comments among `ids`, fetched in order, a batch at a time. */
async function takeLiveComments(
  ids: number[],
  want: number,
  fetchComment: (id: number) => Promise<HnItem | null>,
): Promise<LiveComment[]> {
  const live: LiveComment[] = [];
  let next = 0;
  while (live.length < want && next < ids.length) {
    const batch = ids.slice(next, next + want - live.length);
    next += batch.length;
    for (const item of await Promise.all(batch.map(fetchComment))) {
      if (isLive(item) && item.type === 'comment' && item.by && item.text) {
        live.push(item as LiveComment);
      }
    }
  }
  return live;
}

function toComment(item: LiveComment): Comment {
  return { id: item.id, by: item.by, text: htmlToText(item.text), replies: [] };
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
