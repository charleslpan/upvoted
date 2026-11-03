import { defineConfig } from 'vitest/config';

// Runs every package's tests in one process (`pnpm vitest`). `pnpm test` runs them per package
// through turbo instead. Each project's settings come from @upvoted/testing/vitest.
export default defineConfig({
  test: {
    projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts'],
  },
});
