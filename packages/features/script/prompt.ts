/** Delivery directions a line's `cue` may hold. The voice step turns each into a TTS tag. */
export const CUES = [
  'chuckles',
  'laughs',
  'thoughtful',
  'curious',
  'skeptical',
  'serious',
] as const;
export type Cue = (typeof CUES)[number];

/** "Tuesday, November 3", the date as the host says it. */
export function spokenDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
