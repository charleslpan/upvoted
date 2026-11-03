import { describe, expect, it } from 'vitest';
import { episodeDate } from './dates';

describe('episodeDate', () => {
  it("is the calendar day in the show's time zone (America/New_York)", () => {
    // 03:30 UTC on Nov 3 is still Nov 2 in New York.
    expect(episodeDate(new Date('2026-11-03T03:30:00Z'))).toBe('2026-11-02');
    expect(episodeDate(new Date('2026-11-03T08:00:00Z'))).toBe('2026-11-03');
  });

  it('accepts another time zone', () => {
    expect(episodeDate(new Date('2026-11-03T03:30:00Z'), 'UTC')).toBe('2026-11-03');
  });
});
