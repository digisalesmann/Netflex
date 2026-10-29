import type { Redis } from 'ioredis';

/** Must match apps/api/src/health/health.controller.ts. */
export const WORKER_HEARTBEAT_KEY = 'netflex:worker:heartbeat';

export async function writeHeartbeat(redis: Redis, now = new Date()): Promise<void> {
  await redis.set(WORKER_HEARTBEAT_KEY, now.toISOString(), 'EX', 120);
}
