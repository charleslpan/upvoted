import { calls, usage } from 'eve/events';
import { defineHook } from 'eve/hooks';

/** Logs what each run spent and how much it researched, for the function logs. */
export default defineHook({
  events: {
    'turn.settled'(event, ctx) {
      const { total } = usage(ctx.view);
      const count = (name: string) => calls(ctx.view, { name }).length;
      console.log(
        `session ${ctx.session.id} turn ${event.data.outcome}: ` +
          `${total.inputTokens} input tokens (${total.cacheReadTokens} cached), ` +
          `${total.outputTokens} output, $${total.costUsd?.toFixed(2) ?? '?'}; ` +
          `${count('web_search')} searches, ${count('web_fetch')} fetches`,
      );
    },
  },
});
