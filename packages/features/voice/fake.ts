import type { DialogueRequest, SpeechAdapter } from './speech';
import { countWords, WORDS_PER_SECOND } from './split';
import { encodeWav, type PcmFormat } from './wav';

/** Gemini's output format: 24 kHz mono 16-bit PCM. */
export const FAKE_FORMAT: PcmFormat = { sampleRate: 24_000, channels: 1, bitsPerSample: 16 };
/** Each speaker's tone, in config order. */
export const FAKE_PITCHES = [220, 165];
const TURN_GAP_SEC = 0.25;

/**
 * A stand-in for Gemini that needs no network: each turn becomes a soft tone, pitched by
 * speaker and as long as the words would take to say, with a short pause between turns. Used
 * by the tests, and by `pnpm episode` with `UPVOTED_FAKE_VOICES=1` to hear the mix's pacing.
 */
export function fakeAdapter(): SpeechAdapter & { calls: DialogueRequest[] } {
  const calls: DialogueRequest[] = [];
  return {
    name: 'fake',
    calls,
    async synthesize(request) {
      calls.push(request);
      const samples: number[] = [];
      for (const [i, turn] of request.turns.entries()) {
        if (i > 0) pushSilence(samples, TURN_GAP_SEC);
        const speaker = request.speakers.findIndex((s) => s.name === turn.speaker);
        if (speaker === -1) throw new Error(`Unknown speaker ${turn.speaker}`);
        pushTone(samples, FAKE_PITCHES[speaker] ?? 200, countWords(turn.text) / WORDS_PER_SECOND);
      }
      return encodeWav({ format: FAKE_FORMAT, data: toPcm16(samples) });
    },
  };
}

function pushSilence(samples: number[], seconds: number): void {
  for (let n = Math.round(seconds * FAKE_FORMAT.sampleRate); n > 0; n--) samples.push(0);
}

/** A tone that pulses about four times a second, roughly like syllables. */
function pushTone(samples: number[], freq: number, seconds: number): void {
  const rate = FAKE_FORMAT.sampleRate;
  const count = Math.round(seconds * rate);
  for (let n = 0; n < count; n++) {
    const t = n / rate;
    const fade = Math.min(1, t / 0.02, (seconds - t) / 0.02);
    const syllables = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
    samples.push(0.25 * fade * syllables * Math.sin(2 * Math.PI * freq * t));
  }
}

function toPcm16(samples: number[]): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), i * 2);
  });
  return data;
}
