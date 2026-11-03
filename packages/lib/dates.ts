import { config } from './config';

/** The episode date (YYYY-MM-DD) for a moment: its calendar day in the show's time zone. */
export function episodeDate(now: Date, timeZone: string = config.show.timezone): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
