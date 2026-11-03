import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

/** Runs before every test in every package (see vitest.ts). */

let outDir: string | undefined;

beforeEach(async () => {
  // Tests never touch the network: a fetch the test didn't stub fails loudly.
  vi.stubGlobal('fetch', async (input: unknown) => {
    throw new Error(`Tests never touch the network; stub fetch for ${String(input)}`);
  });
  // Storage always uses the local backend, in a fresh folder per test, even when the shell
  // has a Blob token.
  outDir = await mkdtemp(path.join(tmpdir(), 'upvoted-test-'));
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('UPVOTED_OUT_DIR', outDir);
});

afterEach(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
  outDir = undefined;
});
