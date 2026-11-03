import { publishEpisode } from '@upvoted/features/episodes';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { episode } from '../test/episodes';
import Home from './page';

async function render(): Promise<string> {
  return renderToStaticMarkup(await Home());
}

describe('the home page', () => {
  it('renders without a player before the first episode', async () => {
    expect(await render()).not.toContain('<audio');
  });

  it('plays the latest episode, with links to its stories', async () => {
    await publishEpisode({ ...episode('2026-11-02'), title: 'The day before' });
    await publishEpisode({ ...episode('2026-11-03'), title: 'The latest' });
    const html = await render();

    expect(html).toContain('Tuesday, November 3, 2026');
    expect(html).toContain('The latest');
    expect(html).not.toContain('The day before');
    expect(html).toContain('src="https://blob.example.com/episodes/2026-11-03/episode.mp3"');
    expect(html).toContain('href="https://example.com/1"');
    expect(html).toContain('href="https://news.ycombinator.com/item?id=1"');
    // Story 3 is a text post: a discussion link and no article link.
    expect(html).toContain('href="https://news.ycombinator.com/item?id=3"');
    expect(html.match(/href="https:\/\/example\.com\//g)).toHaveLength(2);
  });
});
