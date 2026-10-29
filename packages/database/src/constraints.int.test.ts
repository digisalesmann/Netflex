import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Prisma, createPrismaClient, type PrismaClient } from './index.js';

/**
 * Integration tests against a real PostgreSQL database (netflex_test).
 * They prove the database itself rejects invalid data, independent of app code.
 */

let db: PrismaClient;

const uniq = () => randomBytes(4).toString('hex');
const hex64 = () => randomBytes(32).toString('hex');
const phone = () =>
  `+23480${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`;

async function expectDbError(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(p).rejects.toThrow(pattern);
}

interface World {
  propertyId: string;
  otherPropertyId: string;
  buildingId: string;
  floorId: string;
  roomId: string;
  otherFloorId: string;
  staffId: string;
  staff2Id: string;
  tenantId: string;
  planVersionId: string;
}

async function buildWorld(): Promise<World> {
  const s = uniq();
  const property = await db.property.create({
    data: { slug: `p-${s}`, name: 'Test Lodge', timeZone: 'Africa/Lagos', currency: 'NGN' },
  });
  const other = await db.property.create({
    data: { slug: `o-${s}`, name: 'Other Lodge', timeZone: 'Africa/Lagos', currency: 'NGN' },
  });
  const building = await db.building.create({ data: { propertyId: property.id, name: 'Block A' } });
  const floor = await db.floor.create({
    data: { propertyId: property.id, buildingId: building.id, label: 'Ground', level: 0 },
  });
  const room = await db.room.create({
    data: { propertyId: property.id, floorId: floor.id, label: 'A1' },
  });
  const otherBuilding = await db.building.create({
    data: { propertyId: other.id, name: 'Block Z' },
  });
  const otherFloor = await db.floor.create({
    data: { propertyId: other.id, buildingId: otherBuilding.id, label: 'Z0', level: 0 },
  });
  const staff = await db.user.create({
    data: { kind: 'STAFF', displayName: 'Admin', email: `a-${s}@test.invalid` },
  });
  const staff2 = await db.user.create({
    data: { kind: 'STAFF', displayName: 'Finance', email: `f-${s}@test.invalid` },
  });
  const tenant = await db.user.create({
    data: { kind: 'TENANT', displayName: 'Tenant', phoneE164: phone() },
  });
  const plan = await db.plan.create({
    data: { propertyId: property.id, slug: `day-${s}`, status: 'PUBLISHED' },
  });
  const pv = await db.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      name: 'Day pass',
      description: 'Test plan',
      scope: 'INDIVIDUAL',
      priceMinor: 50_000n,
      currency: 'NGN',
      durationValue: 1,
      durationUnit: 'DAY',
      activationPolicy: 'ON_FIRST_AUTHORIZATION',
      maxDevices: 2,
      maxConcurrentSessions: 2,
      renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
      refundPolicyText: 'Test',
      termsVersion: 'test',
      createdById: staff.id,
    },
  });
  return {
    propertyId: property.id,
    otherPropertyId: other.id,
    buildingId: building.id,
    floorId: floor.id,
    roomId: room.id,
    otherFloorId: otherFloor.id,
    staffId: staff.id,
    staff2Id: staff2.id,
    tenantId: tenant.id,
    planVersionId: pv.id,
  };
}

function orderData(
  w: World,
  extra: Partial<Prisma.OrderUncheckedCreateInput> = {},
): Prisma.OrderUncheckedCreateInput {
  return {
    reference: `NFX-${uniq()}`,
    propertyId: w.propertyId,
    planVersionId: w.planVersionId,
    scope: 'INDIVIDUAL',
    targetUserId: w.tenantId,
    customerUserId: w.tenantId,
    amountMinor: 50_000n,
    currency: 'NGN',
    planSnapshot: { test: true },
    expiresAt: new Date(Date.now() + 3_600_000),
    ...extra,
  };
}

let w: World;

beforeAll(async () => {
  db = createPrismaClient(inject('testDatabaseUrl'));
  w = await buildWorld();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('property hierarchy', () => {
  it('rejects a room whose floor belongs to another property (composite FK)', async () => {
    await expectDbError(
      db.room.create({
        data: { propertyId: w.propertyId, floorId: w.otherFloorId, label: `X-${uniq()}` },
      }),
      /Foreign key constraint/i,
    );
  });
});

describe('orders and money', () => {
  it('rejects a ROOM order with no room target', async () => {
    await expectDbError(
      db.order.create({ data: orderData(w, { scope: 'ROOM', targetUserId: null }) }),
      /orders_scope_target/,
    );
  });

  it('rejects a FLOOR order that also names a room', async () => {
    await expectDbError(
      db.order.create({
        data: orderData(w, {
          scope: 'FLOOR',
          targetUserId: null,
          targetFloorId: w.floorId,
          targetRoomId: w.roomId,
        }),
      }),
      /orders_scope_target/,
    );
  });

  it('requires a customer account or a guest phone + token', async () => {
    await expectDbError(
      db.order.create({ data: orderData(w, { customerUserId: null }) }),
      /orders_guest_has_token/,
    );
    await expectDbError(
      db.order.create({
        data: orderData(w, { customerUserId: null, customerPhone: '+2348000000000' }),
      }),
      /orders_guest_has_token/,
    );
    await db.order.create({
      data: orderData(w, {
        customerUserId: null,
        customerPhone: '+2348000000000',
        accessTokenVerifier: hex64(),
      }),
    });
  });

  it('rejects zero or negative amounts and bad currency codes', async () => {
    await expectDbError(
      db.order.create({ data: orderData(w, { amountMinor: 0n }) }),
      /orders_amount_positive/,
    );
    await expectDbError(
      db.order.create({ data: orderData(w, { currency: 'ngn' }) }),
      /orders_currency_iso/,
    );
  });

  it('makes order pricing immutable and forbids deleting orders', async () => {
    const o = await db.order.create({ data: orderData(w) });
    await expectDbError(
      db.order.update({ where: { id: o.id }, data: { amountMinor: 1n } }),
      /immutable/,
    );
    await expectDbError(
      db.order.update({ where: { id: o.id }, data: { planSnapshot: { x: 1 } } }),
      /immutable/,
    );
    // Status changes are allowed.
    await db.order.update({ where: { id: o.id }, data: { status: 'AWAITING_PAYMENT' } });
    await expectDbError(db.order.delete({ where: { id: o.id } }), /financial history/);
  });
});

describe('payments', () => {
  it('allows only one successful payment per order', async () => {
    const o = await db.order.create({ data: orderData(w) });
    const base = {
      orderId: o.id,
      provider: 'FAKE' as const,
      amountMinor: 50_000n,
      currency: 'NGN',
    };
    await db.payment.create({
      data: { ...base, providerReference: `r-${uniq()}`, status: 'SUCCEEDED' },
    });
    await db.payment.create({
      data: { ...base, providerReference: `r-${uniq()}`, status: 'FAILED' },
    });
    await expectDbError(
      db.payment.create({
        data: { ...base, providerReference: `r-${uniq()}`, status: 'SUCCEEDED' },
      }),
      /Unique constraint/i,
    );
  });

  it('rejects duplicate provider references', async () => {
    const o = await db.order.create({ data: orderData(w) });
    const ref = `dup-${uniq()}`;
    const data = {
      orderId: o.id,
      provider: 'FAKE' as const,
      providerReference: ref,
      amountMinor: 50_000n,
      currency: 'NGN',
    };
    await db.payment.create({ data });
    await expectDbError(db.payment.create({ data }), /Unique constraint/i);
  });

  it('dedupes webhook events by raw-body fingerprint', async () => {
    const data = {
      provider: 'PAYSTACK' as const,
      fingerprint: hex64(),
      eventType: 'charge.success',
      signatureValid: true,
      payloadRedacted: {},
    };
    await db.paymentEvent.create({ data });
    await expectDbError(db.paymentEvent.create({ data }), /Unique constraint/i);
  });

  it('protects payment amount and forbids deletion', async () => {
    const o = await db.order.create({ data: orderData(w) });
    const p = await db.payment.create({
      data: {
        orderId: o.id,
        provider: 'FAKE',
        providerReference: `r-${uniq()}`,
        amountMinor: 50_000n,
        currency: 'NGN',
      },
    });
    await expectDbError(
      db.payment.update({ where: { id: p.id }, data: { amountMinor: 1n } }),
      /immutable/,
    );
    await expectDbError(db.payment.delete({ where: { id: p.id } }), /financial history/);
    await expectDbError(
      db.payment.update({ where: { id: p.id }, data: { refundedMinor: 60_000n } }),
      /payments_refunded_range/,
    );
  });

  it('enforces the two-person rule on refunds', async () => {
    const o = await db.order.create({ data: orderData(w) });
    const p = await db.payment.create({
      data: {
        orderId: o.id,
        provider: 'FAKE',
        providerReference: `r-${uniq()}`,
        amountMinor: 50_000n,
        currency: 'NGN',
        status: 'SUCCEEDED',
      },
    });
    const base = {
      paymentId: p.id,
      amountMinor: 10_000n,
      currency: 'NGN',
      reason: 'test',
      requestedById: w.staffId,
    };
    await expectDbError(
      db.refund.create({ data: { ...base, approvedById: w.staffId } }),
      /refunds_four_eyes/,
    );
    await db.refund.create({ data: { ...base, approvedById: w.staff2Id } });
  });
});

describe('plan versions', () => {
  it('are immutable once locked, and the lock cannot be removed', async () => {
    const plan = await db.plan.create({
      data: { propertyId: w.propertyId, slug: `lock-${uniq()}` },
    });
    const pv = await db.planVersion.create({
      data: {
        planId: plan.id,
        version: 1,
        name: 'Week',
        description: 'x',
        scope: 'ROOM',
        maxGroupMembers: 4,
        priceMinor: 300_000n,
        currency: 'NGN',
        durationValue: 7,
        durationUnit: 'DAY',
        activationPolicy: 'ON_FIRST_AUTHORIZATION',
        maxDevices: 4,
        maxConcurrentSessions: 4,
        renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
        refundPolicyText: 'x',
        termsVersion: 't',
        createdById: w.staffId,
      },
    });
    await db.planVersion.update({
      where: { id: pv.id },
      data: { name: 'Week (edited before use)' },
    });
    await db.planVersion.update({ where: { id: pv.id }, data: { lockedAt: new Date() } });
    await expectDbError(
      db.planVersion.update({ where: { id: pv.id }, data: { priceMinor: 1n } }),
      /immutable/,
    );
    await expectDbError(
      db.planVersion.update({ where: { id: pv.id }, data: { lockedAt: null } }),
      /immutable/,
    );
    await expectDbError(db.planVersion.delete({ where: { id: pv.id } }), /cannot be deleted/);
  });

  it('rejects a room plan without a group cap and sessions > devices', async () => {
    const plan = await db.plan.create({
      data: { propertyId: w.propertyId, slug: `bad-${uniq()}` },
    });
    const base = {
      planId: plan.id,
      name: 'Bad',
      description: 'x',
      priceMinor: 1n,
      currency: 'NGN',
      durationValue: 1,
      durationUnit: 'DAY' as const,
      activationPolicy: 'ON_PURCHASE' as const,
      renewalRule: 'REPLACE' as const,
      refundPolicyText: 'x',
      termsVersion: 't',
      createdById: w.staffId,
    };
    await expectDbError(
      db.planVersion.create({
        data: { ...base, version: 1, scope: 'ROOM', maxDevices: 2, maxConcurrentSessions: 2 },
      }),
      /plan_versions_group_members/,
    );
    await expectDbError(
      db.planVersion.create({
        data: { ...base, version: 2, scope: 'INDIVIDUAL', maxDevices: 1, maxConcurrentSessions: 2 },
      }),
      /plan_versions_devices/,
    );
  });
});

describe('vouchers and entitlements', () => {
  async function makeEntitlement(extra: Partial<Prisma.EntitlementUncheckedCreateInput> = {}) {
    const sub = await db.subscription.create({
      data: {
        propertyId: w.propertyId,
        planVersionId: w.planVersionId,
        planSnapshot: {},
        scope: 'INDIVIDUAL',
        targetUserId: w.tenantId,
        activationPolicy: 'ON_FIRST_AUTHORIZATION',
      },
    });
    return db.entitlement.create({
      data: {
        propertyId: w.propertyId,
        subscriptionId: sub.id,
        scope: 'INDIVIDUAL',
        targetUserId: w.tenantId,
        maxDevices: 2,
        maxConcurrentSessions: 1,
        ...extra,
      },
    });
  }

  it('requires an order for paid vouchers', async () => {
    await expectDbError(
      db.voucher.create({
        data: {
          propertyId: w.propertyId,
          verifier: hex64(),
          verifierKeyVersion: 1,
          hint: 'ABCD',
          issuanceType: 'PAID',
          scope: 'INDIVIDUAL',
        },
      }),
      /vouchers_issuance_record/,
    );
  });

  it('requires an issuer and reason for complimentary vouchers', async () => {
    const base = {
      propertyId: w.propertyId,
      verifierKeyVersion: 1,
      hint: 'ABCD',
      issuanceType: 'COMPLIMENTARY' as const,
      scope: 'INDIVIDUAL' as const,
    };
    await expectDbError(
      db.voucher.create({ data: { ...base, verifier: hex64() } }),
      /vouchers_issuance_record/,
    );
    await expectDbError(
      db.voucher.create({
        data: { ...base, verifier: hex64(), issuedById: w.staffId, issueReason: '   ' },
      }),
      /vouchers_issuance_record/,
    );
    await db.voucher.create({
      data: { ...base, verifier: hex64(), issuedById: w.staffId, issueReason: 'Welcome credit' },
    });
  });

  it('rejects malformed verifiers/hints and duplicate verifiers', async () => {
    const base = {
      propertyId: w.propertyId,
      verifierKeyVersion: 1,
      issuanceType: 'MANUAL' as const,
      scope: 'INDIVIDUAL' as const,
      issuedById: w.staffId,
      issueReason: 'r',
    };
    await expectDbError(
      db.voucher.create({ data: { ...base, verifier: 'PLAINTEXT-CODE', hint: 'ABCD' } }),
      /vouchers_verifier_hex/,
    );
    await expectDbError(
      db.voucher.create({ data: { ...base, verifier: hex64(), hint: 'AB0O' } }),
      /vouchers_hint_format/,
    );
    const v = hex64();
    await db.voucher.create({ data: { ...base, verifier: v, hint: 'ABCD' } });
    await expectDbError(
      db.voucher.create({ data: { ...base, verifier: v, hint: 'ABCD' } }),
      /Unique constraint/i,
    );
  });

  it('allows only one live voucher per entitlement', async () => {
    const e = await makeEntitlement();
    const base = {
      propertyId: w.propertyId,
      verifierKeyVersion: 1,
      hint: 'ABCD',
      issuanceType: 'MANUAL' as const,
      scope: 'INDIVIDUAL' as const,
      issuedById: w.staffId,
      issueReason: 'r',
      entitlementId: e.id,
    };
    const first = await db.voucher.create({ data: { ...base, verifier: hex64() } });
    await expectDbError(
      db.voucher.create({ data: { ...base, verifier: hex64() } }),
      /Unique constraint/i,
    );
    await db.voucher.update({
      where: { id: first.id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'reissue' },
    });
    await db.voucher.create({ data: { ...base, verifier: hex64(), replacesVoucherId: first.id } });
  });

  it('requires a coherent time window', async () => {
    const now = Date.now();
    await expectDbError(makeEntitlement({ startsAt: new Date(now) }), /entitlements_window/);
    await expectDbError(
      makeEntitlement({ startsAt: new Date(now), expiresAt: new Date(now) }),
      /entitlements_window/,
    );
    await expectDbError(makeEntitlement({ status: 'ACTIVE' }), /entitlements_active_has_window/);
    await makeEntitlement({
      status: 'ACTIVE',
      startsAt: new Date(now),
      expiresAt: new Date(now + 1000),
    });
  });
});

describe('audit log', () => {
  it('is append-only', async () => {
    const entry = await db.auditLog.create({
      data: { actorType: 'SYSTEM', action: 'test.event', targetType: 'test', hash: hex64() },
    });
    await expectDbError(
      db.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
      /append-only/,
    );
    await expectDbError(db.auditLog.delete({ where: { id: entry.id } }), /append-only/);
    await expectDbError(db.$executeRawUnsafe('TRUNCATE "audit_logs"'), /append-only/);
  });
});

describe('tenancy', () => {
  it('allows only one open room assignment per tenant per property', async () => {
    const u = await db.user.create({
      data: { kind: 'TENANT', displayName: `T-${randomUUID()}`, phoneE164: phone() },
    });
    const base = {
      propertyId: w.propertyId,
      userId: u.id,
      roomId: w.roomId,
      createdById: w.staffId,
    };
    await db.tenantAssignment.create({ data: { ...base, startsAt: new Date('2026-01-01Z') } });
    await expectDbError(
      db.tenantAssignment.create({ data: { ...base, startsAt: new Date('2026-02-01Z') } }),
      /Unique constraint/i,
    );
  });
});
