import { getFile, keys, list, putJson } from '@upvoted/lib/storage';
import { readJsonFixture } from '@upvoted/testing/fixtures';
import { ScriptSchema, type Segment } from '@upvoted/types';
import { describe, expect, it, vi } from 'vitest';
import { fakeAdapter } from './fake';
import { ffmpeg } from './ffmpeg';
import { mixEpisode, planDurationSec, planMix, TARGET_LUFS } from './mix';
import { MUSIC } from './music';
import { voiceSegment } from './voice';

const script = ScriptSchema.parse(readJsonFixture('script-voice-sample.json'));
const date = script.date;

describe('planMix', () => {
  it('runs theme, intro, a sting before each story, the sign-off, then the tail', () => {
    const order = planMix(['intro', 'story', 'story', 'story', 'signoff'])
      .filter((part) => part.type !== 'gap')
      .map((part) => (part.type === 'music' ? part.cue : `voice ${part.index}`));

    expect(order).toEqual([
      'theme',
      'voice 0',
      'sting',
      'voice 1',
      'sting',
      'voice 2',
      'sting',
      'voice 3',
      'voice 4',
      'tail',
    ]);
  });

  it('leaves a short pause between every two chunks', () => {
    const parts = planMix(['intro', 'story', 'signoff']);
    parts.forEach((part, i) => {
      const next = parts[i + 1];
      if (next && part.type !== 'gap') expect(next.type).toBe('gap');
    });
  });

  it('keeps the theme intro between four and six seconds', () => {
    expect(MUSIC.theme.durationSec).toBeGreaterThanOrEqual(4);
    expect(MUSIC.theme.durationSec).toBeLessThanOrEqual(6);
  });
});

describe('mixEpisode', () => {
  it('mixes the segments into one loudness-normalized MP3 and deletes the WAVs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await putJson(keys.script(date), script);
    const adapter = fakeAdapter();
    const voiced = await Promise.all(
      script.segments.map((segment, i) => voiceSegment(date, i, segment as Segment, adapter)),
    );
    const segmentKeys = voiced.map((v) => v.key);

    const audio = await mixEpisode(date, segmentKeys);

    expect(audio.key).toBe(keys.episode(date));
    const mp3 = await getFile(audio.key);
    expect(mp3).not.toBeNull();
    expect(audio.bytes).toBe(mp3?.length);
    expect(audio.url).toMatch(/^file:/);
    expect(await list(`episodes/${date}/segments/`)).toEqual([]);

    const expected = planDurationSec(
      planMix(script.segments.map((s) => s.kind)),
      voiced.map((v) => v.durationSec),
    );
    expect(audio.durationSec).toBeCloseTo(expected, 5);

    // Decode the MP3 to check its real length, its format, its tags and its loudness.
    const filePath = new URL(audio.url).pathname;
    const log = await ffmpeg(['-i', filePath, '-af', 'ebur128', '-f', 'null', '-']);
    const time = /time=(\d+):(\d+):([\d.]+)/g;
    const last = [...log.matchAll(time)].at(-1);
    const decodedSec = Number(last?.[1]) * 3600 + Number(last?.[2]) * 60 + Number(last?.[3]);
    expect(decodedSec).toBeCloseTo(expected, 0);
    expect(log).toMatch(/Audio: mp3.*44100 Hz, mono/);
    expect(log).toMatch(/title\s*: Weight-space programming/);
    expect(log).toMatch(/album\s*: Upvoted/);
    const integrated = [...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1];
    expect(Number(integrated)).toBeGreaterThan(TARGET_LUFS - 1.5);
    expect(Number(integrated)).toBeLessThan(TARGET_LUFS + 1.5);
  }, 60_000);

  it('fails clearly when a segment is missing', async () => {
    await expect(mixEpisode(date, [keys.segment(date, 0)])).rejects.toThrow(
      /No episodes\/2026-11-03\/segments\/0.wav/,
    );
  });
});
