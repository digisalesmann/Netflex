import { randomBytes } from 'node:crypto';
import type { DefaultAdapterRegistry, PaymentEngine } from '@netflex/core';
import type { FakeNetworkAdapter } from '@netflex/network';
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
import { ADAPTER_REGISTRY, PAYMENT_ENGINE } from './infra/tokens.js';

let h: Harness;
let gw: FakeNetworkAdapter;
const secrets = new Map<string, string>();
const ag = {} as Record<'owner' | 'admin', Agent>;
let P: { id: string; slug: string; room: string; gatewayId: string };
let planVersionId: string;
const idem = () => `idem-${randomBytes(12).toString('hex')}`;
const mac = () =>
  Array.from(randomBytes(6), (b, i) =>
    (i === 0 ? (b & 0xfc) | 2 : b).toString(16).padStart(2, '0'),
  ).join(':');

async function tenant() {
  const phone = randomPhone();
  await request(h.server)
    .post('/api/v1/auth/tenant/otp/request')
    .set(CSRF)
    .set(XFF())
    .send({ phone })
    .expect(202);
  const code = (await request(h.server).post('/api/v1/dev/otp-outbox').set(CSRF).send({ phone }))
    .body.data.code as string;
  const agent = request.agent(h.server);
  await agent
    .post('/api/v1/auth/tenant/otp/verify')
    .set(CSRF)
    .set(XFF())
    .send({ phone, code })
    .expect(200);
  return { agent, phone, userId: (await agent.get('/api/v1/me')).body.data.user.id as string };
}

beforeAll(async () => {
  h = await startHarness({ NETWORK_ADAPTER: 'fake', PAID_ACCESS_ENABLED: 'true' });
  gw = (h.app.get(ADAPTER_REGISTRY) as DefaultAdapterRegistry).fake as FakeNetworkAdapter;
  ag.owner = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'OWNER', propertyId: null }]),
    secrets,
  );
  const slug = `p7-${uniq()}`;
  const pid = (
    await ag.owner
      .post('/api/v1/admin/properties')
      .set(CSRF)
      .send({ slug, name: 'Portal Lodge', supportPhone: '+2348000000001' })
  ).body.data.id as string;
  const b = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/buildings`)
      .set(CSRF)
      .send({ name: 'Main' })
  ).body.data.id as string;
  const f = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/buildings/${b}/floors`)
      .set(CSRF)
      .send({ label: 'G', level: 0 })
  ).body.data.id as string;
  const room = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/floors/${f}/rooms`)
      .set(CSRF)
      .send({ label: 'G1' })
  ).body.data.id as string;
  const g = await ag.owner
    .post(`/api/v1/admin/properties/${pid}/gateways`)
    .set(CSRF)
    .send({ name: 'Main', vendor: 'FAKE', credentialRef: 'MAIN_ROUTER' });
  P = { id: pid, slug, room, gatewayId: g.body.data.id as string };
  ag.admin = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'PROPERTY_ADMIN', propertyId: pid }]),
    secrets,
  );
  const c = await ag.admin
    .post(`/api/v1/admin/properties/${pid}/plans`)
    .set(CSRF)
    .send({
      slug: 'day',
      version: {
        name: 'Day pass',
        description: '24 hours',
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
  planVersionId = c.body.data.versionId as string;
  await ag.admin
    .post(
      `/api/v1/admin/properties/${pid}/plans/${c.body.data.planId}/versions/${planVersionId}/publish`,
    )
    .set(CSRF)
    .send({})
    .expect(200);
}, 180_000);

afterAll(async () => {
  await h.close();
});

async function voucher() {
  const r = await ag.admin
    .post(`/api/v1/admin/properties/${P.id}/vouchers`)
    .set(CSRF)
    .send({
      planVersionId,
      issuanceType: 'MANUAL',
      reason: 'portal test',
      target: { scope: 'INDIVIDUAL' },
    });
  return r.body.data.vouchers[0].code as string;
}

describe('captive portal identity', () => {
  it('redeems only when the gateway confirms the device holds that IP', async () => {
    const device = mac();
    const c = gw.joinClient(device);
    const code = await voucher();
    // A claimed MAC that does not match what the gateway sees is refused.
    const forged = await request(h.server)
      .post('/api/v1/portal/redeem')
      .set(CSRF)
      .send({ gw: P.gatewayId, ip: c.ip, mac: mac(), code });
    expect(forged.body.data).toEqual({ state: 'RECONNECT_REQUIRED' });
    const unknownIp = await request(h.server)
      .post('/api/v1/portal/redeem')
      .set(CSRF)
      .send({ gw: P.gatewayId, ip: '10.99.99.99', mac: device, code });
    expect(unknownIp.body.data).toEqual({ state: 'RECONNECT_REQUIRED' });
    const ok = await request(h.server)
      .post('/api/v1/portal/redeem')
      .set(CSRF)
      .send({ gw: P.gatewayId, ip: c.ip, mac: device.toUpperCase(), code });
    expect(ok.body.data.state).toBe('ACCESS_BEING_CONFIGURED');
    const st = await request(h.server)
      .post('/api/v1/portal/status')
      .set(CSRF)
      .send({ gw: P.gatewayId, ip: c.ip, mac: device });
    expect(st.body.data).toMatchObject({ state: 'ACCESS_BEING_CONFIGURED', planName: 'Day pass' });
    // Once the gateway confirms (simulated), the portal says CONNECTED.
    const e = await h.prisma.voucherRedemption.findFirstOrThrow({
      where: { device: { macAddress: device } },
    });
    await h.prisma.entitlement.update({
      where: { id: e.entitlementId },
      data: { status: 'ACTIVE', observedNetworkState: 'ACTIVE' },
    });
    const st2 = await request(h.server)
      .post('/api/v1/portal/status')
      .set(CSRF)
      .send({ gw: P.gatewayId, ip: c.ip, mac: device });
    expect(st2.body.data.state).toMatch(/^CONNECTED/);
    expect(st2.body.data.expiresAtLocal).toBeTruthy();
  });

  it('says "gateway unavailable" honestly when the gateway is down or has no adapter', async () => {
    const c = gw.joinClient(mac());
    gw.setDown(true);
    const r = await request(h.server)
      .post('/api/v1/portal/status')
      .set(CSRF)
      .send({ gw: P.gatewayId, ip: c.ip, mac: c.macAddress });
    gw.setDown(false);
    expect(r.body.data).toEqual({ state: 'GATEWAY_UNAVAILABLE' });
    const real = await ag.owner
      .post(`/api/v1/admin/properties/${P.id}/gateways`)
      .set(CSRF)
      .send({ name: `MT ${uniq()}`, vendor: 'MIKROTIK', credentialRef: 'MT_X' });
    const r2 = await request(h.server)
      .post('/api/v1/portal/redeem')
      .set(CSRF)
      .send({ gw: real.body.data.id, ip: c.ip, mac: c.macAddress, code: 'AAAA-BBBB-CCCC' });
    expect(r2.body.data).toEqual({ state: 'GATEWAY_UNAVAILABLE' });
  });

  it('returns branding and support contacts, and NOT_CONNECTED for a new device', async () => {
    const c = gw.joinClient(mac());
    const ctx = await request(h.server)
      .post('/api/v1/portal/context')
      .set(CSRF)
      .send({ gw: P.gatewayId, ip: c.ip, mac: c.macAddress });
    expect(ctx.body.data).toEqual({
      gateway: 'AVAILABLE',
      property: {
        name: 'Portal Lodge',
        slug: P.slug,
        supportPhone: '+2348000000001',
        supportEmail: null,
      },
    });
    const st = await request(h.server)
      .post('/api/v1/portal/status')
      .set(CSRF)
      .send({ gw: P.gatewayId, ip: c.ip, mac: c.macAddress });
    expect(st.body.data).toEqual({ state: 'NOT_CONNECTED' });
  });
});

describe('development simulators', () => {
  it('simulated "join Wi-Fi" redirects like a gateway would', async () => {
    const r = await request(h.server)
      .get(`/api/v1/dev/fake-gateway/join?gw=${P.gatewayId}`)
      .expect(302);
    const u = new URL(r.headers.location as string);
    expect(u.pathname).toBe('/connect');
    expect(await gw.lookupClient(u.searchParams.get('ip') as string)).toEqual({
      macAddress: u.searchParams.get('mac'),
    });
  });

  it('simulated checkout settles a real order through the payment engine', async () => {
    const o = await request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ planVersionId, target: { scope: 'INDIVIDUAL' }, customerPhone: randomPhone() });
    const c = await request(h.server)
      .post(`/api/v1/orders/${o.body.data.orderId}/checkout`)
      .set(CSRF)
      .set(XFF())
      .set('x-order-token', o.body.data.accessToken)
      .set('idempotency-key', idem())
      .send({ email: 'g@example.com' });
    const url = new URL(c.body.data.checkoutUrl as string);
    expect(url.pathname).toContain('/api/v1/dev/fake-checkout/');
    const page = await request(h.server).get(url.pathname).expect(200);
    expect(page.text).toContain('SIMULATED PAYMENT');
    const done = await request(h.server)
      .post(url.pathname)
      .type('form')
      .send({ outcome: 'success' })
      .expect(303);
    expect(done.headers.location).toContain(`/checkout/return?order=${o.body.data.orderId}`);
    expect(
      (await h.prisma.order.findUniqueOrThrow({ where: { id: o.body.data.orderId } })).status,
    ).toBe('PAID');
    void h.app.get<PaymentEngine>(PAYMENT_ENGINE);
  });

  it('do not exist in a configuration without test-only providers', async () => {
    const real = await startHarness({
      OTP_PROVIDER: 'none',
      NETWORK_ADAPTER: 'none',
      PAYMENT_PROVIDER: 'paystack',
      PAYSTACK_SECRET_KEY: 'sk_test_placeholderkey000000',
    });
    try {
      await request(real.server).get('/api/v1/dev/fake-gateway/join').expect(404);
      await request(real.server)
        .post('/api/v1/dev/otp-outbox')
        .set(CSRF)
        .send({ phone: randomPhone() })
        .expect(404);
      await request(real.server).get('/api/v1/dev/fake-checkout/NFX-ANY').expect(404);
    } finally {
      await real.close();
    }
  });
});

describe('tenant account', () => {
  it('lists own orders, shows a receipt only for paid own orders, and nobody else can read them', async () => {
    const t = await tenant();
    const other = await tenant();
    const o = await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ planVersionId, target: { scope: 'INDIVIDUAL' } });
    await t.agent.get(`/api/v1/me/orders/${o.body.data.orderId}/receipt`).expect(404); // unpaid
    const c = await t.agent
      .post(`/api/v1/orders/${o.body.data.orderId}/checkout`)
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ email: 't@example.com' });
    await request(h.server)
      .post(new URL(c.body.data.checkoutUrl).pathname)
      .type('form')
      .send({ outcome: 'success' })
      .expect(303);
    const list = await t.agent.get('/api/v1/me/orders').expect(200);
    expect(list.body.data[0]).toMatchObject({
      reference: o.body.data.reference,
      status: 'PAID',
      amount: { amountMinor: '50000' },
    });
    const rc = await t.agent.get(`/api/v1/me/orders/${o.body.data.orderId}/receipt`).expect(200);
    expect(rc.body.data).toMatchObject({
      receiptFor: o.body.data.reference,
      issuedBy: 'Portal Lodge',
      note: 'Payment receipt. This is not a tax invoice.',
    });
    await other.agent.get(`/api/v1/me/orders/${o.body.data.orderId}/receipt`).expect(404);
    expect((await other.agent.get('/api/v1/me/orders')).body.data).toEqual([]);
    await ag.admin.get('/api/v1/me/orders').expect(403);
  });

  it('preferences, profile, export and erasure request', async () => {
    const t = await tenant();
    const p = await t.agent.get('/api/v1/me/preferences').expect(200);
    expect(p.body.data.channelsAvailable).toEqual({ sms: false, email: false });
    const prefs = {
      sms: { expiryReminders: false, receipts: true, outageNotices: true },
      email: { expiryReminders: false, receipts: false, outageNotices: false },
    };
    await t.agent.put('/api/v1/me/preferences').set(CSRF).send(prefs).expect(200);
    expect((await t.agent.get('/api/v1/me/preferences')).body.data.preferences).toEqual(prefs);
    await t.agent
      .put('/api/v1/me/preferences')
      .set(CSRF)
      .send({ sms: { hack: true } })
      .expect(400);
    await t.agent.patch('/api/v1/me').set(CSRF).send({ displayName: 'Ada L.' }).expect(200);
    const ex = await t.agent.get('/api/v1/me/export').expect(200);
    expect(ex.headers['content-disposition']).toContain('attachment');
    expect(ex.body.data.user.displayName).toBe('Ada L.');
    expect(JSON.stringify(ex.body)).not.toMatch(/tokenVerifier|codeVerifier|passwordHash/);
    const er = await t.agent.post('/api/v1/me/privacy/erasure-request').set(CSRF).send({});
    expect(er.body.data.status).toBe('NO_PROPERTY_DATA');
  });

  it('support tickets: guests need a phone, tenants see only their own, orders must be owned', async () => {
    const t = await tenant();
    const other = await tenant();
    await request(h.server)
      .post('/api/v1/support/tickets')
      .set(CSRF)
      .set(XFF())
      .send({
        propertySlug: P.slug,
        category: 'OUTAGE',
        subject: 'No internet',
        body: 'Nothing loads since 9pm in room G1.',
      })
      .expect(400);
    await request(h.server)
      .post('/api/v1/support/tickets')
      .set(CSRF)
      .set(XFF())
      .send({
        propertySlug: P.slug,
        category: 'OUTAGE',
        subject: 'No internet',
        body: 'Nothing loads since 9pm in room G1.',
        contactPhone: randomPhone(),
      })
      .expect(201);
    const mine = await t.agent.post('/api/v1/support/tickets').set(CSRF).set(XFF()).send({
      propertySlug: P.slug,
      category: 'VOUCHER',
      subject: 'Lost my code',
      body: 'I lost the code from yesterday.',
    });
    expect(mine.status).toBe(201);
    expect((await t.agent.get('/api/v1/me/tickets')).body.data).toHaveLength(1);
    expect((await other.agent.get('/api/v1/me/tickets')).body.data).toHaveLength(0);
    const o = await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ planVersionId, target: { scope: 'INDIVIDUAL' } });
    await other.agent
      .post('/api/v1/support/tickets')
      .set(CSRF)
      .set(XFF())
      .send({
        propertySlug: P.slug,
        category: 'PAYMENT',
        subject: 'Their order',
        body: 'Trying to link someone else order.',
        orderId: o.body.data.orderId,
      })
      .expect(404);
  });
});
