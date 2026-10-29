import { randomBytes } from 'node:crypto';
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
import { OTP_SENDER, type FakeOtpSender } from './auth/otp-sender.js';
import { RedemptionService } from './vouchers/redemption.service.js';

let h: Harness;
let otp: FakeOtpSender;
let redemption: RedemptionService;
const secrets = new Map<string, string>();
const ag = {} as Record<'owner' | 'admin' | 'support' | 'adminB', Agent>;
let A: { id: string; slug: string; floor: string; room: string; room2: string };
let B: { id: string; slug: string; room: string };

const mac = () =>
  Array.from(randomBytes(6), (b, i) => (i === 0 ? b & 0xfc : b).toString(16).padStart(2, '0')).join(
    ':',
  );
const idem = () => `idem-${randomBytes(12).toString('hex')}`;

const planBody = (over: Record<string, unknown> = {}) => ({
  name: 'Day pass',
  description: '24 hours of access',
  scope: 'INDIVIDUAL',
  price: '500',
  duration: { value: 1, unit: 'DAY' },
  activationPolicy: 'ON_FIRST_REDEMPTION',
  redemptionWindow: { value: 30, unit: 'DAY' },
  maxDevices: 2,
  maxConcurrentSessions: 2,
  downloadKbps: 5000,
  uploadKbps: 2000,
  maxGroupMembers: null,
  renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
  availableFrom: null,
  availableUntil: null,
  fairUseText: null,
  refundPolicyText: 'Refunds only before first use.',
  termsVersion: '2026-10',
  ...over,
});

/** Create + publish a plan on property A; returns ids. */
async function publishedPlan(
  over: Record<string, unknown> = {},
  propertyId = A.id,
  agent = ag.admin,
) {
  const c = await agent
    .post(`/api/v1/admin/properties/${propertyId}/plans`)
    .set(CSRF)
    .send({ slug: `plan-${uniq()}`, version: planBody(over) });
  expect(c.status).toBe(201);
  await agent
    .post(
      `/api/v1/admin/properties/${propertyId}/plans/${c.body.data.planId}/versions/${c.body.data.versionId}/publish`,
    )
    .set(CSRF)
    .send({})
    .expect(200);
  return { planId: c.body.data.planId as string, versionId: c.body.data.versionId as string };
}

async function issue(versionId: string, extra: Record<string, unknown> = {}) {
  const r = await ag.admin
    .post(`/api/v1/admin/properties/${A.id}/vouchers`)
    .set(CSRF)
    .send({
      planVersionId: versionId,
      issuanceType: 'COMPLIMENTARY',
      reason: 'welcome credit',
      target: { scope: 'INDIVIDUAL' },
      ...extra,
    });
  expect(r.status).toBe(201);
  return r.body.data.vouchers as { voucherId: string; code: string }[];
}

async function tenantAgent(phone = randomPhone()) {
  await request(h.server)
    .post('/api/v1/auth/tenant/otp/request')
    .set(CSRF)
    .set(XFF())
    .send({ phone })
    .expect(202);
  const t = request.agent(h.server);
  await t
    .post('/api/v1/auth/tenant/otp/verify')
    .set(CSRF)
    .set(XFF())
    .send({ phone, code: otp.lastCode(phone) })
    .expect(200);
  const userId = (await t.get('/api/v1/me')).body.data.user.id as string;
  return { agent: t, userId, phone };
}

const redeem = (
  code: string,
  opts: {
    propertyId?: string;
    macAddress?: string;
    userId?: string | null;
    clientKey?: string;
  } = {},
) =>
  redemption.redeem({
    propertyId: opts.propertyId ?? A.id,
    code,
    macAddress: opts.macAddress ?? mac(),
    userId: opts.userId ?? null,
    clientKey: opts.clientKey ?? uniq(),
  });

beforeAll(async () => {
  h = await startHarness({ PAID_ACCESS_ENABLED: 'true' });
  otp = h.app.get(OTP_SENDER);
  redemption = h.app.get(RedemptionService);
  const owner = await createStaff(h.prisma, [{ role: 'OWNER', propertyId: null }]);
  ag.owner = await signInStaff(h, owner, secrets);
  const mk = async (tag: string) => {
    const slug = `p3-${tag}-${uniq()}`;
    const p = (
      await ag.owner
        .post('/api/v1/admin/properties')
        .set(CSRF)
        .send({ slug, name: `Lodge ${tag}` })
    ).body.data.id as string;
    const b = (
      await ag.owner
        .post(`/api/v1/admin/properties/${p}/buildings`)
        .set(CSRF)
        .send({ name: 'Main' })
    ).body.data.id as string;
    const f = (
      await ag.owner
        .post(`/api/v1/admin/properties/${p}/buildings/${b}/floors`)
        .set(CSRF)
        .send({ label: 'Ground', level: 0 })
    ).body.data.id as string;
    const r1 = (
      await ag.owner
        .post(`/api/v1/admin/properties/${p}/floors/${f}/rooms`)
        .set(CSRF)
        .send({ label: 'R1' })
    ).body.data.id as string;
    const r2 = (
      await ag.owner
        .post(`/api/v1/admin/properties/${p}/floors/${f}/rooms`)
        .set(CSRF)
        .send({ label: 'R2' })
    ).body.data.id as string;
    return { id: p, slug, floor: f, room: r1, room2: r2 };
  };
  A = await mk('a');
  B = await mk('b');
  ag.admin = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'PROPERTY_ADMIN', propertyId: A.id }]),
    secrets,
  );
  ag.support = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: A.id }]),
    secrets,
  );
  ag.adminB = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'PROPERTY_ADMIN', propertyId: B.id }]),
    secrets,
  );
}, 180_000);

afterAll(async () => {
  await h.close();
});

// ====================================================================== plans & catalog
describe('plans', () => {
  it('rejects invalid plan terms before saving', async () => {
    const r = await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans`)
      .set(CSRF)
      .send({ slug: `bad-${uniq()}`, version: planBody({ maxConcurrentSessions: 5 }) });
    expect(r.status).toBe(422);
    const room = await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans`)
      .set(CSRF)
      .send({ slug: `bad-${uniq()}`, version: planBody({ scope: 'ROOM' }) });
    expect(room.status).toBe(422);
    const floatPrice = await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans`)
      .set(CSRF)
      .send({ slug: `bad-${uniq()}`, version: planBody({ price: 500.5 }) });
    expect(floatPrice.status).toBe(400);
  });

  it('draft plans are hidden; published plans appear in the public catalog with full terms', async () => {
    const draft = await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans`)
      .set(CSRF)
      .send({ slug: `draft-${uniq()}`, version: planBody({ name: 'Hidden draft' }) });
    expect(draft.status).toBe(201);
    const { versionId } = await publishedPlan({ name: 'Visible', price: '1500.50' });
    const cat = await request(h.server)
      .get(`/api/v1/catalog/properties/${A.slug}/plans`)
      .expect(200);
    const names = (cat.body.data as { name: string }[]).map((p) => p.name);
    expect(names).toContain('Visible');
    expect(names).not.toContain('Hidden draft');
    const p = (
      cat.body.data as {
        planVersionId: string;
        price: { amountMinor: string; display: string };
        speed: { guaranteed: boolean };
        refundPolicyText: string;
      }[]
    ).find((x) => x.planVersionId === versionId);
    expect(p?.price.amountMinor).toBe('150050');
    expect(p?.price.display).toContain('1,500.50');
    expect(p?.speed.guaranteed).toBe(false);
    expect(p?.refundPolicyText).toBeTruthy();
    expect(cat.headers['cache-control']).toContain('max-age=60');
  });

  it('paused plans leave the catalog and cannot be ordered; resumed plans return', async () => {
    const { planId, versionId } = await publishedPlan({ name: `Pausable ${uniq()}` });
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans/${planId}/pause`)
      .set(CSRF)
      .send({ reason: 'maintenance' })
      .expect(200);
    const cat = await request(h.server).get(`/api/v1/catalog/properties/${A.slug}/plans`);
    expect(
      (cat.body.data as { planVersionId: string }[]).some((p) => p.planVersionId === versionId),
    ).toBe(false);
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
    expect(o.status).toBe(422);
    expect(o.body.error.code).toBe('DOMAIN_NOT_PUBLISHED');
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans/${planId}/resume`)
      .set(CSRF)
      .send({ reason: 'back' })
      .expect(200);
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans/${planId}/archive`)
      .set(CSRF)
      .send({ reason: 'retired' })
      .expect(200);
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans/${planId}/resume`)
      .set(CSRF)
      .send({ reason: 'oops' })
      .expect(422);
  });

  it('a new version never changes what earlier buyers paid; ordering an outdated version is refused', async () => {
    const { planId, versionId: v1 } = await publishedPlan({ price: '700' });
    const o1 = await request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ planVersionId: v1, target: { scope: 'INDIVIDUAL' }, customerPhone: randomPhone() });
    expect(o1.status).toBe(201);
    const v2 = await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/plans/${planId}/versions`)
      .set(CSRF)
      .send(planBody({ price: '900' }));
    await ag.admin
      .post(
        `/api/v1/admin/properties/${A.id}/plans/${planId}/versions/${v2.body.data.versionId}/publish`,
      )
      .set(CSRF)
      .send({})
      .expect(200);
    const stale = await request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ planVersionId: v1, target: { scope: 'INDIVIDUAL' }, customerPhone: randomPhone() });
    expect(stale.status).toBe(409);
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: o1.body.data.orderId } });
    expect(order.amountMinor).toBe(70000n);
    expect((order.planSnapshot as { price: { amountMinor: string } }).price.amountMinor).toBe(
      '70000',
    );
    const locked = await h.prisma.planVersion.findUniqueOrThrow({ where: { id: v1 } });
    expect(locked.lockedAt).not.toBeNull();
  });

  it('support staff and other properties cannot manage plans', async () => {
    await ag.support
      .post(`/api/v1/admin/properties/${A.id}/plans`)
      .set(CSRF)
      .send({ slug: `x-${uniq()}`, version: planBody() })
      .expect(404);
    const { planId } = await publishedPlan();
    await ag.adminB.get(`/api/v1/admin/properties/${A.id}/plans/${planId}`).expect(404);
    await ag.adminB.get(`/api/v1/admin/properties/${B.id}/plans/${planId}`).expect(404);
  });
});

// ====================================================================== orders
describe('orders', () => {
  let versionId: string;
  beforeAll(async () => {
    versionId = (await publishedPlan({ price: '500' })).versionId;
  });

  const guestOrder = (key: string, body: Record<string, unknown>) =>
    request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', key)
      .send(body);

  it('computes the price on the server and rejects any client-supplied amount', async () => {
    const r = await guestOrder(idem(), {
      planVersionId: versionId,
      target: { scope: 'INDIVIDUAL' },
      customerPhone: randomPhone(),
      amount: 1,
    });
    expect(r.status).toBe(400);
    const ok = await guestOrder(idem(), {
      planVersionId: versionId,
      target: { scope: 'INDIVIDUAL' },
      customerPhone: randomPhone(),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.amount).toMatchObject({ amountMinor: '50000', currency: 'NGN' });
    expect(ok.body.data.reference).toMatch(/^NFX-/);
  });

  it('requires an Idempotency-Key and a phone for guests', async () => {
    await request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .send({
        planVersionId: versionId,
        target: { scope: 'INDIVIDUAL' },
        customerPhone: randomPhone(),
      })
      .expect(400);
    await guestOrder(idem(), { planVersionId: versionId, target: { scope: 'INDIVIDUAL' } }).expect(
      400,
    );
  });

  it('replays the same response for a retried request and refuses key reuse with a different body', async () => {
    const key = idem();
    const phone = randomPhone();
    const body = {
      planVersionId: versionId,
      target: { scope: 'INDIVIDUAL' },
      customerPhone: phone,
    };
    const first = await guestOrder(key, body);
    const second = await guestOrder(key, body);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.orderId).toBe(first.body.data.orderId);
    expect(second.body.data.accessToken).toBe(first.body.data.accessToken);
    const other = await guestOrder(key, {
      ...body,
      target: { scope: 'INDIVIDUAL' },
      planVersionId: (await publishedPlan()).versionId,
    });
    expect(other.status).toBe(422);
    expect(await h.prisma.order.count({ where: { customerPhone: phone } })).toBe(1);
  });

  it('parallel duplicate submissions create exactly one order', async () => {
    const key = idem();
    const phone = randomPhone();
    const body = {
      planVersionId: versionId,
      target: { scope: 'INDIVIDUAL' },
      customerPhone: phone,
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => guestOrder(key, body)));
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(results.some((r) => r.status === 201)).toBe(true);
    expect(await h.prisma.order.count({ where: { customerPhone: phone } })).toBe(1);
  });

  it('guests read their order only with the token; nobody else can', async () => {
    const r = await guestOrder(idem(), {
      planVersionId: versionId,
      target: { scope: 'INDIVIDUAL' },
      customerPhone: randomPhone(),
    });
    const { orderId, accessToken } = r.body.data as { orderId: string; accessToken: string };
    await request(h.server).get(`/api/v1/orders/${orderId}`).expect(404);
    await request(h.server)
      .get(`/api/v1/orders/${orderId}`)
      .set('x-order-token', 'wrong-token')
      .expect(404);
    const ok = await request(h.server)
      .get(`/api/v1/orders/${orderId}`)
      .set('x-order-token', accessToken)
      .expect(200);
    expect(ok.body.data.status).toBe('CREATED');
    const stored = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(stored.accessTokenVerifier).not.toBe(accessToken);
    const t = await tenantAgent();
    await t.agent.get(`/api/v1/orders/${orderId}`).expect(404);
  });

  it('signed-in tenants own their orders; other tenants get 404', async () => {
    const t1 = await tenantAgent();
    const t2 = await tenantAgent();
    const r = await t1.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ planVersionId: versionId, target: { scope: 'INDIVIDUAL' } });
    expect(r.status).toBe(201);
    expect(r.body.data.accessToken).toBeUndefined();
    await t1.agent.get(`/api/v1/orders/${r.body.data.orderId}`).expect(200);
    await t2.agent.get(`/api/v1/orders/${r.body.data.orderId}`).expect(404);
  });

  it('staff accounts cannot buy', async () => {
    await ag.admin
      .post('/api/v1/orders')
      .set(CSRF)
      .set('idempotency-key', idem())
      .send({ planVersionId: versionId, target: { scope: 'INDIVIDUAL' } })
      .expect(403);
  });

  it('room plans need purchase authority for that exact room', async () => {
    const room = await publishedPlan({
      scope: 'ROOM',
      maxGroupMembers: 4,
      maxDevices: 4,
      maxConcurrentSessions: 4,
      price: '3000',
    });
    const t = await tenantAgent();
    const body = { planVersionId: room.versionId, target: { scope: 'ROOM', roomId: A.room } };
    // Guests can't buy room access at all.
    await request(h.server)
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ ...body, customerPhone: randomPhone() })
      .expect(401);
    await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send(body)
      .expect(403);

    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/tenants`)
      .set(CSRF)
      .send({
        phone: t.phone,
        displayName: 'Room lead',
        roomId: A.room,
        startsAt: '2026-01-01T00:00:00Z',
      })
      .expect(201);
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/group-authorities`)
      .set(CSRF)
      .send({ userId: t.userId, scope: 'ROOM', targetId: A.room, reason: 'room lead' })
      .expect(201);
    await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send(body)
      .expect(201);
    // Authority for one room doesn't cover the room next door, or a room in another property.
    await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ ...body, target: { scope: 'ROOM', roomId: A.room2 } })
      .expect(403);
    await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ ...body, target: { scope: 'ROOM', roomId: B.room } })
      .expect(422);
  });

  it('online purchases are refused while PAID_ACCESS_ENABLED is false', async () => {
    const closed = await startHarness({ PAID_ACCESS_ENABLED: 'false' });
    try {
      const r = await request(closed.server)
        .post('/api/v1/orders')
        .set(CSRF)
        .set(XFF())
        .set('idempotency-key', idem())
        .send({
          planVersionId: versionId,
          target: { scope: 'INDIVIDUAL' },
          customerPhone: randomPhone(),
        });
      expect({ status: r.status, body: r.body }).toMatchObject({
        status: 422,
        body: { error: { code: 'DOMAIN_PAID_ACCESS_DISABLED' } },
      });
    } finally {
      await closed.close();
    }
  });
});

// ====================================================================== vouchers (admin)
describe('voucher administration', () => {
  let versionId: string;
  beforeAll(async () => {
    versionId = (await publishedPlan({ maxDevices: 2, maxConcurrentSessions: 2 })).versionId;
  });

  it('shows codes once and stores only a keyed verifier', async () => {
    const [v] = await issue(versionId);
    expect(v?.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const raw = (v?.code ?? '').replace(/-/g, '');
    const row = await h.prisma.voucher.findUniqueOrThrow({ where: { id: v?.voucherId } });
    expect(row.verifier).not.toContain(raw);
    expect(row.hint).toBe(raw.slice(-4));
    expect(row.issuanceType).toBe('COMPLIMENTARY');
    const list = await ag.admin
      .get(`/api/v1/admin/properties/${A.id}/vouchers?hint=${row.hint}`)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain(raw);
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'voucher.issued', targetId: versionId },
      orderBy: { id: 'desc' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain(raw);
    // No payment is implied by a complimentary voucher.
    expect(row.orderId).toBeNull();
  });

  it('requires a reason, the right permission, and confirmation for bulk issue', async () => {
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/vouchers`)
      .set(CSRF)
      .send({ planVersionId: versionId, issuanceType: 'MANUAL', target: { scope: 'INDIVIDUAL' } })
      .expect(400);
    await ag.support
      .post(`/api/v1/admin/properties/${A.id}/vouchers`)
      .set(CSRF)
      .send({
        planVersionId: versionId,
        issuanceType: 'MANUAL',
        reason: 'try',
        target: { scope: 'INDIVIDUAL' },
      })
      .expect(404);
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/vouchers`)
      .set(CSRF)
      .send({
        planVersionId: versionId,
        issuanceType: 'PROMOTIONAL',
        reason: 'launch',
        target: { scope: 'INDIVIDUAL' },
        quantity: 5,
      })
      .expect(422);
    const bulk = await issue(versionId, {
      issuanceType: 'PROMOTIONAL',
      quantity: 5,
      confirmBulk: true,
    });
    expect(new Set(bulk.map((v) => v.code)).size).toBe(5);
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/vouchers`)
      .set(CSRF)
      .send({
        planVersionId: versionId,
        issuanceType: 'PAID',
        reason: 'fake paid',
        target: { scope: 'INDIVIDUAL' },
      })
      .expect(400);
  });

  it('cannot issue another property’s plan or for another property’s room', async () => {
    const bPlan = await publishedPlan({}, B.id, ag.adminB);
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/vouchers`)
      .set(CSRF)
      .send({
        planVersionId: bPlan.versionId,
        issuanceType: 'MANUAL',
        reason: 'cross',
        target: { scope: 'INDIVIDUAL' },
      })
      .expect(404);
    const roomPlan = await publishedPlan({ scope: 'ROOM', maxGroupMembers: 2 });
    await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/vouchers`)
      .set(CSRF)
      .send({
        planVersionId: roomPlan.versionId,
        issuanceType: 'MANUAL',
        reason: 'cross',
        target: { scope: 'ROOM', roomId: B.room },
      })
      .expect(404);
  });

  it('suspend → reinstate → revoke follow the state machine', async () => {
    const [v] = await issue(versionId);
    const base = `/api/v1/admin/properties/${A.id}/vouchers/${v?.voucherId}`;
    await ag.admin
      .post(`${base}/reinstate`)
      .set(CSRF)
      .send({ reason: 'not suspended' })
      .expect(409);
    await ag.admin.post(`${base}/suspend`).set(CSRF).send({ reason: 'investigating' }).expect(200);
    expect(await redeem(v?.code ?? '')).toEqual({ ok: false, state: 'SUSPENDED' });
    await ag.admin.post(`${base}/reinstate`).set(CSRF).send({ reason: 'cleared' }).expect(200);
    expect((await redeem(v?.code ?? '')).ok).toBe(true);
    await ag.admin.post(`${base}/revoke`).set(CSRF).send({ reason: 'abuse' }).expect(200);
    expect(await redeem(v?.code ?? '')).toEqual({ ok: false, state: 'INVALID_VOUCHER' });
    await ag.admin.post(`${base}/reinstate`).set(CSRF).send({ reason: 'undo' }).expect(409);
  });

  it('reissue: old code stops working, new code works, bound devices carry over', async () => {
    const [v] = await issue(versionId);
    const device = mac();
    expect((await redeem(v?.code ?? '', { macAddress: device })).ok).toBe(true);
    const r = await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/vouchers/${v?.voucherId}/reissue`)
      .set(CSRF)
      .send({ reason: 'code shared publicly' });
    expect(r.status).toBe(200);
    expect(await redeem(v?.code ?? '', { macAddress: device })).toEqual({
      ok: false,
      state: 'INVALID_VOUCHER',
    });
    const again = await redeem(r.body.data.code, { macAddress: device });
    expect(again).toMatchObject({ ok: true, reusedDevice: true });
    const hist = await ag.admin
      .get(`/api/v1/admin/properties/${A.id}/vouchers/${r.body.data.voucherId}/redemptions`)
      .expect(200);
    expect(hist.body.data).toHaveLength(1);
  });
});

// ====================================================================== redemption engine
describe('voucher redemption', () => {
  let versionId: string;
  beforeAll(async () => {
    versionId = (
      await publishedPlan({
        maxDevices: 2,
        maxConcurrentSessions: 2,
        activationPolicy: 'ON_FIRST_REDEMPTION',
      })
    ).versionId;
  });

  it('first redemption activates the voucher, starts the clock and queues provisioning', async () => {
    const [v] = await issue(versionId);
    const before = Date.now();
    const r = await redeem(v?.code ?? '', { macAddress: 'AA-BB-CC-00-11-22' });
    expect(r).toMatchObject({ ok: true, state: 'ACCESS_BEING_CONFIGURED', firstActivation: true });
    const voucher = await h.prisma.voucher.findUniqueOrThrow({
      where: { id: v?.voucherId },
      include: { entitlement: true },
    });
    expect(voucher.status).toBe('ACTIVE');
    expect(voucher.entitlement?.status).toBe('PROVISIONING');
    const exp = voucher.entitlement?.expiresAt?.getTime() ?? 0;
    expect(exp - (voucher.entitlement?.startsAt?.getTime() ?? 0)).toBe(86_400_000);
    expect(exp).toBeGreaterThanOrEqual(before + 86_400_000);
    const ev = await h.prisma.outboxEvent.findFirst({
      where: { type: 'network.activate', aggregateId: voucher.entitlementId ?? '' },
    });
    expect(ev).not.toBeNull();
    const dev = await h.prisma.device.findFirstOrThrow({
      where: { propertyId: A.id, macAddress: 'aa:bb:cc:00:11:22' },
    });
    expect(dev).toBeTruthy();
  });

  it('a bound device can reconnect; a third device is refused once the limit is reached', async () => {
    const [v] = await issue(versionId);
    const d1 = mac();
    expect(await redeem(v?.code ?? '', { macAddress: d1 })).toMatchObject({
      ok: true,
      reusedDevice: false,
    });
    expect(await redeem(v?.code ?? '', { macAddress: d1 })).toMatchObject({
      ok: true,
      reusedDevice: true,
    });
    expect(await redeem(v?.code ?? '', { macAddress: mac() })).toMatchObject({ ok: true });
    expect(await redeem(v?.code ?? '', { macAddress: mac() })).toEqual({
      ok: false,
      state: 'VOUCHER_EXHAUSTED',
    });
    expect(await redeem(v?.code ?? '', { macAddress: d1 })).toMatchObject({
      ok: true,
      reusedDevice: true,
    });
    expect((await h.prisma.voucher.findUniqueOrThrow({ where: { id: v?.voucherId } })).status).toBe(
      'EXHAUSTED',
    );
  });

  it('CONCURRENCY: 12 devices redeeming at once bind exactly maxDevices (2)', async () => {
    const [v] = await issue(versionId);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => redeem(v?.code ?? '', { macAddress: mac() })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.state === 'VOUCHER_EXHAUSTED')).toHaveLength(10);
    const e = await h.prisma.voucher.findUniqueOrThrow({ where: { id: v?.voucherId } });
    expect(
      await h.prisma.voucherRedemption.count({
        where: { entitlementId: e.entitlementId ?? '', releasedAt: null },
      }),
    ).toBe(2);
    expect(
      await h.prisma.outboxEvent.count({
        where: { type: 'network.activate', aggregateId: e.entitlementId ?? '' },
      }),
    ).toBe(2);
  });

  it('CONCURRENCY: the same device redeeming 8 times at once binds once', async () => {
    const [v] = await issue(versionId);
    const d = mac();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => redeem(v?.code ?? '', { macAddress: d })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.reusedDevice)).toHaveLength(1);
    const e = await h.prisma.voucher.findUniqueOrThrow({ where: { id: v?.voucherId } });
    expect(
      await h.prisma.voucherRedemption.count({ where: { entitlementId: e.entitlementId ?? '' } }),
    ).toBe(1);
  });

  it('gives the same answer for unknown, malformed, revoked and other-property codes', async () => {
    const [v] = await issue(versionId);
    expect(await redeem('ZZZZ-ZZZZ-ZZZZ')).toEqual({ ok: false, state: 'INVALID_VOUCHER' });
    expect(await redeem('hello')).toEqual({ ok: false, state: 'INVALID_VOUCHER' });
    expect(await redeem(v?.code ?? '', { propertyId: B.id })).toEqual({
      ok: false,
      state: 'INVALID_VOUCHER',
    });
    // Lower-case and spaced input still works.
    expect((await redeem((v?.code ?? '').toLowerCase().replace(/-/g, ' '))).ok).toBe(true);
  });

  it('rate-limits a client after 10 attempts', async () => {
    const clientKey = `client-${uniq()}`;
    for (let i = 0; i < 10; i++) await redeem('ZZZZ-ZZZZ-ZZZZ', { clientKey });
    await expect(redeem('ZZZZ-ZZZZ-ZZZZ', { clientKey })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('refuses first activation after the redemption deadline', async () => {
    const [v] = await issue(versionId);
    await h.prisma.voucher.update({
      where: { id: v?.voucherId },
      data: { redeemBy: new Date(Date.now() - 1000) },
    });
    expect(await redeem(v?.code ?? '')).toEqual({ ok: false, state: 'EXPIRED' });
  });

  it('refuses access at and after the entitlement expiry instant', async () => {
    const [v] = await issue(versionId);
    const d = mac();
    await redeem(v?.code ?? '', { macAddress: d });
    const row = await h.prisma.voucher.findUniqueOrThrow({ where: { id: v?.voucherId } });
    const now = new Date();
    await h.prisma.entitlement.update({
      where: { id: row.entitlementId ?? '' },
      data: { startsAt: new Date(now.getTime() - 86_400_000), expiresAt: now },
    });
    expect(await redeem(v?.code ?? '', { macAddress: d })).toEqual({ ok: false, state: 'EXPIRED' });
  });

  it('room vouchers need explicit group membership — knowing the code is not enough', async () => {
    const roomPlan = await publishedPlan({
      scope: 'ROOM',
      maxGroupMembers: 3,
      maxDevices: 3,
      maxConcurrentSessions: 3,
    });
    const r = await ag.admin
      .post(`/api/v1/admin/properties/${A.id}/vouchers`)
      .set(CSRF)
      .send({
        planVersionId: roomPlan.versionId,
        issuanceType: 'MANUAL',
        reason: 'room trial',
        target: { scope: 'ROOM', roomId: A.room },
      });
    const code = r.body.data.vouchers[0].code as string;
    const member = await tenantAgent();
    const stranger = await tenantAgent();
    expect(await redeem(code, { userId: null })).toEqual({
      ok: false,
      state: 'NOT_AUTHORIZED_FOR_GROUP',
    });
    expect(await redeem(code, { userId: stranger.userId })).toEqual({
      ok: false,
      state: 'NOT_AUTHORIZED_FOR_GROUP',
    });
    // Membership management arrives in Phase 5; insert one directly to exercise the rule.
    const v = await h.prisma.voucher.findFirstOrThrow({
      where: { id: r.body.data.vouchers[0].voucherId },
      include: { entitlement: true },
    });
    const adminUser = await h.prisma.user.findFirstOrThrow({
      where: { kind: 'STAFF', roles: { some: { propertyId: A.id } } },
    });
    await h.prisma.groupMembership.create({
      data: {
        subscriptionId: v.entitlement?.subscriptionId ?? '',
        userId: member.userId,
        addedById: adminUser.id,
      },
    });
    expect((await redeem(code, { userId: member.userId })).ok).toBe(true);
  });

  it('ON_PURCHASE plans start the clock at issue (and disclose it)', async () => {
    const p = await publishedPlan({ activationPolicy: 'ON_PURCHASE' });
    const cat = await request(h.server).get(`/api/v1/catalog/properties/${A.slug}/plans`);
    expect(
      (cat.body.data as { planVersionId: string; activationPolicy: string }[]).find(
        (x) => x.planVersionId === p.versionId,
      )?.activationPolicy,
    ).toBe('ON_PURCHASE');
    const [v] = await issue(p.versionId);
    const e = (
      await h.prisma.voucher.findUniqueOrThrow({
        where: { id: v?.voucherId },
        include: { entitlement: true },
      })
    ).entitlement;
    expect(e?.startsAt).not.toBeNull();
    expect(e?.expiresAt).not.toBeNull();
  });
});
