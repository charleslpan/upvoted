import type { DialogueTurn } from './speech';

/**
 * Gemini 3.8 Flash-Lite TTS takes at most 8,192 input tokens and returns at most 16,384 output
 * tokens, which at 25 audio tokens a second is about 10.9 minutes. Flash TTS has the same
 * limits. Each call is kept well inside both, and short enough to finish quickly: long calls
 * are also where Gemini is most likely to swap the two voices, and where it speeds up. Stories
 * of 600 to 700 words voiced in one or two calls came out at 190 words a minute on Nov 3, so
 * calls stay near two minutes of audio.
 */
export const CALL_BUDGET = {
  inputTokens: 4_000,
  audioSec: 120,
};

/** Conversational speech runs at about 150 words a minute. */
export const WORDS_PER_SECOND = 2.5;

/** Tokens a turn costs on top of its words: the speaker label and the request's structure. */
const TURN_OVERHEAD_TOKENS = 10;

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** A rough, deliberately high token count: about four characters a token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function predictedSec(turns: DialogueTurn[]): number {
  return turns.reduce((sum, turn) => sum + countWords(turn.text), 0) / WORDS_PER_SECOND;
}

function turnTokens(turn: DialogueTurn): number {
  return estimateTokens(turn.text) + estimateTokens(turn.style ?? '') + TURN_OVERHEAD_TOKENS;
}

/**
 * Splits a segment's turns into calls, each under the budget, breaking only between whole turns.
 * `fixedTokens` is what every call spends besides its turns (the instructions and voices).
 */
export function splitTurns(
  turns: DialogueTurn[],
  fixedTokens: number,
  budget = CALL_BUDGET,
): DialogueTurn[][] {
  const calls: DialogueTurn[][] = [];
  let current: DialogueTurn[] = [];
  let tokens = fixedTokens;
  let seconds = 0;
  for (const turn of turns) {
    const turnTok = turnTokens(turn);
    const turnSec = countWords(turn.text) / WORDS_PER_SECOND;
    const overBudget = tokens + turnTok > budget.inputTokens || seconds + turnSec > budget.audioSec;
    if (current.length > 0 && overBudget) {
      calls.push(current);
      current = [];
      tokens = fixedTokens;
      seconds = 0;
    }
    // A single turn over the budget still gets a call of its own; turns are never cut.
    current.push(turn);
    tokens += turnTok;
    seconds += turnSec;
  }
  if (current.length > 0) calls.push(current);
  return calls;
}
