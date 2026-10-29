import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUE_NAMES = [
  'payments',
  'provisioning',
  'notifications',
  'reconciliation',
  'maintenance',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

const ROUTES: ReadonlyArray<[prefix: string, queue: QueueName]> = [
  ['payment.', 'payments'],
  ['refund.', 'payments'],
  ['network.', 'provisioning'],
  ['entitlement.', 'provisioning'],
  ['notification.', 'notifications'],
  ['reconcile.', 'reconciliation'],
  ['maintenance.', 'maintenance'],
];

/** Route an outbox event type to its queue. Unknown types return null and are never guessed. */
export function queueForEventType(type: string): QueueName | null {
  return ROUTES.find(([prefix]) => type.startsWith(prefix))?.[1] ?? null;
}

/**
 * Default job policy: bounded retries, exponential backoff with jitter, completed
 * jobs kept 7 days so a re-relayed outbox event with the same jobId is deduplicated,
 * failed jobs kept for inspection and authorized replay.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false,
};

/** Where the relay sends jobs. Lets tests and the real BullMQ queues share one interface. */
export interface JobSink {
  add(queue: QueueName, name: string, data: Record<string, unknown>, jobId: string): Promise<void>;
  close(): Promise<void>;
}

export function createBullSink(
  connection: Redis,
  prefix = 'netflex',
): JobSink & { queues: Map<QueueName, Queue> } {
  const queues = new Map<QueueName, Queue>(
    QUEUE_NAMES.map((name) => [
      name,
      new Queue(name, { connection, prefix, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    ]),
  );
  return {
    queues,
    async add(queue, name, data, jobId) {
      const q = queues.get(queue);
      if (!q) throw new Error(`unknown queue ${queue}`);
      await q.add(name, data, { jobId });
    },
    async close() {
      await Promise.all([...queues.values()].map((q) => q.close()));
    },
  };
}
