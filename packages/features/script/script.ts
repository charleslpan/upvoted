import { config } from '@upvoted/lib/config';
import {
  type EpisodeStory,
  type Line,
  type Script,
  type ScriptDraft,
  ScriptDraftSchema,
  ScriptSchema,
} from '@upvoted/types';
import { CUES, spokenDate } from './prompt';

/**
 * Checks and finishes the script the agent writes. The agent sends a draft (the running order
 * and every line) plus the ids of the stories it covers; code adds the story ids, the title and
 * the show notes, so the model never writes a link.
 */

const host = config.cast.host.name;

/** The stories `get_top_stories` picked for an episode, biggest first. */
export interface Selection {
  date: string;
  ids: number[];
}

/**
 * What's wrong with a draft, as sentences the agent can act on. Empty when it's ready to
 * publish. `selection` is what `get_top_stories` returned in this session, or null if it wasn't
 * called.
 */
export function checkScript(
  draft: unknown,
  storyIds: number[],
  selection: Selection | null,
): string[] {
  if (!selection) return ['Call get_top_stories for the episode date before checking a script.'];
  const problems: string[] = [];
  if (storyIds.join() !== selection.ids.join()) {
    problems.push(
      `storyIds must be exactly the stories get_top_stories returned, in its order: ` +
        `[${selection.ids.join(', ')}], not [${storyIds.join(', ')}].`,
    );
  }
  const parsed = ScriptDraftSchema.safeParse(draft);
  if (!parsed.success) return [...problems, ...issueMessages(parsed.error.issues)];
  if (parsed.data.date !== selection.date) {
    problems.push(`The script is dated ${parsed.data.date}; the episode is ${selection.date}.`);
  }

  const placeholder = toScript(parsed.data, selection.ids, 'title', 'notes');
  const script = ScriptSchema.safeParse(placeholder);
  if (!script.success) problems.push(...issueMessages(script.error.issues));

  let story = 0;
  parsed.data.segments.forEach((segment, i) => {
    // A fourth story segment has no correspondent; the schema check above reports it.
    const correspondent = config.cast.correspondents[story]?.name;
    if (segment.kind === 'story') story++;
    const speakers = segment.kind === 'story' && correspondent ? [host, correspondent] : [host];
    const where = segment.kind === 'story' ? `story ${story}` : segment.kind;
    for (const problem of lineProblems(segment.lines, speakers)) {
      problems.push(`segments[${i}] (${where}): ${problem}`);
    }
  });
  return [...new Set(problems)];
}

/** The finished script: the draft with its story ids, title and show notes from `stories`. */
export function buildScript(draft: ScriptDraft, stories: EpisodeStory[]): Script {
  return ScriptSchema.parse(
    toScript(
      draft,
      stories.map((story) => story.id),
      episodeTitle(draft.date, stories),
      showNotes(draft.date, stories),
    ),
  );
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

/** The draft as a `Script`, story segment `i` covering `storyIds[i]`. */
function toScript(
  draft: ScriptDraft,
  storyIds: number[],
  title: string,
  description: string,
): unknown {
  let story = 0;
  return {
    date: draft.date,
    title,
    description,
    segments: draft.segments.map((segment) => ({
      kind: segment.kind,
      storyId: segment.kind === 'story' ? (storyIds[story++] ?? null) : null,
      lines: segment.lines,
    })),
  };
}

function issueMessages(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message,
  );
}

function episodeTitle(date: string, stories: EpisodeStory[]): string {
  const [top] = stories;
  return `${spokenDate(date)}: ${top?.title ?? config.show.name}, and two more`;
}

function showNotes(date: string, stories: EpisodeStory[]): string {
  const items = stories.map((story, i) => {
    const links = [
      story.url ? `   Article: ${story.url}` : null,
      `   Discussion: ${story.hnUrl}`,
    ].filter(Boolean);
    return `${i + 1}. ${story.title}\n${links.join('\n')}`;
  });
  return `The three biggest Hacker News stories for ${spokenDate(date)}.\n\n${items.join('\n\n')}`;
}
