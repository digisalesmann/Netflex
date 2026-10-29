import { randomBytes } from 'node:crypto';
import { expireDue, type PaymentEngine } from '@netflex/core';
import { createLogger } from '@netflex/observability';
import type { FakePaymentProvider } from '@netflex/payments';
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
import { createPaymentProcessor } from '../../worker/src/processors.js';
import { OTP_SENDER, type FakeOtpSender } from './auth/otp-sender.js';
import { PAYMENT_ENGINE, PAYMENT_PROVIDER } from './infra/tokens.js';
import { RedemptionService } from './vouchers/redemption.service.js';

let h: Harness;
let otp: FakeOtpSender;
let fake: FakePaymentProvider;
let engine: PaymentEngine;
let redemption: RedemptionService;
const secrets = new Map<string, string>();
const ag = {} as Record<'owner' | 'admin' | 'support' | 'network' | 'adminB', Agent>;
let P: { id: string; floor: string; floor2: string; room: string; room2: string; room3: string };
let B: { id: string };
let individualPlan: { planId: string; versionId: string };
let otherIndividualPlan: { planId: string; versionId: string };
let roomPlan: { planId: string; versionId: string };

const idem = () => `idem-${randomBytes(12).toString('hex')}`;
const mac = () =>
  Array.from(randomBytes(6), (b, i) => (i === 0 ? b & 0xfc : b).toString(16).padStart(2, '0')).join(
    ':',
  );
const base = () => `/api/v1/admin/properties/${P.id}`;

const planVersion = (over: Record<string, unknown>) => ({
  name: 'Plan',
  description: 'd',
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
  ...over,
});

async function publish(propertyId: string, agent: Agent, over: Record<string, unknown>) {
  const c = await agent
    .post(`/api/v1/admin/properties/${propertyId}/plans`)
    .set(CSRF)
    .send({ slug: `p-${uniq()}`, version: planVersion(over) });
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

/** Signed-in tenant living in `roomId`. */
async function resident(roomId: string) {
  const phone = randomPhone();
  const on = await ag.admin
    .post(`${base()}/tenants`)
    .set(CSRF)
    .send({ phone, displayName: `T ${uniq()}`, roomId, startsAt: '2026-01-01T00:00:00Z' });
  expect(on.status).toBe(201);
  await request(h.server)
    .post('/api/v1/auth/tenant/otp/request')
    .set(CSRF)
    .set(XFF())
    .send({ phone })
    .expect(202);
  const agent = request.agent(h.server);
  await agent
    .post('/api/v1/auth/tenant/otp/verify')
    .set(CSRF)
    .set(XFF())
    .send({ phone, code: otp.lastCode(phone) })
    .expect(200);
  return {
    agent,
    userId: on.body.data.userId as string,
    phone,
    assignmentId: on.body.data.assignmentId as string,
  };
}

async function issue(versionId: string, target: Record<string, unknown> = { scope: 'INDIVIDUAL' }) {
  const r = await ag.admin
    .post(`${base()}/vouchers`)
    .set(CSRF)
    .send({ planVersionId: versionId, issuanceType: 'MANUAL', reason: 'lifecycle test', target });
  expect(r.status).toBe(201);
  const v = r.body.data.vouchers[0] as { voucherId: string; code: string };
  const row = await h.prisma.voucher.findUniqueOrThrow({ where: { id: v.voucherId } });
  return { code: v.code, voucherId: v.voucherId, entitlementId: row.entitlementId as string };
}

const redeem = (code: string, o: { macAddress?: string; userId?: string | null } = {}) =>
  redemption.redeem({
    propertyId: P.id,
    code,
    macAddress: o.macAddress ?? mac(),
    userId: o.userId ?? null,
    clientKey: uniq(),
  });

const outboxCount = (type: string, entitlementId: string) =>
  h.prisma.outboxEvent.count({ where: { type, aggregateId: entitlementId } });

beforeAll(async () => {
  h = await startHarness({ PAID_ACCESS_ENABLED: 'true' });
  otp = h.app.get(OTP_SENDER);
  fake = h.app.get(PAYMENT_PROVIDER);
  engine = h.app.get(PAYMENT_ENGINE);
  redemption = h.app.get(RedemptionService);
  ag.owner = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'OWNER', propertyId: null }]),
    secrets,
  );
  const pid = (
    await ag.owner
      .post('/api/v1/admin/properties')
      .set(CSRF)
      .send({ slug: `p5-${uniq()}`, name: 'Lifecycle Lodge' })
  ).body.data.id as string;
  const b = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/buildings`)
      .set(CSRF)
      .send({ name: 'Main' })
  ).body.data.id as string;
  const f1 = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/buildings/${b}/floors`)
      .set(CSRF)
      .send({ label: 'G', level: 0 })
  ).body.data.id as string;
  const f2 = (
    await ag.owner
      .post(`/api/v1/admin/properties/${pid}/buildings/${b}/floors`)
      .set(CSRF)
      .send({ label: '1', level: 1 })
  ).body.data.id as string;
  const room = async (f: string, l: string) =>
    (
      await ag.owner
        .post(`/api/v1/admin/properties/${pid}/floors/${f}/rooms`)
        .set(CSRF)
        .send({ label: l })
    ).body.data.id as string;
  P = {
    id: pid,
    floor: f1,
    floor2: f2,
    room: await room(f1, 'G1'),
    room2: await room(f1, 'G2'),
    room3: await room(f2, 'F1'),
  };
  B = {
    id: (
      await ag.owner
        .post('/api/v1/admin/properties')
        .set(CSRF)
        .send({ slug: `p5b-${uniq()}`, name: 'Other' })
    ).body.data.id as string,
  };
  ag.admin = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'PROPERTY_ADMIN', propertyId: P.id }]),
    secrets,
  );
  ag.support = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'SUPPORT', propertyId: P.id }]),
    secrets,
  );
  ag.network = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'NETWORK_ADMIN', propertyId: P.id }]),
    secrets,
  );
  ag.adminB = await signInStaff(
    h,
    await createStaff(h.prisma, [{ role: 'PROPERTY_ADMIN', propertyId: B.id }]),
    secrets,
  );
  individualPlan = await publish(P.id, ag.admin, { name: 'Day' });
  otherIndividualPlan = await publish(P.id, ag.admin, { name: 'Other day' });
  roomPlan = await publish(P.id, ag.admin, {
    name: 'Room week',
    scope: 'ROOM',
    maxGroupMembers: 3,
    maxDevices: 6,
    maxConcurrentSessions: 6,
    duration: { value: 7, unit: 'DAY' },
  });
}, 180_000);

afterAll(async () => {
  await h.close();
});

// ====================================================================== expiry
describe('expiry (database time, exclusive boundary)', () => {
  it('expires at the exact expiry instant and not a moment before', async () => {
    const v = await issue(individualPlan.versionId);
    await redeem(v.code);
    const e = await h.prisma.entitlement.findUniqueOrThrow({ where: { id: v.entitlementId } });
    const exp = e.expiresAt as Date;
    await expireDue(h.prisma, 200, new Date(exp.getTime() - 1));
    expect(
      (await h.prisma.entitlement.findUniqueOrThrow({ where: { id: v.entitlementId } })).status,
    ).toBe('PROVISIONING');
    await expireDue(h.prisma, 200, exp);
    expect(
      (await h.prisma.entitlement.findUniqueOrThrow({ where: { id: v.entitlementId } })).status,
    ).toBe('EXPIRED');
  });

  it('on expiry: vouchers and subscription end, the gateway is told once, it is audited', async () => {
    const v = await issue(individualPlan.versionId);
    const d = mac();
    await redeem(v.code, { macAddress: d });
    await h.prisma
      .$executeRaw`UPDATE "entitlements" SET "startsAt" = now() - interval '2 days', "expiresAt" = now() - interval '1 second' WHERE "id" = ${v.entitlementId}::uuid`;
    await expireDue(h.prisma);
    const e = await h.prisma.entitlement.findUniqueOrThrow({
      where: { id: v.entitlementId },
      include: { subscription: true, vouchers: true },
    });
    expect(e.status).toBe('EXPIRED');
    expect(e.desiredNetworkState).toBe('REVOKED');
    expect(e.subscription.status).toBe('EXPIRED');
    expect(e.vouchers.every((x) => x.status === 'EXPIRED')).toBe(true);
    expect(await outboxCount('network.revoke', v.entitlementId)).toBe(1);
    expect(await redeem(v.code, { macAddress: d })).toEqual({ ok: false, state: 'EXPIRED' });
    expect(
      await h.prisma.auditLog.count({
        where: { action: 'entitlement.expired', targetId: v.entitlementId },
      }),
    ).toBe(1);
  });

  it('expires never-activated vouchers after their deadline (no gateway call: nothing was granted)', async () => {
    const v = await issue(individualPlan.versionId);
    await h.prisma
      .$executeRaw`UPDATE "entitlements" SET "activationDeadline" = now() - interval '1 second' WHERE "id" = ${v.entitlementId}::uuid`;
    const r = await expireDue(h.prisma);
    expect(r.deadlinesMissed).toBeGreaterThanOrEqual(1);
    expect((await h.prisma.voucher.findUniqueOrThrow({ where: { id: v.voucherId } })).status).toBe(
      'EXPIRED',
    );
    expect(await outboxCount('network.revoke', v.entitlementId)).toBe(0);
  });

  it('CONCURRENCY: four expiry runs at once expire each entitlement exactly once', async () => {
    const vs = await Promise.all(Array.from({ length: 6 }, () => issue(individualPlan.versionId)));
    for (const v of vs) await redeem(v.code);
    const ids = vs.map((v) => v.entitlementId);
    await h.prisma
      .$executeRaw`UPDATE "entitlements" SET "startsAt" = now() - interval '2 days', "expiresAt" = now() - interval '1 minute' WHERE "id" = ANY(${ids}::uuid[])`;
    await Promise.all([1, 2, 3, 4].map(() => expireDue(h.prisma, 2)));
    for (const id of ids) {
      expect(
        await h.prisma.auditLog.count({ where: { action: 'entitlement.expired', targetId: id } }),
      ).toBe(1);
      expect(await outboxCount('network.revoke', id)).toBe(1);
    }
  });

  it('runs as the worker job', async () => {
    const v = await issue(individualPlan.versionId);
    await redeem(v.code);
    await h.prisma
      .$executeRaw`UPDATE "entitlements" SET "startsAt" = now() - interval '2 days', "expiresAt" = now() - interval '1 second' WHERE "id" = ${v.entitlementId}::uuid`;
    const processor = createPaymentProcessor(
      engine,
      createLogger({ service: 'worker', environment: 'test', level: 'fatal' }),
      h.prisma,
    );
    await processor({ name: 'entitlements.expire', data: {} });
    expect(
      (await h.prisma.entitlement.findUniqueOrThrow({ where: { id: v.entitlementId } })).status,
    ).toBe('EXPIRED');
  });
});

// ====================================================================== staff lifecycle actions
describe('suspend / reactivate / revoke / extend', () => {
  it('suspend blocks access and tells the gateway; reactivate restores it', async () => {
    const v = await issue(individualPlan.versionId);
    const d = mac();
    await redeem(v.code, { macAddress: d });
    await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/suspend`)
      .set(CSRF)
      .send({ reason: 'unpaid rent dispute' })
      .expect(200);
    expect(await redeem(v.code, { macAddress: d })).toEqual({ ok: false, state: 'SUSPENDED' });
    expect(await outboxCount('network.suspend', v.entitlementId)).toBe(1);
    await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/suspend`)
      .set(CSRF)
      .send({ reason: 'again' })
      .expect(409);
    await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/reactivate`)
      .set(CSRF)
      .send({ reason: 'resolved' })
      .expect(200);
    expect(await redeem(v.code, { macAddress: d })).toMatchObject({ ok: true, reusedDevice: true });
    expect(await outboxCount('network.activate', v.entitlementId)).toBeGreaterThanOrEqual(2);
  });

  it('access that has not started cannot be suspended (suspend the voucher instead)', async () => {
    const v = await issue(individualPlan.versionId);
    const r = await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/suspend`)
      .set(CSRF)
      .send({ reason: 'x-ray' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/voucher/);
  });

  it('revoke ends access for good', async () => {
    const v = await issue(individualPlan.versionId);
    await redeem(v.code);
    await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/revoke`)
      .set(CSRF)
      .send({ reason: 'fraud' })
      .expect(200);
    expect(await redeem(v.code)).toEqual({ ok: false, state: 'INVALID_VOUCHER' });
    const e = await h.prisma.entitlement.findUniqueOrThrow({
      where: { id: v.entitlementId },
      include: { subscription: true },
    });
    expect(e.subscription.status).toBe('REVOKED');
    expect(await outboxCount('network.revoke', v.entitlementId)).toBe(1);
    await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/revoke`)
      .set(CSRF)
      .send({ reason: 'again' })
      .expect(409);
    await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/reactivate`)
      .set(CSRF)
      .send({ reason: 'undo' })
      .expect(409);
  });

  it('extend lengthens started access and moves the deadline of unstarted access; it never shortens', async () => {
    const started = await issue(individualPlan.versionId);
    await redeem(started.code);
    const before = (
      await h.prisma.entitlement.findUniqueOrThrow({ where: { id: started.entitlementId } })
    ).expiresAt as Date;
    const r = await ag.admin
      .post(`${base()}/entitlements/${started.entitlementId}/extend`)
      .set(CSRF)
      .send({ by: { value: 12, unit: 'HOUR' }, reason: 'outage compensation' });
    expect(r.status).toBe(200);
    expect(new Date(r.body.data.expiresAt).getTime() - before.getTime()).toBe(12 * 3600_000);
    await ag.admin
      .post(`${base()}/entitlements/${started.entitlementId}/extend`)
      .set(CSRF)
      .send({ by: { value: -1, unit: 'HOUR' }, reason: 'shorten' })
      .expect(400);

    const unstarted = await issue(individualPlan.versionId);
    const d0 = (
      await h.prisma.entitlement.findUniqueOrThrow({ where: { id: unstarted.entitlementId } })
    ).activationDeadline as Date;
    const r2 = await ag.admin
      .post(`${base()}/entitlements/${unstarted.entitlementId}/extend`)
      .set(CSRF)
      .send({ by: { value: 7, unit: 'DAY' }, reason: 'tenant travelling' });
    expect(new Date(r2.body.data.activationDeadline).getTime() - d0.getTime()).toBe(7 * 86_400_000);
    expect(
      (
        await h.prisma.voucher.findUniqueOrThrow({ where: { id: unstarted.voucherId } })
      ).redeemBy?.getTime(),
    ).toBe(new Date(r2.body.data.activationDeadline).getTime());
    expect(
      await h.prisma.auditLog.count({
        where: {
          action: 'entitlement.extended',
          targetId: started.entitlementId,
          reason: 'outage compensation',
        },
      }),
    ).toBe(1);
  });

  it('roles and properties: support and network staff can look but not act; other properties see nothing', async () => {
    const v = await issue(individualPlan.versionId);
    await ag.support.get(`${base()}/entitlements/${v.entitlementId}`).expect(200);
    await ag.network.get(`${base()}/entitlements`).expect(200);
    await ag.support
      .post(`${base()}/entitlements/${v.entitlementId}/revoke`)
      .set(CSRF)
      .send({ reason: 'nope' })
      .expect(404);
    await ag.network
      .post(`${base()}/entitlements/${v.entitlementId}/suspend`)
      .set(CSRF)
      .send({ reason: 'nope' })
      .expect(404);
    await ag.adminB
      .get(`/api/v1/admin/properties/${B.id}/entitlements/${v.entitlementId}`)
      .expect(404);
    await ag.adminB
      .post(`/api/v1/admin/properties/${B.id}/entitlements/${v.entitlementId}/revoke`)
      .set(CSRF)
      .send({ reason: 'cross' })
      .expect(404);
  });
});

// ====================================================================== tenant access and devices
describe('tenant access view and device recovery', () => {
  it('shows truthful states and lets the owner free a device slot (max 3 per day)', async () => {
    const t = await resident(P.room);
    const other = await resident(P.room2);
    const v = await issue(individualPlan.versionId, { scope: 'INDIVIDUAL', userId: t.userId });
    await redeem(v.code, { userId: t.userId });
    await redeem(v.code, { userId: t.userId });
    expect(await redeem(v.code, { userId: t.userId })).toEqual({
      ok: false,
      state: 'VOUCHER_EXHAUSTED',
    });

    const mine = await t.agent.get('/api/v1/me/access').expect(200);
    const a = (
      mine.body.data as {
        entitlementId: string;
        state: string;
        role: string;
        usage: { available: boolean };
        devices: { list: { redemptionId: string }[] };
        expiresAtLocal: string;
      }[]
    ).find((x) => x.entitlementId === v.entitlementId);
    // No gateway has confirmed anything yet, so it must not say "connected/active".
    expect(a?.state).toBe('ACCESS_BEING_CONFIGURED');
    expect(a?.role).toBe('OWNER');
    expect(a?.usage.available).toBe(false);
    expect(a?.expiresAtLocal).toBeTruthy();
    expect(
      (await other.agent.get('/api/v1/me/access')).body.data.some(
        (x: { entitlementId: string }) => x.entitlementId === v.entitlementId,
      ),
    ).toBe(false);

    const slot = a?.devices.list[0]?.redemptionId as string;
    await other.agent
      .post(`/api/v1/me/access/${v.entitlementId}/devices/${slot}/release`)
      .set(CSRF)
      .send({})
      .expect(404);
    await t.agent
      .post(`/api/v1/me/access/${v.entitlementId}/devices/${slot}/release`)
      .set(CSRF)
      .send({})
      .expect(200);
    expect(await outboxCount('network.disconnect', v.entitlementId)).toBe(1);
    expect(await redeem(v.code, { userId: t.userId })).toMatchObject({ ok: true });

    // Daily cap: 1 used; two more allowed, the fourth refused.
    for (let i = 0; i < 2; i++) {
      const list = (await t.agent.get('/api/v1/me/access')).body.data.find(
        (x: { entitlementId: string }) => x.entitlementId === v.entitlementId,
      );
      await t.agent
        .post(
          `/api/v1/me/access/${v.entitlementId}/devices/${list.devices.list[0].redemptionId}/release`,
        )
        .set(CSRF)
        .send({})
        .expect(200);
      await redeem(v.code, { userId: t.userId });
    }
    const list = (await t.agent.get('/api/v1/me/access')).body.data.find(
      (x: { entitlementId: string }) => x.entitlementId === v.entitlementId,
    );
    await t.agent
      .post(
        `/api/v1/me/access/${v.entitlementId}/devices/${list.devices.list[0].redemptionId}/release`,
      )
      .set(CSRF)
      .send({})
      .expect(429);
    // Staff can still help (no daily cap, reason recorded).
    await ag.admin
      .post(
        `${base()}/entitlements/${v.entitlementId}/devices/${list.devices.list[0].redemptionId}/release`,
      )
      .set(CSRF)
      .send({ reason: 'phone replaced' })
      .expect(200);
  });

  it('staff cannot use tenant endpoints and tenants cannot use staff ones', async () => {
    await ag.admin.get('/api/v1/me/access').expect(403);
    const t = await resident(P.room);
    await t.agent.get(`${base()}/entitlements`).expect(403);
  });
});

// ====================================================================== groups
describe('room groups', () => {
  it('membership is explicit, residence-bound, capped, and removal disconnects devices', async () => {
    const lead = await resident(P.room);
    const mate = await resident(P.room);
    const mate2 = await resident(P.room);
    const outsider = await resident(P.room2);
    const v = await issue(roomPlan.versionId, { scope: 'ROOM', roomId: P.room });
    const eb = `${base()}/entitlements/${v.entitlementId}`;

    // Staff add the lead and hand them the manager role.
    const m1 = await ag.admin.post(`${eb}/members`).set(CSRF).send({ phone: lead.phone });
    expect(m1.status).toBe(201);
    await ag.admin
      .post(`${eb}/transfer-manager`)
      .set(CSRF)
      .send({ toUserId: lead.userId, reason: 'room lead' })
      .expect(200);

    // The manager adds housemates; people living elsewhere are refused.
    await lead.agent
      .post(`/api/v1/me/access/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: outsider.phone })
      .expect(422);
    const add = await lead.agent
      .post(`/api/v1/me/access/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: mate.phone });
    expect(add.status).toBe(201);
    await lead.agent
      .post(`/api/v1/me/access/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: mate.phone })
      .expect(409);
    await lead.agent
      .post(`/api/v1/me/access/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: mate2.phone })
      .expect(201);
    // Cap = 3 (lead + 2).
    const extra = await resident(P.room);
    await lead.agent
      .post(`/api/v1/me/access/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: extra.phone })
      .expect(422);

    // Members can use it; they can't add people; outsiders can't even see it.
    expect(
      await redeem(v.code, { userId: mate.userId, macAddress: 'aa:00:00:00:00:01' }),
    ).toMatchObject({ ok: true });
    expect(await redeem(v.code, { userId: outsider.userId })).toEqual({
      ok: false,
      state: 'NOT_AUTHORIZED_FOR_GROUP',
    });
    await mate.agent
      .post(`/api/v1/me/access/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: extra.phone })
      .expect(404);
    await outsider.agent
      .post(`/api/v1/me/access/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: extra.phone })
      .expect(404);
    const mateView = (await mate.agent.get('/api/v1/me/access')).body.data.find(
      (x: { entitlementId: string }) => x.entitlementId === v.entitlementId,
    );
    expect(mateView.role).toBe('MEMBER');
    expect(mateView.members).toBeUndefined();

    // The manager removes a member: their device is released and disconnected.
    await lead.agent
      .post(`/api/v1/me/access/${v.entitlementId}/members/${add.body.data.membershipId}/remove`)
      .set(CSRF)
      .send({})
      .expect(200);
    expect(await redeem(v.code, { userId: mate.userId, macAddress: 'aa:00:00:00:00:01' })).toEqual({
      ok: false,
      state: 'NOT_AUTHORIZED_FOR_GROUP',
    });
    expect(
      await h.prisma.voucherRedemption.count({
        where: { entitlementId: v.entitlementId, userId: mate.userId, releasedAt: null },
      }),
    ).toBe(0);
    expect(await outboxCount('network.disconnect', v.entitlementId)).toBe(1);

    // The manager can't be removed before handing over the role.
    await ag.admin
      .post(`${eb}/members/${m1.body.data.membershipId}/remove`)
      .set(CSRF)
      .send({ reason: 'test' })
      .expect(409);
  });

  it('moving out of the room ends group membership automatically', async () => {
    const mover = await resident(P.room);
    const v = await issue(roomPlan.versionId, { scope: 'ROOM', roomId: P.room });
    await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: mover.phone })
      .expect(201);
    expect(await redeem(v.code, { userId: mover.userId })).toMatchObject({ ok: true });
    await ag.admin
      .post(`${base()}/assignments`)
      .set(CSRF)
      .send({
        userId: mover.userId,
        roomId: P.room3,
        startsAt: '2026-06-01T00:00:00Z',
        reason: 'moved upstairs',
      })
      .expect(201);
    expect(
      await h.prisma.groupMembership.count({
        where: {
          userId: mover.userId,
          removedAt: null,
          subscription: { entitlement: { id: v.entitlementId } },
        },
      }),
    ).toBe(0);
    expect(await redeem(v.code, { userId: mover.userId })).toEqual({
      ok: false,
      state: 'NOT_AUTHORIZED_FOR_GROUP',
    });
  });

  it('individual access cannot be shared', async () => {
    const v = await issue(individualPlan.versionId);
    const t = await resident(P.room);
    await ag.admin
      .post(`${base()}/entitlements/${v.entitlementId}/members`)
      .set(CSRF)
      .send({ phone: t.phone })
      .expect(422);
  });
});

// ====================================================================== renewal
describe('renewal', () => {
  /** A signed-in tenant buys, pays and redeems an individual plan. */
  async function boughtAndActive(
    t: Awaited<ReturnType<typeof resident>>,
    versionId = individualPlan.versionId,
  ) {
    const o = await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ planVersionId: versionId, target: { scope: 'INDIVIDUAL' } });
    expect(o.status).toBe(201);
    const c = await t.agent
      .post(`/api/v1/orders/${o.body.data.orderId}/checkout`)
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ email: 'renew@example.com' });
    fake.complete(c.body.data.reference);
    await engine.settle(c.body.data.paymentId, 'test');
    const code = (
      await t.agent.post(`/api/v1/orders/${o.body.data.orderId}/voucher`).set(CSRF).send({})
    ).body.data.code as string;
    const d = mac();
    await redeem(code, { userId: t.userId, macAddress: d });
    const v = await h.prisma.voucher.findFirstOrThrow({ where: { orderId: o.body.data.orderId } });
    return { code, device: d, entitlementId: v.entitlementId as string };
  }

  async function renew(
    t: Awaited<ReturnType<typeof resident>>,
    entitlementId: string,
    versionId = individualPlan.versionId,
  ) {
    const o = await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({
        planVersionId: versionId,
        target: { scope: 'INDIVIDUAL' },
        renewEntitlementId: entitlementId,
      });
    if (o.status !== 201) return o;
    const c = await t.agent
      .post(`/api/v1/orders/${o.body.data.orderId}/checkout`)
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ email: 'renew@example.com' });
    fake.complete(c.body.data.reference);
    await engine.settle(c.body.data.paymentId, 'test');
    return o;
  }

  it('stacks after the current expiry, keeps the same code and devices, and chains renewals', async () => {
    const t = await resident(P.room);
    const a = await boughtAndActive(t);
    const e0 = (await h.prisma.entitlement.findUniqueOrThrow({ where: { id: a.entitlementId } }))
      .expiresAt as Date;
    expect((await renew(t, a.entitlementId)).status).toBe(201);
    const e1 = (await h.prisma.entitlement.findUniqueOrThrow({ where: { id: a.entitlementId } }))
      .expiresAt as Date;
    expect(e1.getTime() - e0.getTime()).toBe(86_400_000);
    expect((await renew(t, a.entitlementId)).status).toBe(201);
    const e2 = (await h.prisma.entitlement.findUniqueOrThrow({ where: { id: a.entitlementId } }))
      .expiresAt as Date;
    expect(e2.getTime() - e0.getTime()).toBe(2 * 86_400_000);

    expect(await h.prisma.voucher.count({ where: { entitlementId: a.entitlementId } })).toBe(1);
    expect(await redeem(a.code, { userId: t.userId, macAddress: a.device })).toMatchObject({
      ok: true,
      reusedDevice: true,
    });
    const subs = await h.prisma.subscription.findMany({
      where: {
        OR: [
          { entitlement: { id: a.entitlementId } },
          { targetUserId: t.userId, renewsId: { not: null } },
        ],
      },
    });
    expect(subs).toHaveLength(3);
    expect(new Set(subs.map((s) => s.renewsId).filter(Boolean)).size).toBe(2); // linear chain
    expect(await outboxCount('network.apply_policy', a.entitlementId)).toBe(2);
  });

  it('refuses renewals by someone else, with a different plan, before access starts, or after it ends', async () => {
    const t = await resident(P.room);
    const a = await boughtAndActive(t);
    const stranger = await resident(P.room2);
    expect((await renew(stranger, a.entitlementId)).status).toBe(404);
    const diff = await renew(t, a.entitlementId, otherIndividualPlan.versionId);
    expect(diff.status).toBe(422);
    expect(diff.body.error.code).toBe('DOMAIN_RENEWAL_PLAN_MISMATCH');

    const unstarted = await issue(individualPlan.versionId, {
      scope: 'INDIVIDUAL',
      userId: t.userId,
    });
    expect((await renew(t, unstarted.entitlementId)).status).toBe(409);

    await h.prisma
      .$executeRaw`UPDATE "entitlements" SET "startsAt" = now() - interval '2 days', "expiresAt" = now() - interval '1 second' WHERE "id" = ${a.entitlementId}::uuid`;
    expect((await renew(t, a.entitlementId)).status).toBe(409);
  });

  it('if access ends while the renewal payment is pending, the customer gets fresh access instead', async () => {
    const t = await resident(P.room);
    const a = await boughtAndActive(t);
    const o = await t.agent
      .post('/api/v1/orders')
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({
        planVersionId: individualPlan.versionId,
        target: { scope: 'INDIVIDUAL' },
        renewEntitlementId: a.entitlementId,
      });
    expect(o.status).toBe(201);
    const c = await t.agent
      .post(`/api/v1/orders/${o.body.data.orderId}/checkout`)
      .set(CSRF)
      .set(XFF())
      .set('idempotency-key', idem())
      .send({ email: 'renew@example.com' });
    await h.prisma
      .$executeRaw`UPDATE "entitlements" SET "startsAt" = now() - interval '2 days', "expiresAt" = now() - interval '1 second' WHERE "id" = ${a.entitlementId}::uuid`;
    await expireDue(h.prisma);
    fake.complete(c.body.data.reference);
    expect(await engine.settle(c.body.data.paymentId, 'test')).toBe('SUCCEEDED_FULFILLED');
    const fresh = await h.prisma.voucher.findFirst({ where: { orderId: o.body.data.orderId } });
    expect(fresh).not.toBeNull();
    expect(fresh?.entitlementId).not.toBe(a.entitlementId);
    expect(
      await h.prisma.auditLog.count({
        where: { action: 'order.renewal_fell_back', targetId: o.body.data.orderId },
      }),
    ).toBe(1);
  });

  it('the renewal link on an order can never be changed', async () => {
    const t = await resident(P.room);
    const a = await boughtAndActive(t);
    const o = await renew(t, a.entitlementId);
    await expect(
      h.prisma.order.update({
        where: { id: o.body.data.orderId },
        data: { renewsEntitlementId: null },
      }),
    ).rejects.toThrow(/immutable/);
  });
});
