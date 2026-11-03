import { call, calls, type SessionView, usage } from 'eve/events';
import { defineHook } from 'eve/hooks';

/**
 * Logs what a run spent and how much it researched, for the function logs: once when
 * publish_episode settles, and at the end of every turn.
 */
export default defineHook({
  events: {
    'call.settled'(event, ctx) {
      if (call(ctx.view, event.data.callId)?.name !== 'publish_episode') return;
      logUsage(`publish_episode ${event.data.outcome}`, ctx.session.id, ctx.view);
    },
    'turn.settled'(event, ctx) {
      logUsage(`turn ${event.data.outcome}`, ctx.session.id, ctx.view);
    },
  },
});

function logUsage(when: string, sessionId: string, view: SessionView): void {
  // A metrics line must never fail the run.
  try {
    const { total } = usage(view);
    const count = (name: string) => calls(view, { name }).length;
    console.info(
      `upvoted usage: session ${sessionId}, ${when}: ` +
        `${total.inputTokens} input tokens (${total.cacheReadTokens} cache reads, ` +
        `${total.cacheWriteTokens} cache writes), ${total.outputTokens} output tokens, ` +
        `$${total.costUsd?.toFixed(3) ?? '?'}; ` +
        `${count('web_search')} searches, ${count('web_fetch')} fetches`,
    );
  } catch (error) {
    console.error(`upvoted usage: session ${sessionId}: could not read usage`, error);
  }
}
