import { NotImplementedError } from '@upvoted/lib/errors';
import type { EpisodeRecord } from '@upvoted/types';

/**
 * The ids of stories covered by episodes dated in the `config.retention.excludeDays` days before
 * `now`'s episode date. That date's own episode doesn't count, so a re-run picks the same stories.
 */
export async function loadExcludeIds(_now: Date): Promise<number[]> {
  throw new NotImplementedError('loadExcludeIds', 'publish');
}

/** Adds the episode to `index.json`, newest first, and prunes episodes beyond retention. */
export async function publishEpisode(_record: EpisodeRecord): Promise<void> {
  throw new NotImplementedError('publishEpisode', 'publish');
}
