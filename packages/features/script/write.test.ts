import { config } from '@upvoted/lib/config';
import { readJsonFixture } from '@upvoted/testing/fixtures';
import { type Brief, BriefSchema, type Script, ScriptSchema, type Segment } from '@upvoted/types';
import { MockLanguageModelV4, MockProviderV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assembleScript,
  renderTranscript,
  ScriptValidationError,
  writeBookends,
  writeStorySegment,
} from './write';

const brief = BriefSchema.parse(readJsonFixture('brief-sample.json')) as Brief;
const sample = ScriptSchema.parse(readJsonFixture('script-sample.json')) as Script;
const maya = config.cast.host.name;
const theo = config.cast.correspondents[0].name;
const felix = config.cast.correspondents[2].name;

type CallOptions = MockLanguageModelV4['doGenerateCalls'][number];
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const intro = sample.segments[0] as Segment;
const stories = sample.segments.slice(1, 4);
const signoff = sample.segments[4] as Segment;

/** A model that answers each call with the next of `responses`, as JSON text. */
function mockWriter(...responses: unknown[]) {
  const results = responses.map(
    (response): GenerateResult => ({
      content: [{ type: 'text', text: JSON.stringify(response) }],
      finishReason: { unified: 'stop', raw: 'end_turn' },
      usage: {
        inputTokens: { total: 12_000, noCache: 12_000, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 3_000, text: 1_500, reasoning: 1_500 },
      },
      warnings: [],
    }),
  );
  const model = new MockLanguageModelV4({ provider: 'gateway', doGenerate: results });
  // Model ids that are plain strings resolve through the default provider; this one only
  // knows the configured writer model, so any other id fails.
  globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV4({
    languageModels: { [config.writer.model]: model },
  });
  return model;
}

function callAt(model: MockLanguageModelV4, n: number): CallOptions {
  const call = model.doGenerateCalls[n];
  if (!call) throw new Error(`No call ${n}`);
  return call;
}

/** The text of the call's system and user messages. */
function promptText(call: CallOptions, role: 'system' | 'user'): string {
  return call.prompt
    .filter((message) => message.role === role)
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => ('text' in part ? part.text : '')).join(''),
    )
    .join('\n');
}

const goodLines = (stories[0] as Segment).lines;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
});

describe('writeStorySegment', () => {
  it('returns the story segment the model wrote', async () => {
    mockWriter({ lines: goodLines });
    const segment = await writeStorySegment(brief, 0);
    expect(segment).toEqual({ kind: 'story', storyId: brief.stories[0]?.id, lines: goodLines });
  });

  it('shows the full story but only the titles of the other two, and no usernames', async () => {
    const model = mockWriter({ lines: (stories[1] as Segment).lines });
    await writeStorySegment(brief, 1);
    const prompt = promptText(callAt(model, 0), 'user');
    const [first, second, third] = brief.stories;

    /** The start of a text as it appears inside the prompt's JSON. */
    const quoted = (text: string | null | undefined) => JSON.stringify(text ?? '').slice(1, 200);

    expect(prompt).toContain(quoted(second?.articleText));
    expect(prompt).toContain(quoted(second?.comments[0]?.text));
    expect(prompt).toContain(first?.title);
    expect(prompt).toContain(third?.title);
    expect(prompt).not.toContain(quoted(first?.articleText));
    expect(prompt).not.toContain(quoted(third?.selfText));
    for (const comment of second?.comments ?? []) {
      expect(prompt).not.toContain(`"${comment.by}"`);
    }
  });

  it.each([
    ['a URL', 'Read it at https://example.com today.'],
    ['markdown', 'It is *wild*.'],
  ])('rejects a line with %s, and accepts the retry', async (_, text) => {
    mockWriter({ lines: [{ speaker: maya, text }, ...goodLines.slice(1)] }, { lines: goodLines });
    expect((await writeStorySegment(brief, 0)).lines).toEqual(goodLines);
  });

  it("rejects another story's correspondent, and accepts the retry", async () => {
    const wrong = (stories[1] as Segment).lines.map((line) =>
      line.speaker === maya ? line : { ...line, speaker: felix },
    );
    mockWriter({ lines: wrong }, { lines: (stories[1] as Segment).lines });
    expect((await writeStorySegment(brief, 1)).lines).toEqual((stories[1] as Segment).lines);
  });

  it('retries when the output does not match the schema', async () => {
    mockWriter({ lines: [{ speaker: maya, text: 'Hi.', cue: 'whispers' }] }, { lines: goodLines });
    expect((await writeStorySegment(brief, 0)).lines).toEqual(goodLines);
  });

  it('throws when the retry fails too', async () => {
    const onlyMaya = [{ speaker: maya, text: 'Just me today.' }];
    mockWriter({ lines: onlyMaya }, { lines: onlyMaya });
    await expect(writeStorySegment(brief, 2)).rejects.toBeInstanceOf(ScriptValidationError);
  });
});

describe('writeBookends', () => {
  it('writes the intro and sign-off from the finished segments', async () => {
    const model = mockWriter({ intro: intro.lines, signoff: signoff.lines });
    const result = await writeBookends(brief, stories);

    expect(result.intro).toEqual(intro);
    expect(result.signoff).toEqual(signoff);
    const prompt = promptText(callAt(model, 0), 'user');
    for (const segment of stories) expect(prompt).toContain(segment.lines[0]?.text);
  });

  it('rejects a correspondent in the cold open, and accepts the retry', async () => {
    const withTheo = [...intro.lines, { speaker: theo, text: 'And I am Theo.' }];
    mockWriter(
      { intro: withTheo, signoff: signoff.lines },
      { intro: intro.lines, signoff: signoff.lines },
    );
    expect((await writeBookends(brief, stories)).intro).toEqual(intro);
  });
});

describe('assembleScript', () => {
  it("puts the stories in the brief's order between the intro and sign-off", () => {
    const shuffled = [stories[2], stories[0], stories[1]] as Segment[];
    const script = assembleScript(brief, intro, shuffled, signoff);

    expect(ScriptSchema.parse(script)).toEqual(script);
    expect(script.segments.map((segment) => segment.kind)).toEqual([
      'intro',
      'story',
      'story',
      'story',
      'signoff',
    ]);
    expect(script.segments.slice(1, 4).map((segment) => segment.storyId)).toEqual(
      brief.stories.map((story) => story.id),
    );
  });

  it("links every story's article and HN discussion in the show notes", () => {
    const script = assembleScript(brief, intro, stories, signoff);
    for (const story of brief.stories) {
      expect(script.description).toContain(story.hnUrl);
      if (story.url) expect(script.description).toContain(story.url);
    }
  });

  it('throws when a story segment is missing or belongs to another story', () => {
    expect(() => assembleScript(brief, intro, stories.slice(0, 2), signoff)).toThrow(
      /No story segment/,
    );
    const stray = { ...(stories[0] as Segment), storyId: 1 };
    expect(() => assembleScript(brief, intro, [stray, ...stories.slice(1)], signoff)).toThrow(
      /No story segment/,
    );
  });
});

describe('renderTranscript', () => {
  it('includes every line and the show notes', () => {
    const transcript = renderTranscript(sample);
    for (const line of sample.segments.flatMap((segment) => segment.lines)) {
      expect(transcript).toContain(line.text);
    }
    expect(transcript).toContain(sample.description);
  });
});
