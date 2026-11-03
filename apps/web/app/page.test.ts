import { publishEpisode } from '@upvoted/features/episodes';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { episode } from '../test/episodes';
import Home from './page';

async function render(): Promise<string> {
  return renderToStaticMarkup(await Home());
}

describe('the home page', () => {
  it('says the first episode is coming before there is one', async () => {
    const html = await render();
    expect(html).toContain('Upvoted');
    expect(html).toContain('not affiliated with Hacker News or Y Combinator');
    expect(html).toContain('The first episode is on its way');
    expect(html).not.toContain('<audio');
  });

  it('plays the latest episode, with its stories', async () => {
    await publishEpisode({ ...episode('2026-11-02'), title: 'The day before' });
    await publishEpisode(episode('2026-11-03'));
    const html = await render();

    expect(html).toContain('Tuesday, November 3, 2026');
    expect(html).toContain('Tuesday, November 3: The top story, and two more');
    expect(html).not.toContain('The day before');
    expect(html).toContain(
      '<audio controls="" preload="metadata" src="https://blob.example.com/episodes/2026-11-03/episode.mp3">',
    );
    expect(html).toContain('<a href="https://example.com/1">Article (example.com)</a>');
    expect(html).toContain('<a href="https://news.ycombinator.com/item?id=1">HN discussion</a>');
    // Story 3 is a text post: a discussion link and no article link.
    expect(html).toContain('<a href="https://news.ycombinator.com/item?id=3">HN discussion</a>');
    expect(html.match(/>Article/g)).toHaveLength(2);
  });
});
