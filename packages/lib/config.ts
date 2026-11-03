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

const CastMemberSchema = z.object({
  /** How the cast member is named in scripts and transcripts. */
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
  cast: z
    .object({
      /** The anchor: alone in the cold open and the sign-off, and the questioner in each story. */
      host: CastMemberSchema,
      /** Correspondent `i` covers story `i`, one story each. */
      correspondents: z.tuple([CastMemberSchema, CastMemberSchema, CastMemberSchema]),
    })
    .refine(({ host, correspondents }) => {
      const members = [host, ...correspondents];
      return (
        new Set(members.map((m) => m.name)).size === members.length &&
        new Set(members.map((m) => m.voice)).size === members.length
      );
    }, 'Every cast member needs their own name and voice'),
  retention: z.object({
    /** How many episodes the index (and Blob) keeps. */
    episodes: z.int().positive(),
    /** Stories covered in the past this many days are not picked again. */
    excludeDays: z.int().nonnegative(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type CastMember = z.infer<typeof CastMemberSchema>;

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
      'The three biggest Hacker News stories of the day in about twelve minutes, from an anchor ' +
      'and a correspondent for each story. Upvoted is AI-generated: the stories are picked automatically, the script ' +
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
      'A public-radio morning news show: a measured, warm, clear anchor and well-informed ' +
      'correspondents. Conversational but composed, with crisp diction, an unhurried pace and ' +
      'no filler. Never hyped, never announcer-like.',
  },
  // Gemini prebuilt voices: Sulafat is "warm", Charon "informative", Erinome "clear" and
  // Sadaltager "knowledgeable".
  cast: {
    host: { name: 'Maya', voice: 'Sulafat' },
    correspondents: [
      { name: 'Theo', voice: 'Charon' },
      { name: 'Nadia', voice: 'Erinome' },
      { name: 'Felix', voice: 'Sadaltager' },
    ],
  },
  // The site shows only the latest episode; a week of records covers the story exclusion.
  retention: { episodes: 7, excludeDays: 7 },
});

export default config;

/** The correspondent who covers story `index` (0-based) of an episode. */
export function correspondentFor(index: number): CastMember {
  const correspondent = config.cast.correspondents[index];
  if (!correspondent) throw new RangeError(`No correspondent covers story ${index}`);
  return correspondent;
}
