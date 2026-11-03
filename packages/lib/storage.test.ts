import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { del, describeStorage, getFile, getJson, keys, list, putFile, putJson } from './storage';

// @upvoted/testing's setup.ts points UPVOTED_OUT_DIR at a fresh temp folder per test and
// clears BLOB_READ_WRITE_TOKEN, so these exercise the local backend.
const outDir = () => process.env.UPVOTED_OUT_DIR as string;

describe('local storage', () => {
  it('uses the local backend when no Blob token is set', () => {
    expect(describeStorage()).toBe(`local files in ${outDir()}`);
  });

  it('round-trips JSON through a schema', async () => {
    const schema = z.object({ date: z.iso.date(), ids: z.array(z.number()) });
    const value = { date: '2026-11-03', ids: [1, 2, 3] };

    const saved = await putJson(keys.script('2026-11-03'), value);

    expect(saved.key).toBe('episodes/2026-11-03/script.json');
    expect(await getJson(saved.key, schema)).toEqual(value);
    const file = path.join(outDir(), 'episodes', '2026-11-03', 'script.json');
    expect(fileURLToPath(saved.url)).toBe(file);
    expect(saved.bytes).toBe((await readFile(file)).byteLength);
  });

  it('returns null for a file that does not exist', async () => {
    expect(await getJson('index.json', z.object({}))).toBeNull();
    expect(await getFile('episodes/2026-11-03/episode.mp3')).toBeNull();
  });

  it('throws when stored JSON does not match the schema', async () => {
    await putJson('index.json', { episodes: 'nope' });
    await expect(
      getJson('index.json', z.object({ episodes: z.array(z.unknown()) })),
    ).rejects.toThrow();
  });

  it('writes bytes and strings, replacing what was there', async () => {
    const key = keys.segment('2026-11-03', 0);
    const bytes = new Uint8Array([82, 73, 70, 70]);

    expect(await putFile(key, bytes, 'audio/wav')).toMatchObject({ key, bytes: 4 });
    expect(await getFile(key)).toEqual(Buffer.from(bytes));

    await putFile(key, 'é', 'text/plain');
    expect((await getFile(key))?.toString('utf8')).toBe('é');
  });

  it('lists files under a prefix, sorted by key, and deletes them', async () => {
    await putFile(keys.segment('2026-11-03', 1), 'b', 'audio/wav');
    await putFile(keys.segment('2026-11-03', 0), 'a', 'audio/wav');
    await putJson(keys.script('2026-11-03'), {});
    await putJson(keys.script('2026-11-02'), {});
    await putJson(keys.index, { episodes: [] });

    const segments = await list('episodes/2026-11-03/segments/');
    expect(segments.map((file) => file.key)).toEqual([
      'episodes/2026-11-03/segments/0.wav',
      'episodes/2026-11-03/segments/1.wav',
    ]);
    expect(segments[0]?.bytes).toBe(1);
    expect((await list(keys.episodeDir('2026-11-03'))).map((file) => file.key)).toEqual([
      'episodes/2026-11-03/script.json',
      'episodes/2026-11-03/segments/0.wav',
      'episodes/2026-11-03/segments/1.wav',
    ]);
    expect(await list('')).toHaveLength(5);

    await del([...segments.map((file) => file.key), 'episodes/2026-11-03/missing.wav']);
    expect(await list('episodes/2026-11-03/segments/')).toEqual([]);
    expect(await list('')).toHaveLength(3);
  });

  it('lists nothing before anything is written', async () => {
    expect(await list('episodes/')).toEqual([]);
  });

  it.each(['', '/index.json', '../index.json', 'episodes//brief.json', 'episodes\\brief.json'])(
    'rejects the key %j',
    async (key) => {
      await expect(putJson(key, {})).rejects.toThrow('Invalid storage key');
    },
  );
});

describe('outside production', () => {
  it.each(['preview', 'development'])(
    'keeps every file under preview/ when VERCEL_ENV is %s',
    async (env) => {
      await putJson(keys.index, { episodes: ['live'] });
      vi.stubEnv('VERCEL_ENV', env);

      expect(await getJson(keys.index, z.unknown())).toBeNull();
      const saved = await putJson(keys.index, { episodes: [] });
      await putFile(keys.episode('2026-11-03'), 'mp3', 'audio/mpeg');

      expect(saved.key).toBe('index.json');
      expect(fileURLToPath(saved.url)).toBe(path.join(outDir(), 'preview', 'index.json'));
      expect(await getJson(keys.index, z.unknown())).toEqual({ episodes: [] });
      expect((await list('')).map((file) => file.key)).toEqual([
        'episodes/2026-11-03/episode.mp3',
        'index.json',
      ]);
      await del(['index.json']);
      expect(await getFile(keys.index)).toBeNull();

      vi.stubEnv('VERCEL_ENV', 'production');
      expect(await getJson(keys.index, z.unknown())).toEqual({ episodes: ['live'] });
    },
  );
});
