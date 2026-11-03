import { describe, expect, it } from 'vitest';
import type { DialogueTurn } from './speech';
import { CALL_BUDGET, countWords, estimateTokens, splitTurns, WORDS_PER_SECOND } from './split';

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
const turn = (speaker: string, n: number): DialogueTurn => ({ speaker, text: words(n) });

describe('splitTurns', () => {
  it('keeps a normal story segment in one call', () => {
    const turns = Array.from({ length: 30 }, (_, i) => turn(i % 2 ? 'Theo' : 'Maya', 15));
    expect(splitTurns(turns, 100)).toEqual([turns]);
  });

  it('splits a long segment at whole turns, each call under the audio budget', () => {
    // 60 turns of 40 words is 960 seconds of speech, four times the per-call budget.
    const turns = Array.from({ length: 60 }, (_, i) => turn(i % 2 ? 'Theo' : 'Maya', 40));
    const calls = splitTurns(turns, 100);

    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.flat()).toEqual(turns);
    for (const call of calls) {
      const seconds = call.reduce((sum, t) => sum + countWords(t.text), 0) / WORDS_PER_SECOND;
      expect(seconds).toBeLessThanOrEqual(CALL_BUDGET.audioSec);
    }
  });

  it('splits on input tokens too, counting the fixed cost of every call', () => {
    const long = 'supercalifragilistic '.repeat(100).trim(); // ~525 tokens, but only 100 words
    const turns = Array.from({ length: 10 }, () => ({ speaker: 'Maya', text: long }));
    const calls = splitTurns(turns, 1_000, { inputTokens: 2_200, audioSec: 10_000 });

    expect(calls.map((c) => c.length)).toEqual([2, 2, 2, 2, 2]);
    for (const call of calls) {
      const tokens = 1_000 + call.reduce((sum, t) => sum + estimateTokens(t.text) + 10, 0);
      expect(tokens).toBeLessThanOrEqual(2_200);
    }
  });

  it('never cuts a turn, even one over the budget on its own', () => {
    const turns = [turn('Maya', 5), turn('Theo', 1_000), turn('Maya', 5)];
    expect(splitTurns(turns, 0)).toEqual([[turns[0]], [turns[1]], [turns[2]]]);
  });
});
