import { config } from '@upvoted/lib/config';
import { z } from 'zod';

/**
 * The data contract every pipeline step reads and writes. Everything here is plain JSON
 * (dates are ISO strings), so a value round-trips through `JSON.stringify` and `parse` unchanged.
 */

const hostName = config.cast.host.name;
const correspondentNames = config.cast.correspondents.map((member) => member.name);
const castNames = [hostName, ...correspondentNames] as [string, ...string[]];

/** YYYY-MM-DD, a calendar day in the show's time zone. */
export const EpisodeDateSchema = z.iso.date();
/** An ISO 8601 timestamp in UTC, such as `2026-11-03T08:00:00.000Z`. */
const TimestampSchema = z.iso.datetime();
const HnIdSchema = z.int().positive();

// ---------------------------------------------------------------------------------------------
// Gathered stories

export const CommentSchema = z.object({
  id: HnIdSchema,
  /** HN username. Scripts never read usernames aloud. */
  by: z.string(),
  /** Plain text: HTML stripped, entities decoded, paragraphs separated by blank lines. */
  text: z.string(),
  get replies(): z.ZodArray<typeof CommentSchema> {
    return z.array(CommentSchema);
  },
});
export type Comment = z.infer<typeof CommentSchema>;

/** What selection returns: the story as it stood on HN when it was picked. */
export const StoryRefSchema = z.object({
  id: HnIdSchema,
  title: z.string().min(1),
  /** The linked article, or null for text posts such as most Ask HN posts. */
  url: z.string().min(1).nullable(),
  by: z.string(),
  points: z.int().nonnegative(),
  numComments: z.int().nonnegative(),
  createdAt: TimestampSchema,
});
export type StoryRef = z.infer<typeof StoryRefSchema>;

export const StoryKindSchema = z.enum(['story', 'ask', 'show']);
export type StoryKind = z.infer<typeof StoryKindSchema>;

export const StorySchema = StoryRefSchema.extend({
  /** The article's host name without `www.`, or null when there is no url. */
  domain: z.string().nullable(),
  /** `https://news.ycombinator.com/item?id=<id>` */
  hnUrl: z.url(),
  kind: StoryKindSchema,
  /** The post's own text (Ask HN, Show HN and other text posts), as plain text. */
  selfText: z.string().nullable(),
  /** The article's readable text, capped at about 8,000 words. */
  articleText: z.string().nullable(),
  /** Why the article text is missing, when the story has a url but no text could be read. */
  articleError: z.string().nullable(),
  /** Top-level comments in HN's own ranking order, each with up to two replies. */
  comments: z.array(CommentSchema),
});
export type Story = z.infer<typeof StorySchema>;

export const BriefSchema = z
  .object({
    date: EpisodeDateSchema,
    generatedAt: TimestampSchema,
    /** Exactly three stories, biggest (most points) first. */
    stories: z.array(StorySchema).length(3),
  })
  .superRefine((brief, ctx) => {
    brief.stories.forEach((story, i) => {
      const previous = brief.stories[i - 1];
      if (previous && previous.points < story.points) {
        ctx.addIssue({
          code: 'custom',
          path: ['stories', i, 'points'],
          message: 'Stories must be ordered biggest first',
        });
      }
    });
  });
export type Brief = z.infer<typeof BriefSchema>;

// ---------------------------------------------------------------------------------------------
// Script

export const LineSchema = z.object({
  speaker: z.enum(castNames).describe("The host's or a correspondent's name"),
  text: z.string().min(1).describe('The spoken words, with no markup or stage directions'),
  cue: z
    .string()
    .min(1)
    .optional()
    .describe('A short delivery direction such as "chuckles" or "thoughtful"'),
});
export type Line = z.infer<typeof LineSchema>;

export const SegmentKindSchema = z.enum(['intro', 'story', 'signoff']);
export type SegmentKind = z.infer<typeof SegmentKindSchema>;

export const SegmentSchema = z
  .object({
    kind: SegmentKindSchema,
    /** The HN id of the story a `story` segment covers; null for `intro` and `signoff`. */
    storyId: HnIdSchema.nullable(),
    lines: z.array(LineSchema).min(1),
  })
  .superRefine((segment, ctx) => {
    if (segment.kind === 'story' && segment.storyId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['storyId'],
        message: 'A story segment needs a storyId',
      });
    }
    if (segment.kind !== 'story' && segment.storyId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['storyId'],
        message: `An ${segment.kind} segment has no storyId`,
      });
    }
    const speakers = new Set(segment.lines.map((line) => line.speaker));
    if (segment.kind !== 'story' && [...speakers].some((speaker) => speaker !== hostName)) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: `Only the host, ${hostName}, speaks in the ${segment.kind}`,
      });
    }
    if (segment.kind === 'story') {
      const correspondents = correspondentNames.filter((name) => speakers.has(name));
      if (!speakers.has(hostName) || correspondents.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines'],
          message: `A story segment is the host, ${hostName}, and exactly one correspondent`,
        });
      }
    }
  });
export type Segment = z.infer<typeof SegmentSchema>;

/** The running order: the cold open, one story per correspondent, the sign-off. */
const RUNNING_ORDER: SegmentKind[] = [
  'intro',
  ...correspondentNames.map(() => 'story' as const),
  'signoff',
];

export const ScriptSchema = z
  .object({
    date: EpisodeDateSchema,
    title: z.string().min(1),
    /** Show notes: each story's title, article link and HN discussion link. */
    description: z.string().min(1),
    /** The intro, three story segments (correspondent `i` in story `i`) and the sign-off. */
    segments: z.array(SegmentSchema).min(1),
  })
  .superRefine((script, ctx) => {
    const kinds = script.segments.map((segment) => segment.kind);
    if (kinds.join() !== RUNNING_ORDER.join()) {
      ctx.addIssue({
        code: 'custom',
        path: ['segments'],
        message: `The segments must run ${RUNNING_ORDER.join(', ')}`,
      });
      return;
    }
    script.segments.slice(1, -1).forEach((segment, i) => {
      const expected = correspondentNames[i];
      const stray = segment.lines.find(
        (line) => line.speaker !== hostName && line.speaker !== expected,
      );
      if (stray) {
        ctx.addIssue({
          code: 'custom',
          path: ['segments', i + 1, 'lines'],
          message: `Story ${i + 1} is ${expected}'s, not ${stray.speaker}'s`,
        });
      }
    });
  });
export type Script = z.infer<typeof ScriptSchema>;

// ---------------------------------------------------------------------------------------------
// Episodes

export const EpisodeAudioSchema = z.object({
  /** Storage key, such as `episodes/2026-11-03/episode.mp3`. */
  key: z.string().min(1),
  /** Public URL of the file. */
  url: z.url(),
  bytes: z.int().nonnegative(),
  durationSec: z.number().nonnegative(),
});
export type EpisodeAudio = z.infer<typeof EpisodeAudioSchema>;

/** A story as the site's show notes list it. */
export const EpisodeStorySchema = StorySchema.pick({
  id: true,
  title: true,
  url: true,
  domain: true,
  hnUrl: true,
});
export type EpisodeStory = z.infer<typeof EpisodeStorySchema>;

export const EpisodeRecordSchema = z.object({
  date: EpisodeDateSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  audio: EpisodeAudioSchema,
  /** The stories the episode covers, in running order. */
  stories: z.array(EpisodeStorySchema),
  publishedAt: TimestampSchema,
});
export type EpisodeRecord = z.infer<typeof EpisodeRecordSchema>;

export const EpisodeIndexSchema = z
  .object({
    /** Newest first. */
    episodes: z.array(EpisodeRecordSchema),
  })
  .superRefine((index, ctx) => {
    index.episodes.forEach((episode, i) => {
      const previous = index.episodes[i - 1];
      if (previous && previous.date <= episode.date) {
        ctx.addIssue({
          code: 'custom',
          path: ['episodes', i, 'date'],
          message: 'Episodes must be ordered newest first, one per date',
        });
      }
    });
  });
export type EpisodeIndex = z.infer<typeof EpisodeIndexSchema>;
