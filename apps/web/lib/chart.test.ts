import { describe, expect, it } from 'vitest';
import { barSlots, extent, lineRuns, niceCeil, scaleLinear, toPath } from './chart';

describe('chart scaling', () => {
  it('rounds a maximum up to a tidy axis value', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(0.7)).toBe(1);
    expect(niceCeil(1.2)).toBe(2);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(73)).toBe(100);
    expect(niceCeil(420_000)).toBe(500_000);
  });

  it('maps a domain onto a range and survives a flat domain', () => {
    const s = scaleLinear(0, 10, 100, 0);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(0);
    expect(s(5)).toBe(50);
    expect(scaleLinear(3, 3, 0, 10)(3)).toBe(5);
  });

  it('finds the extent of a series, ignoring nulls and including zero when asked', () => {
    expect(extent([5, null, 9])).toEqual([0, 9]);
    expect(extent([5, 9], false)).toEqual([5, 9]);
    expect(extent([-4, 2])).toEqual([-4, 2]);
    expect(extent([])).toEqual([0, 1]);
    expect(extent([0, 0])).toEqual([0, 1]);
  });

  it('lays bars out in equal slots that stay inside the width', () => {
    const slots = barSlots(4, 100, 0.2);
    expect(slots).toHaveLength(4);
    expect(slots[0]?.w).toBeCloseTo(20);
    const last = slots[3];
    expect((last?.x ?? 0) + (last?.w ?? 0)).toBeLessThanOrEqual(100);
    expect(barSlots(0, 100)).toEqual([]);
  });

  it('breaks a line at a missing value', () => {
    const runs = lineRuns([1, 2, null, 4], { width: 30, height: 10, min: 0, max: 4 });
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(2);
    expect(runs[1]).toHaveLength(1);
    expect(runs[0]?.[0]).toMatchObject({ x: 0, y: 7.5 });
  });

  it('writes path data', () => {
    const [run] = lineRuns([0, 4], { width: 10, height: 10, min: 0, max: 4 });
    expect(toPath(run ?? [])).toBe('M0.00 10.00 L10.00 0.00');
  });
});
