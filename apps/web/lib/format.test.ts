import { describe, expect, it } from 'vitest';
import { label, parseMoney, toInput } from './format';

describe('money input', () => {
  it('parses plain amounts into minor units', () => {
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('1,234.05')).toBe(123405);
    expect(parseMoney('0.07')).toBe(7);
  });

  it('rejects anything that is not a non-negative amount with at most two decimals', () => {
    for (const bad of ['', '-1', '1.234', 'abc', '1e3', '.5', '1.']) {
      expect(parseMoney(bad)).toBeNull();
    }
  });

  it('round-trips through the editable form', () => {
    for (const minor of [0, 1, 99, 100, 123456]) {
      expect(parseMoney(toInput(minor))).toBe(minor);
    }
  });

  it('labels enum values', () => {
    expect(label('BANK_TRANSFER')).toBe('Bank transfer');
  });
});
