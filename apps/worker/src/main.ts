import { ConfigError, loadConfig } from '@netflex/config';
import { createPrismaClient } from '@netflex/database';
import { createLogger } from '@netflex/observability';
import { Redis } from 'ioredis';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeHeartbeat } from './heartbeat.js';
import { relayOutboxBatch } from './outbox-relay.js';
import { createBullSink } from './queues.js';

const BATCH = 50;
const IDLE_MS = 1_000;
const HEARTBEAT_MS = 10_000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    process.stderr.write(`${e instanceof ConfigError ? e.message : 'Invalid configuration'}\n`);
    process.exit(1);
  }
  const log = createLogger({
    service: 'worker',
    environment: config.NETFLEX_ENV,
    level: config.LOG_LEVEL,
  });
  const prisma = createPrismaClient(config.DATABASE_URL);
  // BullMQ requires maxRetriesPerRequest: null on its connection.
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  redis.on('error', (err: Error) => log.warn({ err: err.message }, 'redis connection error'));
  const sink = createBullSink(redis);

  let stopping = false;
  const stop = (signal: string) => {
    log.info({ signal }, 'worker stopping');
    stopping = true;
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  const beat = async () =>
    writeHeartbeat(redis).catch((e: unknown) => log.warn({ err: String(e) }, 'heartbeat failed'));
  await beat();
  const beatTimer = setInterval(() => void beat(), HEARTBEAT_MS);
  log.info('worker started');

  while (!stopping) {
    try {
      const { dispatched, deferred } = await relayOutboxBatch(prisma, sink, BATCH);
      if (dispatched || deferred) log.info({ dispatched, deferred }, 'outbox relayed');
      if (dispatched + deferred < BATCH) await sleep(IDLE_MS);
    } catch (e) {
      // Database or Redis outage: back off and keep going. Nothing is lost; rows stay in the outbox.
      log.error({ err: e instanceof Error ? e.message : String(e) }, 'outbox relay failed');
      await sleep(5_000);
    }
  }

  clearInterval(beatTimer);
  await sink.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  log.info('worker stopped');
}

void main();
