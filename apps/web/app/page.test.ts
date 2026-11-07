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
    await publishEpisode({ ...episode('2026-11-03'), title: 'The latest' });
    const html = await render();

    expect(html).toContain('Tuesday, November 3, 2026');
    expect(html).toContain('The latest');
    expect(html).toContain('src="https://blob.example.com/episodes/2026-11-03/episode.mp3"');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('href="https://example.com/1"');
    expect(html).toContain('href="https://news.ycombinator.com/item?id=1"');
    // Story 3 is a text post: a discussion link and no article link.
    expect(html).toContain('href="https://news.ycombinator.com/item?id=3"');
    expect(html.match(/href="https:\/\/example\.com\//g)).toHaveLength(2);
    // A single episode has no earlier section.
    expect(html.match(/<audio/g)).toHaveLength(1);
    expect(html).not.toContain('<section');
  });

  it('lists the earlier episodes newest first, each with its own player and stories', async () => {
    // Published out of order: the index keeps them newest first.
    await publishEpisode({ ...episode('2026-11-01'), title: 'Two days before' });
    await publishEpisode({ ...episode('2026-11-03'), title: 'The latest' });
    await publishEpisode({ ...episode('2026-11-02'), title: 'The day before' });
    const html = await render();

    const audio = [...html.matchAll(/<audio[^>]*>/g)].map(([tag]) => ({
      src: tag.match(/src="([^"]+)"/)?.[1],
      preload: tag.match(/preload="([^"]+)"/)?.[1],
    }));
    expect(audio).toEqual([
      { src: 'https://blob.example.com/episodes/2026-11-03/episode.mp3', preload: 'metadata' },
      { src: 'https://blob.example.com/episodes/2026-11-02/episode.mp3', preload: 'none' },
      { src: 'https://blob.example.com/episodes/2026-11-01/episode.mp3', preload: 'none' },
    ]);

    const titles = ['The latest', 'The day before', 'Two days before'].map((t) => html.indexOf(t));
    expect(titles.every((at) => at >= 0)).toBe(true);
    expect(titles).toEqual([...titles].sort((a, b) => a - b));
    expect(html).toContain('Sunday, November 1, 2026');
    // Every episode lists its stories: one discussion link per story per episode.
    expect(html.match(/href="https:\/\/news\.ycombinator\.com\/item\?id=1"/g)).toHaveLength(3);
  });
});
