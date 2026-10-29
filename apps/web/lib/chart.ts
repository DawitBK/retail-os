/** Pure scaling helpers for the small inline SVG charts. No drawing here, only numbers. */

export interface Point {
  x: number;
  y: number;
  index: number;
  value: number;
}

/** Round a positive maximum up to 1, 2 or 5 times a power of ten, so axis labels read cleanly. */
export function niceCeil(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  const frac = max / base;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * base;
}

/** A function that maps a value from [d0, d1] onto [r0, r1]; a flat domain maps to the middle. */
export function scaleLinear(
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): (value: number) => number {
  if (d0 === d1) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

/** The smallest range that holds every number and, optionally, zero. Empty input gives [0, 1]. */
export function extent(
  values: (number | null | undefined)[],
  includeZero = true,
): [number, number] {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return [0, 1];
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return min === max ? [min, min + 1] : [min, max];
}

/** Equal-width slots for `count` bars across `width`; `gap` is the share of each slot left empty. */
export function barSlots(count: number, width: number, gap = 0.25): { x: number; w: number }[] {
  if (count <= 0) return [];
  const slot = width / count;
  const w = slot * (1 - gap);
  return Array.from({ length: count }, (_, i) => ({ x: i * slot + (slot - w) / 2, w }));
}

/**
 * Turn a series into runs of points; a null value ends the current run, so a missing month shows as
 * a gap instead of a line that dives to zero.
 */
export function lineRuns(
  values: (number | null)[],
  box: { width: number; height: number; min: number; max: number },
): Point[][] {
  const n = values.length;
  const x = scaleLinear(0, Math.max(n - 1, 1), 0, box.width);
  const y = scaleLinear(box.min, box.max, box.height, 0);
  const runs: Point[][] = [];
  let current: Point[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    current.push({ x: n === 1 ? box.width / 2 : x(index), y: y(value), index, value });
  });
  if (current.length > 0) runs.push(current);
  return runs;
}

/** SVG path data for a run of points, rounded to two decimals to keep the markup small. */
export function toPath(points: Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
}
