import { config } from '@upvoted/lib/config';
import { episodeDate } from '@upvoted/lib/dates';
import { del, getJson, keys, list, putJson } from '@upvoted/lib/storage';
import {
  type EpisodeAudio,
  type EpisodeIndex,
  EpisodeIndexSchema,
  type EpisodeRecord,
  EpisodeRecordSchema,
  type EpisodeStory,
  type Script,
} from '@upvoted/types';

/** Reads `index.json`, or an empty index before the first episode. */
export async function loadIndex(): Promise<EpisodeIndex> {
  return (await getJson(keys.index, EpisodeIndexSchema)) ?? { episodes: [] };
}

/** The published episode for `date`, or null. */
export async function findEpisode(date: string): Promise<EpisodeRecord | null> {
  const { episodes } = await loadIndex();
  return episodes.find((episode) => episode.date === date) ?? null;
}

/**
 * The ids of stories covered by episodes dated in the `config.retention.excludeDays` days before
 * `now`'s episode date. That date's own episode doesn't count, so a re-run picks the same stories.
 */
export async function loadExcludeIds(now: Date): Promise<number[]> {
  const date = episodeDate(now);
  const since = addDays(date, -config.retention.excludeDays);
  const { episodes } = await loadIndex();
  const ids = episodes
    .filter((episode) => episode.date >= since && episode.date < date)
    .flatMap((episode) => episode.stories.map((story) => story.id));
  return [...new Set(ids)];
}

/** The index entry for a mixed episode. `stories` are in running order. */
export function episodeRecord(
  script: Script,
  stories: EpisodeStory[],
  audio: EpisodeAudio,
  publishedAt: Date,
): EpisodeRecord {
  return EpisodeRecordSchema.parse({
    date: script.date,
    title: script.title,
    description: script.description,
    audio,
    stories,
    publishedAt: publishedAt.toISOString(),
  });
}

/**
 * Adds the episode to `index.json`, newest first, replacing any episode with the same date. Keeps
 * the newest `config.retention.episodes` and deletes the files of the episodes it drops. Returns
 * the dropped episodes' dates.
 */
export async function publishEpisode(record: EpisodeRecord): Promise<string[]> {
  const parsed = EpisodeRecordSchema.parse(record);
  const { episodes } = await loadIndex();
  const all = [parsed, ...episodes.filter((episode) => episode.date !== parsed.date)].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0),
  );
  const kept = all.slice(0, config.retention.episodes);
  const dropped = all.slice(config.retention.episodes).map((episode) => episode.date);

  await putJson(keys.index, EpisodeIndexSchema.parse({ episodes: kept }));
  // Only after the index no longer points at them.
  for (const date of dropped) {
    const files = await list(keys.episodeDir(date));
    await del(files.map((file) => file.key));
  }
  return dropped;
}

/** `date` (YYYY-MM-DD) moved by a whole number of days. */
function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}
