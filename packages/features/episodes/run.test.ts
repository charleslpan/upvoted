import { keys } from '@upvoted/lib/storage';
import type { EpisodeRecord } from '@upvoted/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishEpisode } from './publish';
import { type EpisodeRun, handleRunRequest, runScheduled } from './run';

const URL = 'https://upvoted.dev/api/episode';

let started: EpisodeRun[];
const start = async (run: EpisodeRun) => {
  started.push(run);
  return `session-${started.length}`;
};

function call(url = URL, secret: string | null = 'shh', now?: Date): Promise<Response> {
  const headers = secret === null ? undefined : { authorization: `Bearer ${secret}` };
  return handleRunRequest(new Request(url, { method: 'POST', headers }), start, now);
}

async function publish(date: string): Promise<void> {
  const record: EpisodeRecord = {
    date,
    title: 'Published',
    description: 'Show notes.',
    audio: {
      key: keys.episode(date),
      url: 'https://blob.example.com/a.mp3',
      bytes: 1,
      durationSec: 1,
    },
    stories: [],
    publishedAt: `${date}T10:30:00.000Z`,
  };
  await publishEpisode(record);
}

beforeEach(() => {
  started = [];
  vi.stubEnv('CRON_SECRET', 'shh');
});

describe('POST /api/episode', () => {
  it('answers 401 without the secret, and starts nothing', async () => {
    expect((await call(URL, null)).status).toBe(401);
    expect((await call(URL, 'wrong')).status).toBe(401);
    expect(started).toEqual([]);
  });

  it('answers 503 when CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call(URL, '')).status).toBe(503);
    expect(started).toEqual([]);
  });

  it.each([['?date=Nov-3'], ['?force=yes']])('answers 400 for %s', async (query) => {
    expect((await call(`${URL}${query}`)).status).toBe(400);
    expect(started).toEqual([]);
  });

  it("starts a session for today's date in New York", async () => {
    // 03:30 UTC on Nov 3 is still Nov 2 in New York.
    const response = await call(URL, 'shh', new Date('2026-11-03T03:30:00Z'));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      date: '2026-11-02',
      force: false,
      status: 'started',
      sessionId: 'session-1',
    });
    expect(started).toEqual([{ date: '2026-11-02', force: false }]);
  });

  it('does nothing for a date that is already published', async () => {
    await publish('2026-11-01');
    const response = await call(`${URL}?date=2026-11-01`);
    expect(await response.json()).toEqual({
      date: '2026-11-01',
      force: false,
      status: 'already published',
    });
    expect(started).toEqual([]);
  });

  it('makes a published date again with force=1', async () => {
    await publish('2026-11-01');
    const response = await call(`${URL}?date=2026-11-01&force=1`);
    expect(await response.json()).toMatchObject({ date: '2026-11-01', status: 'started' });
    expect(started).toEqual([{ date: '2026-11-01', force: true }]);
  });
});

describe('the daily schedule', () => {
  it("starts today's episode in New York", async () => {
    expect(await runScheduled(start, new Date('2026-11-03T09:15:00Z'))).toMatchObject({
      date: '2026-11-03',
      status: 'started',
    });
    expect(started).toEqual([{ date: '2026-11-03', force: false }]);
  });

  it('starts nothing once the episode is published', async () => {
    await publish('2026-11-03');
    expect(await runScheduled(start, new Date('2026-11-03T09:15:00Z'))).toMatchObject({
      status: 'already published',
    });
    expect(started).toEqual([]);
  });
});
