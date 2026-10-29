import type { PaymentEngine } from '@netflex/core';
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
export function createPaymentProcessor(engine: PaymentEngine, log: Logger) {
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
      default:
        throw new Error(`no processor for job ${job.name}`);
    }
  };
}
