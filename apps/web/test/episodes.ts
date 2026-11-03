import { keys } from '@upvoted/lib/storage';
import type { EpisodeRecord, Segment, Story, StoryRef } from '@upvoted/types';

/** Small, valid contract values for the web app's tests. */

export function storyRef(id: number, points: number): StoryRef {
  return {
    id,
    title: `Story ${id}`,
    url: id === 3 ? null : `https://example.com/${id}`,
    by: 'someone',
    points,
    numComments: 10,
    createdAt: '2026-11-03T01:00:00.000Z',
  };
}

export function story(ref: StoryRef): Story {
  return {
    ...ref,
    domain: ref.url ? 'example.com' : null,
    hnUrl: `https://news.ycombinator.com/item?id=${ref.id}`,
    kind: ref.url ? 'story' : 'ask',
    selfText: ref.url ? null : 'Ask HN text.',
    articleText: ref.url ? 'Article text.' : null,
    articleError: null,
    comments: [],
  };
}

export function segment(kind: Segment['kind'], storyId: number | null = null): Segment {
  return { kind, storyId, lines: [{ speaker: 'Maya', text: `A line for the ${kind}.` }] };
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
    stories: [storyRef(1, 300), storyRef(2, 200), storyRef(3, 100)].map((ref) => {
      const { id, title, url, domain, hnUrl } = story(ref);
      return { id, title, url, domain, hnUrl };
    }),
    publishedAt: `${date}T08:30:00.000Z`,
  };
}
