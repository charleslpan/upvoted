import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The ffmpeg binary that @upvoted/features/voice runs to mix episodes. `ffmpeg-static` finds it
 * next to its own index.js at runtime, which file tracing can't see, so every function that
 * mixes (or reports ffmpeg's version) includes it explicitly. Paths are relative to this app.
 */
const ffmpegFiles = ['../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg'];

const nextConfig: NextConfig = {
  // Internal packages ship TypeScript source; Next.js compiles them with the app.
  transpilePackages: ['@upvoted/features', '@upvoted/lib', '@upvoted/types'],
  // Trace files from the monorepo's root, where pnpm keeps node_modules/.pnpm.
  outputFileTracingRoot: repoRoot,
  // Required at runtime from node_modules rather than bundled, so its path lookup still works.
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/health/ffmpeg': ffmpegFiles,
    // Vercel Workflow runs every step through its generated routes.
    '/.well-known/workflow/**/*': ffmpegFiles,
  },
};

export default nextConfig;
