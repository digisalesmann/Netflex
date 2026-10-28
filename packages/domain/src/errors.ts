/** Stable, machine-readable error codes shared by API responses and logs. */
export const DOMAIN_ERROR_CODES = [
  'INVALID_STATE_TRANSITION',
  'CURRENCY_MISMATCH',
  'INVALID_AMOUNT',
  'INVALID_DURATION',
  'INVALID_TIME_ZONE',
  'INVALID_SCOPE_TARGET',
  'PLAN_NOT_PURCHASABLE',
  'VOUCHER_NOT_REDEEMABLE',
  'PAYMENT_MISMATCH',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    /** Safe, non-secret diagnostic details for logs. Never shown to tenants. */
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
