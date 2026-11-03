import { config } from '@upvoted/lib/config';
import { readJsonFixture } from '@upvoted/testing/fixtures';
import { type Brief, BriefSchema, type Script, ScriptSchema, type Segment } from '@upvoted/types';
import { MockLanguageModelV4, MockProviderV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUES, SCRIPT_STYLE_GUIDE } from './prompt';
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
const [theo, nadia, felix] = config.cast.correspondents.map((member) => member.name) as [
  string,
  string,
  string,
];

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
  it("allows only the host and the story's own correspondent", async () => {
    const model = mockWriter({ lines: (stories[1] as Segment).lines });
    await writeStorySegment(brief, 1);
    const call = callAt(model, 0);
    const schema = call.responseFormat?.type === 'json' ? call.responseFormat.schema : undefined;
    expect(schema).toMatchObject({
      properties: { lines: { items: { properties: { speaker: { enum: [maya, nadia] } } } } },
    });
  });

  it('asks the configured model for structured lines at medium effort', async () => {
    const model = mockWriter({ lines: goodLines });
    await writeStorySegment(brief, 0);

    expect(model.doGenerateCalls).toHaveLength(1);
    const call = callAt(model, 0);
    expect(call.reasoning).toBe('medium');
    expect(call.responseFormat?.type).toBe('json');
    const schema = call.responseFormat?.type === 'json' ? call.responseFormat.schema : undefined;
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            properties: {
              speaker: { enum: [maya, theo] },
              cue: { enum: [...CUES] },
            },
          },
        },
      },
    });
    expect(promptText(call, 'system')).toBe(SCRIPT_STYLE_GUIDE);
  });

  it('returns a story segment for the story, with the model id from config', async () => {
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
    expect(prompt).toContain(`- ${first?.title}`);
    expect(prompt).toContain(`- ${third?.title}`);
    expect(prompt).not.toContain(quoted(first?.articleText));
    expect(prompt).not.toContain(quoted(third?.selfText));
    for (const comment of second?.comments ?? []) {
      expect(prompt).not.toContain(`"${comment.by}"`);
    }
    expect(prompt).toContain(`Only ${maya}, the host, and ${nadia}, this story's correspondent`);
    expect(prompt).toContain(`${nadia} has been following this. Good morning.`);
  });

  it('retries once with the problems appended, then accepts a fixed answer', async () => {
    const bad = [
      { speaker: maya, text: 'Read it at https://example.com, it is *wild*.' },
      { speaker: theo, text: 'Okay.' },
    ];
    const model = mockWriter({ lines: bad }, { lines: goodLines });
    const segment = await writeStorySegment(brief, 0);

    expect(segment.lines).toEqual(goodLines);
    expect(model.doGenerateCalls).toHaveLength(2);
    const retry = promptText(callAt(model, 1), 'user');
    expect(retry).toContain('Your previous attempt was rejected');
    expect(retry).toContain('line 1: the text contains a URL or domain');
    expect(retry).toContain('line 1: the text contains markdown');
  });

  it('retries when the output does not match the schema', async () => {
    const model = mockWriter(
      { lines: [{ speaker: maya, text: 'Hi.', cue: 'whispers' }] },
      { lines: goodLines },
    );
    await writeStorySegment(brief, 0);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(promptText(callAt(model, 1), 'user')).toContain("didn't match the JSON schema");
  });

  it('throws when the retry fails too', async () => {
    const onlyMaya = [{ speaker: maya, text: 'Just me today.' }];
    mockWriter({ lines: onlyMaya }, { lines: onlyMaya });
    const error = await writeStorySegment(brief, 2).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScriptValidationError);
    expect((error as ScriptValidationError).problems).toEqual([
      `both ${maya} and ${felix} must speak`,
    ]);
  });
});

describe('writeBookends', () => {
  it('writes the intro and sign-off from the finished segments', async () => {
    const model = mockWriter({ intro: intro.lines, signoff: signoff.lines });
    const result = await writeBookends(brief, stories);

    expect(result.intro).toEqual(intro);
    expect(result.signoff).toEqual(signoff);
    const call = callAt(model, 0);
    const prompt = promptText(call, 'user');
    expect(prompt).toContain(
      `I'm ${maya}, and this is Upvoted, the top of Hacker News for Tuesday, November 3.`,
    );
    expect(prompt).toContain(`And that's Upvoted for this Tuesday, November 3. I'm ${maya}.`);
    const schema = call.responseFormat?.type === 'json' ? call.responseFormat.schema : undefined;
    const hostOnly = { items: { properties: { speaker: { enum: [maya] } } } };
    expect(schema).toMatchObject({ properties: { intro: hostOnly, signoff: hostOnly } });
    for (const segment of stories) {
      const line = segment.lines[0];
      expect(prompt).toContain(`${line?.speaker}: ${line?.text}`);
    }
  });

  it('rejects a correspondent in the cold open', async () => {
    const withTheo = [...intro.lines, { speaker: theo, text: 'And I am Theo.' }];
    const model = mockWriter(
      { intro: withTheo, signoff: signoff.lines },
      { intro: intro.lines, signoff: signoff.lines },
    );
    expect((await writeBookends(brief, stories)).intro).toEqual(intro);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(promptText(callAt(model, 1), 'user')).toContain("didn't match the JSON schema");
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

  it('builds the title and show notes from the brief, matching the fixture', () => {
    const script = assembleScript(brief, intro, stories, signoff);
    expect(script.title).toBe(sample.title);
    expect(script.description).toBe(sample.description);
    for (const story of brief.stories) {
      expect(script.description).toContain(story.hnUrl);
      if (story.url) expect(script.description).toContain(story.url);
    }
    expect(script).toEqual(sample);
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
  it('renders headings, bold host names and italic cues', () => {
    const transcript = renderTranscript(sample);
    expect(transcript.startsWith(`# ${sample.title}\n\n## Intro\n\n`)).toBe(true);
    expect(transcript).toContain('## Story 1\n\n');
    expect(transcript).toContain('## Story 3\n\n');
    expect(transcript).toContain('## Sign-off\n\n');
    expect(transcript).toContain(`**${theo}:** *(thoughtful)* Probably not magic.`);
    expect(transcript).toContain(`**${felix}:** Good morning, ${maya}.`);
    expect(transcript.endsWith(`## Show notes\n\n${sample.description}\n`)).toBe(true);
  });
});
