/**
 * The show's music, synthesized at mix time with ffmpeg's `aevalsrc`, so there are no audio
 * files to license or bundle: a soft plucked arpeggio for the theme, a two-note chime for the
 * sting before each story, and a settling chord for the tail. Each is a filtergraph chain that
 * produces mono audio and ends in a short echo and a fade.
 */

export type Cue = 'theme' | 'sting' | 'tail';

interface Note {
  /** Start time, in seconds. */
  at: number;
  freq: number;
  /** How fast it dies away: higher is shorter. */
  decay: number;
  gain: number;
}

// Cmaj9 voicing: C3 E3 G3 B3 D4 E4 G4, and C2 under it.
const C2 = 65.41;
const C3 = 130.81;
const E3 = 164.81;
const G3 = 196.0;
const B3 = 246.94;
const D4 = 293.66;
const E4 = 329.63;
const G4 = 392.0;
const A4 = 440.0;

export const MUSIC: Record<Cue, { durationSec: number; notes: Note[] }> = {
  theme: {
    durationSec: 5,
    notes: [
      { at: 0, freq: C2, decay: 0.6, gain: 0.2 },
      ...[C3, E3, G3, B3, D4, E4, G4, D4].map((freq, i) => ({
        at: i * 0.22,
        freq,
        decay: 2.2,
        gain: 0.3,
      })),
      // The phrase lands on a held chord.
      ...[C3, G3, B3, E4].map((freq) => ({ at: 2.0, freq, decay: 0.9, gain: 0.22 })),
    ],
  },
  sting: {
    durationSec: 1.4,
    notes: [
      { at: 0, freq: G4, decay: 3.5, gain: 0.3 },
      { at: 0.14, freq: E4 * 2, decay: 3, gain: 0.25 },
      { at: 0, freq: C3, decay: 2.5, gain: 0.2 },
    ],
  },
  tail: {
    durationSec: 4.5,
    notes: [
      { at: 0, freq: C2, decay: 0.7, gain: 0.18 },
      ...[G4, E4, D4, B3].map((freq, i) => ({ at: i * 0.25, freq, decay: 1.8, gain: 0.25 })),
      ...[C3, E3, G3, A4].map((freq) => ({ at: 1.1, freq, decay: 0.8, gain: 0.2 })),
    ],
  },
};

/** A plucked tone: a sine with a soft second harmonic, a 5 ms attack and an exponential decay. */
function pluck({ at, freq, decay, gain }: Note): string {
  const t = `(t-${at})`;
  return (
    `${gain}*gte(t,${at})*min(1,${t}*200)*exp(-${decay}*${t})*` +
    `(sin(2*PI*${freq}*${t})+0.25*sin(4*PI*${freq}*${t}))`
  );
}

/** The filtergraph chain (no input pads) that synthesizes a cue at `sampleRate`. */
export function musicFilter(cue: Cue, sampleRate: number): string {
  const { durationSec, notes } = MUSIC[cue];
  const expr = notes.map(pluck).join('+');
  const fadeSec = Math.min(1.2, durationSec / 3);
  return [
    `aevalsrc='${expr}':s=${sampleRate}:d=${durationSec}:c=mono`,
    'highpass=f=50',
    'lowpass=f=5000',
    'aecho=0.8:0.6:90|170:0.25|0.15',
    // The echo runs on past the source; keep each cue to its length.
    `atrim=duration=${durationSec}`,
    `afade=t=out:st=${(durationSec - fadeSec).toFixed(2)}:d=${fadeSec.toFixed(2)}`,
  ].join(',');
}
