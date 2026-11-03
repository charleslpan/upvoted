import { config, correspondentFor } from '@upvoted/lib/config';
import type { Brief, Line, Script, Segment, Story } from '@upvoted/types';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';
import { CUES, SCRIPT_STYLE_GUIDE, spokenDate } from './prompt';

/**
 * The writer: three per-story calls (run in parallel by the workflow), one short call for the
 * intro and sign-off, then deterministic assembly. Each call is sized to finish well inside
 * Vercel Hobby's 300-second function limit, retry included.
 */

/** Opus 5.5's default, set explicitly. Charles asked for medium on Nov 3; don't raise it. */
const REASONING = 'medium';
/** Room for adaptive thinking plus a ~550-word segment (~1,500 tokens of JSON). */
const MAX_OUTPUT_TOKENS = 16_000;
/** Per attempt, gateway retries included. Two attempts stay under 300 seconds. */
const CALL_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 2;

const host = config.cast.host.name;

/**
 * What the model writes: lines only, from the speakers allowed in that part. Kinds, story ids
 * and links are added in code.
 */
function modelLineSchema(speakers: [string, ...string[]]) {
  return z.object({
    speaker: z
      .enum(speakers)
      .describe(speakers.length === 1 ? `Always ${speakers[0]}` : `${speakers.join(' or ')}`),
    text: z.string().min(1).describe('The spoken words, plain text for a voice engine'),
    cue: z.enum(CUES).optional().describe('An optional delivery direction, used rarely'),
  });
}
type ModelLine = z.infer<ReturnType<typeof modelLineSchema>>;

const HostLineSchema = modelLineSchema([host]);
const BookendsOutputSchema = z.object({
  intro: z.array(HostLineSchema).min(1).describe(`The cold open, ${host} alone`),
  signoff: z.array(HostLineSchema).min(1).describe(`The sign-off, ${host} alone`),
});

/** Thrown when the model's output fails validation on both attempts. */
export class ScriptValidationError extends Error {
  constructor(
    readonly part: string,
    readonly problems: string[],
  ) {
    super(`The ${part} failed validation twice:\n- ${problems.join('\n- ')}`);
    this.name = 'ScriptValidationError';
  }
}

/** Writes the host's interview with the correspondent about `brief.stories[index]`. */
export async function writeStorySegment(brief: Brief, index: number): Promise<Segment> {
  const story = brief.stories[index];
  if (!story) throw new RangeError(`The brief has no story ${index}`);
  const correspondent = correspondentFor(index).name;
  const others = brief.stories.filter((_, i) => i !== index).map((other) => other.title);

  const prompt = `Write story segment ${index + 1} of 3 for ${spokenDate(brief.date)}.

Only ${host}, the host, and ${correspondent}, this story's correspondent, speak. ${host} sets the story up in a few sentences, brings in ${correspondent} ("${correspondent} has been following this. Good morning." or close to it), interviews ${correspondent}, and closes with a short thank-you tag that ${correspondent} answers. Aim for 450 to 550 words. Start right in on ${host}'s setup, since the cold open is written separately; end on the tag, without teasing the next story.

The other two stories today are covered in their own segments, so don't discuss them:
${others.map((title) => `- ${title}`).join('\n')}

The brief for this story, as JSON:
${JSON.stringify(storyForPrompt(story), null, 2)}`;

  const speakers: [string, string] = [host, correspondent];
  const schema = z.object({ lines: z.array(modelLineSchema(speakers)).min(1) });
  const { lines } = await generate(`story ${index + 1} segment`, schema, prompt, (output) =>
    lineProblems(output.lines, speakers),
  );
  return { kind: 'story', storyId: story.id, lines: lines.map(toLine) };
}

/** Writes the host's dated cold open and sign-off around the finished story segments. */
export async function writeBookends(
  brief: Brief,
  stories: Segment[],
): Promise<{ intro: Segment; signoff: Segment }> {
  const date = spokenDate(brief.date);
  const segments = brief.stories.map((story, i) => {
    const segment = stories.find((s) => s.storyId === story.id);
    if (!segment) throw new Error(`No segment for story ${story.id}, "${story.title}"`);
    return `## Story ${i + 1}: ${story.title}\n\n${segment.lines.map((line) => `${line.speaker}: ${line.text}`).join('\n')}`;
  });

  const prompt = `Write the cold open and the sign-off for ${date}. ${host} speaks alone in both.

The cold open is 60 to 100 words. It starts straight on a hook for story 1, then "I'm ${host}, and this is ${config.show.name}, the top of Hacker News for ${date}.", then a one-line tease for story 2 and for story 3, in that order, then a short stay-with-us line in ${config.show.name}'s own words. Each hook and tease matches what the segment actually says.

The sign-off is 40 to 70 words. It opens "And that's ${config.show.name} for this ${date}. I'm ${host}.", then one honest credit line, such as "${config.show.name} is written by Claude and voiced by Gemini.", then a short send-off in your own words.

The three story segments, already written:

${segments.join('\n\n')}`;

  const output = await generate('intro and sign-off', BookendsOutputSchema, prompt, (value) => [
    ...lineProblems(value.intro, [host]).map((p) => `intro: ${p}`),
    ...lineProblems(value.signoff, [host]).map((p) => `signoff: ${p}`),
  ]);
  return {
    intro: { kind: 'intro', storyId: null, lines: output.intro.map(toLine) },
    signoff: { kind: 'signoff', storyId: null, lines: output.signoff.map(toLine) },
  };
}

/** Puts the segments in running order with the episode's title and show notes. */
export function assembleScript(
  brief: Brief,
  intro: Segment,
  stories: Segment[],
  signoff: Segment,
): Script {
  if (intro.kind !== 'intro') throw new Error(`Expected an intro segment, got ${intro.kind}`);
  if (signoff.kind !== 'signoff')
    throw new Error(`Expected a signoff segment, got ${signoff.kind}`);
  const ordered = brief.stories.map((story) => {
    const segment = stories.find((s) => s.kind === 'story' && s.storyId === story.id);
    if (!segment) throw new Error(`No story segment for story ${story.id}, "${story.title}"`);
    return segment;
  });
  if (stories.length !== ordered.length) {
    throw new Error(`Expected ${ordered.length} story segments, got ${stories.length}`);
  }
  return {
    date: brief.date,
    title: episodeTitle(brief),
    description: showNotes(brief),
    segments: [intro, ...ordered, signoff],
  };
}

/** Renders the script as the Markdown transcript saved next to it. */
export function renderTranscript(script: Script): string {
  let story = 0;
  const sections = script.segments.map((segment) => {
    const heading =
      segment.kind === 'intro'
        ? 'Intro'
        : segment.kind === 'signoff'
          ? 'Sign-off'
          : `Story ${++story}`;
    const lines = segment.lines.map(
      (line) => `**${line.speaker}:** ${line.cue ? `*(${line.cue})* ` : ''}${line.text}`,
    );
    return `## ${heading}\n\n${lines.join('\n\n')}`;
  });
  return `# ${script.title}\n\n${sections.join('\n\n')}\n\n## Show notes\n\n${script.description}\n`;
}

// ---------------------------------------------------------------------------------------------
// Model calls

/**
 * One structured-output call, validated. If the output fails the schema or `check`, it asks
 * once more with the problems appended, then gives up.
 */
async function generate<S extends z.ZodType>(
  part: string,
  schema: S,
  prompt: string,
  check: (output: z.infer<S>) => string[],
): Promise<z.infer<S>> {
  let problems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const request =
      problems.length === 0
        ? prompt
        : `${prompt}\n\n# Your previous attempt was rejected\n\nIt had these problems:\n${problems.map((p) => `- ${p}`).join('\n')}\n\nWrite the whole part again, fixing them.`;
    const started = performance.now();
    try {
      const result = await generateText({
        model: config.writer.model,
        system: SCRIPT_STYLE_GUIDE,
        prompt: request,
        output: Output.object({ schema, name: 'script_part' }),
        reasoning: REASONING,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        timeout: CALL_TIMEOUT_MS,
      });
      const { inputTokens, outputTokens, outputTokenDetails } = result.usage;
      console.log(
        `  writer: ${part}, attempt ${attempt}: ${seconds(started)}s, ` +
          `${inputTokens ?? '?'} tokens in, ${outputTokens ?? '?'} out ` +
          `(${outputTokenDetails.reasoningTokens ?? '?'} reasoning)`,
      );
      const output = result.output as z.infer<S>;
      problems = check(output);
      if (problems.length === 0) return output;
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      console.log(`  writer: ${part}, attempt ${attempt}: ${seconds(started)}s, invalid JSON`);
      problems = [`The response didn't match the JSON schema: ${error.message}`];
    }
    console.log(`  writer: ${part} rejected: ${problems.join('; ')}`);
  }
  throw new ScriptValidationError(part, problems);
}

/** The story as the model sees it: no usernames, so none can be read aloud. */
function storyForPrompt(story: Story) {
  return {
    title: story.title,
    kind: story.kind,
    domain: story.domain,
    points: story.points,
    commentCount: story.numComments,
    postText: story.selfText,
    articleText: story.articleText,
    articleError: story.articleError,
    comments: story.comments.map((comment) => ({
      text: comment.text,
      replies: comment.replies.map((reply) => reply.text),
    })),
  };
}

function toLine(line: ModelLine): Line {
  return line.cue
    ? { speaker: line.speaker, text: line.text, cue: line.cue }
    : {
        speaker: line.speaker,
        text: line.text,
      };
}

// ---------------------------------------------------------------------------------------------
// Validation

const URL_PATTERN = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|dev|ai|app|co)\b/i;
/** Markdown that a voice engine would read out: emphasis, headings, code, links, lists. */
const MARKDOWN_PATTERN = /[*_`#]|\[[^\]]*\]\(|^\s*[-+>]\s/m;

/**
 * What's wrong with a part's lines, as sentences the model can act on. Empty when fine. Every
 * one of `speakers`, and no one else, must speak.
 */
export function lineProblems(lines: Line[], speakers: string[]): string[] {
  const problems: string[] = [];
  lines.forEach((line, i) => {
    const where = `line ${i + 1}`;
    if (!speakers.includes(line.speaker)) {
      problems.push(
        `${where}: the speaker must be ${speakers.join(' or ')}, not "${line.speaker}"`,
      );
    }
    if (URL_PATTERN.test(line.text)) problems.push(`${where}: the text contains a URL or domain`);
    if (MARKDOWN_PATTERN.test(line.text)) problems.push(`${where}: the text contains markdown`);
    if (line.cue !== undefined && !(CUES as readonly string[]).includes(line.cue)) {
      problems.push(`${where}: "${line.cue}" is not an allowed cue (${CUES.join(', ')})`);
    }
  });
  if (speakers.length > 1 && speakers.some((name) => !lines.some((l) => l.speaker === name))) {
    problems.push(`both ${speakers.join(' and ')} must speak`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Title and show notes, built from the brief so links are never the model's

function episodeTitle(brief: Brief): string {
  const [top] = brief.stories;
  return `${spokenDate(brief.date)}: ${top?.title ?? config.show.name}, and two more`;
}

function showNotes(brief: Brief): string {
  const stories = brief.stories.map((story, i) => {
    const links = [
      story.url ? `   Article: ${story.url}` : null,
      `   Discussion: ${story.hnUrl}`,
    ].filter(Boolean);
    return `${i + 1}. ${story.title}\n${links.join('\n')}`;
  });
  return `The three biggest Hacker News stories for ${spokenDate(brief.date)}.\n\n${stories.join('\n\n')}`;
}

function seconds(started: number): string {
  return ((performance.now() - started) / 1000).toFixed(1);
}
