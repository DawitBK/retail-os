let timezone = 'Africa/Addis_Ababa';

/** Set once at start-up from the validated environment. */
export function configureTimezone(tz: string): void {
  // Throws RangeError for an unknown zone, so a typo fails at boot rather than in a report.
  new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  timezone = tz;
}

let clock: () => Date = () => new Date();

/** The current instant. Every timestamp the application writes comes from here, never from the database's now(). */
export const now = (): Date => clock();

/**
 * Replaces the clock. Only the demo-data command calls this, to replay a business that has been
 * trading for months through the real services; the API process never does, so a request can
 * never choose its own time. Returns a function that puts the real clock back.
 */
export function useClock(source: () => Date): () => void {
  const previous = clock;
  clock = source;
  return () => {
    clock = previous;
  };
}

/** The calendar date (YYYY-MM-DD) of an instant in the business time zone, not in UTC. */
export function businessDate(at: Date = now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export const getBusinessTimezone = (): string => timezone;

/** A YYYY-MM-DD calendar date moved by a number of days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
