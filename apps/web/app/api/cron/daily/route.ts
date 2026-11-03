import { episodeDate } from '@upvoted/lib/dates';
import { EpisodeDateSchema } from '@upvoted/types';
import { start } from 'workflow/api';
import { dailyEpisode } from '../../../../workflows/daily-episode';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Starts the daily episode workflow and answers its run id. Vercel Cron calls it every morning
 * with `Authorization: Bearer $CRON_SECRET`; call it the same way to run it by hand, with
 * `?date=YYYY-MM-DD` for another day than today (in the show's time zone).
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const param = new URL(request.url).searchParams.get('date');
  const date = param ?? episodeDate(new Date());
  if (!EpisodeDateSchema.safeParse(date).success) {
    return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  const run = await start(dailyEpisode, [date]);
  return Response.json({ date, runId: run.runId });
}
