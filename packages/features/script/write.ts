import { NotImplementedError } from '@upvoted/lib/errors';
import type { Brief, Script, Segment } from '@upvoted/types';

/** Writes the two hosts' conversation about `brief.stories[index]`, a `story` segment. */
export async function writeStorySegment(_brief: Brief, _index: number): Promise<Segment> {
  throw new NotImplementedError('writeStorySegment', 'writer');
}

/** Writes the dated intro and the sign-off around the finished story segments. */
export async function writeBookends(
  _brief: Brief,
  _stories: Segment[],
): Promise<{ intro: Segment; signoff: Segment }> {
  throw new NotImplementedError('writeBookends', 'writer');
}

/** Puts the segments in running order with the episode's title and show notes. */
export function assembleScript(
  _brief: Brief,
  _intro: Segment,
  _stories: Segment[],
  _signoff: Segment,
): Script {
  throw new NotImplementedError('assembleScript', 'writer');
}

/** Renders the script as the Markdown transcript saved next to it. */
export function renderTranscript(_script: Script): string {
  throw new NotImplementedError('renderTranscript', 'writer');
}
