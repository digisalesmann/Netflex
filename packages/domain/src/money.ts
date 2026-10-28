import { DomainError } from './errors.js';

/** ISO 4217 currencies NetFlex supports, with their minor-unit exponent. */
export const CURRENCY_EXPONENTS = { NGN: 2, USD: 2 } as const;
export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, value);
}

/** Money is always integer minor units (kobo for NGN). Never floating point. */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

export function money(amountMinor: bigint, currency: CurrencyCode): Money {
  if (typeof amountMinor !== 'bigint') {
    throw new DomainError('INVALID_AMOUNT', 'Money amounts must be bigint minor units');
  }
  return Object.freeze({ amountMinor, currency });
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new DomainError('CURRENCY_MISMATCH', 'Cannot combine different currencies', {
      a: a.currency,
      b: b.currency,
    });
  }
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

export function assertPositive(m: Money): void {
  if (m.amountMinor <= 0n) {
    throw new DomainError('INVALID_AMOUNT', 'Amount must be greater than zero');
  }
}

/**
 * Format for display only. Uses string arithmetic on the bigint so no
 * precision is lost before Intl formatting.
 */
export function formatMoney(m: Money, locale = 'en-NG'): string {
  const exp = CURRENCY_EXPONENTS[m.currency];
  const negative = m.amountMinor < 0n;
  const abs = negative ? -m.amountMinor : m.amountMinor;
  const divisor = 10n ** BigInt(exp);
  const major = abs / divisor;
  const minor = (abs % divisor).toString().padStart(exp, '0');
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });
  // Intl accepts decimal strings exactly (ES2023 "string numeric literal" support).
  const formatted = fmt.format(`${major.toString()}.${minor}` as unknown as number);
  return negative ? `-${formatted}` : formatted;
}

/**
 * Parse a major-unit decimal string typed by an admin ("1500" or "1500.50")
 * into minor units. Rejects more decimals than the currency allows.
 */
export function parseMajorUnits(input: string, currency: CurrencyCode): Money {
  const exp = CURRENCY_EXPONENTS[currency];
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(input.trim());
  if (!match) throw new DomainError('INVALID_AMOUNT', 'Amount must be a plain decimal number');
  const [, whole = '0', frac = ''] = match;
  if (frac.length > exp) {
    throw new DomainError('INVALID_AMOUNT', `At most ${exp} decimal places allowed`);
  }
  const minor = BigInt(whole) * 10n ** BigInt(exp) + BigInt(frac.padEnd(exp, '0') || '0');
  return money(minor, currency);
}
