import type { Gateway, Prisma, PrismaClient } from '@netflex/database';
import {
  addDuration,
  entitlementStateMachine,
  snapshotFromJson,
  type PlanSnapshotJson,
} from '@netflex/domain';
import {
  diffEntitlement,
  type DesiredEntitlement,
  type NetworkAdapter,
  type OperationResult,
} from '@netflex/network';
import { recordAudit, type Tx } from './audit.js';
import { queueNetwork, type NetworkCommand } from './entitlements.js';

/** Turns a gateway row into an adapter. Returns null when no adapter exists for that vendor yet. */
export interface AdapterRegistry {
  forGateway(gateway: Gateway): NetworkAdapter | null;
}

export const NETWORK_MAX_ATTEMPTS = 8;

const OP_TYPE: Record<
  NetworkCommand,
  'ACTIVATE' | 'SUSPEND' | 'REVOKE' | 'DISCONNECT' | 'APPLY_POLICY'
> = {
  'network.activate': 'ACTIVATE',
  'network.suspend': 'SUSPEND',
  'network.revoke': 'REVOKE',
  'network.disconnect': 'DISCONNECT',
  'network.apply_policy': 'APPLY_POLICY',
};

export type NetworkOutcome = 'SUCCEEDED' | 'RETRY' | 'FAILED' | 'NO_GATEWAY' | 'SKIPPED';

/** Thrown so the job runner retries with backoff. The operation row already records the attempt. */
export class RetryableNetworkError extends Error {
  constructor(
    public readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'RetryableNetworkError';
  }
}

/**
 * Applies entitlement state to gateways (spec §11.2): durable operation records,
 * desired state always recomputed from the database (so retries and out-of-order
 * commands converge), post-mutation read-back verification, bounded retries,
 * and no "connected" claim unless the gateway confirms it.
 */
export class NetworkEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: AdapterRegistry,
  ) {}

  /** The single source of what the gateway SHOULD enforce for an entitlement. */
  async desiredFor(
    tx: Tx | PrismaClient,
    entitlementId: string,
  ): Promise<DesiredEntitlement | null> {
    const e = await tx.entitlement.findUnique({
      where: { id: entitlementId },
      include: {
        subscription: { select: { planSnapshot: true } },
        redemptions: {
          where: { releasedAt: null },
          select: { device: { select: { macAddress: true } } },
        },
        property: {
          select: { zones: { select: { identifier: true, roomId: true, floorId: true } } },
        },
      },
    });
    if (!e) return null;
    const plan = snapshotFromJson(e.subscription.planSnapshot as unknown as PlanSnapshotJson);
    const ended =
      e.status === 'EXPIRED' ||
      e.status === 'REVOKED' ||
      e.desiredNetworkState === 'REVOKED' ||
      e.desiredNetworkState === 'NONE';
    const zones = e.property.zones
      .filter(
        (z) =>
          (e.scope === 'ROOM' && z.roomId === e.targetRoomId) ||
          (e.scope === 'FLOOR' && z.floorId === e.targetFloorId),
      )
      .map((z) => z.identifier);
    return {
      entitlementId: e.id,
      state: ended
        ? 'REVOKED'
        : e.desiredNetworkState === 'SUSPENDED' || e.status === 'SUSPENDED'
          ? 'SUSPENDED'
          : 'ACTIVE',
      devices: e.redemptions.map((r) => r.device.macAddress).sort(),
      policy: {
        downloadKbps: e.downloadKbps,
        uploadKbps: e.uploadKbps,
        maxConcurrentSessions: e.maxConcurrentSessions,
        expiresAt: e.expiresAt?.toISOString() ?? null,
        maxSessionSeconds: Math.floor(
          addDuration(new Date(0), plan.duration, 'UTC').getTime() / 1000,
        ),
      },
      zones,
    };
  }

  private async gatewayFor(propertyId: string) {
    const gw = await this.prisma.gateway.findFirst({
      where: { propertyId, status: { not: 'DISABLED' } },
      orderBy: { createdAt: 'asc' },
    });
    if (!gw) return null;
    return { gw, adapter: this.registry.forGateway(gw) };
  }

  /** Entry point for outbox-driven commands. Idempotent per outbox event. */
  async processCommand(
    outboxEventId: string,
    type: NetworkCommand,
    payload: { entitlementId?: unknown; deviceId?: unknown },
  ): Promise<NetworkOutcome> {
    const entitlementId = typeof payload.entitlementId === 'string' ? payload.entitlementId : null;
    if (!entitlementId) return 'SKIPPED';
    const e = await this.prisma.entitlement.findUnique({
      where: { id: entitlementId },
      select: { propertyId: true },
    });
    if (!e) return 'SKIPPED';
    const op = await this.prisma.networkOperation.upsert({
      where: { idempotencyKey: `outbox:${outboxEventId}` },
      create: {
        idempotencyKey: `outbox:${outboxEventId}`,
        propertyId: e.propertyId,
        entitlementId,
        type: OP_TYPE[type],
        desiredState: {
          command: type,
          deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : null,
        } as Prisma.InputJsonValue,
        maxAttempts: NETWORK_MAX_ATTEMPTS,
      },
      update: {},
    });
    return this.processOperation(op.id);
  }

  /** Run one operation attempt (also used for authorized manual replay). */
  async processOperation(operationId: string): Promise<NetworkOutcome> {
    const claimed = await this.prisma.networkOperation.updateMany({
      where: { id: operationId, status: { in: ['PENDING', 'RETRY_SCHEDULED'] } },
      data: { status: 'IN_PROGRESS', attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return 'SKIPPED';
    const op = await this.prisma.networkOperation.findUniqueOrThrow({ where: { id: operationId } });
    const meta = op.desiredState as { command?: string; deviceId?: string | null };

    const target = await this.gatewayFor(op.propertyId);
    if (!target || !target.adapter) {
      await this.finish(
        op.id,
        'FAILED',
        target ? 'ADAPTER_NOT_IMPLEMENTED' : 'NO_GATEWAY_CONFIGURED',
        target
          ? `no adapter for vendor ${target.gw.vendor}`
          : 'no gateway registered for this property',
        null,
      );
      return 'NO_GATEWAY';
    }
    const { gw, adapter } = target;
    await this.prisma.networkOperation.update({ where: { id: op.id }, data: { gatewayId: gw.id } });
    if (!op.entitlementId) {
      await this.finish(op.id, 'FAILED', 'NO_TARGET', 'operation has no entitlement', null);
      return 'FAILED';
    }
    const desired = await this.desiredFor(this.prisma, op.entitlementId);
    if (!desired) {
      await this.finish(op.id, 'FAILED', 'NOT_FOUND', 'entitlement not found', null);
      return 'FAILED';
    }

    // 1. Mutate.
    let result: OperationResult;
    if (op.type === 'DISCONNECT' && meta.deviceId) {
      const device = await this.prisma.device.findUnique({
        where: { id: meta.deviceId },
        select: { macAddress: true },
      });
      result = device
        ? await adapter.disconnectDevice(op.entitlementId, device.macAddress)
        : { ok: true };
      // The device list itself is part of the desired state; re-apply it too.
      if (result.ok && desired.state !== 'REVOKED')
        result = await adapter.applyEntitlement(desired);
    } else {
      result =
        desired.state === 'REVOKED'
          ? await adapter.revokeEntitlement(op.entitlementId)
          : await adapter.applyEntitlement(desired);
    }
    if (!result.ok) return this.fail(op, desired, result.code, result.detail, result.retryable);

    // 2. Read back. An API "ok" is not proof (spec §3.14).
    const observed = await adapter.readEntitlement(op.entitlementId);
    if ('unreachable' in observed)
      return this.fail(op, desired, 'UNREACHABLE', observed.detail, true);
    const diffs = diffEntitlement(desired, observed);
    if (diffs.length)
      return this.fail(op, desired, 'VERIFY_MISMATCH', diffs.join('; ').slice(0, 400), true);

    // 3. Record what is now confirmed.
    await this.prisma.$transaction(async (tx) => {
      await tx.networkOperation.update({
        where: { id: op.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          lastErrorCode: null,
          lastErrorDetail: null,
          verification: {
            inSync: true,
            observedState: observed.present ? observed.state : 'ABSENT',
            devices: observed.devices.length,
          },
        },
      });
      const e = await tx.entitlement.findUniqueOrThrow({
        where: { id: op.entitlementId as string },
      });
      const data: Prisma.EntitlementUncheckedUpdateInput = {
        observedNetworkState: desired.state,
        observedAt: new Date(),
      };
      // ACTIVE only once the gateway confirms the policy AND the access window exists.
      // A recovered PROVISIONING_FAILED steps through PROVISIONING (both transitions are legal).
      if (
        desired.state === 'ACTIVE' &&
        (e.status === 'PROVISIONING' || e.status === 'PROVISIONING_FAILED')
      ) {
        if (e.status === 'PROVISIONING_FAILED')
          entitlementStateMachine.assertTransition('PROVISIONING_FAILED', 'PROVISIONING');
        if (e.expiresAt) {
          entitlementStateMachine.assertTransition('PROVISIONING', 'ACTIVE');
          data.status = 'ACTIVE';
        } else {
          data.status = 'PROVISIONING';
        }
      }
      await tx.entitlement.update({ where: { id: e.id }, data });
    });
    return 'SUCCEEDED';
  }

  private async fail(
    op: {
      id: string;
      attempts: number;
      maxAttempts: number;
      entitlementId: string | null;
      propertyId: string;
      type: string;
    },
    desired: DesiredEntitlement,
    code: string,
    detail: string,
    retryable: boolean,
  ): Promise<NetworkOutcome> {
    // op.attempts was already incremented when this attempt was claimed.
    const attempt = op.attempts;
    if (retryable && attempt < op.maxAttempts) {
      const delayMs = Math.min(15 * 60_000, 5_000 * 2 ** (attempt - 1));
      await this.prisma.networkOperation.update({
        where: { id: op.id },
        data: {
          status: 'RETRY_SCHEDULED',
          nextAttemptAt: new Date(Date.now() + delayMs),
          lastErrorCode: code,
          lastErrorDetail: detail.slice(0, 500),
        },
      });
      throw new RetryableNetworkError(code, detail);
    }
    await this.finish(op.id, 'FAILED', code, detail, desired);
    return 'FAILED';
  }

  private async finish(
    id: string,
    status: 'FAILED',
    code: string,
    detail: string,
    desired: DesiredEntitlement | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const op = await tx.networkOperation.update({
        where: { id },
        data: {
          status,
          completedAt: new Date(),
          lastErrorCode: code,
          lastErrorDetail: detail.slice(0, 500),
        },
      });
      if (
        !op.entitlementId ||
        code === 'NO_GATEWAY_CONFIGURED' ||
        code === 'ADAPTER_NOT_IMPLEMENTED'
      )
        return;
      const e = await tx.entitlement.findUniqueOrThrow({ where: { id: op.entitlementId } });
      // Paid access that could not be provisioned stays paid; it needs attention, not a re-charge (spec §13.4).
      if (desired?.state === 'ACTIVE' && e.status === 'PROVISIONING') {
        await tx.entitlement.update({
          where: { id: e.id },
          data: { status: 'PROVISIONING_FAILED' },
        });
      }
      await tx.reconciliationDiscrepancy.create({
        data: {
          kind: 'NETWORK_DRIFT',
          propertyId: e.propertyId,
          entitlementId: e.id,
          details: { operationId: id, code, detail: detail.slice(0, 300), type: op.type },
        },
      });
      await recordAudit(tx, {
        actorType: 'SYSTEM',
        propertyId: e.propertyId,
        action: 'network.operation_failed',
        targetType: 'entitlement',
        targetId: e.id,
        metadata: { operationId: id, code, attempts: op.attempts },
      });
    });
  }

  // ================================================================ health, sessions, reconciliation

  async checkGateway(gatewayId: string) {
    const gw = await this.prisma.gateway.findUniqueOrThrow({ where: { id: gatewayId } });
    const adapter = this.registry.forGateway(gw);
    if (!adapter) {
      await this.prisma.gateway.update({
        where: { id: gw.id },
        data: {
          lastHealthAt: new Date(),
          status: gw.status === 'DISABLED' ? 'DISABLED' : 'UNVERIFIED',
        },
      });
      return { reachable: false, detail: `no adapter for vendor ${gw.vendor}`, capabilities: null };
    }
    const health = await adapter.healthCheck();
    const capabilities = adapter.getCapabilities();
    await this.prisma.gateway.update({
      where: { id: gw.id },
      data: {
        lastHealthAt: new Date(),
        ...(health.reachable ? { lastHealthyAt: new Date() } : {}),
        status:
          gw.status === 'DISABLED' ? 'DISABLED' : health.reachable ? 'HEALTHY' : 'UNREACHABLE',
        capabilities: capabilities as unknown as Prisma.InputJsonValue,
        ...(health.firmware ? { firmware: health.firmware.slice(0, 40) } : {}),
      },
    });
    return { reachable: health.reachable, detail: health.detail, capabilities };
  }

  /**
   * Compare gateway reality with the database for one property (spec §23).
   * If the gateway is unreachable nothing is changed — access is never revoked
   * because one data source is temporarily unavailable.
   */
  async reconcileProperty(propertyId: string) {
    const report = {
      reachable: false,
      sessionsSeen: 0,
      clocksStarted: 0,
      drift: 0,
      revokesQueued: 0,
      unknownSessions: 0,
    };
    const target = await this.gatewayFor(propertyId);
    if (!target?.adapter) return report;
    const { gw, adapter } = target;
    const health = await this.checkGateway(gw.id);
    if (!health.reachable) return report;
    report.reachable = true;

    const sessions = await adapter.listActiveSessions();
    if ('unreachable' in sessions) return { ...report, reachable: false };
    report.sessionsSeen = sessions.length;
    const now = new Date();
    const seenIds = new Set<string>();

    for (const s of sessions) {
      seenIds.add(s.gatewaySessionId);
      await this.prisma.$transaction(async (tx) => {
        const e = s.entitlementId
          ? await tx.entitlement.findFirst({
              where: { id: s.entitlementId, propertyId },
              include: { subscription: true, property: { select: { timeZone: true } } },
            })
          : null;
        const device = await tx.device.findUnique({
          where: { propertyId_macAddress: { propertyId, macAddress: s.macAddress } },
        });
        await tx.networkSession.upsert({
          where: {
            gatewayId_gatewaySessionId: { gatewayId: gw.id, gatewaySessionId: s.gatewaySessionId },
          },
          create: {
            propertyId,
            gatewayId: gw.id,
            gatewaySessionId: s.gatewaySessionId,
            entitlementId: e?.id ?? null,
            deviceId: device?.id ?? null,
            macAddress: s.macAddress,
            ipAddress: s.ipAddress,
            source: 'ADAPTER_POLL',
            startedAt: new Date(s.startedAt),
            lastSeenAt: now,
            bytesIn: s.bytesIn === null ? null : BigInt(s.bytesIn),
            bytesOut: s.bytesOut === null ? null : BigInt(s.bytesOut),
          },
          update: {
            lastSeenAt: now,
            endedAt: null,
            bytesIn: s.bytesIn === null ? null : BigInt(s.bytesIn),
            bytesOut: s.bytesOut === null ? null : BigInt(s.bytesOut),
          },
        });

        if (!e) {
          report.unknownSessions++;
          const known = await tx.reconciliationDiscrepancy.findFirst({
            where: {
              kind: 'SESSION_WITHOUT_ENTITLEMENT',
              resolvedAt: null,
              propertyId,
              details: { path: ['gatewaySessionId'], equals: s.gatewaySessionId },
            },
          });
          if (!known)
            await tx.reconciliationDiscrepancy.create({
              data: {
                kind: 'SESSION_WITHOUT_ENTITLEMENT',
                propertyId,
                details: {
                  gatewayId: gw.id,
                  gatewaySessionId: s.gatewaySessionId,
                  macSuffix: s.macAddress.slice(-5),
                },
              },
            });
          return;
        }
        // Database is the truth for expiry/revocation: a live session for ended access is cut.
        if (
          e.status === 'EXPIRED' ||
          e.status === 'REVOKED' ||
          (e.expiresAt && e.expiresAt <= now)
        ) {
          const known = await tx.reconciliationDiscrepancy.findFirst({
            where: { kind: 'EXPIRED_BUT_ACTIVE_ON_GATEWAY', resolvedAt: null, entitlementId: e.id },
          });
          if (!known) {
            await tx.reconciliationDiscrepancy.create({
              data: {
                kind: 'EXPIRED_BUT_ACTIVE_ON_GATEWAY',
                propertyId,
                entitlementId: e.id,
                details: { gatewaySessionId: s.gatewaySessionId, status: e.status },
              },
            });
            await queueNetwork(tx, 'network.revoke', e.id, { reason: 'session_after_end' });
            report.revokesQueued++;
          }
          return;
        }
        // ON_FIRST_AUTHORIZATION: the clock starts when the gateway first sees a real login.
        if (
          !e.startsAt &&
          (e.status === 'PROVISIONING' || e.status === 'ACTIVE') &&
          e.subscription.activationPolicy === 'ON_FIRST_AUTHORIZATION'
        ) {
          const plan = snapshotFromJson(e.subscription.planSnapshot as unknown as PlanSnapshotJson);
          const expiresAt = addDuration(now, plan.duration, e.property.timeZone);
          await tx.entitlement.update({
            where: { id: e.id },
            data: {
              startsAt: now,
              expiresAt,
              ...(e.observedNetworkState === 'ACTIVE' && e.status === 'PROVISIONING'
                ? { status: 'ACTIVE' }
                : {}),
            },
          });
          await queueNetwork(tx, 'network.apply_policy', e.id, { reason: 'clock_started' });
          await recordAudit(tx, {
            actorType: 'SYSTEM',
            propertyId,
            action: 'entitlement.clock_started',
            targetType: 'entitlement',
            targetId: e.id,
            metadata: { gatewaySessionId: s.gatewaySessionId, expiresAt: expiresAt.toISOString() },
          });
          report.clocksStarted++;
        }
      });
    }

    await this.prisma.networkSession.updateMany({
      where: { gatewayId: gw.id, endedAt: null, gatewaySessionId: { notIn: [...seenIds] } },
      data: { endedAt: now },
    });

    // Desired vs actual for every entitlement the gateway should know about.
    const live = await this.prisma.entitlement.findMany({
      where: {
        propertyId,
        OR: [
          { desiredNetworkState: { in: ['ACTIVE', 'SUSPENDED'] } },
          { desiredNetworkState: 'REVOKED', observedNetworkState: { in: ['ACTIVE', 'SUSPENDED'] } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    for (const { id } of live) {
      const desired = await this.desiredFor(this.prisma, id);
      if (!desired) continue;
      const observed = await adapter.readEntitlement(id);
      if ('unreachable' in observed) return { ...report, reachable: false };
      const diffs = diffEntitlement(desired, observed);
      if (!diffs.length) continue;
      // Don't stack duplicates while a fix is already queued or running.
      const pending = await this.prisma.networkOperation.count({
        where: { entitlementId: id, status: { in: ['PENDING', 'IN_PROGRESS', 'RETRY_SCHEDULED'] } },
      });
      if (pending) continue;
      report.drift++;
      await this.prisma.$transaction(async (tx) => {
        await tx.reconciliationDiscrepancy.create({
          data: {
            kind: 'NETWORK_DRIFT',
            propertyId,
            entitlementId: id,
            details: { diffs, source: 'reconcile' },
          },
        });
        await queueNetwork(
          tx,
          desired.state === 'REVOKED' ? 'network.revoke' : 'network.apply_policy',
          id,
          { reason: 'drift' },
        );
      });
    }
    return report;
  }

  /**
   * Re-run operations whose retry job never ran (e.g. Redis lost the job).
   * Safe because every attempt re-applies the current desired state.
   */
  async resumeStalledOperations(olderThanMs = 30 * 60_000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const stalled = await this.prisma.networkOperation.findMany({
      where: {
        OR: [
          { status: 'RETRY_SCHEDULED', nextAttemptAt: { lte: cutoff } },
          { status: 'PENDING', createdAt: { lte: cutoff } },
        ],
      },
      select: { id: true },
      take: 100,
    });
    let resumed = 0;
    for (const { id } of stalled) {
      try {
        await this.processOperation(id);
      } catch (e) {
        if (!(e instanceof RetryableNetworkError)) throw e;
      }
      resumed++;
    }
    return resumed;
  }

  async reconcileAll() {
    await this.resumeStalledOperations();
    const properties = await this.prisma.gateway.findMany({
      where: { status: { not: 'DISABLED' } },
      distinct: ['propertyId'],
      select: { propertyId: true },
    });
    const out: Record<string, Awaited<ReturnType<NetworkEngine['reconcileProperty']>>> = {};
    for (const p of properties) out[p.propertyId] = await this.reconcileProperty(p.propertyId);
    return out;
  }
}
