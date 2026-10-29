import { describe, expect, it } from 'vitest';
import {
  formatDays,
  formatMonth,
  formatRate,
  formatRatio,
  pickDate,
  pickInt,
  pickOne,
} from './analytics';

describe('analytics formatting', () => {
  it('shows days with one decimal under ten and none above, and a dash for no data', () => {
    expect(formatDays(null)).toBe('–');
    expect(formatDays(3.456)).toBe('3.5');
    expect(formatDays(42.4)).toBe('42');
    expect(formatDays(0)).toBe('0.0');
  });

  it('formats rates and ratios', () => {
    expect(formatRate(1.5)).toBe('1.50');
    expect(formatRate(null)).toBe('–');
    expect(formatRatio(3.4219)).toBe('3.42×');
    expect(formatRatio(undefined)).toBe('–');
  });

  it('only lets known values through to the API', () => {
    expect(pickOne('FAST', ['FAST', 'SLOW'] as const)).toBe('FAST');
    expect(pickOne('bogus', ['FAST', 'SLOW'] as const)).toBeUndefined();
    expect(pickOne(undefined, ['FAST'] as const)).toBeUndefined();
    expect(pickInt('30', 7, 365, 90)).toBe(30);
    expect(pickInt('3', 7, 365, 90)).toBe(90);
    expect(pickInt('abc', 7, 365, 90)).toBe(90);
    expect(pickInt('1.5', 1, 9, 4)).toBe(4);
    expect(pickInt('', 0, 9, 4)).toBe(4);
    expect(pickDate('2026-10-05')).toBe('2026-10-05');
    expect(pickDate('05/10/2026')).toBeUndefined();
  });

  it('names a month', () => {
    expect(formatMonth('2026-10')).toBe('Oct 2026');
    expect(formatMonth('nonsense')).toBe('nonsense');
  });
});
