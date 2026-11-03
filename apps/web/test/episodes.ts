import { keys } from '@upvoted/lib/storage';
import type { EpisodeRecord, EpisodeStory } from '@upvoted/types';

/** Small, valid contract values for the web app's tests. */

function story(id: number): EpisodeStory {
  return {
    id,
    title: `Story ${id}`,
    url: id === 3 ? null : `https://example.com/${id}`,
    domain: id === 3 ? null : 'example.com',
    hnUrl: `https://news.ycombinator.com/item?id=${id}`,
  };
}

export function episode(date: string): EpisodeRecord {
  return {
    date,
    title: `Tuesday, November 3: The top story, and two more`,
    description: 'Show notes.',
    audio: {
      key: keys.episode(date),
      url: `https://blob.example.com/${keys.episode(date)}`,
      bytes: 8_000_000,
      durationSec: 700,
    },
    stories: [1, 2, 3].map(story),
    publishedAt: `${date}T08:30:00.000Z`,
  };
}
