import { describe, expect, it } from 'vitest';
import {
  VOUCHER_ALPHABET,
  VOUCHER_ENTROPY_BITS,
  computeVoucherVerifier,
  constantTimeEqualHex,
  formatVoucherCode,
  generateVoucherCode,
  normalizeVoucherCode,
  voucherHint,
  type VoucherCode,
} from './voucher-code.js';

const PEPPER = 'p'.repeat(32);

describe('voucher codes', () => {
  it('has the documented entropy and no confusable characters', () => {
    expect(VOUCHER_ENTROPY_BITS).toBeGreaterThan(59);
    for (const ch of '01OIL') expect(VOUCHER_ALPHABET).not.toContain(ch);
    expect(new Set(VOUCHER_ALPHABET).size).toBe(VOUCHER_ALPHABET.length);
  });

  it('generates 12-character codes from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateVoucherCode();
      expect(c).toMatch(new RegExp(`^[${VOUCHER_ALPHABET}]{12}$`));
    }
  });

  it('produces no duplicates in a large sample', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(generateVoucherCode());
    expect(seen.size).toBe(20_000);
  });

  it('uses every alphabet symbol (rough uniformity check)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 5_000; i++)
      for (const ch of generateVoucherCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(VOUCHER_ALPHABET.length);
    const expected = (5_000 * 12) / VOUCHER_ALPHABET.length;
    for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.15);
  });

  it('rejects a broken random source', () => {
    expect(() => generateVoucherCode(() => 99)).toThrow();
  });

  it('formats and normalizes round-trip', () => {
    const c = generateVoucherCode();
    const shown = formatVoucherCode(c);
    expect(shown).toMatch(/^.{4}-.{4}-.{4}$/);
    expect(normalizeVoucherCode(shown)).toBe(c);
    expect(normalizeVoucherCode(` ${shown.toLowerCase()} `)).toBe(c);
  });

  it.each(['', 'ABCD', 'ABCD-EFGH-JKL0', 'ABCD-EFGH-JKLO', 'x'.repeat(100), 'ABCD-EFGH-JKLM-N'])(
    'normalize rejects %j',
    (input) => expect(normalizeVoucherCode(input)).toBeNull(),
  );

  it('derives a stable keyed verifier that depends on the pepper', () => {
    const c = 'ABCDEFGHJKMN' as VoucherCode;
    const v1 = computeVoucherVerifier(PEPPER, c);
    expect(v1).toMatch(/^[0-9a-f]{64}$/);
    expect(computeVoucherVerifier(PEPPER, c)).toBe(v1);
    expect(computeVoucherVerifier('q'.repeat(32), c)).not.toBe(v1);
    expect(v1).not.toContain(c);
  });

  it('refuses a short pepper', () => {
    expect(() => computeVoucherVerifier('short', 'ABCDEFGHJKMN' as VoucherCode)).toThrow();
  });

  it('hint is last four characters', () => {
    expect(voucherHint('ABCDEFGHJKMN' as VoucherCode)).toBe('JKMN');
  });

  it('constant-time compare', () => {
    expect(constantTimeEqualHex('abcd', 'abcd')).toBe(true);
    expect(constantTimeEqualHex('abcd', 'abce')).toBe(false);
    expect(constantTimeEqualHex('abcd', 'abcdab')).toBe(false);
    expect(constantTimeEqualHex('', '')).toBe(false);
  });
});
