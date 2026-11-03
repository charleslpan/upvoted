import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

/** The Vitest settings every package shares. A package's vitest.config.ts is one call to this. */
export function testProject(name: string) {
  return defineProject({
    test: {
      name,
      include: ['**/*.test.ts'],
      exclude: ['**/node_modules/**'],
      environment: 'node',
      setupFiles: [fileURLToPath(new URL('./setup.ts', import.meta.url))],
      unstubEnvs: true,
      unstubGlobals: true,
    },
  });
}
