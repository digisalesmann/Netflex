import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@netflex/database';
import type { Tx } from '../audit/audit.service.js';
import { PRISMA } from '../infra/tokens.js';
import { ApiError } from './api-error.js';

const TTL_MS = 24 * 3600_000;
/** An in-progress marker older than this is treated as abandoned (crashed request) and retaken. */
const STALE_MS = 60_000;

export function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Idempotency keys for create operations (spec §22). The first request claims the
 * key; the business change and the stored response commit in ONE transaction, so
 * a retry either replays the original result or (if the original failed) runs again.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async run<T extends Prisma.InputJsonValue>(
    scope: string,
    key: string,
    hash: string,
    fn: (tx: Tx) => Promise<{ status: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Idempotency-Key header must be 16–100 letters, digits, - or _.',
      );
    }
    const claimed = await this.claim(scope, key, hash);
    if (!claimed.ok) return { ...claimed.replay, replayed: true };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await fn(tx);
        await tx.idempotencyRecord.update({
          where: { scope_key: { scope, key } },
          data: { responseStatus: result.status, responseBody: result.body },
        });
        return { ...result, replayed: false };
      });
    } catch (e) {
      // Release the key so the client can retry after fixing the problem.
      await this.prisma.idempotencyRecord
        .deleteMany({ where: { scope, key, responseStatus: null } })
        .catch(() => undefined);
      throw e;
    }
  }

  private async claim(
    scope: string,
    key: string,
    hash: string,
  ): Promise<{ ok: true } | { ok: false; replay: { status: number; body: never } }> {
    const now = new Date();
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "idempotency_records" ("scope", "key", "requestHash", "createdAt", "expiresAt")
      VALUES (${scope}, ${key}, ${hash}, ${now}, ${new Date(now.getTime() + TTL_MS)})
      ON CONFLICT ("scope", "key") DO NOTHING`;
    if (inserted === 1) return { ok: true };

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!existing) return this.claim(scope, key, hash); // released meanwhile
    if (existing.requestHash !== hash) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'UNPROCESSABLE',
        'This Idempotency-Key was already used with a different request.',
      );
    }
    if (existing.responseStatus !== null) {
      return {
        ok: false,
        replay: { status: existing.responseStatus, body: existing.responseBody as never },
      };
    }
    if (now.getTime() - existing.createdAt.getTime() > STALE_MS) {
      const retaken = await this.prisma.idempotencyRecord.updateMany({
        where: { scope, key, responseStatus: null, createdAt: existing.createdAt },
        data: { createdAt: now },
      });
      if (retaken.count === 1) return { ok: true };
    }
    throw new ApiError(
      HttpStatus.CONFLICT,
      'CONFLICT',
      'The same request is already being processed. Try again shortly.',
    );
  }
}
