import { htmlResponse, stubFetch } from '@upvoted/testing/fetch';
import { readFixture } from '@upvoted/testing/fixtures';
import { describe, expect, it } from 'vitest';
import { ARTICLE_MAX_WORDS, extractArticle, fetchArticle } from './article';
import { countWords } from './text';

const paragraph = (n: number) => `<p>${'word '.repeat(n).trim()}.</p>`;

describe('extractArticle', () => {
  it('extracts the readable text of a saved page', () => {
    const text = extractArticle(readFixture('articles/wtf-ubuntu.html'));

    expect(text.startsWith('2026-11-02\n\nWhat the fuck, Ubuntu?')).toBe(true);
    expect(text).toContain('This is true as of 2026-11-02 14:48 UTC.');
    expect(countWords(text)).toBeGreaterThan(250);
  });

  it(`caps the text at ${ARTICLE_MAX_WORDS} words`, () => {
    const html = `<html><body><article><h1>Long</h1>${paragraph(3000).repeat(4)}</article></body></html>`;

    const text = extractArticle(html);

    expect(text).toMatch(/\[Truncated after 8,000 words\.\]$/);
    expect(countWords(text)).toBeLessThan(ARTICLE_MAX_WORDS + 10);
  });

  it('throws when there is no article text', () => {
    expect(() => extractArticle('<html><body></body></html>')).toThrow();
  });
});

describe('fetchArticle', () => {
  it('sends a browser-like request', async () => {
    const fetch = stubFetch(() => htmlResponse(readFixture('articles/wtf-ubuntu.html')));

    const result = await fetchArticle('https://example.com/post');

    expect(result.error).toBeNull();
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('user-agent')).toMatch(/^Mozilla\/5\.0 .* Chrome\//);
    expect(headers.get('accept')).toContain('text/html');
  });

  it('decodes the charset the server declares', async () => {
    const body = `<html><body><article><h1>Café</h1>${paragraph(80)}<p>Fin: café.</p></article></body></html>`;
    const latin1 = Uint8Array.from(body, (char) => char.charCodeAt(0));
    stubFetch(
      () => new Response(latin1, { headers: { 'content-type': 'text/html; charset=ISO-8859-1' } }),
    );

    const { text } = await fetchArticle('https://example.com/post');

    expect(text).toContain('Fin: café.');
  });

  it('never throws', async () => {
    stubFetch(() => {
      throw new Error('boom');
    });

    const result = await fetchArticle('https://example.com/post');

    expect(result).toEqual({
      text: null,
      error: expect.stringContaining('Could not fetch https://example.com/post'),
    });
  });
});
