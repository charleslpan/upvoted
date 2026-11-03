import { episodePrompt, runScheduled } from '@upvoted/features/episodes';
import { defineSchedule } from 'eve/schedules';
import episode from '../channels/episode';

/**
 * Today's episode, every morning at 09:00 UTC (Hobby fires it some time in that hour). A date
 * that's already published starts no session and spends nothing.
 */
export default defineSchedule({
  cron: '0 9 * * *',
  async run({ to, waitUntil, appAuth }) {
    const result = await runScheduled(async (run) => {
      const delivery = to(episode, run).send(episodePrompt(run), { auth: appAuth });
      waitUntil(delivery);
      return (await delivery).sessionId;
    });
    console.log(`daily episode: ${JSON.stringify(result)}`);
  },
});
