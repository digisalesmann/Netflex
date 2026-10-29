import type { Prisma, PrismaClient } from '@netflex/database';
import {
  DomainError,
  addDuration,
  entitlementStateMachine,
  type EntitlementStatus,
  type PlanDuration,
} from '@netflex/domain';
import { recordAudit, type Tx } from './audit.js';

export type NetworkCommand =
  | 'network.activate'
  | 'network.suspend'
  | 'network.revoke'
  | 'network.disconnect'
  | 'network.apply_policy';

export interface Actor {
  type: 'USER' | 'SYSTEM';
  userId: string | null;
  correlationId?: string | null;
  ip?: string | null;
}

const LIVE: EntitlementStatus[] = [
  'PENDING_ACTIVATION',
  'PROVISIONING',
  'PROVISIONING_FAILED',
  'ACTIVE',
  'SUSPENDED',
];

/** Queue a gateway instruction (consumed by the network processor, Phase 6). */
export function queueNetwork(
  tx: Tx,
  type: NetworkCommand,
  entitlementId: string,
  extra: Record<string, unknown> = {},
) {
  return tx.outboxEvent.create({
    data: {
      type,
      aggregateType: 'entitlement',
      aggregateId: entitlementId,
      payload: { entitlementId, ...extra } as Prisma.InputJsonValue,
    },
  });
}

/** Lock an entitlement row for the rest of the transaction. */
export async function lockEntitlement(tx: Tx, entitlementId: string, propertyId?: string) {
  const rows = propertyId
    ? await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "entitlements" WHERE "id" = ${entitlementId}::uuid AND "propertyId" = ${propertyId}::uuid FOR UPDATE`
    : await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "entitlements" WHERE "id" = ${entitlementId}::uuid FOR UPDATE`;
  if (!rows[0]) return null;
  return tx.entitlement.findUniqueOrThrow({
    where: { id: entitlementId },
    include: { subscription: true },
  });
}

async function transition(
  tx: Tx,
  id: string,
  from: EntitlementStatus,
  to: EntitlementStatus,
  data: Prisma.EntitlementUncheckedUpdateManyInput = {},
) {
  entitlementStateMachine.assertTransition(from, to);
  const r = await tx.entitlement.updateMany({
    where: { id, status: from },
    data: { ...data, status: to },
  });
  if (r.count !== 1)
    throw new DomainError('INVALID_STATE_TRANSITION', 'Entitlement changed concurrently', { id });
}

function audit(
  tx: Tx,
  actor: Actor,
  propertyId: string,
  action: string,
  entitlementId: string,
  reason: string | null,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(tx, {
    actorType: actor.type,
    actorUserId: actor.userId,
    propertyId,
    action,
    targetType: 'entitlement',
    targetId: entitlementId,
    reason,
    correlationId: actor.correlationId ?? null,
    ipAddress: actor.ip ?? null,
    metadata,
  });
}

/** End an entitlement for good (expired or revoked): vouchers stop working and the gateway is told to remove access. */
async function terminate(
  tx: Tx,
  e: { id: string; status: EntitlementStatus; subscriptionId: string; desiredNetworkState: string },
  to: 'EXPIRED' | 'REVOKED',
  voucherReason: string,
) {
  await transition(tx, e.id, e.status, to, { desiredNetworkState: 'REVOKED' });
  const now = new Date();
  await tx.voucher.updateMany({
    where: { entitlementId: e.id, status: { notIn: ['REVOKED', 'EXPIRED'] } },
    data:
      to === 'REVOKED'
        ? { status: 'REVOKED', revokedAt: now, revokeReason: voucherReason }
        : { status: 'EXPIRED' },
  });
  await tx.voucherDelivery.deleteMany({ where: { voucher: { entitlementId: e.id } } });
  await tx.subscription.updateMany({
    where: { id: e.subscriptionId, status: { in: ['PENDING', 'ACTIVE'] } },
    data: { status: to },
  });
  if (e.desiredNetworkState === 'ACTIVE' || e.desiredNetworkState === 'SUSPENDED') {
    await queueNetwork(tx, 'network.revoke', e.id, { reason: to.toLowerCase() });
  }
}

/**
 * Expire everything due, using DATABASE time (spec §9: trusted time) and the
 * half-open rule (expired once now() >= expiresAt). Also expires vouchers never
 * activated before their deadline. Safe to run concurrently (SKIP LOCKED) and
 * repeatedly; each entitlement is expired exactly once.
 */
export async function expireDue(
  prisma: PrismaClient,
  batch = 200,
  /** Tests only: evaluate as of this instant. Production always uses database now(). */
  asOf?: Date,
): Promise<{ expired: number; deadlinesMissed: number }> {
  let expired = 0;
  let deadlinesMissed = 0;
  for (;;) {
    const n = await prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string; kind: 'EXPIRY' | 'DEADLINE' }[]>`
        SELECT "id", CASE WHEN "status" = 'PENDING_ACTIVATION' THEN 'DEADLINE' ELSE 'EXPIRY' END AS "kind"
        FROM "entitlements"
        WHERE ("status" IN ('ACTIVE', 'SUSPENDED', 'PROVISIONING', 'PROVISIONING_FAILED') AND "expiresAt" IS NOT NULL AND "expiresAt" <= COALESCE(${asOf ?? null}::timestamptz, now()))
           OR ("status" = 'PENDING_ACTIVATION' AND (
                ("activationDeadline" IS NOT NULL AND "activationDeadline" <= COALESCE(${asOf ?? null}::timestamptz, now()))
             OR ("expiresAt" IS NOT NULL AND "expiresAt" <= COALESCE(${asOf ?? null}::timestamptz, now()))))
        ORDER BY "expiresAt" NULLS LAST
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED`;
      for (const d of due) {
        const e = await tx.entitlement.findUniqueOrThrow({ where: { id: d.id } });
        await terminate(tx, e, 'EXPIRED', 'expired');
        await audit(
          tx,
          { type: 'SYSTEM', userId: null },
          e.propertyId,
          d.kind === 'DEADLINE' ? 'entitlement.activation_deadline_passed' : 'entitlement.expired',
          e.id,
          null,
          {
            expiresAt: e.expiresAt?.toISOString() ?? null,
            activationDeadline: e.activationDeadline?.toISOString() ?? null,
          },
        );
        if (d.kind === 'DEADLINE') deadlinesMissed++;
        else expired++;
      }
      return due.length;
    });
    if (n < batch) break;
  }
  return { expired, deadlinesMissed };
}

export class LifecycleError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'LifecycleError';
  }
}

const notFound = () => new LifecycleError('NOT_FOUND', 'Not found.');

/**
 * Suspend access. The time-based clock keeps running (it is a time product);
 * staff can extend afterwards to compensate. Access that hasn't started has no
 * window to suspend — suspend its voucher instead.
 */
export async function suspendEntitlement(
  tx: Tx,
  propertyId: string,
  entitlementId: string,
  actor: Actor,
  reason: string,
) {
  const e = await lockEntitlement(tx, entitlementId, propertyId);
  if (!e) throw notFound();
  if (!e.expiresAt)
    throw new LifecycleError(
      'CONFLICT',
      'This access has not started yet. Suspend its voucher instead.',
    );
  if (!entitlementStateMachine.canTransition(e.status, 'SUSPENDED'))
    throw new LifecycleError(
      'CONFLICT',
      `Access that is ${e.status.toLowerCase()} cannot be suspended.`,
    );
  await transition(tx, e.id, e.status, 'SUSPENDED', { desiredNetworkState: 'SUSPENDED' });
  await queueNetwork(tx, 'network.suspend', e.id);
  await audit(tx, actor, propertyId, 'entitlement.suspended', e.id, reason, { from: e.status });
}

export async function reactivateEntitlement(
  tx: Tx,
  propertyId: string,
  entitlementId: string,
  actor: Actor,
  reason: string,
) {
  const e = await lockEntitlement(tx, entitlementId, propertyId);
  if (!e) throw notFound();
  if (e.status !== 'SUSPENDED')
    throw new LifecycleError('CONFLICT', 'Only suspended access can be reactivated.');
  if (e.expiresAt && e.expiresAt <= new Date())
    throw new LifecycleError('CONFLICT', 'This access has already expired.');
  await transition(tx, e.id, 'SUSPENDED', 'PROVISIONING', { desiredNetworkState: 'ACTIVE' });
  await queueNetwork(tx, 'network.activate', e.id);
  await audit(tx, actor, propertyId, 'entitlement.reactivated', e.id, reason);
}

export async function revokeEntitlement(
  tx: Tx,
  propertyId: string,
  entitlementId: string,
  actor: Actor,
  reason: string,
) {
  const e = await lockEntitlement(tx, entitlementId, propertyId);
  if (!e) throw notFound();
  if (!LIVE.includes(e.status))
    throw new LifecycleError(
      'CONFLICT',
      `Access that is ${e.status.toLowerCase()} cannot be revoked.`,
    );
  await terminate(tx, e, 'REVOKED', reason);
  await audit(tx, actor, propertyId, 'entitlement.revoked', e.id, reason, { from: e.status });
}

/**
 * Extend validity (never shortens). Started access gets a later expiry; access
 * not started yet gets a later activation deadline (and voucher redeem-by).
 */
export async function extendEntitlement(
  tx: Tx,
  propertyId: string,
  entitlementId: string,
  by: PlanDuration,
  timeZone: string,
  actor: Actor,
  reason: string,
) {
  const e = await lockEntitlement(tx, entitlementId, propertyId);
  if (!e) throw notFound();
  if (!LIVE.includes(e.status))
    throw new LifecycleError(
      'CONFLICT',
      'Ended access cannot be extended. Issue new access instead.',
    );
  if (e.expiresAt) {
    const base = e.expiresAt > new Date() ? e.expiresAt : new Date();
    const next = addDuration(base, by, timeZone);
    await tx.entitlement.update({ where: { id: e.id }, data: { expiresAt: next } });
    if (e.desiredNetworkState === 'ACTIVE')
      await queueNetwork(tx, 'network.apply_policy', e.id, { reason: 'extended' });
    await audit(tx, actor, propertyId, 'entitlement.extended', e.id, reason, {
      from: e.expiresAt.toISOString(),
      to: next.toISOString(),
      by,
    });
    return { expiresAt: next, activationDeadline: e.activationDeadline };
  }
  const base =
    e.activationDeadline && e.activationDeadline > new Date() ? e.activationDeadline : new Date();
  const next = addDuration(base, by, timeZone);
  await tx.entitlement.update({ where: { id: e.id }, data: { activationDeadline: next } });
  await tx.voucher.updateMany({
    where: { entitlementId: e.id, status: { in: ['ISSUED', 'SUSPENDED'] } },
    data: { redeemBy: next },
  });
  await audit(tx, actor, propertyId, 'entitlement.deadline_extended', e.id, reason, {
    from: e.activationDeadline?.toISOString() ?? null,
    to: next.toISOString(),
    by,
  });
  return { expiresAt: null, activationDeadline: next };
}

/**
 * Free a device slot on an entitlement (lost/replaced phone, randomized MAC).
 * The device is disconnected at the gateway; an exhausted voucher reopens.
 */
export async function releaseDevice(
  tx: Tx,
  entitlementId: string,
  redemptionId: string,
  actor: Actor,
  reason: string,
) {
  const r = await tx.voucherRedemption.findFirst({
    where: { id: redemptionId, entitlementId, releasedAt: null },
    include: { entitlement: true },
  });
  if (!r) throw notFound();
  await tx.voucherRedemption.update({ where: { id: r.id }, data: { releasedAt: new Date() } });
  await tx.voucher.updateMany({
    where: { entitlementId, status: 'EXHAUSTED' },
    data: { status: 'ACTIVE' },
  });
  await queueNetwork(tx, 'network.disconnect', entitlementId, { deviceId: r.deviceId });
  await audit(
    tx,
    actor,
    r.entitlement.propertyId,
    'entitlement.device_released',
    entitlementId,
    reason,
    { redemptionId: r.id, deviceId: r.deviceId },
  );
}

/**
 * Remove a person from a room/floor group: membership ends and every device
 * they bound to that access is released and disconnected.
 */
export async function removeMember(tx: Tx, membershipId: string, actor: Actor, reason: string) {
  const m = await tx.groupMembership.findFirst({
    where: { id: membershipId, removedAt: null },
    include: { subscription: { include: { entitlement: true } } },
  });
  if (!m) throw notFound();
  await tx.groupMembership.update({
    where: { id: m.id },
    data: { removedAt: new Date(), removedById: actor.userId },
  });
  const e = m.subscription.entitlement;
  if (e) {
    const bindings = await tx.voucherRedemption.findMany({
      where: { entitlementId: e.id, userId: m.userId, releasedAt: null },
    });
    for (const b of bindings) {
      await tx.voucherRedemption.update({ where: { id: b.id }, data: { releasedAt: new Date() } });
      await queueNetwork(tx, 'network.disconnect', e.id, { deviceId: b.deviceId });
    }
    if (bindings.length)
      await tx.voucher.updateMany({
        where: { entitlementId: e.id, status: 'EXHAUSTED' },
        data: { status: 'ACTIVE' },
      });
    await audit(tx, actor, e.propertyId, 'group.member_removed', e.id, reason, {
      userId: m.userId,
      role: m.role,
      devicesReleased: bindings.length,
    });
  }
}
