/** Small formatting and parsing helpers shared by the inventory, analytics and forecasting pages. */

/** One decimal under 10, none above; null (nothing sold, so no rate) becomes a dash. */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return '–';
  return Math.abs(days) < 10 ? days.toFixed(1) : String(Math.round(days));
}

/** Units per day, two decimals. */
export function formatRate(perDay: number | null | undefined): string {
  return perDay === null || perDay === undefined || !Number.isFinite(perDay)
    ? '–'
    : perDay.toFixed(2);
}

/** A ratio such as stock turnover or GMROI: "3.42×". */
export function formatRatio(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '–'
    : `${value.toFixed(2)}×`;
}

/** Returns the value only when it is one of the allowed strings; anything else becomes undefined. */
export function pickOne<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return allowed.find((a) => a === value);
}

/** A whole number inside [min, max], else the fallback. */
export function pickInt(
  value: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isInteger(n) && n >= min && n <= max
    ? n
    : fallback;
}

/** Accepts only yyyy-mm-dd, so a typed value cannot reach the API as something else. */
export function pickDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/** "2026-10" -> "Oct 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
