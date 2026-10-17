let timezone = 'Africa/Addis_Ababa';

/** Set once at start-up from the validated environment. */
export function configureTimezone(tz: string): void {
  // Throws RangeError for an unknown zone, so a typo fails at boot rather than in a report.
  new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  timezone = tz;
}

/** The calendar date (YYYY-MM-DD) of an instant in the business time zone, not in UTC. */
export function businessDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export const getBusinessTimezone = (): string => timezone;
