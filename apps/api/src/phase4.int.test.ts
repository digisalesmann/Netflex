import { randomBytes } from 'node:crypto';
import type { PaymentEngine } from '@netflex/core';
import { createLogger } from '@netflex/observability';
import { FakePaymentProvider, PaymentProviderError } from '@netflex/payments';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  XFF,
  createStaff,
  randomPhone,
  signInStaff,
  startHarness,
  uniq,
  type Agent,
  type Harness,
} from '../../../scripts/test/api-harness.js';
import { relayOutboxBatch } from '../../worker/src/outbox-relay.js';
import { createPaymentProcessor, type JobLike } from '../../worker/src/processors.js';
import type { JobSink } from '../../worker/src/queues.js';
import { PAYMENT_ENGINE, PAYMENT_PROVIDER } from './infra/tokens.js';
import { RedemptionService } from './vouchers/redemption.service.js';

let h: Harness;
let fake: FakePaymentProvider;
let engine: PaymentEngine;
let redemption: RedemptionService;
const secrets = new Map<string, string>();
const ag = {} as Record<'owner' | 'admin' | 'finance1' | 'finance2' | 'support' | 'network', Agent>;
let A: { id: string; slug: string };
let versionId: string;

const idem = () => `idem-${randomBytes(12).toString('hex')}`;
const mac = () =>
  Array.from(randomBytes(6), (b, i) => (i === 0 ? b & 0xfc : b).toString(16).padStart(2, '0')).join(
    ':',
  );

/** Guest order + checkout. Returns ids, token and provider reference. */
async function orderAndCheckout(price = '500') {
  void price;
  const o = await request(h.server)
    .post('/api/v1/orders')
    .set(CSRF)
    .set(XFF())
    .set('idempotency-key', idem())
    .send({
      planVersionId: versionId,
      target: { scope: 'INDIVIDUAL' },
      customerPhone: randomPhone(),
    });
  expect(o.status).toBe(201);
  const { orderId, accessToken } = o.body.data as { orderId: string; accessToken: string };
  const c = await checkout(orderId, accessToken);
  expect(c.status).toBe(201);
  return {
    orderId,
    token: accessToken,
    paymentId: c.body.data.paymentId as string,
    reference: c.body.data.reference as string,
  };
}

const checkout = (orderId: string, token: string, key = idem()) =>
  request(h.server)
    .post(`/api/v1/orders/${orderId}/checkout`)
    .set(CSRF)
    .set(XFF())
    .set('x-order-token', token)
    .set('idempotency-key', key)
    .send({ email: 'buyer@example.com' });

function webhook(payload: unknown, opts: { tamper?: boolean; signature?: string } = {}) {
  const w = fake.signedWebhook(payload);
  const body = opts.tamper ? w.body.replace('"NGN"', '"USD"') : w.body;
  // No CSRF header: provider callbacks authenticate by signature.
  return request(h.server)
    .post('/api/v1/webhooks/paystack')
    .set('content-type', 'application/json')
    .set('x-paystack-signature', opts.signature ?? w.signature)
    .send(body);
}

const chargeSuccess = (reference: string, amount = 50000, currency = 'NGN') => ({
  event: 'charge.success',
  data: {
    id: Number(randomBytes(3).readUIntBE(0, 3)),
    reference,
    amount,
    currency,
    status: 'success',
    customer: { email: 'buyer@example.com', phone: '08000000000' },
    authorization: { last4: '4081' },
  },
});

/** Run everything currently in the outbox through the real worker processor (in-process). */
async function drainOutbox() {
  const jobs: JobLike[] = [];
  const sink: JobSink = {
    add: async (_q, name, data, jobId) => void jobs.push({ id: jobId, name, data }),
    close: async () => {},
  };
  await relayOutboxBatch(h.prisma, sink, 200);
  const processor = createPaymentProcessor(
    engine,
    createLogger({ service: 'worker', environment: 'test', level: 'fatal' }),
  );
  const results = [];
  for (const j of jobs) {
    if (j.name.startsWith('payment.') || j.name.startsWith('refund.'))
      results.push(await processor(j));
  }
  return { jobs, results };
}

const orderStatus = (orderId: string, token: string) =>
  request(h.server).get(`/api/v1/orders/${orderId}`).set('x-order-token', token);

beforeAll(async () => {
  h = await startHarness({ PAID_ACCESS_ENABLED: 'true' });
  fake = h.app.get(PAYMENT_PROVIDER);
  engine = h.app.get(PAYMENT_ENGINE);
  redemption = h.app.get(RedemptionService);
  // Park outbox rows from other suites so drainOutbox only sees this file's work.
  await h.prisma.outboxEvent.updateMany({
    where: { dispatchedAt: null },
    data: { dispatchedAt: new Date() },
  });

  ag.owner = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'OWNER', propertyId: null }]),
    secrets,
  );
  const slug = `p4-${uniq()}`;
  const p = await ag.owner
    .post('/api/v1/admin/properties')
    .set(CSRF)
    .send({ slug, name: 'Pay Lodge' });
  A = { id: p.body.data.id as string, slug };
  ag.admin = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'PROPERTY_ADMIN', propertyId: A.id }]),
    secrets,
  );
  ag.finance1 = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'FINANCE', propertyId: A.id }]),
    secrets,
  );
  ag.finance2 = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'FINANCE', propertyId: A.id }]),
    secrets,
  );
  ag.support = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: A.id }]),
    secrets,
  );
  ag.network = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'NETWORK_ADMIN', propertyId: A.id }]),
    secrets,
  );

  const plan = await ag.admin
    .post(`/api/v1/admin/properties/${A.id}/plans`)
    .set(CSRF)
    .send({
      slug: `day-${uniq()}`,
      version: {
        name: 'Day pass',
        description: '24h',
        scope: 'INDIVIDUAL',
        price: '500',
        duration: { value: 1, unit: 'DAY' },
        activationPolicy: 'ON_FIRST_REDEMPTION',
        redemptionWindow: { value: 30, unit: 'DAY' },
        maxDevices: 2,
        maxConcurrentSessions: 2,
        downloadKbps: null,
        uploadKbps: null,
        maxGroupMembers: null,
        renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
        availableFrom: null,
        availableUntil: null,
        fairUseText: null,
        refundPolicyText: 'Refunds before first use.',
        termsVersion: 't',
      },
    });
  versionId = plan.body.data.versionId as string;
  await ag.admin
    .post(
      `/api/v1/admin/properties/${A.id}/plans/${plan.body.data.planId}/versions/${versionId}/publish`,
    )
    .set(CSRF)
    .send({})
    .expect(200);
}, 180_000);

afterAll(async () => {
  await h.close();
});

// ====================================================================== happy path
describe('purchase → verified payment → voucher → redemption', () => {
  it('runs end to end through the real webhook endpoint and worker processor', async () => {
    const { orderId, token, paymentId, reference } = await orderAndCheckout();
    expect((await orderStatus(orderId, token)).body.data.stage).toBe('PAYMENT_PENDING');
    const pay = await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(pay.status).toBe('PENDING');
    expect(pay.checkoutUrl).toContain(reference);

    fake.complete(reference);
    const w = await webhook(chargeSuccess(reference));
    expect(w.status).toBe(200);
    const ev = await h.prisma.paymentEvent.findFirstOrThrow({
      where: { providerReference: reference },
    });
    expect(JSON.stringify(ev.payloadRedacted)).not.toMatch(/buyer@example\.com|4081|08000000000/);

    const { jobs } = await drainOutbox();
    expect(jobs.map((j) => j.name)).toContain('payment.webhook');

    const after = await h.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { order: true },
    });
    expect(after.status).toBe('SUCCEEDED');
    expect(after.order.status).toBe('PAID');
    const voucher = await h.prisma.voucher.findFirstOrThrow({ where: { orderId } });
    expect(voucher.issuanceType).toBe('PAID');
    expect((await orderStatus(orderId, token)).body.data).toMatchObject({
      stage: 'VOUCHER_AVAILABLE',
      voucherAvailable: true,
    });

    const reveal = await request(h.server)
      .post(`/api/v1/orders/${orderId}/voucher`)
      .set(CSRF)
      .set('x-order-token', token)
      .send({});
    expect(reveal.status).toBe(200);
    const code = reveal.body.data.code as string;
    const delivery = await h.prisma.voucherDelivery.findUniqueOrThrow({
      where: { voucherId: voucher.id },
    });
    expect(delivery.codeEnc).not.toContain(code.replace(/-/g, ''));

    expect(
      await redemption.redeem({
        propertyId: A.id,
        code,
        macAddress: mac(),
        userId: null,
        clientKey: uniq(),
      }),
    ).toMatchObject({ ok: true });
    // Once used, the code can no longer be retrieved from the order page.
    await request(h.server)
      .post(`/api/v1/orders/${orderId}/voucher`)
      .set(CSRF)
      .set('x-order-token', token)
      .send({})
      .expect(410);
  });

  it('only the order owner can retrieve the code', async () => {
    const { orderId, reference } = await orderAndCheckout();
    fake.complete(reference);
    await engine.settle(
      (await h.prisma.payment.findFirstOrThrow({ where: { providerReference: reference } })).id,
      'test',
    );
    await request(h.server)
      .post(`/api/v1/orders/${orderId}/voucher`)
      .set(CSRF)
      .send({})
      .expect(404);
    await request(h.server)
      .post(`/api/v1/orders/${orderId}/voucher`)
      .set(CSRF)
      .set('x-order-token', 'forged')
      .send({})
      .expect(404);
  });

  it('the browser redirect proves nothing: "I have paid" re-checks the provider', async () => {
    const { orderId, token, reference } = await orderAndCheckout();
    const before = await request(h.server)
      .post(`/api/v1/orders/${orderId}/payment/verify`)
      .set(CSRF)
      .set('x-order-token', token)
      .send({});
    expect(before.body.data.stage).toBe('PAYMENT_PENDING');
    fake.complete(reference);
    const after = await request(h.server)
      .post(`/api/v1/orders/${orderId}/payment/verify`)
      .set(CSRF)
      .set('x-order-token', token)
      .send({});
    expect(after.body.data.stage).toBe('VOUCHER_AVAILABLE');
  });

  it('checkout is idempotent and refuses paid orders', async () => {
    const o = await request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({
        planVersionId: versionId,
        target: { scope: 'INDIVIDUAL' },
        customerPhone: randomPhone(),
      });
    const { orderId, accessToken } = o.body.data as { orderId: string; accessToken: string };
    const key = idem();
    const c1 = await checkout(orderId, accessToken, key);
    const c2 = await checkout(orderId, accessToken, key);
    expect(c2.body.data.paymentId).toBe(c1.body.data.paymentId);
    expect(c2.body.data.checkoutUrl).toBe(c1.body.data.checkoutUrl);
    expect(await h.prisma.payment.count({ where: { orderId } })).toBe(1);
    fake.complete(c1.body.data.reference);
    await engine.settle(c1.body.data.paymentId, 'test');
    expect((await checkout(orderId, accessToken)).status).toBe(409);
  });
});

// ====================================================================== webhook security
describe('webhook security', () => {
  it('rejects forged, tampered and unsigned webhooks without storing them', async () => {
    const { reference } = await orderAndCheckout();
    fake.complete(reference);
    const before = await h.prisma.paymentEvent.count();
    expect((await webhook(chargeSuccess(reference), { signature: 'a'.repeat(128) })).status).toBe(
      401,
    );
    expect((await webhook(chargeSuccess(reference), { tamper: true })).status).toBe(401);
    expect(
      (
        await request(h.server)
          .post('/api/v1/webhooks/paystack')
          .set('content-type', 'application/json')
          .send(JSON.stringify(chargeSuccess(reference)))
      ).status,
    ).toBe(401);
    // Signed with a different key (e.g. an attacker's own Paystack account).
    const other = new FakePaymentProvider('test').signedWebhook(chargeSuccess(reference));
    expect((await webhook(chargeSuccess(reference), { signature: other.signature })).status).toBe(
      401,
    );
    expect(await h.prisma.paymentEvent.count()).toBe(before);
    expect(
      (await h.prisma.payment.findFirstOrThrow({ where: { providerReference: reference } })).status,
    ).toBe('PENDING');
  });

  it('stores a duplicate delivery once and fulfils once', async () => {
    const { orderId, reference } = await orderAndCheckout();
    fake.complete(reference);
    const payload = chargeSuccess(reference);
    await webhook(payload).expect(200);
    await webhook(payload).expect(200);
    await webhook(payload).expect(200);
    expect(await h.prisma.paymentEvent.count({ where: { providerReference: reference } })).toBe(1);
    await drainOutbox();
    await drainOutbox();
    expect(await h.prisma.subscription.count({ where: { orderId } })).toBe(1);
    expect(await h.prisma.voucher.count({ where: { orderId } })).toBe(1);
  });

  it('never trusts the webhook body: a "success" the provider does not confirm changes nothing', async () => {
    const { orderId, reference } = await orderAndCheckout();
    await webhook(chargeSuccess(reference)).expect(200); // provider still says pending
    await drainOutbox();
    expect(
      (await h.prisma.payment.findFirstOrThrow({ where: { providerReference: reference } })).status,
    ).toBe('PENDING');
    expect(await h.prisma.voucher.count({ where: { orderId } })).toBe(0);
  });

  it('webhooks for unknown references are recorded and ignored', async () => {
    const ref = `NFX-UNKNOWN-${uniq()}`;
    await webhook(chargeSuccess(ref)).expect(200);
    await drainOutbox();
    const ev = await h.prisma.paymentEvent.findFirstOrThrow({ where: { providerReference: ref } });
    expect(ev.processingError).toBe('UNKNOWN_REFERENCE');
  });
});

// ====================================================================== financial correctness
describe('financial correctness', () => {
  it.each([
    ['amount (underpaid)', { amountMinor: 49_999n }],
    ['amount (overpaid)', { amountMinor: 50_001n }],
    ['currency', { currency: 'USD' }],
  ])('rejects a %s mismatch: no access, discrepancy recorded', async (_label, outcome) => {
    const { orderId, paymentId, reference } = await orderAndCheckout();
    fake.complete(reference, outcome);
    expect(await engine.settle(paymentId, 'test')).toBe('MISMATCH');
    const p = await h.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { order: true },
    });
    expect(p.status).toBe('FAILED');
    expect(p.order.status).toBe('AWAITING_PAYMENT');
    expect(await h.prisma.voucher.count({ where: { orderId } })).toBe(0);
    expect(
      await h.prisma.reconciliationDiscrepancy.count({
        where: { paymentId, kind: 'PAYMENT_AMOUNT_MISMATCH' },
      }),
    ).toBe(1);
  });

  it('CONCURRENCY: 8 simultaneous settlements fulfil exactly once', async () => {
    const { orderId, paymentId, reference } = await orderAndCheckout();
    fake.complete(reference);
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        engine.settle(paymentId, 'test').catch((e: Error) => e.message),
      ),
    );
    expect(outcomes.filter((o) => o === 'SUCCEEDED_FULFILLED')).toHaveLength(1);
    expect(await h.prisma.subscription.count({ where: { orderId } })).toBe(1);
    expect(await h.prisma.voucher.count({ where: { orderId } })).toBe(1);
  });

  it('out-of-order: a later "failed" status cannot undo a verified success', async () => {
    const { paymentId, reference } = await orderAndCheckout();
    fake.complete(reference);
    await engine.settle(paymentId, 'test');
    fake.complete(reference, { status: 'failed' });
    expect(await engine.settle(paymentId, 'webhook:charge.failed')).toBe('ALREADY_FINAL');
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'SUCCEEDED',
    );
  });

  it('a double charge is recorded truthfully, fulfilled once, and flagged for refund', async () => {
    const first = await orderAndCheckout();
    const second = await checkout(first.orderId, first.token);
    fake.complete(first.reference);
    fake.complete(second.body.data.reference);
    expect(await engine.settle(first.paymentId, 'test')).toBe('SUCCEEDED_FULFILLED');
    expect(await engine.settle(second.body.data.paymentId, 'test')).toBe('SUCCEEDED_DISCREPANCY');
    expect(
      await h.prisma.payment.count({ where: { orderId: first.orderId, status: 'SUCCEEDED' } }),
    ).toBe(2);
    expect(await h.prisma.subscription.count({ where: { orderId: first.orderId } })).toBe(1);
    expect(
      await h.prisma.reconciliationDiscrepancy.count({
        where: { paymentId: second.body.data.paymentId },
      }),
    ).toBe(1);
  });

  it('a late success on an abandoned payment becomes a discrepancy, not silent money', async () => {
    const { orderId, paymentId, reference } = await orderAndCheckout();
    fake.complete(reference, { status: 'abandoned' });
    expect(await engine.settle(paymentId, 'test')).toBe('ABANDONED');
    fake.complete(reference, { status: 'success' });
    await webhook(chargeSuccess(reference)).expect(200);
    await drainOutbox();
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'ABANDONED',
    );
    expect(
      await h.prisma.reconciliationDiscrepancy.count({
        where: { paymentId, kind: 'LATE_SUCCESS_ON_CLOSED_PAYMENT' },
      }),
    ).toBe(1);
    expect(await h.prisma.voucher.count({ where: { orderId } })).toBe(0);
  });

  it('provider outage at checkout: clear 503, nothing charged, attempt closed', async () => {
    const o = await request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({
        planVersionId: versionId,
        target: { scope: 'INDIVIDUAL' },
        customerPhone: randomPhone(),
      });
    fake.failNext(
      'initialize',
      new PaymentProviderError('TIMEOUT', 'Payment provider timed out', true),
    );
    const c = await checkout(o.body.data.orderId, o.body.data.accessToken);
    expect(c.status).toBe(503);
    expect(c.body.error.message).toMatch(/not been charged/);
    expect(
      (await h.prisma.payment.findFirstOrThrow({ where: { orderId: o.body.data.orderId } }))
        .failureCode,
    ).toBe('INIT_TIMEOUT');
  });

  it('provider outage during verification: payment stays pending and the job retries later', async () => {
    const { paymentId, reference } = await orderAndCheckout();
    fake.complete(reference);
    fake.failNext(
      'verify',
      new PaymentProviderError('UNAVAILABLE', 'Payment provider unreachable', true),
    );
    await expect(engine.settle(paymentId, 'test')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'PENDING',
    );
    expect(await engine.settle(paymentId, 'test')).toBe('SUCCEEDED_FULFILLED');
  });
});

// ====================================================================== reconciliation
describe('reconciliation', () => {
  it('settles a paid order whose webhook never arrived, and expires abandoned orders', async () => {
    const lost = await orderAndCheckout();
    fake.complete(lost.reference);
    await h.prisma
      .$executeRaw`UPDATE "payments" SET "createdAt" = now() - interval '10 minutes' WHERE "id" = ${lost.paymentId}::uuid`;

    const o = await request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({
        planVersionId: versionId,
        target: { scope: 'INDIVIDUAL' },
        customerPhone: randomPhone(),
      });
    await h.prisma
      .$executeRaw`UPDATE "orders" SET "expiresAt" = now() - interval '1 minute' WHERE "id" = ${o.body.data.orderId}::uuid`;

    const report = await engine.reconcile();
    expect(report.verified).toBeGreaterThanOrEqual(1);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: lost.orderId } })).status).toBe(
      'PAID',
    );
    expect(
      (await h.prisma.order.findUniqueOrThrow({ where: { id: o.body.data.orderId } })).status,
    ).toBe('EXPIRED');
  });
});

// ====================================================================== refunds
describe('refunds', () => {
  async function paidOrder() {
    const x = await orderAndCheckout();
    fake.complete(x.reference);
    await engine.settle(x.paymentId, 'test');
    return x;
  }
  const base = () => `/api/v1/admin/properties/${A.id}`;

  it('needs two different people, never exceeds what was paid, and completes only on provider confirmation', async () => {
    const x = await paidOrder();
    await ag.finance1
      .post(`${base()}/payments/${x.paymentId}/refunds`)
      .set(CSRF)
      .send({ amount: '600', reason: 'too much' })
      .expect(422);
    const r = await ag.finance1
      .post(`${base()}/payments/${x.paymentId}/refunds`)
      .set(CSRF)
      .send({ amount: '500', reason: 'customer could not connect' });
    expect(r.status).toBe(201);
    const refundId = r.body.data.refundId as string;
    // A second request would exceed the remaining balance while the first is in flight.
    await ag.finance2
      .post(`${base()}/payments/${x.paymentId}/refunds`)
      .set(CSRF)
      .send({ amount: '1', reason: 'extra' })
      .expect(422);
    await ag.finance1.post(`${base()}/refunds/${refundId}/approve`).set(CSRF).send({}).expect(403);
    await ag.finance2.post(`${base()}/refunds/${refundId}/approve`).set(CSRF).send({}).expect(200);

    await drainOutbox(); // refund.submit
    const submitted = await h.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.providerRefundId).not.toBeNull();
    // The provider hasn't processed it yet: no financial effect.
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: x.paymentId } })).status).toBe(
      'SUCCEEDED',
    );

    fake.setRefundStatus(submitted.providerRefundId as string, 'processed');
    await webhook({
      event: 'refund.processed',
      data: {
        status: 'processed',
        transaction_reference: x.reference,
        refund_reference: '1320',
        amount: '50000',
        currency: 'NGN',
      },
    }).expect(200);
    await drainOutbox();

    const p = await h.prisma.payment.findUniqueOrThrow({
      where: { id: x.paymentId },
      include: { order: true },
    });
    expect(p.status).toBe('REFUNDED');
    expect(p.refundedMinor).toBe(50000n);
    expect(p.order.status).toBe('REFUNDED');
    const v = await h.prisma.voucher.findFirstOrThrow({ where: { orderId: x.orderId } });
    expect(v.status).toBe('REVOKED'); // never used, so withdrawn
    expect(await h.prisma.voucherDelivery.count({ where: { voucherId: v.id } })).toBe(0);
  });

  it('partial refunds accumulate up to the paid amount', async () => {
    const x = await paidOrder();
    for (const amt of ['200', '300']) {
      const r = await ag.finance1
        .post(`${base()}/payments/${x.paymentId}/refunds`)
        .set(CSRF)
        .send({ amount: amt, reason: 'partial' });
      await ag.finance2
        .post(`${base()}/refunds/${r.body.data.refundId}/approve`)
        .set(CSRF)
        .send({})
        .expect(200);
      await drainOutbox();
      const ref = await h.prisma.refund.findUniqueOrThrow({ where: { id: r.body.data.refundId } });
      fake.setRefundStatus(ref.providerRefundId as string, 'processed');
      await engine.checkRefund(ref.id);
    }
    const p = await h.prisma.payment.findUniqueOrThrow({ where: { id: x.paymentId } });
    expect(p.refundedMinor).toBe(50000n);
    expect(p.status).toBe('REFUNDED');
  });

  it('an interrupted refund submission is never sent twice; it goes to a human', async () => {
    const x = await paidOrder();
    const r = await ag.finance1
      .post(`${base()}/payments/${x.paymentId}/refunds`)
      .set(CSRF)
      .send({ amount: '500', reason: 'test crash' });
    await ag.finance2
      .post(`${base()}/refunds/${r.body.data.refundId}/approve`)
      .set(CSRF)
      .send({})
      .expect(200);
    const before = fake.calls.filter((c) => c.method === 'createRefund').length;
    fake.failNext(
      'createRefund',
      new PaymentProviderError('TIMEOUT', 'Payment provider timed out', true),
    );
    expect(await engine.submitRefund(r.body.data.refundId)).toBe('NEEDS_REVIEW');
    expect(await engine.submitRefund(r.body.data.refundId)).toBe('NEEDS_REVIEW');
    expect(fake.calls.filter((c) => c.method === 'createRefund').length).toBe(before + 1);
    expect(
      await h.prisma.reconciliationDiscrepancy.count({ where: { paymentId: x.paymentId } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('roles: support and network staff cannot touch payments; finance can read and resolve', async () => {
    const x = await paidOrder();
    await ag.support
      .post(`${base()}/payments/${x.paymentId}/refunds`)
      .set(CSRF)
      .send({ amount: '1', reason: 'nope' })
      .expect(404);
    await ag.network.get(`${base()}/payments`).expect(404);
    await ag.support.get(`${base()}/payments`).expect(200); // read-only for status questions
    const list = await ag.finance1.get(`${base()}/discrepancies`).expect(200);
    const d = (list.body.data as { id: string }[])[0];
    if (d)
      await ag.finance1
        .post(`${base()}/discrepancies/${d.id}/resolve`)
        .set(CSRF)
        .send({ resolution: 'refunded manually via dashboard' })
        .expect(200);
  });
});
