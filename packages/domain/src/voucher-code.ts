import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Voucher code format (ADR-0003): 12 characters from a 31-symbol alphabet with
 * no 0/O/1/I/L, shown as XXXX-XXXX-XXXX. Entropy ≈ 59.4 bits.
 */
export const VOUCHER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const VOUCHER_CODE_LENGTH = 12;
export const VOUCHER_ENTROPY_BITS = VOUCHER_CODE_LENGTH * Math.log2(VOUCHER_ALPHABET.length);

/** Raw, normalized voucher code. Treat as a secret: never log, never put in URLs. */
export type VoucherCode = string & { readonly __brand: 'VoucherCode' };

export type RandomIntFn = (maxExclusive: number) => number;

export function generateVoucherCode(rand: RandomIntFn = (max) => randomInt(max)): VoucherCode {
  let out = '';
  for (let i = 0; i < VOUCHER_CODE_LENGTH; i++) {
    const idx = rand(VOUCHER_ALPHABET.length);
    if (!Number.isInteger(idx) || idx < 0 || idx >= VOUCHER_ALPHABET.length) {
      throw new Error('Random source returned an out-of-range index');
    }
    out += VOUCHER_ALPHABET[idx];
  }
  return out as VoucherCode;
}

/** Display form: XXXX-XXXX-XXXX. */
export function formatVoucherCode(code: VoucherCode): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

const VALID = new RegExp(`^[${VOUCHER_ALPHABET}]{${VOUCHER_CODE_LENGTH}}$`);

/**
 * Normalize user input: uppercase, drop spaces/dashes. Returns null for anything
 * that can't be a voucher, so callers can return the same generic error as for
 * an unknown code.
 */
export function normalizeVoucherCode(input: string): VoucherCode | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  return VALID.test(cleaned) ? (cleaned as VoucherCode) : null;
}

/** Keyed verifier stored in the database instead of the code (unique index). */
export function computeVoucherVerifier(pepper: string, code: VoucherCode): string {
  if (pepper.length < 32) throw new Error('Voucher pepper is too short');
  return createHmac('sha256', pepper).update(`netflex:voucher:v1:${code}`).digest('hex');
}

/** Last 4 characters, safe to show staff for support lookups. */
export function voucherHint(code: VoucherCode): string {
  return code.slice(-4);
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}
