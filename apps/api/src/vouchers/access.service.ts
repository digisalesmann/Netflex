import { Inject, Injectable } from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
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
import type { Tx } from '../audit/audit.service.js';
import { CONFIG } from '../infra/tokens.js';

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
  /** Plaintext code: return to the customer ONCE; never log or store. */
  code: VoucherCode;
  hint: string;
  redeemBy: Date | null;
}

/**
 * Creates the access chain for one purchase or issuance (spec §8.5): a
 * Subscription (contract + immutable plan snapshot), an Entitlement (what the
 * network should allow) and a Voucher (the credential, stored only as a keyed
 * verifier). Used by admin issuance now and by verified payments in Phase 4.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(CONFIG) private readonly config: NetflexConfig) {}

  async grant(tx: Tx, input: GrantAccessInput): Promise<GrantedAccess> {
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
    // ON_PURCHASE: the clock starts now (must be disclosed before checkout).
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
            verifier: computeVoucherVerifier(this.config.VOUCHER_PEPPER, code),
            verifierKeyVersion: this.config.VOUCHER_PEPPER_VERSION,
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
        // A verifier collision is astronomically unlikely (2^59 codes); retry with a new code anyway.
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          continue;
        throw e;
      }
    }
  }

  /** New credential for an existing entitlement (lost code). The old voucher must already be revoked. */
  async reissue(
    tx: Tx,
    old: {
      id: string;
      propertyId: string;
      scope: 'INDIVIDUAL' | 'ROOM' | 'FLOOR';
      issuanceType: IssuanceType;
      orderId: string | null;
      entitlementId: string | null;
      redeemBy: Date | null;
      status: string;
    },
    actorId: string,
    reason: string,
  ) {
    const code = generateVoucherCode();
    const v = await tx.voucher.create({
      data: {
        propertyId: old.propertyId,
        verifier: computeVoucherVerifier(this.config.VOUCHER_PEPPER, code),
        verifierKeyVersion: this.config.VOUCHER_PEPPER_VERSION,
        hint: voucherHint(code),
        status: 'ISSUED',
        issuanceType: old.issuanceType,
        scope: old.scope,
        orderId: old.orderId,
        entitlementId: old.entitlementId,
        // Non-paid vouchers need an issuer + reason; paid reissues record them too.
        issuedById: actorId,
        issueReason: `reissue: ${reason}`,
        redeemBy: old.redeemBy,
        replacesVoucherId: old.id,
        issuedAt: new Date(),
      },
    });
    return { voucherId: v.id, code, hint: v.hint };
  }
}
