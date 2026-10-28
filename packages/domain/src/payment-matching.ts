import type { Money } from './money.js';

/** What NetFlex expects, loaded from its own Payment/Order records. */
export interface ExpectedPayment {
  readonly reference: string;
  readonly amount: Money;
  /** Provider account/integration that should have received the money, if the provider reports it. */
  readonly accountId: string | null;
}

/** Normalized result of a server-side provider verification call (never from the browser). */
export interface VerifiedProviderTransaction {
  readonly reference: string;
  readonly status: 'success' | 'failed' | 'abandoned' | 'pending' | 'reversed' | 'unknown';
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly accountId: string | null;
}

export type PaymentMismatch = 'REFERENCE' | 'AMOUNT' | 'CURRENCY' | 'ACCOUNT' | 'STATUS';

/**
 * Decide whether a verified provider transaction may mark the payment SUCCEEDED.
 * Any mismatch blocks fulfilment and is recorded as a discrepancy.
 */
export function matchVerifiedTransaction(
  expected: ExpectedPayment,
  actual: VerifiedProviderTransaction,
): { ok: true } | { ok: false; mismatches: PaymentMismatch[] } {
  const mismatches: PaymentMismatch[] = [];
  if (actual.reference !== expected.reference) mismatches.push('REFERENCE');
  if (actual.currency !== expected.amount.currency) mismatches.push('CURRENCY');
  if (actual.amountMinor !== expected.amount.amountMinor) mismatches.push('AMOUNT');
  if (expected.accountId !== null && actual.accountId !== expected.accountId)
    mismatches.push('ACCOUNT');
  if (actual.status !== 'success') mismatches.push('STATUS');
  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}
