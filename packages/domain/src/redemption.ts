import type { AccessScope } from './scope.js';
import type { EntitlementStatus, VoucherStatus } from './state-machines.js';
import { hasExpired } from './time.js';

export const ISSUANCE_TYPES = ['PAID', 'COMPLIMENTARY', 'MANUAL', 'PROMOTIONAL'] as const;
export type IssuanceType = (typeof ISSUANCE_TYPES)[number];

export interface RedemptionInput {
  readonly now: Date;
  /** Property of the gateway/network zone the request arrived from (server-resolved). */
  readonly requestPropertyId: string;
  readonly voucher: {
    readonly status: VoucherStatus;
    readonly propertyId: string;
    readonly scope: AccessScope;
    readonly issuanceType: IssuanceType;
    /** True only if a linked Payment is SUCCEEDED (server-verified). */
    readonly paymentVerified: boolean;
    /** True only if a non-paid voucher has an issuer + reason on record. */
    readonly issuanceAuthorized: boolean;
    readonly redeemBy: Date | null;
  };
  readonly entitlement: {
    readonly status: EntitlementStatus;
    readonly expiresAt: Date | null;
    readonly maxDevices: number;
    readonly boundDeviceCount: number;
  };
  readonly device: {
    /** This device already holds a redemption on this voucher. */
    readonly alreadyBound: boolean;
  };
  /** For ROOM/FLOOR: whether the requesting user is an explicit, active group member. */
  readonly requesterIsGroupMember: boolean;
}

export type RedemptionRejection =
  | 'WRONG_PROPERTY'
  | 'NOT_ISSUED'
  | 'PAYMENT_UNVERIFIED'
  | 'ISSUANCE_UNAUTHORIZED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'REDEMPTION_DEADLINE_PASSED'
  | 'DEVICE_LIMIT_REACHED'
  | 'NOT_GROUP_MEMBER';

export type RedemptionDecision =
  | { ok: true; action: 'BIND_NEW_DEVICE' | 'REUSE_BOUND_DEVICE'; firstActivation: boolean }
  | { ok: false; reason: RedemptionRejection };

/**
 * Pure redemption rules (spec §8.4). The caller must evaluate this inside a
 * transaction holding a row lock on the voucher (SELECT … FOR UPDATE) so that
 * concurrent requests cannot both pass the device-limit check.
 */
export function evaluateRedemption(input: RedemptionInput): RedemptionDecision {
  const { voucher: v, entitlement: e, now } = input;
  const reject = (reason: RedemptionRejection): RedemptionDecision => ({ ok: false, reason });

  if (v.propertyId !== input.requestPropertyId) return reject('WRONG_PROPERTY');
  if (v.status === 'REVOKED') return reject('REVOKED');
  if (v.status === 'SUSPENDED' || e.status === 'SUSPENDED') return reject('SUSPENDED');
  if (v.status === 'EXPIRED' || e.status === 'EXPIRED') return reject('EXPIRED');
  if (v.status === 'GENERATED') return reject('NOT_ISSUED');
  if (v.issuanceType === 'PAID' ? !v.paymentVerified : !v.issuanceAuthorized) {
    return reject(v.issuanceType === 'PAID' ? 'PAYMENT_UNVERIFIED' : 'ISSUANCE_UNAUTHORIZED');
  }
  if (e.status === 'REVOKED') return reject('REVOKED');
  if (e.expiresAt && hasExpired(now, e.expiresAt)) return reject('EXPIRED');

  const firstActivation = v.status === 'ISSUED';
  if (firstActivation && v.redeemBy && hasExpired(now, v.redeemBy)) {
    return reject('REDEMPTION_DEADLINE_PASSED');
  }
  if (v.scope !== 'INDIVIDUAL' && !input.requesterIsGroupMember) return reject('NOT_GROUP_MEMBER');

  if (input.device.alreadyBound) return { ok: true, action: 'REUSE_BOUND_DEVICE', firstActivation };
  if (v.status === 'EXHAUSTED' || e.boundDeviceCount >= e.maxDevices)
    return reject('DEVICE_LIMIT_REACHED');
  return { ok: true, action: 'BIND_NEW_DEVICE', firstActivation };
}

/** Portal states the tenant sees (spec §12). */
export type PublicRedemptionState =
  'INVALID_VOUCHER' | 'VOUCHER_EXHAUSTED' | 'EXPIRED' | 'SUSPENDED' | 'NOT_AUTHORIZED_FOR_GROUP';

/**
 * Map internal reasons to deliberately coarse public states so a guessed code
 * can't be distinguished from a revoked, unpaid, or other-property code.
 */
export function publicRedemptionState(reason: RedemptionRejection): PublicRedemptionState {
  switch (reason) {
    case 'DEVICE_LIMIT_REACHED':
      return 'VOUCHER_EXHAUSTED';
    case 'EXPIRED':
    case 'REDEMPTION_DEADLINE_PASSED':
      return 'EXPIRED';
    case 'SUSPENDED':
      return 'SUSPENDED';
    case 'NOT_GROUP_MEMBER':
      return 'NOT_AUTHORIZED_FOR_GROUP';
    case 'WRONG_PROPERTY':
    case 'NOT_ISSUED':
    case 'PAYMENT_UNVERIFIED':
    case 'ISSUANCE_UNAUTHORIZED':
    case 'REVOKED':
      return 'INVALID_VOUCHER';
  }
}
