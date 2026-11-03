import { timingSafeEqual } from 'node:crypto';
import { episodeDate } from '@upvoted/lib/dates';
import { EpisodeDateSchema } from '@upvoted/types';
import { findEpisode } from './publish';

/**
 * When to start the agent on an episode. The manual trigger and the daily schedule both come
 * through here, so a date that's already published never starts a session (and never spends a
 * token) unless `force` asks to make it again.
 */

export interface EpisodeRun {
  date: string;
  force: boolean;
}

/** Starts an agent session for the run and returns its id. */
export type StartSession = (run: EpisodeRun) => Promise<string>;

export type RunResult =
  | (EpisodeRun & { status: 'started'; sessionId: string })
  | (EpisodeRun & { status: 'already published' });

/** Starts a session for `run`, unless its date is published and `force` is off. */
export async function startEpisode(run: EpisodeRun, start: StartSession): Promise<RunResult> {
  if (!run.force && (await findEpisode(run.date)) !== null) {
    return { ...run, status: 'already published' };
  }
  return { ...run, status: 'started', sessionId: await start(run) };
}

/**
 * The manual trigger, `POST /api/episode`: needs `Authorization: Bearer $CRON_SECRET`, takes an
 * optional `?date=YYYY-MM-DD` (default: today in the show's time zone) and `?force=1`.
 */
export async function handleRunRequest(
  request: Request,
  start: StartSession,
  now = new Date(),
): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 });
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const date = params.get('date') ?? episodeDate(now);
  if (!EpisodeDateSchema.safeParse(date).success) {
    return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  const forceParam = params.get('force');
  if (forceParam !== null && forceParam !== '0' && forceParam !== '1') {
    return Response.json({ error: 'force must be 0 or 1' }, { status: 400 });
  }

  const result = await startEpisode({ date, force: forceParam === '1' }, start);
  return Response.json(result, { status: result.status === 'started' ? 202 : 200 });
}

/** The daily schedule: today's episode (in the show's time zone), unless it's published. */
export function runScheduled(start: StartSession, now = new Date()): Promise<RunResult> {
  return startEpisode({ date: episodeDate(now), force: false }, start);
}

/** The message that starts the agent on an episode. */
export function episodePrompt({ date, force }: EpisodeRun): string {
  return (
    `Produce the Upvoted episode for ${date}.` +
    (force ? ' It was published before; this run makes it again and replaces it.' : '')
  );
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
