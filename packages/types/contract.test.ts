import { config } from '@upvoted/lib/config';
import { describe, expect, it } from 'vitest';
import {
  type Brief,
  BriefSchema,
  type EpisodeIndex,
  EpisodeIndexSchema,
  type Script,
  ScriptSchema,
  type Story,
} from './contract';

const maya = config.cast.host.name;
const [theo, nadia, felix] = config.cast.correspondents.map((member) => member.name) as [
  string,
  string,
  string,
];

function story(id: number, points: number): Story {
  return {
    id,
    title: `Story ${id}`,
    url: `https://example.com/${id}`,
    by: 'someone',
    points,
    numComments: 10,
    createdAt: '2026-11-02T12:00:00.000Z',
    domain: 'example.com',
    hnUrl: `https://news.ycombinator.com/item?id=${id}`,
    kind: 'story',
    selfText: null,
    articleText: 'Article text.',
    articleError: null,
    comments: [
      {
        id: id * 10,
        by: 'commenter',
        text: 'A comment.',
        replies: [{ id: id * 10 + 1, by: 'replier', text: 'A reply.', replies: [] }],
      },
    ],
  };
}

const brief: Brief = {
  date: '2026-11-03',
  generatedAt: '2026-11-03T08:05:00.000Z',
  stories: [story(1, 300), story(2, 200), story(3, 100)],
};

const storySegment = (storyId: number, correspondent: string) => ({
  kind: 'story' as const,
  storyId,
  lines: [
    { speaker: maya, text: `${correspondent} has been following this. Good morning.` },
    { speaker: correspondent, text: `Good morning, ${maya}.`, cue: 'chuckles' },
  ],
});

const script: Script = {
  date: '2026-11-03',
  title: 'Upvoted for Tuesday, November 3',
  description: 'Show notes.',
  segments: [
    { kind: 'intro', storyId: null, lines: [{ speaker: maya, text: 'This is Upvoted.' }] },
    storySegment(1, theo),
    storySegment(2, nadia),
    storySegment(3, felix),
    { kind: 'signoff', storyId: null, lines: [{ speaker: maya, text: 'See you tomorrow.' }] },
  ],
};

/** The script with segment `i` replaced. */
const withSegment = (i: number, segment: unknown) => ({
  ...script,
  segments: script.segments.map((s, j) => (j === i ? segment : s)),
});

const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe('Brief', () => {
  it('round-trips through JSON unchanged', () => {
    expect(BriefSchema.parse(roundTrip(brief))).toEqual(brief);
  });

  it('needs exactly three stories', () => {
    expect(BriefSchema.safeParse({ ...brief, stories: brief.stories.slice(0, 2) }).success).toBe(
      false,
    );
  });

  it('needs the stories biggest first', () => {
    const result = BriefSchema.safeParse({ ...brief, stories: [...brief.stories].reverse() });
    expect(result.success).toBe(false);
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(BriefSchema.safeParse({ ...brief, date: '11/03/2026' }).success).toBe(false);
  });
});

describe('Script', () => {
  it('round-trips through JSON unchanged', () => {
    expect(ScriptSchema.parse(roundTrip(script))).toEqual(script);
  });

  it('rejects a speaker who is not in the cast', () => {
    const result = ScriptSchema.safeParse(
      withSegment(0, { kind: 'intro', storyId: null, lines: [{ speaker: 'Bob', text: 'Hi.' }] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['segments', 0, 'lines', 0, 'speaker']);
  });

  it.each([
    [0, 'intro'],
    [4, 'signoff'],
  ] as const)('lets only the host speak in the %s', (i, kind) => {
    const lines = [
      { speaker: maya, text: 'Hello.' },
      { speaker: theo, text: 'Hello.' },
    ];
    const result = ScriptSchema.safeParse(withSegment(i, { kind, storyId: null, lines }));
    expect(result.success).toBe(false);
  });

  it('needs the host and exactly one correspondent in a story', () => {
    const hostOnly = { kind: 'story', storyId: 1, lines: [{ speaker: maya, text: 'Hi.' }] };
    const twoCorrespondents = {
      ...storySegment(1, theo),
      lines: [...storySegment(1, theo).lines, { speaker: nadia, text: 'And me.' }],
    };
    for (const segment of [hostOnly, twoCorrespondents]) {
      const result = ScriptSchema.safeParse(withSegment(1, segment));
      expect(result.success).toBe(false);
    }
  });

  it("gives each story its own correspondent, in the cast's order", () => {
    const result = ScriptSchema.safeParse(withSegment(2, storySegment(2, felix)));
    expect(result.success).toBe(false);
  });

  it('needs the intro, three stories and the sign-off, in that order', () => {
    const missing = { ...script, segments: script.segments.slice(0, 4) };
    const result = ScriptSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it('needs a storyId on a story segment', () => {
    const result = ScriptSchema.safeParse(
      withSegment(1, { ...storySegment(1, theo), storyId: null }),
    );
    expect(result.success).toBe(false);
  });

  it.each([
    [0, 'intro'],
    [4, 'signoff'],
  ] as const)('rejects a storyId on the %s', (i, kind) => {
    const result = ScriptSchema.safeParse(
      withSegment(i, { kind, storyId: 1, lines: [{ speaker: maya, text: 'Hi.' }] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['segments', i, 'storyId']);
  });

  it('rejects a segment with no lines', () => {
    const result = ScriptSchema.safeParse(
      withSegment(0, { kind: 'intro', storyId: null, lines: [] }),
    );
    expect(result.success).toBe(false);
  });
});

describe('EpisodeIndex', () => {
  const record = (date: string) => ({
    date,
    title: `Upvoted for ${date}`,
    description: 'Show notes.',
    audio: {
      key: `episodes/${date}/episode.mp3`,
      url: `https://blob.example.com/episodes/${date}/episode.mp3`,
      bytes: 8_600_000,
      durationSec: 720.5,
    },
    stories: [1, 2, 3].map((id) => ({
      id,
      title: `Story ${id}`,
      url: id === 3 ? null : `https://example.com/${id}`,
      domain: id === 3 ? null : 'example.com',
      hnUrl: `https://news.ycombinator.com/item?id=${id}`,
    })),
    publishedAt: `${date}T08:20:00.000Z`,
  });

  it('round-trips through JSON unchanged', () => {
    const index: EpisodeIndex = { episodes: [record('2026-11-03'), record('2026-11-02')] };
    expect(EpisodeIndexSchema.parse(roundTrip(index))).toEqual(index);
  });

  it('needs the episodes newest first, one per date', () => {
    const oldestFirst = { episodes: [record('2026-11-02'), record('2026-11-03')] };
    const duplicate = { episodes: [record('2026-11-03'), record('2026-11-03')] };
    expect(EpisodeIndexSchema.safeParse(oldestFirst).success).toBe(false);
    expect(EpisodeIndexSchema.safeParse(duplicate).success).toBe(false);
  });
});
