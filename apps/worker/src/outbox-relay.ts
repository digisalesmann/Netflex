import type { PrismaClient } from '@netflex/database';
import { queueForEventType, type JobSink } from './queues.js';

interface OutboxRow {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  attempts: number;
}

export interface RelayResult {
  dispatched: number;
  deferred: number;
}

const MAX_BACKOFF_SECONDS = 15 * 60;

/** Delay before retrying a relay failure: 2^attempts seconds, capped at 15 minutes. */
export function relayBackoffSeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.max(0, attempts));
}

/**
 * Transactional outbox relay (ADR-0002). Claims undispatched events with
 * FOR UPDATE SKIP LOCKED so several workers never claim the same row, enqueues
 * each with jobId = outbox id (BullMQ ignores duplicate ids), then marks it dispatched.
 * If the process dies after enqueue but before commit, the row is relayed again
 * and the duplicate job id makes it a no-op.
 */
export async function relayOutboxBatch(
  prisma: PrismaClient,
  sink: JobSink,
  batchSize = 50,
): Promise<RelayResult> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT "id", "type", "aggregateType", "aggregateId", "payload", "attempts"
        FROM "outbox_events"
        WHERE "dispatchedAt" IS NULL AND "availableAt" <= now()
        ORDER BY "availableAt", "createdAt"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;

      let dispatched = 0;
      let deferred = 0;
      for (const row of rows) {
        const queue = queueForEventType(row.type);
        let error: string | null = queue ? null : `NO_ROUTE for type ${row.type}`;
        if (queue) {
          try {
            await sink.add(
              queue,
              row.type,
              {
                outboxEventId: row.id,
                aggregateType: row.aggregateType,
                aggregateId: row.aggregateId,
                payload: row.payload,
              },
              row.id,
            );
          } catch (e) {
            error = `ENQUEUE_FAILED: ${e instanceof Error ? e.message : 'unknown'}`.slice(0, 300);
          }
        }
        if (error === null) {
          await tx.$executeRaw`UPDATE "outbox_events" SET "dispatchedAt" = now(), "lastError" = NULL WHERE "id" = ${row.id}::uuid`;
          dispatched++;
        } else {
          const delay = relayBackoffSeconds(row.attempts + 1);
          await tx.$executeRaw`
            UPDATE "outbox_events"
            SET "attempts" = "attempts" + 1, "lastError" = ${error},
                "availableAt" = now() + make_interval(secs => ${delay})
            WHERE "id" = ${row.id}::uuid`;
          deferred++;
        }
      }
      return { dispatched, deferred };
    },
    { timeout: 30_000 },
  );
}
