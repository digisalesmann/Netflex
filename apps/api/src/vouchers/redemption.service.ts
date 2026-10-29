import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
import type { PrismaClient } from '@netflex/database';
import {
  addDuration,
  computeVoucherVerifier,
  evaluateRedemption,
  normalizeMac,
  normalizeVoucherCode,
  publicRedemptionState,
  snapshotFromJson,
  type PlanSnapshotJson,
  type PublicRedemptionState,
} from '@netflex/domain';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { CONFIG, PRISMA } from '../infra/tokens.js';

export const REDEEM_LIMITS = {
  /** Per client (device/IP as seen by the gateway). */
  perClient: { name: 'redeem-client', limit: 10, windowSeconds: 3600 },
  /** Whole-property ceiling; a burst of failures here signals guessing. */
  perProperty: { name: 'redeem-property', limit: 600, windowSeconds: 3600 },
} as const;

export interface RedeemInput {
  /** Property resolved by the server from the gateway/zone — never from the browser. */
  propertyId: string;
  code: string;
  /** Device MAC as reported by the gateway (Phase 6 makes this trusted). */
  macAddress: string;
  /** Signed-in tenant, if any (needed for room/floor group access). */
  userId: string | null;
  /** Rate-limit subject for this client. */
  clientKey: string;
}

export type RedeemResult =
  | {
      ok: true;
      state: 'ACCESS_BEING_CONFIGURED';
      entitlementId: string;
      firstActivation: boolean;
      reusedDevice: boolean;
      expiresAt: string | null;
    }
  | { ok: false; state: PublicRedemptionState };

/**
 * Voucher redemption (spec §8.4). The voucher row is locked (SELECT … FOR UPDATE)
 * for the whole decision, so concurrent requests can never bind more devices than
 * the plan allows. Errors are deliberately coarse (no "code exists" oracle).
 *
 * Not exposed as a public HTTP endpoint until the gateway integration (Phase 6)
 * supplies a trusted device identity and property; see docs/architecture/vouchers.md.
 */
@Injectable()
export class RedemptionService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: NetflexConfig,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async redeem(input: RedeemInput): Promise<RedeemResult> {
    await this.limits.hit(REDEEM_LIMITS.perClient, `${input.propertyId}:${input.clientKey}`);
    await this.limits.hit(REDEEM_LIMITS.perProperty, input.propertyId);

    const code = normalizeVoucherCode(input.code);
    const mac = normalizeMac(input.macAddress);
    if (!mac)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Device identity missing.');
    if (!code) return { ok: false, state: 'INVALID_VOUCHER' };
    const verifier = computeVoucherVerifier(this.config.VOUCHER_PEPPER, code);

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "vouchers" WHERE "verifier" = ${verifier} FOR UPDATE`;
      if (!locked[0]) return { ok: false, state: 'INVALID_VOUCHER' } as const;
      const v = await tx.voucher.findUniqueOrThrow({
        where: { id: locked[0].id },
        include: {
          order: {
            include: {
              payments: {
                where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } },
                select: { id: true },
              },
            },
          },
          entitlement: { include: { subscription: true } },
        },
      });
      const e = v.entitlement;
      if (!e) return { ok: false, state: 'INVALID_VOUCHER' } as const;

      const device = await tx.device.findUnique({
        where: { propertyId_macAddress: { propertyId: v.propertyId, macAddress: mac } },
      });
      const activeBindings = await tx.voucherRedemption.findMany({
        where: { entitlementId: e.id, releasedAt: null },
        select: { deviceId: true },
      });
      const alreadyBound = !!device && activeBindings.some((b) => b.deviceId === device.id);
      const isMember =
        input.userId !== null &&
        (await tx.groupMembership.count({
          where: { subscriptionId: e.subscriptionId, userId: input.userId, removedAt: null },
        })) > 0;

      const now = new Date();
      const decision = evaluateRedemption({
        now,
        requestPropertyId: input.propertyId,
        voucher: {
          status: v.status,
          propertyId: v.propertyId,
          scope: v.scope,
          issuanceType: v.issuanceType,
          paymentVerified: (v.order?.payments.length ?? 0) > 0,
          issuanceAuthorized: v.issuanceType !== 'PAID' && v.issuedById !== null && !!v.issueReason,
          redeemBy: v.redeemBy,
        },
        entitlement: {
          status: e.status,
          expiresAt: e.expiresAt,
          maxDevices: e.maxDevices,
          boundDeviceCount: activeBindings.length,
        },
        device: { alreadyBound },
        requesterIsGroupMember: isMember,
      });
      if (!decision.ok)
        return { ok: false, state: publicRedemptionState(decision.reason) } as const;

      if (decision.action === 'REUSE_BOUND_DEVICE') {
        await tx.device.update({
          where: { id: (device as { id: string }).id },
          data: { lastSeenAt: now },
        });
        return {
          ok: true,
          state: 'ACCESS_BEING_CONFIGURED',
          entitlementId: e.id,
          firstActivation: false,
          reusedDevice: true,
          expiresAt: e.expiresAt?.toISOString() ?? null,
        } as const;
      }

      const d = device
        ? await tx.device.update({
            where: { id: device.id },
            data: { lastSeenAt: now, userId: input.userId ?? device.userId },
          })
        : await tx.device.create({
            data: { propertyId: v.propertyId, macAddress: mac, userId: input.userId },
          });
      await tx.voucherRedemption.create({
        data: { voucherId: v.id, entitlementId: e.id, deviceId: d.id, userId: input.userId },
      });

      const bound = activeBindings.length + 1;
      const voucherUpdate: Record<string, unknown> = {};
      if (v.status === 'ISSUED')
        Object.assign(voucherUpdate, { status: 'ACTIVE', activatedAt: now });
      if (bound >= e.maxDevices) voucherUpdate.status = 'EXHAUSTED';
      if (Object.keys(voucherUpdate).length)
        await tx.voucher.update({ where: { id: v.id }, data: voucherUpdate });

      // Start the clock now only for ON_FIRST_REDEMPTION; ON_FIRST_AUTHORIZATION waits
      // for the gateway to confirm (Phase 6); ON_PURCHASE started at issue.
      let expiresAt = e.expiresAt;
      const entUpdate: Record<string, unknown> = { desiredNetworkState: 'ACTIVE' };
      if (e.status === 'PENDING_ACTIVATION') entUpdate.status = 'PROVISIONING';
      if (!e.startsAt && e.subscription.activationPolicy === 'ON_FIRST_REDEMPTION') {
        const plan = snapshotFromJson(e.subscription.planSnapshot as unknown as PlanSnapshotJson);
        const tz = (
          await tx.property.findUniqueOrThrow({
            where: { id: v.propertyId },
            select: { timeZone: true },
          })
        ).timeZone;
        expiresAt = addDuration(now, plan.duration, tz);
        Object.assign(entUpdate, { startsAt: now, expiresAt });
      }
      await tx.entitlement.update({ where: { id: e.id }, data: entUpdate });
      if (e.subscription.status === 'PENDING')
        await tx.subscription.update({
          where: { id: e.subscriptionId },
          data: { status: 'ACTIVE' },
        });

      // Durable hand-off to the worker; the network processor arrives with Phase 5/6.
      await tx.outboxEvent.create({
        data: {
          type: 'network.activate',
          aggregateType: 'entitlement',
          aggregateId: e.id,
          payload: { entitlementId: e.id, deviceId: d.id },
        },
      });
      await this.audit.record(tx, {
        actorType: input.userId ? 'USER' : 'SYSTEM',
        actorUserId: input.userId,
        propertyId: v.propertyId,
        action: 'voucher.redeemed',
        targetType: 'voucher',
        targetId: v.id,
        metadata: {
          entitlementId: e.id,
          deviceId: d.id,
          firstActivation: decision.firstActivation,
          boundDevices: bound,
        },
      });
      return {
        ok: true,
        state: 'ACCESS_BEING_CONFIGURED',
        entitlementId: e.id,
        firstActivation: decision.firstActivation,
        reusedDevice: false,
        expiresAt: expiresAt?.toISOString() ?? null,
      } as const;
    });
  }
}
