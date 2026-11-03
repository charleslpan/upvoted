import { ffmpegVersion } from '@upvoted/features/voice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Proves the ffmpeg binary made it into the deployment: answers the first line of
 * `ffmpeg -version`. Guarded by `Authorization: Bearer $CRON_SECRET`, like the cron route.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, version: await ffmpegVersion() });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
