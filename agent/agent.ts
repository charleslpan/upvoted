import { defineAgent } from 'eve';

/**
 * Upvoted's producer: picks the day's three biggest Hacker News stories, reads them, writes the
 * script and publishes the episode. What it does lives in instructions.md; its tools are thin
 * wrappers over @upvoted/features.
 */
export default defineAgent({
  // Sonnet 5.5 is the best value for this job. Medium reasoning, as Charles asked on Nov 3.
  model: 'anthropic/claude-sonnet-5.5',
  reasoning: 'medium',
  // No sandbox tools (bash, files): the agent only needs its own tools and the web.
  defaultTools: false,
  limits: {
    // The backstop for a runaway session: it fails instead of spending more. A normal episode
    // uses a fraction of this (see AGENTS.md).
    sessionUsage: ({ window }) =>
      window.inputTokens - window.cacheReadTokens >= 500_000 ||
      window.outputTokens >= 100_000 ||
      (window.costUsd ?? 0) >= 5,
    // A run is one turn; nobody follows up, so don't keep sessions around for 30 days.
    sessionTimeoutMs: 24 * 60 * 60 * 1_000,
  },
  build: {
    // ffmpeg-static finds its binary next to its own index.js, so ship the package whole
    // instead of bundling it. publish_episode's mix step runs it.
    externalDependencies: ['ffmpeg-static'],
  },
});
