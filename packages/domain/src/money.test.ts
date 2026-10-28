import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  addMoney,
  compareMoney,
  formatMoney,
  money,
  moneyEquals,
  parseMajorUnits,
  subtractMoney,
} from './money.js';

describe('money', () => {
  it('adds and subtracts in minor units without float error', () => {
    // 0.1 + 0.2 style trap in naira/kobo
    const a = money(10n, 'NGN');
    const b = money(20n, 'NGN');
    expect(addMoney(a, b).amountMinor).toBe(30n);
    expect(subtractMoney(b, a).amountMinor).toBe(10n);
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(money(1n, 'NGN'), money(1n, 'USD'))).toThrow(DomainError);
    expect(() => compareMoney(money(1n, 'NGN'), money(1n, 'USD'))).toThrow(/currencies/);
  });

  it('rejects non-bigint amounts', () => {
    expect(() => money(1.5 as unknown as bigint, 'NGN')).toThrow(DomainError);
  });

  it('compares and equals', () => {
    expect(compareMoney(money(1n, 'NGN'), money(2n, 'NGN'))).toBe(-1);
    expect(moneyEquals(money(2n, 'NGN'), money(2n, 'NGN'))).toBe(true);
    expect(moneyEquals(money(2n, 'NGN'), money(2n, 'USD'))).toBe(false);
  });

  it('parses admin-entered major units exactly', () => {
    expect(parseMajorUnits('1500', 'NGN').amountMinor).toBe(150000n);
    expect(parseMajorUnits('1500.5', 'NGN').amountMinor).toBe(150050n);
    expect(parseMajorUnits('0.01', 'NGN').amountMinor).toBe(1n);
    expect(parseMajorUnits('999999999999999.99', 'NGN').amountMinor).toBe(99999999999999999n);
  });

  it.each(['1.234', '-5', '1e3', 'abc', '', '1,000'])('rejects %j', (input) => {
    expect(() => parseMajorUnits(input, 'NGN')).toThrow(DomainError);
  });

  it('formats naira with two decimals', () => {
    const s = formatMoney(money(150050n, 'NGN'));
    expect(s).toContain('1,500.50');
    expect(formatMoney(money(-5n, 'NGN'))).toMatch(/^-.*0\.05$/);
  });
});
