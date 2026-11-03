import { loadIndex, publishEpisode } from '@upvoted/features/episodes';
import { getFile, getJson, keys } from '@upvoted/lib/storage';
import { BriefSchema, ScriptSchema, type StoryRef } from '@upvoted/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { episode, segment, story, storyRef } from '../test/episodes';

// Without the Workflow compiler, 'use workflow' and 'use step' are no-ops, so the workflow runs
// as a plain function. The steps that would reach HN, Claude, Gemini or ffmpeg are mocked;
// storage and publishing are real, on the tests' local folder.

const mocks = vi.hoisted(() => ({
  selectStories: vi.fn(),
  gatherStory: vi.fn(),
  writeStorySegment: vi.fn(),
  writeBookends: vi.fn(),
  voiceSegment: vi.fn(),
  mixEpisode: vi.fn(),
}));

vi.mock('@upvoted/features/stories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@upvoted/features/stories')>()),
  selectStories: mocks.selectStories,
  gatherStory: mocks.gatherStory,
}));
vi.mock('@upvoted/features/script', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@upvoted/features/script')>()),
  writeStorySegment: mocks.writeStorySegment,
  writeBookends: mocks.writeBookends,
}));
vi.mock('@upvoted/features/voice', () => ({
  voiceSegment: mocks.voiceSegment,
  mixEpisode: mocks.mixEpisode,
}));

const { dailyEpisode } = await import('./daily-episode');

const DATE = '2026-11-03';
const refs = [storyRef(1, 300), storyRef(2, 200), storyRef(3, 100)];
const audio = {
  key: keys.episode(DATE),
  url: `https://blob.example.com/${keys.episode(DATE)}`,
  bytes: 8_000_000,
  durationSec: 700,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date('2026-11-03T08:10:00Z'), toFake: ['Date'] });
  mocks.selectStories.mockResolvedValue(refs);
  mocks.gatherStory.mockImplementation(async (ref: StoryRef) => story(ref));
  mocks.writeStorySegment.mockImplementation(async (brief, index: number) =>
    segment('story', brief.stories[index].id, index),
  );
  mocks.writeBookends.mockResolvedValue({ intro: segment('intro'), signoff: segment('signoff') });
  mocks.voiceSegment.mockImplementation(async (date: string, index: number) => ({
    key: keys.segment(date, index),
    durationSec: 60,
  }));
  mocks.mixEpisode.mockResolvedValue(audio);
  return () => vi.useRealTimers();
});

describe('dailyEpisode', () => {
  it('selects, gathers, writes, voices, mixes and publishes the episode', async () => {
    await publishEpisode({
      ...episode('2026-10-30'),
      stories: episode('2026-10-30').stories.slice(0, 1),
    });

    expect(await dailyEpisode(DATE)).toEqual({ date: DATE, status: 'published', audio });

    // Stories from the 24 hours before 08:00 UTC, skipping the past week's.
    expect(mocks.selectStories).toHaveBeenCalledWith(new Date('2026-11-03T08:00:00Z'), [1]);

    const brief = await getJson(keys.brief(DATE), BriefSchema);
    expect(brief?.stories.map((s) => s.id)).toEqual([1, 2, 3]);

    const script = await getJson(keys.script(DATE), ScriptSchema);
    expect(script?.segments.map((s) => s.storyId)).toEqual([null, 1, 2, 3, null]);
    expect(await getFile(keys.transcript(DATE))).not.toBeNull();

    // The segments are voiced in parallel, but they reach the mix in the script's order.
    expect(mocks.mixEpisode).toHaveBeenCalledWith(
      DATE,
      [0, 1, 2, 3, 4].map((i) => keys.segment(DATE, i)),
    );

    const { episodes } = await loadIndex();
    expect(episodes.map((e) => e.date)).toEqual([DATE, '2026-10-30']);
    expect(episodes[0]).toMatchObject({
      date: DATE,
      title: script?.title,
      description: script?.description,
      audio,
      publishedAt: '2026-11-03T08:10:00.000Z',
    });
    expect(episodes[0]?.stories.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("does nothing when the date's episode is already published", async () => {
    await publishEpisode(episode(DATE));
    const before = await loadIndex();

    expect(await dailyEpisode(DATE)).toEqual({ date: DATE, status: 'already published' });

    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
    expect(await loadIndex()).toEqual(before);
  });

  it('makes the episode again and replaces it when forced', async () => {
    await publishEpisode({ ...episode(DATE), title: 'The old format' });

    expect(await dailyEpisode(DATE, true)).toEqual({ date: DATE, status: 'published', audio });

    const script = await getJson(keys.script(DATE), ScriptSchema);
    const { episodes } = await loadIndex();
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      date: DATE,
      title: script?.title,
      publishedAt: '2026-11-03T08:10:00.000Z',
    });
  });

  it('publishes nothing when a step fails', async () => {
    mocks.mixEpisode.mockRejectedValue(new Error('ffmpeg failed'));

    await expect(dailyEpisode(DATE)).rejects.toThrow('ffmpeg failed');
    expect(await loadIndex()).toEqual({ episodes: [] });
  });
});
