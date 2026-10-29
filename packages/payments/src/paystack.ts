import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  PaymentProviderError,
  SAFE_REFERENCE,
  type InitializeInput,
  type InitializeResult,
  type PaymentProvider,
  type ProviderRefundStatus,
  type ProviderTxStatus,
  type RefundInput,
  type RefundResult,
  type VerifiedTransaction,
  type WebhookEvent,
} from './provider.js';

/**
 * Paystack adapter. Facts this relies on are recorded with sources in
 * docs/payments/paystack-reference.md. NOT live-verified until a sandbox run
 * with the owner's sk_test_ key is recorded.
 */

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ status: z.boolean(), message: z.string(), data });
const intAmount = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((v) => BigInt(v));

const InitResponse = envelope(
  z.object({ authorization_url: z.url(), access_code: z.string(), reference: z.string() }),
);
const VerifyResponse = envelope(
  z.object({
    id: z.union([z.number(), z.string()]),
    status: z.string(),
    reference: z.string(),
    amount: intAmount,
    currency: z.string(),
    paid_at: z.string().nullable().optional(),
  }),
);
const RefundData = z.object({
  id: z.union([z.number(), z.string()]),
  status: z.string(),
  amount: intAmount,
  currency: z.string(),
});
const RefundResponse = envelope(RefundData);
const WebhookBody = z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) });

export function mapTxStatus(s: string): ProviderTxStatus {
  switch (s) {
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'abandoned':
      return 'abandoned';
    case 'reversed':
      return 'reversed';
    case 'ongoing':
    case 'pending':
    case 'processing':
    case 'queued':
      return 'pending';
    default:
      return 'unknown';
  }
}

export function mapRefundStatus(s: string): ProviderRefundStatus {
  return (
    (['pending', 'processing', 'processed', 'failed'] as const).find((x) => x === s) ?? 'unknown'
  );
}

/** Keep only fields NetFlex needs; drop customer, authorization and card data. */
export function redactPaystackEvent(
  event: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const pick = (k: string) => (data[k] === undefined ? undefined : data[k]);
  return {
    event,
    data: {
      id: pick('id'),
      reference: pick('reference'),
      status: pick('status'),
      amount: pick('amount'),
      currency: pick('currency'),
      paid_at: pick('paid_at'),
      channel: pick('channel'),
      transaction_reference: pick('transaction_reference'),
      refund_reference: pick('refund_reference'),
      domain: pick('domain'),
    },
  };
}

export class PaystackProvider implements PaymentProvider {
  readonly kind = 'PAYSTACK' as const;

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.paystack.co',
    private readonly timeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^sk_(test|live)_/.test(secretKey))
      throw new Error('Paystack secret key has an unexpected format');
  }

  private async call<T extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.infer<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body !== undefined
          ? {
              body: JSON.stringify(body, (_k, v: unknown) =>
                typeof v === 'bigint' ? Number(v) : v,
              ),
            }
          : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new PaymentProviderError(
        timeout ? 'TIMEOUT' : 'UNAVAILABLE',
        timeout ? 'Payment provider timed out' : 'Payment provider unreachable',
        true,
      );
    }
    if (res.status === 401)
      throw new PaymentProviderError(
        'UNAUTHORIZED',
        'Payment provider rejected our credentials',
        false,
      );
    if (res.status === 404)
      throw new PaymentProviderError('NOT_FOUND', 'Not found at payment provider', false);
    if (res.status >= 500)
      throw new PaymentProviderError('UNAVAILABLE', `Payment provider error ${res.status}`, true);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new PaymentProviderError(
        'BAD_RESPONSE',
        'Payment provider returned invalid JSON',
        true,
      );
    }
    if (res.status >= 400) {
      const msg = (json as { message?: unknown })?.message;
      throw new PaymentProviderError(
        'REJECTED',
        `Payment provider refused the request: ${typeof msg === 'string' ? msg.slice(0, 160) : res.status}`,
        false,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success || !(parsed.data as { status: boolean }).status) {
      throw new PaymentProviderError('BAD_RESPONSE', 'Unexpected payment provider response', true);
    }
    return parsed.data;
  }

  async initialize(i: InitializeInput): Promise<InitializeResult> {
    if (!SAFE_REFERENCE.test(i.reference))
      throw new PaymentProviderError('REJECTED', 'Invalid reference format', false);
    if (i.amountMinor > BigInt(Number.MAX_SAFE_INTEGER))
      throw new PaymentProviderError('REJECTED', 'Amount too large', false);
    const r = await this.call('POST', '/transaction/initialize', InitResponse, {
      email: i.email,
      amount: i.amountMinor,
      currency: i.currency,
      reference: i.reference,
      callback_url: i.callbackUrl,
      metadata: i.metadata,
    });
    if (r.data.reference !== i.reference)
      throw new PaymentProviderError(
        'BAD_RESPONSE',
        'Provider returned a different reference',
        false,
      );
    return { checkoutUrl: r.data.authorization_url, providerReference: r.data.reference };
  }

  async verify(reference: string): Promise<VerifiedTransaction> {
    if (!SAFE_REFERENCE.test(reference))
      throw new PaymentProviderError('REJECTED', 'Invalid reference format', false);
    const r = await this.call(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
      VerifyResponse,
    );
    return {
      reference: r.data.reference,
      status: mapTxStatus(r.data.status),
      rawStatus: r.data.status,
      amountMinor: r.data.amount,
      currency: r.data.currency,
      providerTransactionId: String(r.data.id),
      paidAt: r.data.paid_at ? new Date(r.data.paid_at) : null,
    };
  }

  async createRefund(i: RefundInput): Promise<RefundResult> {
    const r = await this.call('POST', '/refund', RefundResponse, {
      transaction: i.transactionReference,
      amount: i.amountMinor,
      currency: i.currency,
      merchant_note: i.merchantNote.slice(0, 200),
    });
    return {
      providerRefundId: String(r.data.id),
      status: mapRefundStatus(r.data.status),
      amountMinor: r.data.amount,
      currency: r.data.currency,
    };
  }

  async fetchRefund(id: string): Promise<RefundResult> {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id))
      throw new PaymentProviderError('REJECTED', 'Invalid refund id', false);
    const r = await this.call('GET', `/refund/${id}`, RefundResponse);
    return {
      providerRefundId: String(r.data.id),
      status: mapRefundStatus(r.data.status),
      amountMinor: r.data.amount,
      currency: r.data.currency,
    };
  }

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    return verifyHmacSha512(this.secretKey, rawBody, headers['x-paystack-signature']);
  }

  parseWebhook(rawBody: Buffer) {
    return parseWebhookBody(rawBody);
  }
}

export function verifyHmacSha512(
  secret: string,
  rawBody: Buffer,
  header: string | string[] | undefined,
): boolean {
  const sig = Array.isArray(header) ? header[0] : header;
  if (!sig || !/^[0-9a-f]{128}$/i.test(sig)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(sig, 'hex'));
}

export function parseWebhookBody(rawBody: Buffer): {
  type: string;
  event: WebhookEvent;
  redacted: Record<string, unknown>;
} {
  let parsed;
  try {
    parsed = WebhookBody.parse(JSON.parse(rawBody.toString('utf8')));
  } catch {
    throw new PaymentProviderError('BAD_RESPONSE', 'Malformed webhook body', false);
  }
  const { event: type, data } = parsed;
  const redacted = redactPaystackEvent(type, data);
  let event: WebhookEvent = { kind: 'other', type };
  if (
    (type === 'charge.success' || type === 'charge.failed') &&
    typeof data.reference === 'string'
  ) {
    event = { kind: type, reference: data.reference };
  } else if (type.startsWith('refund.') && typeof data.transaction_reference === 'string') {
    event = {
      kind: 'refund',
      status: mapRefundStatus(String(data.status ?? type.slice(7))),
      transactionReference: data.transaction_reference,
    };
  }
  return { type, event, redacted };
}
