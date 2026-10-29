import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  LifecycleError,
  extendEntitlement,
  reactivateEntitlement,
  recordAudit,
  releaseDevice,
  removeMember,
  revokeEntitlement,
  suspendEntitlement,
  type Actor,
  type Tx,
} from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import { snapshotFromJson, type PlanDuration, type PlanSnapshotJson } from '@netflex/domain';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMetaValue } from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { notFound } from '../common/prisma-errors.js';
import { PRISMA } from '../infra/tokens.js';

/** Tenant self-service device releases allowed per entitlement per 24 h (assumption A11). */
export const SELF_RELEASES_PER_DAY = 3;

const conflict = (m: string) => new ApiError(HttpStatus.CONFLICT, 'CONFLICT', m);
const unprocessable = (m: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', m);

export function actorOf(auth: AuthContext, meta: RequestMetaValue): Actor {
  return { type: 'USER', userId: auth.user.id, correlationId: meta.requestId, ip: meta.ip };
}

/**
 * Entitlement lifecycle and room/floor group management (spec §7, §9). Staff
 * actions are scoped to a property; tenant actions are scoped to what the tenant
 * owns, manages or is a member of. Everything is audited with a reason.
 */
@Injectable()
export class LifecycleService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Run a core lifecycle step, translating its errors into API errors. */
  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      if (e instanceof LifecycleError)
        throw e.code === 'NOT_FOUND' ? notFound() : conflict(e.message);
      throw e;
    }
  }

  suspend(propertyId: string, id: string, actor: Actor, reason: string) {
    return this.run((tx) => suspendEntitlement(tx, propertyId, id, actor, reason));
  }
  reactivate(propertyId: string, id: string, actor: Actor, reason: string) {
    return this.run((tx) => reactivateEntitlement(tx, propertyId, id, actor, reason));
  }
  revoke(propertyId: string, id: string, actor: Actor, reason: string) {
    return this.run((tx) => revokeEntitlement(tx, propertyId, id, actor, reason));
  }
  async extend(propertyId: string, id: string, by: PlanDuration, actor: Actor, reason: string) {
    const tz = (
      await this.prisma.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { timeZone: true },
      })
    ).timeZone;
    return this.run((tx) => extendEntitlement(tx, propertyId, id, by, tz, actor, reason));
  }

  /** Staff release: no daily cap, reason required. */
  releaseByStaff(
    propertyId: string,
    entitlementId: string,
    redemptionId: string,
    actor: Actor,
    reason: string,
  ) {
    return this.run(async (tx) => {
      if (
        !(await tx.entitlement.findFirst({
          where: { id: entitlementId, propertyId },
          select: { id: true },
        }))
      )
        throw notFound();
      await releaseDevice(tx, entitlementId, redemptionId, actor, reason);
    });
  }

  /**
   * Tenant release: their own device, or any device if they own/manage the access.
   * Capped per day so a shared code can't be rotated endlessly between devices.
   */
  releaseByTenant(
    auth: AuthContext,
    meta: RequestMetaValue,
    entitlementId: string,
    redemptionId: string,
  ) {
    return this.run(async (tx) => {
      const view = await this.accessFor(tx, auth.user.id, entitlementId);
      const r = await tx.voucherRedemption.findFirst({
        where: { id: redemptionId, entitlementId, releasedAt: null },
      });
      if (!r) throw notFound();
      if (view.role === 'MEMBER' && r.userId !== auth.user.id) throw notFound();
      const recent = await tx.voucherRedemption.count({
        where: { entitlementId, releasedAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
      });
      if (recent >= SELF_RELEASES_PER_DAY) {
        throw new ApiError(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          'You have changed devices too often today. Contact the property office if you need help.',
        );
      }
      await releaseDevice(
        tx,
        entitlementId,
        redemptionId,
        actorOf(auth, meta),
        'released by tenant',
      );
    });
  }

  // ================================================================ groups

  /**
   * Add a housemate to room/floor access. They must be a registered tenant who
   * currently lives in that room (ROOM) or on that floor (FLOOR), within the plan's cap.
   */
  async addMember(tx: Tx, entitlementId: string, phone: string, actor: Actor, propertyId?: string) {
    const e = await tx.entitlement.findFirst({
      where: { id: entitlementId, ...(propertyId ? { propertyId } : {}) },
      include: { subscription: true },
    });
    if (!e) throw notFound();
    if (e.scope === 'INDIVIDUAL') throw unprocessable('Individual access cannot be shared.');
    if (['EXPIRED', 'REVOKED'].includes(e.status)) throw conflict('This access has ended.');
    const user = await tx.user.findFirst({
      where: {
        phoneE164: phone,
        kind: 'TENANT',
        status: 'ACTIVE',
        assignments: {
          some: {
            propertyId: e.propertyId,
            endsAt: null,
            ...(e.scope === 'ROOM'
              ? { roomId: e.targetRoomId as string }
              : { room: { floorId: e.targetFloorId as string } }),
          },
        },
      },
      select: { id: true },
    });
    if (!user)
      throw unprocessable(
        `This person must be a registered tenant currently living ${e.scope === 'ROOM' ? 'in this room' : 'on this floor'}.`,
      );
    const active = await tx.groupMembership.findMany({
      where: { subscriptionId: e.subscriptionId, removedAt: null },
      select: { userId: true },
    });
    if (active.some((m) => m.userId === user.id))
      throw conflict('This person is already a member.');
    const cap =
      snapshotFromJson(e.subscription.planSnapshot as unknown as PlanSnapshotJson)
        .maxGroupMembers ?? 0;
    if (active.length >= cap) throw unprocessable(`This plan allows at most ${cap} members.`);
    const m = await tx.groupMembership.create({
      data: {
        subscriptionId: e.subscriptionId,
        userId: user.id,
        role: 'MEMBER',
        addedById: actor.userId ?? user.id,
      },
    });
    await recordAudit(tx, {
      actorType: actor.type,
      actorUserId: actor.userId,
      propertyId: e.propertyId,
      action: 'group.member_added',
      targetType: 'entitlement',
      targetId: e.id,
      correlationId: actor.correlationId ?? null,
      ipAddress: actor.ip ?? null,
      metadata: { userId: user.id, membershipId: m.id },
    });
    return { membershipId: m.id, userId: user.id };
  }

  /** Hand the manager role to another active member (or any resident added first). */
  async transferManager(
    tx: Tx,
    entitlementId: string,
    toUserId: string,
    actor: Actor,
    reason: string,
    propertyId?: string,
  ) {
    const e = await tx.entitlement.findFirst({
      where: { id: entitlementId, ...(propertyId ? { propertyId } : {}) },
    });
    if (!e) throw notFound();
    const target = await tx.groupMembership.findFirst({
      where: { subscriptionId: e.subscriptionId, userId: toUserId, removedAt: null },
    });
    if (!target) throw unprocessable('The new manager must already be a member.');
    await tx.groupMembership.updateMany({
      where: { subscriptionId: e.subscriptionId, removedAt: null, role: 'MANAGER' },
      data: { role: 'MEMBER' },
    });
    await tx.groupMembership.update({ where: { id: target.id }, data: { role: 'MANAGER' } });
    await tx.subscription.update({
      where: { id: e.subscriptionId },
      data: { ownerUserId: toUserId },
    });
    await recordAudit(tx, {
      actorType: actor.type,
      actorUserId: actor.userId,
      propertyId: e.propertyId,
      action: 'group.manager_transferred',
      targetType: 'entitlement',
      targetId: e.id,
      reason,
      correlationId: actor.correlationId ?? null,
      ipAddress: actor.ip ?? null,
      metadata: { toUserId },
    });
  }

  removeMemberChecked(
    tx: Tx,
    entitlementId: string,
    membershipId: string,
    actor: Actor,
    reason: string,
    propertyId?: string,
  ) {
    return (async () => {
      const m = await tx.groupMembership.findFirst({
        where: {
          id: membershipId,
          removedAt: null,
          subscription: {
            entitlement: { id: entitlementId, ...(propertyId ? { propertyId } : {}) },
          },
        },
      });
      if (!m) throw notFound();
      if (m.role === 'MANAGER')
        throw conflict('Transfer the manager role before removing the manager.');
      await removeMember(tx, m.id, actor, reason);
    })();
  }

  // ================================================================ tenant views

  /** What the tenant may do with this entitlement. Anything else is "not found". */
  async accessFor(tx: Tx | PrismaClient, userId: string, entitlementId: string) {
    const e = await tx.entitlement.findUnique({
      where: { id: entitlementId },
      include: {
        subscription: { include: { memberships: { where: { userId, removedAt: null } } } },
      },
    });
    if (!e) throw notFound();
    const membership = e.subscription.memberships[0];
    const role: 'OWNER' | 'MANAGER' | 'MEMBER' | null =
      e.scope === 'INDIVIDUAL'
        ? e.targetUserId === userId || e.subscription.ownerUserId === userId
          ? 'OWNER'
          : null
        : membership
          ? membership.role
          : null;
    if (!role) throw notFound();
    return { entitlement: e, role };
  }

  /** The tenant's access list with truthful statuses (spec §16). */
  async myAccess(userId: string) {
    const recent = new Date(Date.now() - 30 * 24 * 3600_000);
    const rows = await this.prisma.entitlement.findMany({
      where: {
        AND: [
          { OR: [{ status: { notIn: ['EXPIRED', 'REVOKED'] } }, { updatedAt: { gt: recent } }] },
          {
            OR: [
              {
                scope: 'INDIVIDUAL',
                OR: [{ targetUserId: userId }, { subscription: { ownerUserId: userId } }],
              },
              {
                scope: { not: 'INDIVIDUAL' },
                subscription: { memberships: { some: { userId, removedAt: null } } },
              },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        property: { select: { name: true, timeZone: true } },
        subscription: {
          include: {
            planVersion: { select: { planId: true } },
            memberships: {
              where: { removedAt: null },
              include: { user: { select: { id: true, displayName: true, phoneE164: true } } },
            },
          },
        },
        vouchers: {
          where: { status: { notIn: ['REVOKED'] } },
          select: { hint: true, status: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        redemptions: {
          where: { releasedAt: null },
          select: {
            id: true,
            userId: true,
            redeemedAt: true,
            device: { select: { macAddress: true, label: true } },
          },
        },
      },
    });
    const now = Date.now();
    return rows.map((e) => {
      const me = e.subscription.memberships.find((m) => m.userId === userId);
      const role = e.scope === 'INDIVIDUAL' ? 'OWNER' : (me?.role ?? 'MEMBER');
      const plan = snapshotFromJson(e.subscription.planSnapshot as unknown as PlanSnapshotJson);
      const fmt = (d: Date | null) =>
        d
          ? new Intl.DateTimeFormat('en-NG', {
              timeZone: e.property.timeZone,
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(d)
          : null;
      const remaining = e.expiresAt
        ? Math.max(0, Math.floor((e.expiresAt.getTime() - now) / 1000))
        : null;
      const seesAll = role !== 'MEMBER';
      return {
        entitlementId: e.id,
        planId: e.subscription.planVersion.planId,
        property: e.property.name,
        planName: plan.name,
        scope: e.scope,
        role,
        myMembershipId: me?.id ?? null,
        state: accessState(e.status, e.observedNetworkState, remaining),
        startsAt: e.startsAt?.toISOString() ?? null,
        expiresAt: e.expiresAt?.toISOString() ?? null,
        expiresAtLocal: fmt(e.expiresAt),
        activateBy: fmt(e.activationDeadline),
        remainingSeconds: remaining,
        voucherHint: e.vouchers[0]?.hint ?? null,
        devices: {
          limit: e.maxDevices,
          inUse: e.redemptions.length,
          list: e.redemptions
            .filter((r) => seesAll || r.userId === userId)
            .map((r) => ({
              redemptionId: r.id,
              mine: r.userId === userId,
              since: r.redeemedAt.toISOString(),
              label: r.device.label,
              macSuffix: r.device.macAddress.slice(-5),
            })),
        },
        members:
          role === 'MANAGER'
            ? e.subscription.memberships.map((m) => ({
                membershipId: m.id,
                userId: m.user.id,
                name: m.user.displayName,
                phoneSuffix: (m.user.phoneE164 ?? '').slice(-4),
                role: m.role,
              }))
            : undefined,
        // Real counters arrive only with the gateway integration; never invented.
        usage: { available: false, note: 'Usage statistics are not available yet.' },
      };
    });
  }
}

/** Customer-facing status that never claims a connection the gateway hasn't confirmed. */
export function accessState(
  status: string,
  observed: string | null,
  remainingSeconds: number | null,
): string {
  switch (status) {
    case 'PENDING_ACTIVATION':
      return 'VOUCHER_AVAILABLE';
    case 'PROVISIONING':
      return 'ACCESS_BEING_CONFIGURED';
    case 'PROVISIONING_FAILED':
      return 'PROVISIONING_NEEDS_ATTENTION';
    case 'ACTIVE':
      if (observed !== 'ACTIVE') return 'ACCESS_BEING_CONFIGURED';
      return remainingSeconds !== null && remainingSeconds < 24 * 3600 ? 'EXPIRING_SOON' : 'ACTIVE';
    case 'SUSPENDED':
      return 'ACCESS_SUSPENDED';
    case 'EXPIRED':
      return 'SUBSCRIPTION_EXPIRED';
    case 'REVOKED':
      return 'ACCESS_REVOKED';
    default:
      return 'UNKNOWN';
  }
}
