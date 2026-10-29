import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@netflex/database';
import { PRISMA } from '../infra/tokens.js';

export type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  actorType: 'USER' | 'SYSTEM' | 'PROVIDER';
  actorUserId?: string | null;
  propertyId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  ipAddress?: string | null;
  /** Never include secrets, codes, or tokens. */
  metadata?: Record<string, unknown>;
}

/** Arbitrary but fixed key for the advisory lock that serializes the hash chain. */
const AUDIT_CHAIN_LOCK = 727_274_001;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

export function auditHash(prevHash: string | null, fields: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${prevHash ?? ''}|${canonical(fields)}`)
    .digest('hex');
}

/**
 * Append-only audit log with a SHA-256 hash chain. The database already blocks
 * UPDATE/DELETE/TRUNCATE; the chain additionally reveals tampering by anyone who
 * bypasses triggers (e.g. a superuser). Always call inside the business
 * transaction so the audit record commits with the change it describes.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async record(tx: Tx, e: AuditEntry): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
    const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
    const prevHash = last?.hash ?? null;
    const occurredAt = new Date();
    const fields = {
      occurredAt: occurredAt.toISOString(),
      actorType: e.actorType,
      actorUserId: e.actorUserId ?? null,
      propertyId: e.propertyId ?? null,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId ?? null,
      reason: e.reason ?? null,
      metadata: e.metadata ?? {},
    };
    await tx.auditLog.create({
      data: {
        ...fields,
        occurredAt,
        metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
        correlationId: e.correlationId ?? null,
        ipAddress: e.ipAddress ?? null,
        prevHash,
        hash: auditHash(prevHash, fields),
      },
    });
  }

  /** Convenience for audit-only events (e.g. failed sign-in) outside a business transaction. */
  async recordStandalone(e: AuditEntry): Promise<void> {
    await this.prisma.$transaction((tx) => this.record(tx, e));
  }

  /**
   * Recompute the chain from `fromId` (default: the first entry). Every entry must
   * link to the previous entry's hash and its own hash must match its contents.
   * Returns the id of the first broken entry, or null if intact.
   */
  async verifyChain(fromId?: bigint): Promise<bigint | null> {
    let prev: string | null | undefined;
    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where: fromId !== undefined ? { id: { gte: fromId } } : {},
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) return null;
      for (const r of rows) {
        // The first row checked anchors the chain to whatever it links to.
        if (prev !== undefined && r.prevHash !== prev) return r.id;
        const expected = auditHash(r.prevHash, {
          occurredAt: r.occurredAt.toISOString(),
          actorType: r.actorType,
          actorUserId: r.actorUserId,
          propertyId: r.propertyId,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          reason: r.reason,
          metadata: r.metadata,
        });
        if (r.hash !== expected) return r.id;
        prev = r.hash;
      }
      cursor = rows[rows.length - 1]?.id;
    }
  }
}
