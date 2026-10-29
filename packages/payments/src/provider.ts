/**
 * Payment provider abstraction (spec §6, §13). Business logic never talks to a
 * provider SDK directly. Every method returns normalized, typed data; provider
 * failures surface as PaymentProviderError with a stable code and a safe message.
 */

export type ProviderKind = 'PAYSTACK' | 'FAKE';

export type ProviderTxStatus =
  'success' | 'failed' | 'abandoned' | 'pending' | 'reversed' | 'unknown';
export type ProviderRefundStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'unknown';

export interface InitializeInput {
  reference: string;
  amountMinor: bigint;
  currency: string;
  email: string;
  callbackUrl: string;
  /** Non-sensitive identifiers only. */
  metadata: Record<string, string>;
}

export interface InitializeResult {
  checkoutUrl: string;
  providerReference: string;
}

export interface VerifiedTransaction {
  reference: string;
  status: ProviderTxStatus;
  amountMinor: bigint;
  currency: string;
  providerTransactionId: string | null;
  paidAt: Date | null;
  /** Provider's raw status string, for diagnostics. */
  rawStatus: string;
}

export interface RefundInput {
  transactionReference: string;
  amountMinor: bigint;
  currency: string;
  merchantNote: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: ProviderRefundStatus;
  amountMinor: bigint;
  currency: string;
}

export type WebhookEvent =
  | { kind: 'charge.success' | 'charge.failed'; reference: string }
  | { kind: 'refund'; status: ProviderRefundStatus; transactionReference: string }
  | { kind: 'other'; type: string };

export interface PaymentProvider {
  readonly kind: ProviderKind;
  initialize(input: InitializeInput): Promise<InitializeResult>;
  /** Server-side source of truth for a transaction's state. Throws NOT_FOUND if unknown. */
  verify(reference: string): Promise<VerifiedTransaction>;
  createRefund(input: RefundInput): Promise<RefundResult>;
  fetchRefund(providerRefundId: string): Promise<RefundResult>;
  /** Constant-time check of the webhook signature over the unmodified raw body. */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;
  /** Parse a signature-verified webhook body. Never used to decide payment state on its own. */
  parseWebhook(rawBody: Buffer): {
    type: string;
    event: WebhookEvent;
    redacted: Record<string, unknown>;
  };
}

export const PROVIDER_ERROR_CODES = [
  'TIMEOUT',
  'UNAVAILABLE',
  'REJECTED',
  'NOT_FOUND',
  'BAD_RESPONSE',
  'UNAUTHORIZED',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export class PaymentProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    /** Whether retrying later could succeed. */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/** Paystack references: alphanumerics, '-', '.', '=' only. */
export const SAFE_REFERENCE = /^[A-Za-z0-9.=-]{6,100}$/;
