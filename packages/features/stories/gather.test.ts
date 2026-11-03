import { htmlResponse } from '@upvoted/testing/fetch';
import { readFixture } from '@upvoted/testing/fixtures';
import { hnFixtures, stubHnApi } from '@upvoted/testing/hn';
import type { StoryRef } from '@upvoted/types';
import { describe, expect, it } from 'vitest';
import { gatherStory, REPLIES_PER_COMMENT, TOP_COMMENTS } from './gather';

const ARTICLE_URL = 'https://chalmovsky.com/posts/wtf-ubuntu';

const ubuntu: StoryRef = {
  id: 50337608,
  title: 'WTF Ubuntu?',
  url: ARTICLE_URL,
  by: 'chalmovsky',
  points: 1590,
  numComments: 662,
  createdAt: '2026-11-02T14:52:00.000Z',
};

const subvocal: StoryRef = {
  id: 50340088,
  title: 'Show HN: Subvocal – Talk to your computer without making noise',
  url: null,
  by: 'aarushyadav',
  points: 800,
  numComments: 373,
  createdAt: '2026-11-02T17:16:17.000Z',
};

const article = () => htmlResponse(readFixture('articles/wtf-ubuntu.html'));

function kidsOf(items: ReturnType<typeof hnFixtures>['items'], id: number): number[] {
  return items[String(id)]?.kids ?? [];
}

describe('gatherStory', () => {
  it('keeps the story as selected and adds where it lives', async () => {
    stubHnApi({ pages: { [ARTICLE_URL]: article } });

    const story = await gatherStory(ubuntu);

    expect(story).toMatchObject({
      ...ubuntu,
      domain: 'chalmovsky.com',
      hnUrl: 'https://news.ycombinator.com/item?id=50337608',
      kind: 'story',
      selfText: null,
      articleError: null,
    });
  });

  it("extracts the article's readable text", async () => {
    stubHnApi({ pages: { [ARTICLE_URL]: article } });

    const { articleText } = await gatherStory(ubuntu);

    expect(articleText).toMatch(/^2026-11-02\n\nWhat the fuck, Ubuntu\?\n\nIn case you missed it:/);
    expect(articleText).toContain('Debian patched it on October 16.');
    expect(articleText).not.toContain('plausible');
  });

  it("takes the top comments and replies in HN's own order", async () => {
    const { items } = hnFixtures();
    stubHnApi({ items, pages: { [ARTICLE_URL]: article } });

    const { comments } = await gatherStory(ubuntu);

    expect(comments.map((c) => c.id)).toEqual(kidsOf(items, ubuntu.id).slice(0, TOP_COMMENTS));
    for (const comment of comments) {
      expect(comment.replies.map((r) => r.id)).toEqual(
        kidsOf(items, comment.id).slice(0, REPLIES_PER_COMMENT),
      );
      expect(comment.replies.every((reply) => reply.replies.length === 0)).toBe(true);
    }
  });

  it('turns comment HTML into plain text', async () => {
    stubHnApi({ pages: { [ARTICLE_URL]: article } });

    const { comments } = await gatherStory(ubuntu);
    const byId = new Map(comments.map((comment) => [comment.id, comment]));

    expect(byId.get(50338289)?.by).toBe('BoppreH');
    expect(byId.get(50338289)?.text).toMatch(
      /^Worse yet, the Ubuntu security incident page\[0\] lists "Ubuntu Priority: High" .* There's a "Why this priority\?" link that simply says:\n\n> Why is this CVE high priority\?\n\n> See ubuntu cvss score\n\nThat's it,/,
    );
    expect(byId.get(50337998)?.text).toMatch(
      /^Here is Ubuntu’s webpage on this vulnerability:\n\nhttps:\/\/ubuntu\.com\/security\/CVE-2026-98432\n\nIt’s still,/,
    );
    for (const comment of comments) {
      for (const text of [comment.text, ...comment.replies.map((reply) => reply.text)]) {
        expect(text).not.toMatch(/<[a-z/]|&(quot|#x27|#x2F|gt|lt|amp);/);
      }
    }
  });

  it('skips dead and deleted comments, taking the next ones instead', async () => {
    const { items } = hnFixtures();
    const kids = kidsOf(items, ubuntu.id);
    const [first, second, third] = kids as [number, number, number];
    items[second] = { ...items[second], id: second, dead: true };
    items[third] = { id: third, deleted: true };
    const firstReplies = kidsOf(items, first);
    items[firstReplies[0] as number] = { id: firstReplies[0] as number, deleted: true };
    stubHnApi({ items, pages: { [ARTICLE_URL]: article } });

    const { comments } = await gatherStory(ubuntu);

    expect(comments.map((c) => c.id)).toEqual([first, ...kids.slice(3, TOP_COMMENTS + 2)]);
    expect(comments[0]?.replies.map((r) => r.id)).toEqual(firstReplies.slice(1, 3));
  });

  it("uses the post's own text when there is no link", async () => {
    const { items } = hnFixtures();
    items[subvocal.id] = { ...items[subvocal.id], id: subvocal.id, kids: [] };
    const fetch = stubHnApi({ items });

    const story = await gatherStory(subvocal);

    expect(story).toMatchObject({
      kind: 'show',
      domain: null,
      articleText: null,
      articleError: null,
      comments: [],
    });
    expect(story.selfText).toMatch(
      /^Hi HN, we're Aarush and Arnav from The Subvocal Company \(YC F26\) \(https:\/\/subvocal\.company\/\)\. /,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe('when the article cannot be read', () => {
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
    ])('records %s in articleError and still gathers the rest', async (_, page, error) => {
      stubHnApi({ pages: { [ARTICLE_URL]: page } });

      const story = await gatherStory(ubuntu);

      expect(story.articleText).toBeNull();
      expect(story.articleError).toMatch(error);
      expect(story.comments).toHaveLength(TOP_COMMENTS);
    });

    it('records a network failure in articleError', async () => {
      // No page is stubbed for the article, so its fetch fails as it would offline.
      stubHnApi();

      const story = await gatherStory(ubuntu);

      expect(story.articleText).toBeNull();
      expect(story.articleError).toContain(`Could not fetch ${ARTICLE_URL}`);
      expect(story.comments).toHaveLength(TOP_COMMENTS);
    });
  });

  it('fails when the HN API fails, so the step can be retried', async () => {
    const { items } = hnFixtures();
    delete items[ubuntu.id];
    stubHnApi({ items, pages: { [ARTICLE_URL]: article } });

    await expect(gatherStory(ubuntu)).rejects.toThrow('hacker-news.firebaseio.com');
  });
});
