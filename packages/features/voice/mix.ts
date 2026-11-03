import { NotImplementedError } from '@upvoted/lib/errors';
import type { EpisodeAudio } from '@upvoted/types';

/**
 * Stitches the voiced segments (in order) with the theme and stings into a loudness-normalized
 * MP3, saved at `keys.episode(date)`.
 */
export async function mixEpisode(_date: string, _segmentKeys: string[]): Promise<EpisodeAudio> {
  throw new NotImplementedError('mixEpisode', 'voice');
}
