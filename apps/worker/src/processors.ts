import {
  expireDue,
  type NetworkCommand,
  type NetworkEngine,
  type PaymentEngine,
} from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import type { Logger } from '@netflex/observability';

export interface JobLike {
  id?: string;
  name: string;
  data: { payload?: Record<string, unknown> } & Record<string, unknown>;
  attemptsMade?: number;
}

/**
 * Job handlers. Each is idempotent against database state, so BullMQ retries and
 * outbox re-relays are safe. Unknown job names fail loudly (kept for inspection)
 * instead of being silently dropped.
 */
export function createPaymentProcessor(
  engine: PaymentEngine,
  log: Logger,
  prisma?: PrismaClient,
  network?: NetworkEngine,
) {
  return async (job: JobLike): Promise<unknown> => {
    const payload = job.data.payload ?? {};
    const str = (k: string) => {
      const v = payload[k];
      if (typeof v !== 'string') throw new Error(`job ${job.name} missing ${k}`);
      return v;
    };
    switch (job.name) {
      case 'payment.webhook': {
        const r = await engine.processWebhookEvent(str('paymentEventId'));
        log.info({ job: job.name, jobId: job.id, result: r }, 'webhook event processed');
        return r;
      }
      case 'payment.verify': {
        const r = await engine.settle(str('paymentId'), 'job');
        log.info({ job: job.name, jobId: job.id, result: r }, 'payment verified');
        return r;
      }
      case 'refund.submit': {
        const r = await engine.submitRefund(str('refundId'));
        log.info({ job: job.name, jobId: job.id, result: r }, 'refund submitted');
        return r;
      }
      case 'refund.check':
        return engine.checkRefund(str('refundId'));
      case 'reconcile.payments': {
        const r = await engine.reconcile();
        log.info({ job: job.name, ...r }, 'payment reconciliation run');
        return r;
      }
      case 'entitlements.expire': {
        if (!prisma) throw new Error('entitlements.expire needs a database client');
        const r = await expireDue(prisma);
        if (r.expired || r.deadlinesMissed)
          log.info({ job: job.name, ...r }, 'entitlements expired');
        return r;
      }
      case 'network.activate':
      case 'network.suspend':
      case 'network.revoke':
      case 'network.disconnect':
      case 'network.apply_policy': {
        if (!network) throw new Error('network engine not configured');
        const outboxEventId =
          typeof job.data.outboxEventId === 'string' ? job.data.outboxEventId : (job.id ?? '');
        const r = await network.processCommand(outboxEventId, job.name as NetworkCommand, payload);
        log.info({ job: job.name, jobId: job.id, result: r }, 'network operation');
        return r;
      }
      case 'network.replay': {
        if (!network) throw new Error('network engine not configured');
        return network.processOperation(str('operationId'));
      }
      case 'reconcile.network': {
        if (!network) throw new Error('network engine not configured');
        const r = await network.reconcileAll();
        log.info(
          { job: job.name, properties: Object.keys(r).length },
          'network reconciliation run',
        );
        return r;
      }
      default:
        throw new Error(`no processor for job ${job.name}`);
    }
  };
}
