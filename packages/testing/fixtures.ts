import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Shared test fixtures, recorded from the real APIs, under packages/testing/fixtures/. */

/** Absolute path of a fixture, such as `fixturePath('hn/algolia-search.json')`. */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}

export function readJsonFixture<T = unknown>(name: string): T {
  return JSON.parse(readFixture(name)) as T;
}
