import { config } from '@upvoted/lib/config';
import { readJsonFixture } from '@upvoted/testing/fixtures';
import {
  type EpisodeStory,
  type Script,
  type ScriptDraft,
  ScriptSchema,
  type Segment,
} from '@upvoted/types';
import { describe, expect, it } from 'vitest';
import { buildScript, checkScript, renderTranscript, type Selection } from './script';

const sample = ScriptSchema.parse(readJsonFixture('script-sample.json')) as Script;
const ids = sample.segments.flatMap((segment) => (segment.storyId ? [segment.storyId] : []));
const selection: Selection = { date: sample.date, ids };
const maya = config.cast.host.name;
const [theo, nadia] = config.cast.correspondents.map((member) => member.name) as [string, string];

/** The sample as the agent would send it: no story ids, title or show notes. */
function draft(): ScriptDraft {
  return {
    date: sample.date,
    segments: sample.segments.map(({ kind, lines }) => ({ kind, lines: [...lines] })),
  };
}

function withSegment(i: number, change: (segment: ScriptDraft['segments'][number]) => unknown) {
  const value = draft();
  return {
    ...value,
    segments: value.segments.map((segment, j) => (j === i ? change(segment) : segment)),
  };
}

const stories: EpisodeStory[] = ids.map((id, i) => ({
  id,
  title: `Story ${i + 1}`,
  url: i === 2 ? null : `https://example.com/${id}`,
  domain: i === 2 ? null : 'example.com',
  hnUrl: `https://news.ycombinator.com/item?id=${id}`,
}));

describe('checkScript', () => {
  it('accepts a well-formed script for the selected stories', () => {
    expect(checkScript(draft(), ids, selection)).toEqual([]);
  });

  it('refuses before get_top_stories has picked the stories', () => {
    expect(checkScript(draft(), ids, null)).toHaveLength(1);
  });

  it.each([
    ['another story', [ids[0], ids[1], 999] as number[]],
    ['the right stories in another order', [ids[1], ids[0], ids[2]] as number[]],
    ['only two stories', ids.slice(0, 2)],
  ])('rejects %s', (_, storyIds) => {
    expect(checkScript(draft(), storyIds, selection)).not.toEqual([]);
  });

  it('rejects a script for another date', () => {
    expect(checkScript({ ...draft(), date: '2026-11-04' }, ids, selection)).not.toEqual([]);
  });

  it.each([
    [
      'a correspondent in the cold open',
      withSegment(0, (s) => ({ ...s, lines: [...s.lines, { speaker: theo, text: 'Hello.' }] })),
    ],
    [
      "another story's correspondent",
      withSegment(1, (s) => ({ ...s, lines: [...s.lines, { speaker: nadia, text: 'Hi.' }] })),
    ],
    [
      'a story with only the host',
      withSegment(2, (s) => ({ ...s, lines: [{ speaker: maya, text: 'Just me.' }] })),
    ],
    ['a missing story', { ...draft(), segments: draft().segments.filter((_, i) => i !== 2) }],
    [
      'an unknown speaker',
      withSegment(0, () => ({ kind: 'intro', lines: [{ speaker: 'Bob', text: 'Hi.' }] })),
    ],
    [
      'a URL read aloud',
      withSegment(4, (s) => ({ ...s, lines: [{ speaker: maya, text: 'Visit www.upvoted.dev.' }] })),
    ],
    [
      'markdown',
      withSegment(4, (s) => ({ ...s, lines: [{ speaker: maya, text: 'That was **big**.' }] })),
    ],
    [
      'an unknown cue',
      withSegment(4, (s) => ({ ...s, lines: [{ speaker: maya, text: 'Bye.', cue: 'shouts' }] })),
    ],
  ])('rejects %s', (_, value) => {
    expect(checkScript(value, ids, selection)).not.toEqual([]);
  });
});

describe('buildScript', () => {
  const script = buildScript(draft(), stories);

  it('gives story segment i the id of story i', () => {
    expect(script.segments.map((segment: Segment) => segment.storyId)).toEqual([
      null,
      ...ids,
      null,
    ]);
  });

  it("builds the title and show notes from the stories' HN details", () => {
    expect(script.title).toContain('Story 1');
    for (const story of stories) {
      expect(script.description).toContain(story.title);
      expect(script.description).toContain(story.hnUrl);
      if (story.url) expect(script.description).toContain(story.url);
    }
  });

  it('renders a transcript with every line and the show notes', () => {
    const transcript = renderTranscript(script);
    for (const line of script.segments.flatMap((segment) => segment.lines)) {
      expect(transcript).toContain(line.text);
    }
    expect(transcript).toContain(script.description);
  });
});
