import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.hoisted(() => vi.fn(async () => ({ runId: 'wrun_test' })));
vi.mock('workflow/api', () => ({ start }));

const { GET } = await import('./route');
const { dailyEpisode } = await import('../../../../workflows/daily-episode');

const URL = 'https://upvoted.dev/api/cron/daily';

function call(url = URL, secret: string | null = 'shh'): Promise<Response> {
  const headers = secret === null ? undefined : { authorization: `Bearer ${secret}` };
  return GET(new Request(url, { headers }));
}

describe('GET /api/cron/daily', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'shh');
    start.mockClear();
  });

  it('answers 401 without the secret, and starts nothing', async () => {
    expect((await call(URL, null)).status).toBe(401);
    expect((await call(URL, 'wrong')).status).toBe(401);
    expect(start).not.toHaveBeenCalled();
  });

  it('answers 503 when CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call(URL, '')).status).toBe(503);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts the workflow for today's date in New York", async () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T08:05:00Z'), toFake: ['Date'] });
    try {
      const response = await call();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        date: '2026-11-03',
        force: false,
        runId: 'wrun_test',
      });
      expect(start).toHaveBeenCalledWith(dailyEpisode, ['2026-11-03', false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes another date to rerun', async () => {
    const response = await call(`${URL}?date=2026-11-01`);
    expect(await response.json()).toEqual({ date: '2026-11-01', force: false, runId: 'wrun_test' });
    expect(start).toHaveBeenCalledWith(dailyEpisode, ['2026-11-01', false]);
  });

  it('passes force=1 on to regenerate a published date', async () => {
    const response = await call(`${URL}?date=2026-11-01&force=1`);
    expect(await response.json()).toEqual({ date: '2026-11-01', force: true, runId: 'wrun_test' });
    expect(start).toHaveBeenCalledWith(dailyEpisode, ['2026-11-01', true]);
  });

  it('answers 400 for a force other than 0 or 1', async () => {
    expect((await call(`${URL}?force=yes`)).status).toBe(400);
    expect(start).not.toHaveBeenCalled();
  });

  it('answers 400 for a malformed date', async () => {
    expect((await call(`${URL}?date=tomorrow`)).status).toBe(400);
    expect(start).not.toHaveBeenCalled();
  });
});
