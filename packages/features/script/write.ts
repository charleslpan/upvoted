import { config } from '@upvoted/lib/config';
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

const hostNames = config.hosts.map((host) => host.name) as [string, string];

/** What the model writes: lines only. Kinds, story ids and links are added in code. */
const ModelLineSchema = z.object({
  speaker: z.enum(hostNames).describe("One of the two hosts' names"),
  text: z.string().min(1).describe('The spoken words, plain text for a voice engine'),
  cue: z.enum(CUES).optional().describe('An optional delivery direction, about one line in five'),
});
const StoryOutputSchema = z.object({ lines: z.array(ModelLineSchema).min(1) });
const BookendsOutputSchema = z.object({
  intro: z.array(ModelLineSchema).min(1),
  signoff: z.array(ModelLineSchema).min(1),
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

/** Writes the two hosts' conversation about `brief.stories[index]`, a `story` segment. */
export async function writeStorySegment(brief: Brief, index: number): Promise<Segment> {
  const story = brief.stories[index];
  if (!story) throw new RangeError(`The brief has no story ${index}`);
  const lead = hostNames[index % 2] as string;
  const skeptic = hostNames[(index + 1) % 2] as string;
  const others = brief.stories.filter((_, i) => i !== index).map((other) => other.title);

  const prompt = `Write the conversation about story ${index + 1} of 3 for ${spokenDate(brief.date)}.

${lead} leads this story and ${skeptic} plays the curious skeptic. Aim for 450 to 550 words. Start right in on the story, since the intro and the hand-off are written separately; end on a line that lands the story, without teasing the next one.

The other two stories today are covered in their own segments, so don't discuss them:
${others.map((title) => `- ${title}`).join('\n')}

The brief for this story, as JSON:
${JSON.stringify(storyForPrompt(story), null, 2)}`;

  const { lines } = await generate(
    `story ${index + 1} segment`,
    StoryOutputSchema,
    prompt,
    (output) => lineProblems(output.lines),
  );
  return { kind: 'story', storyId: story.id, lines: lines.map(toLine) };
}

/** Writes the dated intro and the sign-off around the finished story segments. */
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

  const prompt = `Write the intro and the sign-off for ${date}.

The intro is 60 to 90 words, shared by both hosts. It opens with "This is ${config.show.name}, the top of Hacker News for ${date}", then gives each story a one-line hook, in this order, that matches what the hosts actually say in it. The sign-off is 40 to 60 words: a warm, quick wrap that thanks the listener and says the show is back tomorrow. Both hosts speak in each.

The three story segments, already written:

${segments.join('\n\n')}`;

  const output = await generate('intro and sign-off', BookendsOutputSchema, prompt, (value) => [
    ...lineProblems(value.intro).map((p) => `intro: ${p}`),
    ...lineProblems(value.signoff).map((p) => `signoff: ${p}`),
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

function toLine(line: z.infer<typeof ModelLineSchema>): Line {
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

/** What's wrong with a part's lines, as sentences the model can act on. Empty when fine. */
export function lineProblems(lines: Line[]): string[] {
  const problems: string[] = [];
  lines.forEach((line, i) => {
    const where = `line ${i + 1}`;
    if (!(hostNames as string[]).includes(line.speaker)) {
      problems.push(
        `${where}: the speaker must be ${hostNames.join(' or ')}, not "${line.speaker}"`,
      );
    }
    if (URL_PATTERN.test(line.text)) problems.push(`${where}: the text contains a URL or domain`);
    if (MARKDOWN_PATTERN.test(line.text)) problems.push(`${where}: the text contains markdown`);
    if (line.cue !== undefined && !(CUES as readonly string[]).includes(line.cue)) {
      problems.push(`${where}: "${line.cue}" is not an allowed cue (${CUES.join(', ')})`);
    }
  });
  if (hostNames.some((name) => !lines.some((line) => line.speaker === name))) {
    problems.push(`both ${hostNames.join(' and ')} must speak`);
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
