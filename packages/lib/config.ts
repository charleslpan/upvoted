import { z } from 'zod';

/**
 * The show's settings, validated at import so a typo fails fast rather than mid-run.
 * Model ids are Vercel AI Gateway ids (https://ai-gateway.vercel.sh/v1/models).
 */

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const HostSchema = z.object({
  /** How the host is named in scripts and transcripts. */
  name: z.string().min(1),
  /** A Gemini TTS prebuilt voice name, such as `Kore` or `Puck`. */
  voice: z.string().min(1),
});

const ConfigSchema = z.object({
  show: z.object({
    name: z.string().min(1),
    author: z.string().min(1),
    description: z.string().min(1),
    /** Episode dates (YYYY-MM-DD) are calendar days in this zone. */
    timezone: z.string().refine(isTimeZone, 'Unknown IANA time zone'),
    targetMinutes: z.number().positive(),
    /** Absolute origin of the deployed site, with no trailing slash. */
    siteUrl: z.url(),
  }),
  writer: z.object({ model: z.string().min(1) }),
  tts: z.object({
    model: z.string().min(1),
    /** The show-wide delivery style. A line's cue overrides it for that line. */
    style: z.string().min(1),
  }),
  hosts: z
    .tuple([HostSchema, HostSchema])
    .refine(([a, b]) => a.name !== b.name, 'The two hosts need different names'),
  retention: z.object({
    /** How many episodes the index (and Blob) keeps. */
    episodes: z.int().positive(),
    /** Stories covered in the past this many days are not picked again. */
    excludeDays: z.int().nonnegative(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Host = z.infer<typeof HostSchema>;

function siteUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000');
  return url.replace(/\/+$/, '');
}

export const config: Config = ConfigSchema.parse({
  show: {
    name: 'Upvoted',
    author: 'Charles Pan',
    description:
      'The three biggest Hacker News stories of the day, talked through by two hosts in about ' +
      'twelve minutes. Upvoted is AI-generated: the stories are picked automatically, the script ' +
      'is written by Claude, and the voices are synthetic. It is not affiliated with Hacker News ' +
      'or Y Combinator.',
    timezone: 'America/New_York',
    targetMinutes: 12,
    siteUrl: siteUrl(),
  },
  writer: { model: 'anthropic/claude-opus-5.5' },
  tts: {
    // Moving up to 'google/gemini-3.8-flash-tts' is a one-line change.
    model: 'google/gemini-3.8-flash-lite-tts',
    style:
      'A warm, relaxed morning-show conversation between two friends who know tech well. ' +
      'Natural pace, easy laughter, never announcer-like.',
  },
  // Gemini prebuilt voices: Sulafat is "warm", Achird is "friendly".
  hosts: [
    { name: 'Maya', voice: 'Sulafat' },
    { name: 'Theo', voice: 'Achird' },
  ],
  retention: { episodes: 30, excludeDays: 7 },
});

export default config;
