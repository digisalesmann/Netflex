import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@netflex/database';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testConfig } from '../../../scripts/test/test-config.js';
import { relayBackoffSeconds, relayOutboxBatch } from './outbox-relay.js';
import { createBullSink, queueForEventType, type JobSink } from './queues.js';

const config = testConfig();
let prisma: PrismaClient;
let redis: Redis;
let sink: ReturnType<typeof createBullSink>;
const prefix = `nftest-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  prisma = createPrismaClient(config.DATABASE_URL);
  redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  sink = createBullSink(redis, prefix);
});

beforeEach(async () => {
  // Isolate from other test files: park any leftover undispatched events far in the future.
  await prisma.$executeRaw`UPDATE "outbox_events" SET "availableAt" = now() + interval '100 years' WHERE "dispatchedAt" IS NULL`;
});

afterAll(async () => {
  for (const q of sink.queues.values()) await q.obliterate({ force: true });
  await sink.close();
  await redis.quit();
  await prisma.$disconnect();
});

async function addEvent(type: string) {
  return prisma.outboxEvent.create({
    data: { type, aggregateType: 'test', aggregateId: randomUUID(), payload: { hello: 'world' } },
  });
}

describe('queueForEventType', () => {
  it('routes known prefixes and refuses unknown ones', () => {
    expect(queueForEventType('payment.verify')).toBe('payments');
    expect(queueForEventType('network.activate')).toBe('provisioning');
    expect(queueForEventType('mystery.thing')).toBeNull();
  });
});

describe('relayOutboxBatch (real PostgreSQL + Redis)', () => {
  it('enqueues each event once with jobId = outbox id and marks it dispatched', async () => {
    const e = await addEvent('payment.verify');
    const r = await relayOutboxBatch(prisma, sink);
    expect(r).toEqual({ dispatched: 1, deferred: 0 });
    const job = await sink.queues.get('payments')?.getJob(e.id);
    expect(job?.name).toBe('payment.verify');
    expect(job?.data).toMatchObject({ outboxEventId: e.id, payload: { hello: 'world' } });
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.dispatchedAt).not.toBeNull();
    expect(await relayOutboxBatch(prisma, sink)).toEqual({ dispatched: 0, deferred: 0 });
  });

  it('re-relaying after a crash does not create a duplicate job', async () => {
    const e = await addEvent('network.activate');
    await relayOutboxBatch(prisma, sink);
    // Simulate "enqueued but commit lost": clear dispatchedAt and relay again.
    await prisma.outboxEvent.update({ where: { id: e.id }, data: { dispatchedAt: null } });
    await relayOutboxBatch(prisma, sink);
    const counts = await sink.queues
      .get('provisioning')
      ?.getJobCounts('waiting', 'delayed', 'active', 'completed');
    const total = Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });

  it('concurrent relays never claim the same event twice', async () => {
    const events = await Promise.all(
      Array.from({ length: 30 }, () => addEvent('notification.send')),
    );
    let adds = 0;
    const counting: JobSink = {
      async add(...args) {
        adds++;
        await sink.add(...args);
      },
      close: async () => {},
    };
    const results = await Promise.all([1, 2, 3].map(() => relayOutboxBatch(prisma, counting, 50)));
    expect(results.reduce((a, r) => a + r.dispatched, 0)).toBe(30);
    expect(adds).toBe(30);
    const undispatched = await prisma.outboxEvent.count({
      where: { id: { in: events.map((e) => e.id) }, dispatchedAt: null },
    });
    expect(undispatched).toBe(0);
  });

  it('defers unroutable events with backoff instead of guessing a queue', async () => {
    const e = await addEvent('mystery.thing');
    expect(await relayOutboxBatch(prisma, sink)).toEqual({ dispatched: 0, deferred: 1 });
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.dispatchedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/NO_ROUTE/);
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps the event when Redis enqueue fails (nothing is lost)', async () => {
    const e = await addEvent('payment.verify');
    const broken: JobSink = {
      add: async () => {
        throw new Error('redis down');
      },
      close: async () => {},
    };
    expect(await relayOutboxBatch(prisma, broken)).toEqual({ dispatched: 0, deferred: 1 });
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.dispatchedAt).toBeNull();
    expect(row.lastError).toMatch(/ENQUEUE_FAILED: redis down/);
  });

  it('caps backoff at 15 minutes', () => {
    expect(relayBackoffSeconds(1)).toBe(2);
    expect(relayBackoffSeconds(30)).toBe(900);
  });
});
