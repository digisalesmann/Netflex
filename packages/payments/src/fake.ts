import { createHmac, randomBytes } from 'node:crypto';
import { assertSimulatorAllowed, type NetflexEnvironment } from '@netflex/config';
import { parseWebhookBody, verifyHmacSha512 } from './paystack.js';
import {
  PaymentProviderError,
  type InitializeInput,
  type InitializeResult,
  type PaymentProvider,
  type ProviderRefundStatus,
  type ProviderTxStatus,
  type RefundInput,
  type RefundResult,
  type VerifiedTransaction,
} from './provider.js';

interface FakeTx {
  reference: string;
  amountMinor: bigint;
  currency: string;
  status: ProviderTxStatus;
  id: string;
  paidAt: Date | null;
}

/**
 * TEST DOUBLE — never a real payment. Mimics the Paystack contract (including
 * HMAC-SHA512 webhook signatures) so the full payment path can be tested.
 * Construction throws outside development/test, and config validation rejects
 * PAYMENT_PROVIDER=fake in staging/production.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly kind = 'FAKE' as const;
  readonly webhookSecret = `fake_whsec_${randomBytes(16).toString('hex')}`;
  private readonly txs = new Map<string, FakeTx>();
  private readonly refunds = new Map<string, RefundResult & { reference: string }>();
  /** Inject failures: next N calls of a method throw this error. */
  private readonly failures = new Map<string, PaymentProviderError[]>();
  readonly calls: { method: string; arg: string }[] = [];

  private readonly checkoutBaseUrl: string;

  constructor(env: NetflexEnvironment, opts: { checkoutBaseUrl?: string } = {}) {
    assertSimulatorAllowed(env, 'FakePaymentProvider');
    this.checkoutBaseUrl = opts.checkoutBaseUrl ?? 'https://checkout.fake.invalid/';
  }

  failNext(
    method: 'initialize' | 'verify' | 'createRefund' | 'fetchRefund',
    error: PaymentProviderError,
    times = 1,
  ): void {
    this.failures.set(method, [
      ...(this.failures.get(method) ?? []),
      ...Array.from({ length: times }, () => error),
    ]);
  }

  private maybeFail(method: string): void {
    const queue = this.failures.get(method);
    const err = queue?.shift();
    if (err) throw err;
  }

  initialize(i: InitializeInput): Promise<InitializeResult> {
    this.calls.push({ method: 'initialize', arg: i.reference });
    this.maybeFail('initialize');
    this.txs.set(i.reference, {
      reference: i.reference,
      amountMinor: i.amountMinor,
      currency: i.currency,
      status: 'pending',
      id: String(this.txs.size + 1000),
      paidAt: null,
    });
    return Promise.resolve({
      checkoutUrl: `${this.checkoutBaseUrl}${encodeURIComponent(i.reference)}`,
      providerReference: i.reference,
    });
  }

  /** Simulate the customer finishing checkout. Overrides let tests forge mismatches. */
  complete(
    reference: string,
    outcome: { status?: ProviderTxStatus; amountMinor?: bigint; currency?: string } = {},
  ): void {
    const tx = this.txs.get(reference);
    if (!tx) throw new Error(`fake: unknown reference ${reference}`);
    Object.assign(tx, {
      status: outcome.status ?? 'success',
      ...(outcome.amountMinor !== undefined ? { amountMinor: outcome.amountMinor } : {}),
      ...(outcome.currency ? { currency: outcome.currency } : {}),
    });
    if (tx.status === 'success') tx.paidAt = new Date();
  }

  /** Whether this simulator knows the reference (used by the development checkout page). */
  has(reference: string): boolean {
    return this.txs.has(reference);
  }

  verify(reference: string): Promise<VerifiedTransaction> {
    this.calls.push({ method: 'verify', arg: reference });
    this.maybeFail('verify');
    const tx = this.txs.get(reference);
    if (!tx)
      return Promise.reject(
        new PaymentProviderError('NOT_FOUND', 'Not found at payment provider', false),
      );
    return Promise.resolve({
      reference: tx.reference,
      status: tx.status,
      rawStatus: tx.status,
      amountMinor: tx.amountMinor,
      currency: tx.currency,
      providerTransactionId: tx.id,
      paidAt: tx.paidAt,
    });
  }

  createRefund(i: RefundInput): Promise<RefundResult> {
    this.calls.push({ method: 'createRefund', arg: i.transactionReference });
    this.maybeFail('createRefund');
    const tx = this.txs.get(i.transactionReference);
    if (!tx || tx.status !== 'success')
      return Promise.reject(
        new PaymentProviderError('REJECTED', 'Transaction not refundable', false),
      );
    const r = {
      providerRefundId: String(5000 + this.refunds.size),
      status: 'pending' as ProviderRefundStatus,
      amountMinor: i.amountMinor,
      currency: i.currency,
      reference: i.transactionReference,
    };
    this.refunds.set(r.providerRefundId, r);
    return Promise.resolve({ ...r });
  }

  setRefundStatus(providerRefundId: string, status: ProviderRefundStatus): void {
    const r = this.refunds.get(providerRefundId);
    if (!r) throw new Error('fake: unknown refund');
    r.status = status;
  }

  fetchRefund(id: string): Promise<RefundResult> {
    this.calls.push({ method: 'fetchRefund', arg: id });
    this.maybeFail('fetchRefund');
    const r = this.refunds.get(id);
    return r
      ? Promise.resolve({ ...r })
      : Promise.reject(
          new PaymentProviderError('NOT_FOUND', 'Not found at payment provider', false),
        );
  }

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    return verifyHmacSha512(this.webhookSecret, rawBody, headers['x-paystack-signature']);
  }

  parseWebhook(rawBody: Buffer) {
    return parseWebhookBody(rawBody);
  }

  /** Build a signed webhook exactly as Paystack would send it. */
  signedWebhook(payload: unknown): { body: string; signature: string } {
    const body = JSON.stringify(payload);
    return { body, signature: createHmac('sha512', this.webhookSecret).update(body).digest('hex') };
  }
}
