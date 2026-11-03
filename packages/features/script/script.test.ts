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
const [theo, nadia, felix] = config.cast.correspondents.map((member) => member.name) as [
  string,
  string,
  string,
];

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

/** `total` words as lines of at most 70 words, the speakers taking turns. */
function lines(speakers: string[], total: number) {
  const result: { speaker: string; text: string }[] = [];
  for (let left = total; left > 0; left -= 70) {
    result.push({
      speaker: speakers[result.length % speakers.length] ?? maya,
      text: words(Math.min(70, left)),
    });
  }
  return result;
}

/**
 * A script as the agent sends it (no story ids, title or show notes), inside every word budget:
 * a 90-word intro, three 620-word stories and a 50-word sign-off, 2,000 words in all.
 */
function draft(): ScriptDraft {
  return {
    date: sample.date,
    segments: [
      { kind: 'intro', lines: lines([maya], 90) },
      ...[theo, nadia, felix].map((correspondent) => ({
        kind: 'story' as const,
        lines: lines([maya, correspondent], 620),
      })),
      { kind: 'signoff', lines: lines([maya], 50) },
    ],
  };
}

/** The draft with `line` added to segment `i`. */
function withLine(i: number, line: { speaker: string; text: string; cue?: string }) {
  return withSegment(i, (s) => ({ ...s, lines: [...s.lines, line] }));
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
    ['a correspondent in the cold open', withLine(0, { speaker: theo, text: 'Hello.' })],
    ["another story's correspondent", withLine(1, { speaker: nadia, text: 'Hi.' })],
    ['a story with only the host', withSegment(2, (s) => ({ ...s, lines: lines([maya], 620) }))],
    ['a missing story', { ...draft(), segments: draft().segments.filter((_, i) => i !== 2) }],
    ['an unknown speaker', withLine(0, { speaker: 'Bob', text: 'Hi.' })],
    ['a URL read aloud', withLine(4, { speaker: maya, text: 'Visit www.upvoted.dev.' })],
    ['markdown', withLine(4, { speaker: maya, text: 'That was **big**.' })],
    ['a year in digits', withLine(4, { speaker: maya, text: 'Online since 2016.' })],
    ['a version in digits', withLine(4, { speaker: maya, text: 'It beat GPT-6.' })],
    ['an unknown cue', withLine(4, { speaker: maya, text: 'Bye.', cue: 'shouts' })],
    [
      'a line over 80 words',
      withSegment(1, (s) => ({
        ...s,
        lines: [...lines([maya, theo], 540), { speaker: theo, text: words(81) }],
      })),
    ],
  ])('rejects %s', (_, value) => {
    expect(checkScript(value, ids, selection)).not.toEqual([]);
  });

  it.each([
    // 540 words, under 550.
    ['a short story', 1, withSegment(1, (s) => ({ ...s, lines: lines([maya, theo], 540) }))],
    // 620 + 100 = 720 words, over 700.
    [
      'a long story',
      2,
      withSegment(2, (s) => ({ ...s, lines: [...s.lines, ...lines([nadia], 100)] })),
    ],
    // 90 + 30 = 120 words, over 110.
    ['a long cold open', 0, withLine(0, { speaker: maya, text: words(30) })],
    // 50 + 30 = 80 words, over 70.
    ['a long sign-off', 4, withLine(4, { speaker: maya, text: words(30) })],
  ])('rejects %s', (_, i, value) => {
    const problems = checkScript(value, ids, selection);
    expect(problems.some((problem) => problem.startsWith(`segments[${i}]`))).toBe(true);
  });

  it('rejects a script under the total word floor, even with every part in range', () => {
    const short = draft();
    short.segments = short.segments.map((segment) =>
      segment.kind === 'story'
        ? { ...segment, lines: lines(segment.lines.map((line) => line.speaker).slice(0, 2), 560) }
        : segment,
    ) as ScriptDraft['segments'];
    // Stories of 560 words are in range, but 90 + 3 × 560 + 50 is 1,820.
    expect(checkScript(short, ids, selection)).toHaveLength(1);
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
