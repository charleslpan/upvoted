import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { del as blobDel, get as blobGet, list as blobList, put as blobPut } from '@vercel/blob';
import type { z } from 'zod';

/**
 * The one way pipeline steps read and write files.
 *
 * With `BLOB_READ_WRITE_TOKEN` set, files go to the project's public Vercel Blob store under
 * their key, with no random suffix. Without it, they go to the local disk under `out/` at the
 * repo root (or under `UPVOTED_OUT_DIR`), so the pipeline and the tests run with no Vercel
 * account. The backend is picked on every call, from the environment at that moment.
 */

export interface StoredFile {
  key: string;
  /** Public URL on Blob; a `file://` URL on the local backend. */
  url: string;
  bytes: number;
}

/** The storage key layout. Segment numbers are the segment's 0-based index in the script. */
export const keys = {
  index: 'index.json',
  episodeDir: (date: string) => `episodes/${date}/`,
  brief: (date: string) => `episodes/${date}/brief.json`,
  script: (date: string) => `episodes/${date}/script.json`,
  transcript: (date: string) => `episodes/${date}/transcript.md`,
  segment: (date: string, index: number) => `episodes/${date}/segments/${index}.wav`,
  episode: (date: string) => `episodes/${date}/episode.mp3`,
} as const;

interface Backend {
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<StoredFile[]>;
  del(keys: string[]): Promise<void>;
}

/** Writes `value` as pretty-printed JSON. */
export async function putJson(key: string, value: unknown): Promise<StoredFile> {
  return putFile(key, `${JSON.stringify(value, null, 2)}\n`, 'application/json; charset=utf-8');
}

/** Reads and validates a JSON file, or returns null when there is none. */
export async function getJson<S extends z.ZodType>(
  key: string,
  schema: S,
): Promise<z.output<S> | null> {
  const body = await getFile(key);
  return body === null ? null : schema.parse(JSON.parse(body.toString('utf8')));
}

/** Writes a file, replacing any file already at `key`. A string is written as UTF-8. */
export async function putFile(
  key: string,
  bytes: Uint8Array | string,
  contentType: string,
): Promise<StoredFile> {
  assertKey(key);
  const body = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  return backend().put(key, body, contentType);
}

/** Reads a file, or returns null when there is none. */
export async function getFile(key: string): Promise<Buffer | null> {
  assertKey(key);
  return backend().get(key);
}

/** Lists every file whose key starts with `prefix`, sorted by key. */
export async function list(prefix: string): Promise<StoredFile[]> {
  if (prefix !== '') assertKey(prefix.replace(/\/$/, ''));
  const files = await backend().list(prefix);
  return files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Deletes files. Keys with no file are ignored. */
export async function del(keysToDelete: string[]): Promise<void> {
  for (const key of keysToDelete) assertKey(key);
  if (keysToDelete.length > 0) await backend().del(keysToDelete);
}

/** Says where files are going, for logs. */
export function describeStorage(): string {
  return blobToken() ? 'Vercel Blob' : `local files in ${localRoot()}`;
}

function assertKey(key: string): void {
  const segments = key.split('/');
  if (
    key === '' ||
    key.includes('\\') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
}

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || undefined;
}

function localRoot(): string {
  const outDir = process.env.UPVOTED_OUT_DIR;
  return outDir ? path.resolve(outDir) : path.join(workspaceRoot(), 'out');
}

/** The monorepo's root (where pnpm-workspace.yaml is), so every package shares one out/. */
function workspaceRoot(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (path.dirname(dir) === dir) return process.cwd();
  }
}

function backend(): Backend {
  const token = blobToken();
  return token ? blobBackend(token) : localBackend(localRoot());
}

function blobBackend(token: string): Backend {
  return {
    async put(key, body, contentType) {
      const isDocument =
        contentType.startsWith('application/json') || contentType.startsWith('text/');
      const result = await blobPut(key, Buffer.from(body), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType,
        // JSON and text files (the index above all) are rewritten in place, so keep the CDN's
        // copy short-lived. Audio keeps Blob's default.
        ...(isDocument ? { cacheControlMaxAge: 60 } : {}),
        token,
      });
      return { key: result.pathname, url: result.url, bytes: body.byteLength };
    },
    async get(key) {
      const result = await blobGet(key, { access: 'public', useCache: false, token });
      if (result === null || result.statusCode !== 200) return null;
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
    async list(prefix) {
      const files: StoredFile[] = [];
      let cursor: string | undefined;
      do {
        const page = await blobList({ prefix, cursor, limit: 1000, token });
        for (const blob of page.blobs) {
          files.push({ key: blob.pathname, url: blob.url, bytes: blob.size });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return files;
    },
    async del(keysToDelete) {
      await blobDel(keysToDelete, { token });
    },
  };
}

function localBackend(root: string): Backend {
  const fileFor = (key: string) => path.join(root, ...key.split('/'));
  return {
    async put(key, body, _contentType) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      return { key, url: pathToFileURL(file).href, bytes: body.byteLength };
    },
    async get(key) {
      try {
        return await readFile(fileFor(key));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async list(prefix) {
      let entries: string[];
      try {
        entries = await readdir(root, { recursive: true });
      } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
      }
      const files: StoredFile[] = [];
      for (const entry of entries) {
        const key = entry.split(path.sep).join('/');
        if (!key.startsWith(prefix)) continue;
        const file = fileFor(key);
        const info = await stat(file);
        if (info.isFile()) files.push({ key, url: pathToFileURL(file).href, bytes: info.size });
      }
      return files;
    },
    async del(keysToDelete) {
      await Promise.all(keysToDelete.map((key) => rm(fileFor(key), { force: true })));
    },
  };
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
