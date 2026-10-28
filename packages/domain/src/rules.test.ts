import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import { money } from './money.js';
import { matchVerifiedTransaction } from './payment-matching.js';
import { checkPurchasable, validatePlanVersion, type PlanVersionSnapshot } from './plans.js';
import { evaluateRedemption, publicRedemptionState, type RedemptionInput } from './redemption.js';
import { assertTargetInProperty, canPurchaseFor } from './scope.js';

const now = new Date('2026-07-01T12:00:00Z');

const plan: PlanVersionSnapshot = {
  planId: 'plan_1',
  planVersionId: 'pv_1',
  version: 1,
  propertyId: 'prop_A',
  name: 'Day pass',
  status: 'PUBLISHED',
  scope: 'INDIVIDUAL',
  price: money(50_000n, 'NGN'),
  duration: { value: 1, unit: 'DAY' },
  activationPolicy: 'ON_FIRST_AUTHORIZATION',
  redemptionWindow: { value: 30, unit: 'DAY' },
  maxDevices: 2,
  maxConcurrentSessions: 2,
  rate: { downloadKbps: 5_000, uploadKbps: 2_000 },
  maxGroupMembers: null,
  renewalRule: 'STACK_AFTER_CURRENT_EXPIRY',
  availableFrom: null,
  availableUntil: null,
  termsVersion: '2026-10-28',
};

describe('plan validation and eligibility', () => {
  it('accepts a valid plan', () => expect(() => validatePlanVersion(plan)).not.toThrow());

  it.each<[string, Partial<PlanVersionSnapshot>]>([
    ['zero price', { price: money(0n, 'NGN') }],
    ['sessions > devices', { maxConcurrentSessions: 3 }],
    ['group members on individual', { maxGroupMembers: 3 }],
    ['room without group cap', { scope: 'ROOM', maxGroupMembers: null }],
    ['tiny rate', { rate: { downloadKbps: 1, uploadKbps: null } }],
    ['inverted availability', { availableFrom: now, availableUntil: now }],
  ])('rejects %s', (_label, patch) => {
    expect(() => validatePlanVersion({ ...plan, ...patch })).toThrow(DomainError);
  });

  const ctx: Parameters<typeof checkPurchasable>[1] = {
    now,
    propertyId: 'prop_A',
    scope: 'INDIVIDUAL',
    paidAccessEnabled: true,
  };
  it('is purchasable when published, right property and scope', () => {
    expect(checkPurchasable(plan, ctx)).toEqual({ ok: true });
  });
  it.each<[string, Partial<PlanVersionSnapshot>, Partial<typeof ctx>, string]>([
    ['paid access off', {}, { paidAccessEnabled: false }, 'PAID_ACCESS_DISABLED'],
    ['draft', { status: 'DRAFT' }, {}, 'NOT_PUBLISHED'],
    ['paused', { status: 'PAUSED' }, {}, 'NOT_PUBLISHED'],
    ['other property', {}, { propertyId: 'prop_B' }, 'WRONG_PROPERTY'],
    ['scope mismatch', {}, { scope: 'FLOOR' }, 'WRONG_SCOPE'],
    ['future', { availableFrom: new Date('2026-08-01Z') }, {}, 'NOT_YET_AVAILABLE'],
    ['ended exactly now', { availableUntil: now }, {}, 'NO_LONGER_AVAILABLE'],
  ])('blocks purchase: %s', (_l, p, c, reason) => {
    expect(checkPurchasable({ ...plan, ...p }, { ...ctx, ...c })).toEqual({ ok: false, reason });
  });
});

describe('scope rules', () => {
  const actor = {
    userId: 'u1',
    propertyId: 'prop_A',
    roomIds: new Set(['room_1']),
    floorIds: new Set<string>(),
  };
  it('individuals can only buy for themselves', () => {
    expect(canPurchaseFor(actor, { scope: 'INDIVIDUAL', userId: 'u1' }, 'prop_A')).toBe(true);
    expect(canPurchaseFor(actor, { scope: 'INDIVIDUAL', userId: 'u2' }, 'prop_A')).toBe(false);
  });
  it('room authority does not grant adjacent rooms or the floor', () => {
    expect(canPurchaseFor(actor, { scope: 'ROOM', roomId: 'room_1' }, 'prop_A')).toBe(true);
    expect(canPurchaseFor(actor, { scope: 'ROOM', roomId: 'room_2' }, 'prop_A')).toBe(false);
    expect(canPurchaseFor(actor, { scope: 'FLOOR', floorId: 'floor_1' }, 'prop_A')).toBe(false);
  });
  it('authority never crosses properties', () => {
    expect(canPurchaseFor(actor, { scope: 'ROOM', roomId: 'room_1' }, 'prop_B')).toBe(false);
  });
  it('validates target belongs to the property', () => {
    const t = { scope: 'ROOM', roomId: 'room_1' } as const;
    expect(() =>
      assertTargetInProperty(t, { propertyId: 'prop_A', floorId: 'f', roomId: 'room_1' }, 'prop_A'),
    ).not.toThrow();
    expect(() =>
      assertTargetInProperty(t, { propertyId: 'prop_B', floorId: 'f', roomId: 'room_1' }, 'prop_A'),
    ).toThrow();
    expect(() => assertTargetInProperty(t, null, 'prop_A')).toThrow();
  });
});

describe('evaluateRedemption', () => {
  const base: RedemptionInput = {
    now,
    requestPropertyId: 'prop_A',
    voucher: {
      status: 'ISSUED',
      propertyId: 'prop_A',
      scope: 'INDIVIDUAL',
      issuanceType: 'PAID',
      paymentVerified: true,
      issuanceAuthorized: false,
      redeemBy: new Date('2026-07-31T00:00:00Z'),
    },
    entitlement: {
      status: 'PENDING_ACTIVATION',
      expiresAt: null,
      maxDevices: 2,
      boundDeviceCount: 0,
    },
    device: { alreadyBound: false },
    requesterIsGroupMember: false,
  };
  const withV = (v: Partial<RedemptionInput['voucher']>): RedemptionInput => ({
    ...base,
    voucher: { ...base.voucher, ...v },
  });
  const withE = (e: Partial<RedemptionInput['entitlement']>): RedemptionInput => ({
    ...base,
    entitlement: { ...base.entitlement, ...e },
  });

  it('allows first activation of a verified paid voucher', () => {
    expect(evaluateRedemption(base)).toEqual({
      ok: true,
      action: 'BIND_NEW_DEVICE',
      firstActivation: true,
    });
  });

  it('never activates a paid voucher without verified payment', () => {
    expect(evaluateRedemption(withV({ paymentVerified: false }))).toEqual({
      ok: false,
      reason: 'PAYMENT_UNVERIFIED',
    });
  });

  it('requires an issuance record for free/manual vouchers', () => {
    expect(
      evaluateRedemption(withV({ issuanceType: 'COMPLIMENTARY', paymentVerified: false })),
    ).toEqual({
      ok: false,
      reason: 'ISSUANCE_UNAUTHORIZED',
    });
    expect(
      evaluateRedemption(
        withV({ issuanceType: 'COMPLIMENTARY', paymentVerified: false, issuanceAuthorized: true }),
      ).ok,
    ).toBe(true);
  });

  it('enforces the device limit and lets bound devices reconnect', () => {
    expect(evaluateRedemption(withE({ boundDeviceCount: 2 }))).toEqual({
      ok: false,
      reason: 'DEVICE_LIMIT_REACHED',
    });
    expect(
      evaluateRedemption({ ...withE({ boundDeviceCount: 2 }), device: { alreadyBound: true } }),
    ).toMatchObject({
      ok: true,
      action: 'REUSE_BOUND_DEVICE',
    });
  });

  it('enforces the redemption deadline only for first activation (exclusive boundary)', () => {
    expect(evaluateRedemption(withV({ redeemBy: now }))).toEqual({
      ok: false,
      reason: 'REDEMPTION_DEADLINE_PASSED',
    });
    expect(
      evaluateRedemption({
        ...withV({ status: 'ACTIVE', redeemBy: now }),
        entitlement: {
          ...base.entitlement,
          status: 'ACTIVE',
          expiresAt: new Date('2026-07-02Z'),
          boundDeviceCount: 1,
        },
      }).ok,
    ).toBe(true);
  });

  it('rejects at the exact expiry instant', () => {
    expect(evaluateRedemption(withE({ status: 'ACTIVE', expiresAt: now }))).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it('rejects other-property, revoked, suspended, not-issued', () => {
    expect(evaluateRedemption({ ...base, requestPropertyId: 'prop_B' })).toMatchObject({
      reason: 'WRONG_PROPERTY',
    });
    expect(evaluateRedemption(withV({ status: 'REVOKED' }))).toMatchObject({ reason: 'REVOKED' });
    expect(evaluateRedemption(withE({ status: 'SUSPENDED' }))).toMatchObject({
      reason: 'SUSPENDED',
    });
    expect(evaluateRedemption(withV({ status: 'GENERATED' }))).toMatchObject({
      reason: 'NOT_ISSUED',
    });
  });

  it('room/floor vouchers need explicit group membership — knowing the code is not enough', () => {
    expect(evaluateRedemption(withV({ scope: 'ROOM' }))).toEqual({
      ok: false,
      reason: 'NOT_GROUP_MEMBER',
    });
    expect(
      evaluateRedemption({ ...withV({ scope: 'ROOM' }), requesterIsGroupMember: true }).ok,
    ).toBe(true);
  });

  it('public states hide whether a code exists', () => {
    for (const r of ['WRONG_PROPERTY', 'NOT_ISSUED', 'PAYMENT_UNVERIFIED', 'REVOKED'] as const) {
      expect(publicRedemptionState(r)).toBe('INVALID_VOUCHER');
    }
    expect(publicRedemptionState('DEVICE_LIMIT_REACHED')).toBe('VOUCHER_EXHAUSTED');
  });
});

describe('matchVerifiedTransaction', () => {
  const expected = { reference: 'NFX-1', amount: money(50_000n, 'NGN'), accountId: null };
  const ok = {
    reference: 'NFX-1',
    status: 'success' as const,
    amountMinor: 50_000n,
    currency: 'NGN',
    accountId: null,
  };

  it('accepts an exact match', () =>
    expect(matchVerifiedTransaction(expected, ok)).toEqual({ ok: true }));

  it('reports every mismatch', () => {
    expect(
      matchVerifiedTransaction(expected, {
        ...ok,
        amountMinor: 49_999n,
        currency: 'USD',
        reference: 'X',
        status: 'failed',
      }),
    ).toEqual({ ok: false, mismatches: ['REFERENCE', 'CURRENCY', 'AMOUNT', 'STATUS'] });
  });

  it('rejects overpayment as well as underpayment', () => {
    expect(matchVerifiedTransaction(expected, { ...ok, amountMinor: 50_001n })).toEqual({
      ok: false,
      mismatches: ['AMOUNT'],
    });
  });

  it('checks the receiving account when known', () => {
    expect(
      matchVerifiedTransaction(
        { ...expected, accountId: 'acct_1' },
        { ...ok, accountId: 'acct_2' },
      ),
    ).toEqual({ ok: false, mismatches: ['ACCOUNT'] });
  });
});
