import { ConfigError, loadConfig } from '@netflex/config';
import { PaymentEngine, deriveDeliveryKey } from '@netflex/core';
import { createPrismaClient } from '@netflex/database';
import { createLogger } from '@netflex/observability';
import { FakePaymentProvider, PaystackProvider, type PaymentProvider } from '@netflex/payments';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeHeartbeat } from './heartbeat.js';
import { relayOutboxBatch } from './outbox-relay.js';
import { createPaymentProcessor } from './processors.js';
import { createBullSink } from './queues.js';

const BATCH = 50;
const IDLE_MS = 1_000;
const HEARTBEAT_MS = 10_000;
const RECONCILE_EVERY_MS = 5 * 60_000;

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
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  redis.on('error', (err: Error) => log.warn({ err: err.message }, 'redis connection error'));
  const sink = createBullSink(redis);

  let provider: PaymentProvider;
  if (config.PAYMENT_PROVIDER === 'paystack') {
    provider = new PaystackProvider(config.PAYSTACK_SECRET_KEY as string, config.PAYSTACK_BASE_URL);
  } else {
    provider = new FakePaymentProvider(config.NETFLEX_ENV);
    log.warn('PAYMENT_PROVIDER=fake: test double; its state is not shared with the API process');
  }
  const engine = new PaymentEngine(prisma, provider, {
    voucher: { pepper: config.VOUCHER_PEPPER, pepperVersion: config.VOUCHER_PEPPER_VERSION },
    deliveryKey: deriveDeliveryKey(config.VOUCHER_PEPPER),
  });
  const process_ = createPaymentProcessor(engine, log);
  const workers = [
    new Worker('payments', process_, { connection: redis, prefix: 'netflex', concurrency: 4 }),
    new Worker('reconciliation', process_, {
      connection: redis,
      prefix: 'netflex',
      concurrency: 1,
    }),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) =>
      log.error(
        {
          queue: w.name,
          job: job?.name,
          jobId: job?.id,
          attempts: job?.attemptsMade,
          err: err.message,
        },
        'job failed',
      ),
    );
  }
  await sink.queues
    .get('reconciliation')
    ?.upsertJobScheduler(
      'reconcile-payments',
      { every: RECONCILE_EVERY_MS },
      { name: 'reconcile.payments', data: {} },
    );

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
  log.info({ provider: provider.kind }, 'worker started');

  while (!stopping) {
    try {
      const { dispatched, deferred } = await relayOutboxBatch(prisma, sink, BATCH);
      if (dispatched || deferred) log.info({ dispatched, deferred }, 'outbox relayed');
      if (dispatched + deferred < BATCH) await sleep(IDLE_MS);
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, 'outbox relay failed');
      await sleep(5_000);
    }
  }

  clearInterval(beatTimer);
  await Promise.allSettled(workers.map((w) => w.close()));
  await sink.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  log.info('worker stopped');
}

void main();
