import { Prisma } from '@netflex/database';
import {
  addDuration,
  computeVoucherVerifier,
  generateVoucherCode,
  snapshotToJson,
  voucherHint,
  type IssuanceType,
  type PlanVersionSnapshot,
  type ScopeTarget,
  type VoucherCode,
} from '@netflex/domain';
import type { Tx } from './audit.js';

export interface VoucherKeys {
  pepper: string;
  pepperVersion: number;
}

export interface GrantAccessInput {
  propertyId: string;
  timeZone: string;
  plan: PlanVersionSnapshot;
  target: ScopeTarget | { scope: 'INDIVIDUAL'; userId: null };
  ownerUserId: string | null;
  orderId: string | null;
  issuance: { type: IssuanceType; issuedById: string | null; reason: string | null };
  now: Date;
}

export interface GrantedAccess {
  subscriptionId: string;
  entitlementId: string;
  voucherId: string;
  /** Plaintext code: hand to the customer once; never log or store unencrypted. */
  code: VoucherCode;
  hint: string;
  redeemBy: Date | null;
}

/**
 * Create the access chain for one purchase or issuance (spec §8.5): Subscription
 * (contract + immutable plan snapshot), Entitlement (what the network should
 * allow) and Voucher (credential stored only as a keyed verifier).
 */
export async function grantAccess(
  tx: Tx,
  keys: VoucherKeys,
  input: GrantAccessInput,
): Promise<GrantedAccess> {
  const { plan, target, now } = input;
  const targetCols = {
    targetUserId: target.scope === 'INDIVIDUAL' ? target.userId : null,
    targetRoomId: target.scope === 'ROOM' ? target.roomId : null,
    targetFloorId: target.scope === 'FLOOR' ? target.floorId : null,
  };
  const subscription = await tx.subscription.create({
    data: {
      propertyId: input.propertyId,
      orderId: input.orderId,
      planVersionId: plan.planVersionId,
      planSnapshot: snapshotToJson(plan) as unknown as Prisma.InputJsonValue,
      scope: plan.scope,
      ownerUserId: input.ownerUserId,
      ...targetCols,
      activationPolicy: plan.activationPolicy,
    },
  });

  const deadline = plan.redemptionWindow
    ? addDuration(now, plan.redemptionWindow, input.timeZone)
    : null;
  const window =
    plan.activationPolicy === 'ON_PURCHASE'
      ? { startsAt: now, expiresAt: addDuration(now, plan.duration, input.timeZone) }
      : { startsAt: null, expiresAt: null };
  const entitlement = await tx.entitlement.create({
    data: {
      propertyId: input.propertyId,
      subscriptionId: subscription.id,
      scope: plan.scope,
      ...targetCols,
      activationDeadline: deadline,
      ...window,
      maxDevices: plan.maxDevices,
      maxConcurrentSessions: plan.maxConcurrentSessions,
      downloadKbps: plan.rate.downloadKbps,
      uploadKbps: plan.rate.uploadKbps,
    },
  });

  for (let attempt = 0; ; attempt++) {
    const code = generateVoucherCode();
    try {
      const voucher = await tx.voucher.create({
        data: {
          propertyId: input.propertyId,
          verifier: computeVoucherVerifier(keys.pepper, code),
          verifierKeyVersion: keys.pepperVersion,
          hint: voucherHint(code),
          status: 'ISSUED',
          issuanceType: input.issuance.type,
          scope: plan.scope,
          orderId: input.orderId,
          entitlementId: entitlement.id,
          issuedById: input.issuance.issuedById,
          issueReason: input.issuance.reason,
          redeemBy: deadline,
          issuedAt: now,
        },
      });
      return {
        subscriptionId: subscription.id,
        entitlementId: entitlement.id,
        voucherId: voucher.id,
        code,
        hint: voucher.hint,
        redeemBy: deadline,
      };
    } catch (e) {
      if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        continue;
      throw e;
    }
  }
}
