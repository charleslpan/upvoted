import { keys, putFile } from '@upvoted/lib/storage';
import type { Segment } from '@upvoted/types';
import { fakeAdapter } from './fake';
import { geminiAdapter } from './gemini';
import { dialogueRequest, type SpeechAdapter, segmentSpeakers, toTurn } from './speech';
import { countWords, estimateTokens, predictedSec, splitTurns } from './split';
import { encodeWav, joinPcm, parseWav, pcmDurationSec } from './wav';

/** The whole budget for one call, retries included, well inside Vercel's 300-second limit. */
const CALL_TIMEOUT_MS = 240_000;
/** Silence between two calls' audio within a segment, like a breath between turns. */
const CHUNK_GAP_SEC = 0.3;
/** Audio this far from what the word count predicts is worth a look (dropped or repeated lines). */
const DURATION_WARN_RATIO = { low: 0.6, high: 1.7 };

/** Gemini through AI Gateway, or tones when `UPVOTED_FAKE_VOICES=1`. */
export function defaultAdapter(): SpeechAdapter {
  return process.env.UPVOTED_FAKE_VOICES === '1' ? fakeAdapter() : geminiAdapter();
}

/**
 * Voices one segment with the voices of the cast members in it (the host alone, or the host
 * and one correspondent) and saves it as a WAV at `keys.segment(date, index)`. Returns the
 * storage key and the audio's length.
 *
 * A long segment is split at whole turns into calls under Gemini's per-call limits. The calls
 * run at once, and their audio is joined in order.
 */
export async function voiceSegment(
  date: string,
  index: number,
  segment: Segment,
  adapter: SpeechAdapter = defaultAdapter(),
): Promise<{ key: string; durationSec: number }> {
  const key = keys.segment(date, index);
  const turns = segment.lines.map(toTurn);
  const speakers = segmentSpeakers(segment);
  const empty = dialogueRequest(speakers, []);
  const fixedTokens = estimateTokens(empty.instructions + JSON.stringify(empty.speakers));
  const calls = splitTurns(turns, fixedTokens);

  const chunks = await Promise.all(
    calls.map(async (callTurns, i) => {
      const started = performance.now();
      const wav = await adapter.synthesize(dialogueRequest(speakers, callTurns), {
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      const pcm = parseWav(wav);
      const durationSec = pcmDurationSec(pcm);
      const words = callTurns.reduce((sum, turn) => sum + countWords(turn.text), 0);
      const predicted = predictedSec(callTurns);
      const elapsed = (performance.now() - started) / 1000;
      const wpm = durationSec > 0 ? Math.round((words / durationSec) * 60) : 0;
      console.log(
        `  ${key} call ${i + 1}/${calls.length} (${adapter.name}): ${callTurns.length} turns, ` +
          `${words} words, predicted ${predicted.toFixed(1)}s → ${durationSec.toFixed(1)}s of ` +
          `audio (${wpm} wpm) in ${elapsed.toFixed(1)}s`,
      );
      warnOnOddDuration(`${key} call ${i + 1}`, durationSec, predicted);
      return pcm;
    }),
  );

  const joined = joinPcm(chunks, CHUNK_GAP_SEC);
  const words = turns.reduce((sum, turn) => sum + countWords(turn.text), 0);
  const actual = pcmDurationSec(joined);
  console.log(
    `  ${key} (${segment.kind}): ${words} words in ${calls.length} calls, predicted ` +
      `${predictedSec(turns).toFixed(1)}s → ${actual.toFixed(1)}s ` +
      `(${actual > 0 ? Math.round((words / actual) * 60) : 0} wpm)`,
  );
  await putFile(key, encodeWav(joined), 'audio/wav');
  return { key, durationSec: actual };
}

/**
 * Gemini has been reported to swap or drop voices mid-dialogue, which tends to show up as
 * audio much shorter or longer than the words need.
 */
function warnOnOddDuration(label: string, actualSec: number, expectedSec: number): void {
  if (expectedSec <= 0) return;
  const ratio = actualSec / expectedSec;
  if (ratio < DURATION_WARN_RATIO.low || ratio > DURATION_WARN_RATIO.high) {
    console.warn(
      `  Warning: ${label} is ${actualSec.toFixed(1)}s, but its words predict about ` +
        `${expectedSec.toFixed(1)}s. Listen for dropped, repeated or swapped lines.`,
    );
  }
}
