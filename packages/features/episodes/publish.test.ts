import { config } from '@upvoted/lib/config';
import { getFile, getJson, keys, list, putFile, putJson } from '@upvoted/lib/storage';
import { EpisodeIndexSchema, type EpisodeRecord } from '@upvoted/types';
import { describe, expect, it } from 'vitest';
import { findEpisode, loadExcludeIds, loadIndex, publishEpisode } from './publish';

function record(date: string, ids = [1, 2, 3]): EpisodeRecord {
  return {
    date,
    title: `Episode for ${date}`,
    description: 'Show notes.',
    audio: {
      key: keys.episode(date),
      url: `https://blob.example.com/${keys.episode(date)}`,
      bytes: 8_000_000,
      durationSec: 700,
    },
    stories: ids.map((id) => ({
      id,
      title: `Story ${id}`,
      url: `https://example.com/${id}`,
      domain: 'example.com',
      hnUrl: `https://news.ycombinator.com/item?id=${id}`,
    })),
    publishedAt: `${date}T08:30:00.000Z`,
  };
}

/** `count` consecutive dates ending at 2026-11-03, newest first. */
function dates(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2026, 10, 3 - i));
    return day.toISOString().slice(0, 10);
  });
}

async function saveEpisodeFiles(date: string): Promise<void> {
  await putFile(keys.episode(date), 'mp3', 'audio/mpeg');
  await putJson(keys.script(date), {});
  await putFile(keys.transcript(date), '# Transcript', 'text/markdown');
}

describe('publishEpisode', () => {
  it('creates the index with the first episode', async () => {
    await publishEpisode(record('2026-11-03'));
    expect(await loadIndex()).toEqual({ episodes: [record('2026-11-03')] });
    expect(await findEpisode('2026-11-03')).toEqual(record('2026-11-03'));
    expect(await findEpisode('2026-11-02')).toBeNull();
  });

  it('keeps the index newest first, whatever order episodes arrive in', async () => {
    await publishEpisode(record('2026-11-02'));
    await publishEpisode(record('2026-11-03'));
    await publishEpisode(record('2026-11-01'));
    const index = await getJson(keys.index, EpisodeIndexSchema);
    expect(index?.episodes.map((episode) => episode.date)).toEqual([
      '2026-11-03',
      '2026-11-02',
      '2026-11-01',
    ]);
  });

  it('replaces an episode with the same date', async () => {
    await publishEpisode(record('2026-11-02'));
    await publishEpisode(record('2026-11-03'));
    const redo = { ...record('2026-11-03', [7, 8, 9]), title: 'Redone' };
    await publishEpisode(redo);
    const { episodes } = await loadIndex();
    expect(episodes).toEqual([redo, record('2026-11-02')]);
  });

  it('changes nothing when the same episode is published again', async () => {
    await publishEpisode(record('2026-11-03'));
    const before = await getFile(keys.index);
    expect(await publishEpisode(record('2026-11-03'))).toEqual([]);
    expect(await getFile(keys.index)).toEqual(before);
  });

  it(`keeps the newest ${config.retention.episodes} episodes and deletes the rest's files`, async () => {
    expect(config.retention.episodes).toBe(7);
    const [newest, ...older] = dates(8) as [string, ...string[]];
    for (const date of older.reverse()) {
      await saveEpisodeFiles(date);
      await publishEpisode(record(date));
    }
    await saveEpisodeFiles(newest);
    const dropped = await publishEpisode(record(newest));

    expect(dropped).toEqual(['2026-10-27']);
    const { episodes } = await loadIndex();
    expect(episodes.map((episode) => episode.date)).toEqual(dates(7));
    expect(await list(keys.episodeDir('2026-10-27'))).toEqual([]);
    expect(await list(keys.episodeDir('2026-10-28'))).toHaveLength(3);
    expect(await list(keys.episodeDir(newest))).toHaveLength(3);
  });

  it('rejects an invalid record without touching the index', async () => {
    await publishEpisode(record('2026-11-02'));
    const before = await getFile(keys.index);
    await expect(publishEpisode({ ...record('2026-11-03'), date: 'today' })).rejects.toThrow();
    expect(await getFile(keys.index)).toEqual(before);
  });
});

describe('loadExcludeIds', () => {
  it('is empty before the first episode', async () => {
    expect(await loadExcludeIds(new Date('2026-11-03T08:00:00Z'))).toEqual([]);
  });

  it(`covers the ${config.retention.excludeDays} days before the episode date, not that date itself`, async () => {
    expect(config.retention.excludeDays).toBe(7);
    await publishEpisode(record('2026-11-03', [30, 31, 32])); // today: a re-run picks these again
    await publishEpisode(record('2026-11-02', [20, 21, 22]));
    await publishEpisode(record('2026-10-27', [10, 11, 12])); // 7 days before: excluded
    await publishEpisode(record('2026-10-26', [1, 2, 3])); // 8 days before: free again

    const ids = await loadExcludeIds(new Date('2026-11-03T08:00:00Z'));
    expect(ids.sort((a, b) => a - b)).toEqual([10, 11, 12, 20, 21, 22]);
  });

  it("uses the episode date in the show's time zone", async () => {
    await publishEpisode(record('2026-11-02', [20, 21, 22]));
    // 03:00 UTC on Nov 3 is still Nov 2 in New York, so Nov 2's own episode doesn't count.
    expect(await loadExcludeIds(new Date('2026-11-03T03:00:00Z'))).toEqual([]);
    expect(await loadExcludeIds(new Date('2026-11-03T08:00:00Z'))).toEqual([20, 21, 22]);
  });
});
