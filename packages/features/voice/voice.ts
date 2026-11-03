import { NotImplementedError } from '@upvoted/lib/errors';
import type { Segment } from '@upvoted/types';

/**
 * Voices one segment with the two hosts' voices and saves it as a WAV at
 * `keys.segment(date, index)`. Returns the storage key and the audio's length.
 */
export async function voiceSegment(
  _date: string,
  _index: number,
  _segment: Segment,
): Promise<{ key: string; durationSec: number }> {
  throw new NotImplementedError('voiceSegment', 'voice');
}
