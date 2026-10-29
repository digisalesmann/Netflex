import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakePaymentProvider } from './fake.js';
import {
  PaystackProvider,
  mapTxStatus,
  parseWebhookBody,
  redactPaystackEvent,
  verifyHmacSha512,
} from './paystack.js';
import { PaymentProviderError } from './provider.js';

const KEY = 'sk_test_0123456789abcdef';

function mockFetch(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown } | Error,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = handler(String(url), init ?? {});
    if (r instanceof Error) throw r;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe('webhook signature (HMAC-SHA512 of the raw body)', () => {
  const body = Buffer.from('{"event":"charge.success","data":{"reference":"abc123"}}');
  const sig = createHmac('sha512', KEY).update(body).digest('hex');

  it('accepts the correct signature', () => expect(verifyHmacSha512(KEY, body, sig)).toBe(true));
  it('accepts upper-case hex', () =>
    expect(verifyHmacSha512(KEY, body, sig.toUpperCase())).toBe(true));
  it('rejects a signature over a re-serialized body', () => {
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1));
    expect(verifyHmacSha512(KEY, reserialized, sig)).toBe(false);
  });
  it('rejects wrong key, missing, malformed and SHA-256 signatures', () => {
    expect(verifyHmacSha512('sk_test_other', body, sig)).toBe(false);
    expect(verifyHmacSha512(KEY, body, undefined)).toBe(false);
    expect(verifyHmacSha512(KEY, body, 'nothex')).toBe(false);
    expect(verifyHmacSha512(KEY, body, createHmac('sha256', KEY).update(body).digest('hex'))).toBe(
      false,
    );
  });
});

describe('webhook parsing and redaction', () => {
  it('extracts the reference and drops customer/card data', () => {
    const raw = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: {
          reference: 'r1',
          amount: 50000,
          currency: 'NGN',
          customer: { email: 'a@b.c', phone: '080' },
          authorization: { last4: '4081', bin: '408408' },
        },
      }),
    );
    const p = parseWebhookBody(raw);
    expect(p.event).toEqual({ kind: 'charge.success', reference: 'r1' });
    const json = JSON.stringify(p.redacted);
    expect(json).not.toMatch(/a@b\.c|4081|408408|080/);
    expect(json).toContain('"amount":50000');
  });
  it('maps refund events by transaction reference (amount may be a string)', () => {
    const raw = Buffer.from(
      JSON.stringify({
        event: 'refund.processed',
        data: { status: 'processed', transaction_reference: 'T1', amount: '5000', currency: 'NGN' },
      }),
    );
    expect(parseWebhookBody(raw).event).toEqual({
      kind: 'refund',
      status: 'processed',
      transactionReference: 'T1',
    });
  });
  it('rejects malformed bodies', () => {
    expect(() => parseWebhookBody(Buffer.from('not json'))).toThrow(PaymentProviderError);
    expect(() => parseWebhookBody(Buffer.from('{"data":{}}'))).toThrow(PaymentProviderError);
  });
  it('redaction keeps only allow-listed fields', () => {
    expect(
      Object.keys((redactPaystackEvent('x', { a: 1, reference: 'r' }) as { data: object }).data),
    ).not.toContain('a');
  });
});

describe('status mapping', () => {
  it.each([
    ['success', 'success'],
    ['failed', 'failed'],
    ['abandoned', 'abandoned'],
    ['reversed', 'reversed'],
    ['ongoing', 'pending'],
    ['queued', 'pending'],
    ['something-new', 'unknown'],
  ])('%s → %s', (a, b) => expect(mapTxStatus(a)).toBe(b));
});

describe('PaystackProvider HTTP contract (mocked transport)', () => {
  it('initializes with integer kobo, our reference, bearer auth', async () => {
    const m = mockFetch(() => ({
      status: 200,
      body: {
        status: true,
        message: 'ok',
        data: {
          authorization_url: 'https://checkout.paystack.com/x',
          access_code: 'x',
          reference: 'nfx-ref-001',
        },
      },
    }));
    const p = new PaystackProvider(KEY, 'https://api.paystack.co', 1000, m.impl);
    const r = await p.initialize({
      reference: 'nfx-ref-001',
      amountMinor: 150050n,
      currency: 'NGN',
      email: 'a@b.co',
      callbackUrl: 'https://x/cb',
      metadata: { orderId: 'o' },
    });
    expect(r.checkoutUrl).toBe('https://checkout.paystack.com/x');
    expect(m.calls[0]?.url).toBe('https://api.paystack.co/transaction/initialize');
    expect((m.calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
    expect(JSON.parse(String(m.calls[0]?.init.body))).toMatchObject({
      amount: 150050,
      currency: 'NGN',
      reference: 'nfx-ref-001',
    });
  });

  it('verifies and normalizes amounts to bigint', async () => {
    const m = mockFetch(() => ({
      status: 200,
      body: {
        status: true,
        message: 'ok',
        data: {
          id: 99,
          status: 'success',
          reference: 'nfx-ref-001',
          amount: 150050,
          currency: 'NGN',
          paid_at: '2026-10-29T10:00:00.000Z',
        },
      },
    }));
    const v = await new PaystackProvider(KEY, undefined, 1000, m.impl).verify('nfx-ref-001');
    expect(v).toMatchObject({
      status: 'success',
      amountMinor: 150050n,
      currency: 'NGN',
      providerTransactionId: '99',
    });
  });

  it('maps transport failures to typed, retryable errors', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    await expect(
      new PaystackProvider(KEY, undefined, 1000, mockFetch(() => timeout).impl).verify(
        'nfx-ref-001',
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
    await expect(
      new PaystackProvider(
        KEY,
        undefined,
        1000,
        mockFetch(() => ({ status: 503, body: {} })).impl,
      ).verify('nfx-ref-001'),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    await expect(
      new PaystackProvider(
        KEY,
        undefined,
        1000,
        mockFetch(() => ({ status: 401, body: {} })).impl,
      ).verify('nfx-ref-001'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
    await expect(
      new PaystackProvider(
        KEY,
        undefined,
        1000,
        mockFetch(() => ({ status: 404, body: {} })).impl,
      ).verify('nfx-ref-001'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      new PaystackProvider(
        KEY,
        undefined,
        1000,
        mockFetch(() => ({ status: 200, body: 'garbage' })).impl,
      ).verify('nfx-ref-001'),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(
      new PaystackProvider(
        KEY,
        undefined,
        1000,
        mockFetch(() => ({
          status: 200,
          body: {
            status: true,
            message: 'ok',
            data: { id: 1, status: 'success', reference: 'r', amount: 1.5, currency: 'NGN' },
          },
        })).impl,
      ).verify('nfx-ref-001'),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('refuses unsafe references and bad keys', async () => {
    const p = new PaystackProvider(
      KEY,
      undefined,
      1000,
      mockFetch(() => ({ status: 200, body: {} })).impl,
    );
    await expect(p.verify('../../etc')).rejects.toMatchObject({ code: 'REJECTED' });
    expect(() => new PaystackProvider('pk_live_x')).toThrow();
  });

  it('error messages never include the secret key', async () => {
    const p = new PaystackProvider(
      KEY,
      undefined,
      1000,
      mockFetch(() => ({ status: 400, body: { status: false, message: 'Invalid amount' } })).impl,
    );
    const err = await p.verify('nfx-ref-001').then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect(err?.message).not.toContain(KEY);
  });
});

describe('FakePaymentProvider', () => {
  it('refuses to exist outside development/test', () => {
    expect(() => new FakePaymentProvider('production')).toThrow();
    expect(() => new FakePaymentProvider('staging')).toThrow();
  });
  it('signs webhooks with the same scheme it verifies', () => {
    const f = new FakePaymentProvider('test');
    const w = f.signedWebhook({ event: 'charge.success', data: { reference: 'r' } });
    expect(
      f.verifyWebhookSignature(Buffer.from(w.body), { 'x-paystack-signature': w.signature }),
    ).toBe(true);
  });
});
