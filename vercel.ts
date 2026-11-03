import { withEve } from 'eve/vercel';

/**
 * The Vercel project, built from the repo root: the Next.js site in apps/web, plus the eve agent
 * in agent/, which withEve adds as its own service with its routes (/eve/v1/*) and its daily
 * schedules as Cron Jobs. POST /api/episode, the manual trigger, goes to the agent too.
 */
export default await withEve({
  services: {
    web: {
      framework: 'nextjs',
      root: 'apps/web',
      buildCommand: 'node node_modules/next/dist/bin/next build',
    },
  },
  routes: [
    { src: '^/api/episode$', destination: { type: 'service', service: 'eve' } },
    { src: '^(.*)$', destination: { type: 'service', service: 'web' } },
  ],
});
