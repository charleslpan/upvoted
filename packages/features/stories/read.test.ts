import { htmlResponse } from '@upvoted/testing/fetch';
import { readFixture } from '@upvoted/testing/fixtures';
import { hnFixtures, stubHnApi } from '@upvoted/testing/hn';
import { describe, expect, it } from 'vitest';
import { getArticle, getComments, getReplies, lookupStories } from './read';

const UBUNTU = 50337608;
const SUBVOCAL = 50340088;
const ARTICLE_URL = 'https://chalmovsky.com/posts/wtf-ubuntu';

const article = () => htmlResponse(readFixture('articles/wtf-ubuntu.html'));

function kidsOf(items: ReturnType<typeof hnFixtures>['items'], id: number): number[] {
  return items[String(id)]?.kids ?? [];
}

/** Every username in the fixtures, none of which may reach the agent. */
function usernames(): string[] {
  const { items } = hnFixtures();
  return [...new Set(Object.values(items).flatMap((item) => (item?.by ? [item.by] : [])))];
}

const MARKUP = /<[a-z/]|&(quot|#x27|#x2F|gt|lt|amp);/;

describe('getArticle', () => {
  it("returns the article's readable text and where it lives", async () => {
    stubHnApi({ pages: { [ARTICLE_URL]: article } });

    const story = await getArticle(UBUNTU);

    expect(story).toMatchObject({
      id: UBUNTU,
      title: 'WTF Ubuntu?',
      kind: 'story',
      url: ARTICLE_URL,
      domain: 'chalmovsky.com',
      postText: null,
      articleError: null,
    });
    expect(story.articleText).toContain('Debian patched it on October 16.');
  });

  it("returns the post's own text when there is no link", async () => {
    stubHnApi();

    const story = await getArticle(SUBVOCAL);

    expect(story).toMatchObject({ kind: 'show', url: null, articleText: null, articleError: null });
    expect(story.postText).toContain('Hi HN');
    expect(story.postText).not.toMatch(MARKUP);
  });

  it.each([
    ['an HTTP error', () => new Response('Forbidden', { status: 403 }), 'HTTP 403'],
    [
      'a PDF',
      () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
      'Not an HTML page (application/pdf)',
    ],
    [
      'a PDF served without a content type',
      () => new Response(new TextEncoder().encode('%PDF-1.7 ...')),
      'Not an HTML page (application/pdf)',
    ],
    [
      'a page with almost no text',
      () => htmlResponse('<html><body><div id="app">Loading…</div></body></html>'),
      /^(No readable article text found|Too little readable text)/,
    ],
  ])('reports %s as articleError instead of throwing', async (_, page, error) => {
    stubHnApi({ pages: { [ARTICLE_URL]: page } });

    const story = await getArticle(UBUNTU);

    expect(story.articleText).toBeNull();
    expect(story.articleError).toMatch(error);
  });

  it('reports a network failure as articleError', async () => {
    // No page is stubbed for the article, so its fetch fails as it would offline.
    stubHnApi();

    const story = await getArticle(UBUNTU);

    expect(story.articleText).toBeNull();
    expect(story.articleError).toContain(`Could not fetch ${ARTICLE_URL}`);
  });

  it('fails when HN has no such story', async () => {
    const { items } = hnFixtures();
    delete items[UBUNTU];
    stubHnApi({ items });

    await expect(getArticle(UBUNTU)).rejects.toThrow('hacker-news.firebaseio.com');
  });
});

describe('getComments', () => {
  it("returns the top comments in HN's own order, as plain text with no usernames", async () => {
    const { items } = hnFixtures();
    stubHnApi({ items });

    const { comments } = await getComments(UBUNTU, { limit: 5 });

    expect(comments.map((c) => c.id)).toEqual(kidsOf(items, UBUNTU).slice(0, 5));
    expect(comments[0]?.replyCount).toBe(kidsOf(items, comments[0]?.id ?? 0).length);
    const json = JSON.stringify(comments);
    for (const name of usernames()) expect(json).not.toContain(`"${name}"`);
    for (const comment of comments) expect(comment.text).not.toMatch(MARKUP);
  });

  it('pages through the thread with the cursor', async () => {
    const { items } = hnFixtures();
    stubHnApi({ items });

    const first = await getComments(UBUNTU, { limit: 4 });
    const second = await getComments(UBUNTU, { limit: 4, cursor: first.nextCursor });

    expect([...first.comments, ...second.comments].map((c) => c.id)).toEqual(
      kidsOf(items, UBUNTU).slice(0, 8),
    );
  });

  it('skips dead and deleted comments, taking the next ones instead', async () => {
    const { items } = hnFixtures();
    const kids = kidsOf(items, UBUNTU);
    const [first, second, third] = kids as [number, number, number];
    items[second] = { ...items[second], id: second, dead: true };
    items[third] = { id: third, deleted: true };
    stubHnApi({ items });

    const page = await getComments(UBUNTU, { limit: 3 });

    expect(page.comments.map((c) => c.id)).toEqual([first, ...kids.slice(3, 5)]);
    expect(page.nextCursor).toBe('5');
  });

  it('ends with a null cursor', async () => {
    const { items } = hnFixtures();
    items[SUBVOCAL] = { ...items[SUBVOCAL], id: SUBVOCAL, kids: kidsOf(items, UBUNTU).slice(0, 2) };
    stubHnApi({ items });

    const page = await getComments(SUBVOCAL, { limit: 5 });

    expect(page.comments).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });
});

describe('getReplies', () => {
  it("returns a comment's top replies in HN's order, with no usernames", async () => {
    const { items } = hnFixtures();
    const [comment] = kidsOf(items, UBUNTU) as [number];
    stubHnApi({ items });

    const replies = await getReplies(comment, { limit: 2 });

    expect(replies.map((r) => r.id)).toEqual(kidsOf(items, comment).slice(0, 2));
    const json = JSON.stringify(replies);
    for (const name of usernames()) expect(json).not.toContain(`"${name}"`);
  });
});

describe('lookupStories', () => {
  it("builds each story's links from HN, in the order asked", async () => {
    stubHnApi();

    const stories = await lookupStories([SUBVOCAL, UBUNTU]);

    expect(stories).toEqual([
      {
        id: SUBVOCAL,
        title: 'Show HN: Subvocal – Talk to your computer without making noise',
        url: null,
        domain: null,
        hnUrl: `https://news.ycombinator.com/item?id=${SUBVOCAL}`,
      },
      {
        id: UBUNTU,
        title: 'WTF Ubuntu?',
        url: ARTICLE_URL,
        domain: 'chalmovsky.com',
        hnUrl: `https://news.ycombinator.com/item?id=${UBUNTU}`,
      },
    ]);
  });

  it('fails for an id that is not a story', async () => {
    const { items } = hnFixtures();
    const [comment] = kidsOf(items, UBUNTU) as [number];
    stubHnApi({ items });

    await expect(lookupStories([comment])).rejects.toThrow(`HN has no story ${comment}`);
  });
});
