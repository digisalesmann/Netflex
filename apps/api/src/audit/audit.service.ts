import { Inject, Injectable } from '@nestjs/common';
import { auditHash, recordAudit, type AuditEntry, type Tx } from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import { PRISMA } from '../infra/tokens.js';

export type { AuditEntry, Tx } from '@netflex/core';
export { auditHash } from '@netflex/core';

/**
 * Append-only audit log with a SHA-256 hash chain. The database already blocks
 * UPDATE/DELETE/TRUNCATE; the chain additionally reveals tampering by anyone who
 * bypasses triggers (e.g. a superuser). Always call inside the business
 * transaction so the audit record commits with the change it describes.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  record(tx: Tx, e: AuditEntry): Promise<void> {
    return recordAudit(tx, e);
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
