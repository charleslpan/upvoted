import { config } from '@upvoted/lib/config';
import type { Line, Segment } from '@upvoted/types';

/**
 * What a text-to-speech adapter voices in one call: a stretch of a segment, by the host alone or
 * by the host and one correspondent. Gemini takes one speaker as plain text and two as
 * multi-speaker `turns`; the fake adapter turns it into tones for tests and dry runs.
 */
export interface DialogueTurn {
  /** A cast member's name. */
  speaker: string;
  text: string;
  /** A delivery direction for this turn; without one, the call's `instructions` apply. */
  style?: string;
}

export interface DialogueRequest {
  /** The segment's speakers and their prebuilt voices, the host first: one or two. */
  speakers: { name: string; voice: string }[];
  turns: DialogueTurn[];
  /** The show-wide delivery style. */
  instructions: string;
}

export interface SpeechAdapter {
  readonly name: string;
  /** Voices the dialogue and returns it as a WAV file. */
  synthesize(request: DialogueRequest, options: { abortSignal: AbortSignal }): Promise<Uint8Array>;
}

/** Fuller directions for the cues the writer uses most; any other cue is passed through as-is. */
const CUE_STYLES: Record<string, string> = {
  laughs: 'laughing warmly as you speak',
  laughing: 'laughing warmly as you speak',
  chuckles: 'with a light chuckle',
  excited: 'excited and energetic',
  amused: 'amused, smiling',
  skeptical: 'skeptical, a little dry',
  curious: 'curious, leaning in',
  thoughtful: 'thoughtful and unhurried',
  serious: 'serious and measured',
  surprised: 'genuinely surprised',
  sighs: 'with a small sigh',
  wry: 'wry, deadpan',
};

/** The Gemini `style` for a line's cue, or undefined to fall back on the show-wide style. */
export function styleForCue(cue: string | undefined): string | undefined {
  const trimmed = cue?.trim();
  if (!trimmed) return undefined;
  return CUE_STYLES[trimmed.toLowerCase()] ?? trimmed;
}

export function toTurn(line: Line): DialogueTurn {
  const style = styleForCue(line.cue);
  return style
    ? { speaker: line.speaker, text: line.text, style }
    : { speaker: line.speaker, text: line.text };
}

/** The cast members who speak in the segment, with their voices, the host first. */
export function segmentSpeakers(segment: Segment): DialogueRequest['speakers'] {
  const { host, correspondents } = config.cast;
  return [host, ...correspondents]
    .filter((member) => segment.lines.some((line) => line.speaker === member.name))
    .map(({ name, voice }) => ({ name, voice }));
}

export function dialogueRequest(
  speakers: DialogueRequest['speakers'],
  turns: DialogueTurn[],
): DialogueRequest {
  return { speakers, turns, instructions: config.tts.style };
}
