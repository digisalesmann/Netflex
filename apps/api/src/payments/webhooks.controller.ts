import { createHash } from 'node:crypto';
import { Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { PrismaClient } from '@netflex/database';
import { PaymentProviderError, type PaymentProvider } from '@netflex/payments';
import type { RawBodyRequest } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { AppRequest } from '../auth/auth.types.js';
import { Public, SkipCsrf } from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { PAYMENT_PROVIDER, PRISMA } from '../infra/tokens.js';

/**
 * Payment provider webhooks (spec §13.3). Signature verified over the unmodified
 * raw body; valid events stored once (fingerprint) with an outbox job in the same
 * transaction, then acknowledged immediately. Business effects happen in the
 * worker after a fresh server-side verification — the webhook body is never trusted.
 */
@Public()
@SkipCsrf()
@ApiExcludeController()
@Controller({ path: 'webhooks' })
export class WebhooksController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {}

  @Post('paystack')
  @HttpCode(200)
  async paystack(@Req() req: RawBodyRequest<AppRequest>) {
    const raw = req.rawBody;
    if (!raw || raw.length === 0)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', 'Empty body.');
    if (!this.provider.verifyWebhookSignature(raw, req.headers)) {
      this.logger.warn({ requestId: req.id, bytes: raw.length }, 'webhook rejected: bad signature');
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Invalid signature.');
    }
    let parsed;
    try {
      parsed = this.provider.parseWebhook(raw);
    } catch (e) {
      if (e instanceof PaymentProviderError)
        throw new ApiError(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', 'Malformed event.');
      throw e;
    }
    const fingerprint = createHash('sha256').update(raw).digest('hex');
    const reference =
      parsed.event.kind === 'charge.success' || parsed.event.kind === 'charge.failed'
        ? parsed.event.reference
        : parsed.event.kind === 'refund'
          ? parsed.event.transactionReference
          : null;

    const stored = await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "payment_events" ("id", "provider", "fingerprint", "eventType", "providerReference", "signatureValid", "receivedAt", "payloadRedacted")
        VALUES (gen_random_uuid(), ${this.provider.kind}::"PaymentProviderKind", ${fingerprint}, ${parsed.type.slice(0, 64)}, ${reference?.slice(0, 64) ?? null}, true, now(), ${JSON.stringify(parsed.redacted)}::jsonb)
        ON CONFLICT ("provider", "fingerprint") DO NOTHING
        RETURNING "id"`;
      const id = inserted[0]?.id;
      if (!id) return null;
      await tx.outboxEvent.create({
        data: {
          type: 'payment.webhook',
          aggregateType: 'payment_event',
          aggregateId: id,
          payload: { paymentEventId: id },
        },
      });
      return id;
    });
    this.logger.info(
      { requestId: req.id, eventType: parsed.type, duplicate: stored === null },
      'webhook received',
    );
    return { received: true };
  }
}
