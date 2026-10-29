import { createHash } from 'node:crypto';
import type { Prisma } from '@netflex/database';

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

/** Fixed key for the advisory lock that serializes the hash chain. */
export const AUDIT_CHAIN_LOCK = 727_274_001;

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
 * Append an audit entry to the hash chain inside the caller's transaction, so it
 * commits with the change it describes. Shared by the API and the worker.
 */
export async function recordAudit(tx: Tx, e: AuditEntry): Promise<void> {
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
