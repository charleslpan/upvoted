import { getFile, keys } from '@upvoted/lib/storage';
import { readJsonFixture } from '@upvoted/testing/fixtures';
import { ScriptSchema, type Segment } from '@upvoted/types';
import { describe, expect, it, vi } from 'vitest';
import { FAKE_FORMAT, fakeAdapter } from './fake';
import { countWords, WORDS_PER_SECOND } from './split';
import { voiceSegment } from './voice';
import { parseWav, pcmDurationSec } from './wav';

const script = ScriptSchema.parse(readJsonFixture('script-voice-sample.json'));
const date = script.date;

describe('voiceSegment', () => {
  it('voices a segment in one two-speaker call and saves it as a WAV', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const adapter = fakeAdapter();
    const segment = script.segments[1] as Segment;

    const result = await voiceSegment(date, 1, segment, adapter);

    expect(result.key).toBe(keys.segment(date, 1));
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.speakers).toEqual([
      { name: 'Maya', voice: 'Sulafat' },
      { name: 'Theo', voice: 'Charon' },
    ]);
    expect(adapter.calls[0]?.turns.map((turn) => [turn.speaker, turn.text])).toEqual(
      segment.lines.map((line) => [line.speaker, line.text]),
    );

    const saved = await getFile(result.key);
    expect(saved).not.toBeNull();
    const pcm = parseWav(saved as Buffer);
    expect(pcm.format).toEqual(FAKE_FORMAT);
    expect(result.durationSec).toBeCloseTo(pcmDurationSec(pcm), 5);
    // The words at the fake's speaking rate, plus two short pauses between turns.
    const words = segment.lines.reduce((sum, line) => sum + countWords(line.text), 0);
    expect(result.durationSec).toBeCloseTo(words / WORDS_PER_SECOND + 0.5, 1);
  });

  it('splits a long segment into several calls and joins their audio in order', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const adapter = fakeAdapter();
    const text = Array.from({ length: 50 }, () => 'word').join(' ');
    const segment: Segment = {
      kind: 'story',
      storyId: 1,
      lines: Array.from({ length: 40 }, (_, i) => ({ speaker: i % 2 ? 'Theo' : 'Maya', text })),
    };

    const result = await voiceSegment(date, 2, segment, adapter);

    // 2,000 words is 800 seconds of speech, so at least seven calls under the 120-second budget.
    expect(adapter.calls.length).toBeGreaterThanOrEqual(7);
    expect(adapter.calls.flatMap((call) => call.turns).map((t) => t.speaker)).toEqual(
      segment.lines.map((line) => line.speaker),
    );
    expect(result.durationSec).toBeGreaterThan(800);
    expect(result.durationSec).toBeLessThan(815);
  });

  it('warns when the audio is far from what the words predict', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeAdapter();
    const truncated = {
      ...fake,
      // As if Gemini dropped most of the lines: audio for the first turn only.
      synthesize: (
        request: Parameters<typeof fake.synthesize>[0],
        options: { abortSignal: AbortSignal },
      ) => fake.synthesize({ ...request, turns: request.turns.slice(0, 1) }, options),
    };

    await voiceSegment(date, 1, script.segments[1] as Segment, fake);
    expect(warn).not.toHaveBeenCalled();

    await voiceSegment(date, 1, script.segments[1] as Segment, truncated);
    expect(warn).toHaveBeenCalled();
  });
});
