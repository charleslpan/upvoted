import { randomUUID } from 'node:crypto';
import { type EpisodeRun, episodePrompt, handleRunRequest } from '@upvoted/features/episodes';
import { defineChannel, POST } from 'eve/channels';

/**
 * Where episode runs start. `POST /api/episode` is the manual trigger (Bearer `CRON_SECRET`,
 * `?date=YYYY-MM-DD`, `?force=1`); the daily schedules hand their runs here too, through
 * `receive`. Every run gets a session of its own.
 */
export default defineChannel<undefined, void, EpisodeRun>({
  routes: [
    POST('/api/episode', (request, { from }) =>
      handleRunRequest(request, async (run) => {
        const delivery = await from(address(run)).send(episodePrompt(run), {
          auth: {
            authenticator: 'upvoted',
            principalType: 'service',
            principalId: 'manual-trigger',
            attributes: {},
          },
          title: `Episode ${run.date}${run.force ? ' (forced)' : ''}`,
        });
        return delivery.sessionId;
      }),
    ),
  ],
  async receive({ message, target, ...send }, { from }) {
    return from(address(target)).send(message, { ...send, title: `Episode ${target.date}` });
  },
});

function address(run: EpisodeRun): string {
  return `episode:${run.date}:${randomUUID()}`;
}
