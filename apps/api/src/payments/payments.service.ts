import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
import { deriveDeliveryKey, type PaymentEngine } from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import { formatVoucherCode, type VoucherCode } from '@netflex/domain';
import { PaymentProviderError, type PaymentProvider } from '@netflex/payments';
import { decryptSecret } from '@netflex/security';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMetaValue } from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { IdempotencyService, requestHash } from '../common/idempotency.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { CONFIG, PAYMENT_ENGINE, PAYMENT_PROVIDER, PRISMA } from '../infra/tokens.js';
import { OrdersService } from '../orders/orders.service.js';

const MAX_OPEN_ATTEMPTS = 3;
const LIMIT_CHECKOUT = { name: 'checkout-order', limit: 10, windowSeconds: 3600 };
const LIMIT_VERIFY = { name: 'payment-verify-order', limit: 12, windowSeconds: 600 };
const LIMIT_REVEAL = { name: 'voucher-reveal-order', limit: 20, windowSeconds: 3600 };

export function deliveryKey(config: NetflexConfig): Buffer {
  return deriveDeliveryKey(config.VOUCHER_PEPPER);
}

@Injectable()
export class PaymentsService {
  private readonly dKey: Buffer;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: NetflexConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PAYMENT_ENGINE) private readonly engine: PaymentEngine,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.dKey = deliveryKey(config);
  }

  /**
   * Start a payment attempt. The Payment row exists before the provider is called,
   * so every provider-side transaction is traceable to an order.
   */
  async checkout(
    orderId: string,
    auth: AuthContext | undefined,
    token: string | undefined,
    email: string,
    idemKey: string,
    meta: RequestMetaValue,
  ) {
    const order = await this.orders.loadAccessible(orderId, auth, token);
    await this.limits.hit(LIMIT_CHECKOUT, order.id);
    if (!this.config.PAID_ACCESS_ENABLED) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'DOMAIN_PAID_ACCESS_DISABLED',
        'Online purchases are not open yet.',
      );
    }

    const claim = await this.idempotency.run(
      `POST /orders/${order.id}/checkout`,
      idemKey,
      requestHash({ email }),
      async (tx) => {
        const o = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        if (o.status !== 'CREATED' && o.status !== 'AWAITING_PAYMENT') {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'CONFLICT',
            o.status === 'PAID'
              ? 'This order is already paid.'
              : 'This order can no longer be paid. Start a new order.',
          );
        }
        if (o.expiresAt <= new Date())
          throw new ApiError(
            HttpStatus.CONFLICT,
            'CONFLICT',
            'This order has expired. Start a new order.',
          );
        const open = await tx.payment.count({
          where: { orderId: o.id, status: { in: ['CREATED', 'PENDING'] } },
        });
        if (open >= MAX_OPEN_ATTEMPTS) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'CONFLICT',
            'Several payment attempts are still being confirmed. Check your payment status before trying again.',
          );
        }
        const p = await tx.payment.create({
          data: {
            orderId: o.id,
            provider: this.provider.kind,
            providerReference: `${o.reference}-${randomBytes(3).toString('hex')}`,
            amountMinor: o.amountMinor,
            currency: o.currency,
          },
        });
        if (o.status === 'CREATED')
          await tx.order.update({ where: { id: o.id }, data: { status: 'AWAITING_PAYMENT' } });
        await this.audit.record(tx, {
          actorType: 'USER',
          actorUserId: auth?.user.id ?? null,
          propertyId: o.propertyId,
          action: 'payment.created',
          targetType: 'payment',
          targetId: p.id,
          correlationId: meta.requestId,
          ipAddress: meta.ip,
          metadata: { orderId: o.id, providerReference: p.providerReference },
        });
        return { status: 201, body: { paymentId: p.id } };
      },
    );

    const paymentId = claim.body.paymentId;
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.checkoutUrl)
      return { paymentId, reference: payment.providerReference, checkoutUrl: payment.checkoutUrl };
    if (payment.status !== 'CREATED') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This payment attempt could not be started. Try again with a new request.',
      );
    }

    try {
      const init = await this.provider.initialize({
        reference: payment.providerReference,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        email,
        callbackUrl: `${this.config.PUBLIC_WEB_URL}/checkout/return?order=${order.id}`,
        metadata: { orderId: order.id, orderReference: order.reference },
      });
      await this.prisma.payment.updateMany({
        where: { id: paymentId, status: 'CREATED' },
        data: { status: 'PENDING', checkoutUrl: init.checkoutUrl },
      });
      return { paymentId, reference: payment.providerReference, checkoutUrl: init.checkoutUrl };
    } catch (e) {
      const code = e instanceof PaymentProviderError ? e.code : 'UNKNOWN';
      await this.prisma.payment.updateMany({
        where: { id: paymentId, status: 'CREATED' },
        data: { status: 'FAILED', failureCode: `INIT_${code}` },
      });
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'The payment provider is not responding. Please try again shortly. You have not been charged.',
      );
    }
  }

  /** Customer returned from checkout ("I've paid"): ask the provider directly. The redirect itself proves nothing. */
  async verifyForCustomer(
    orderId: string,
    auth: AuthContext | undefined,
    token: string | undefined,
  ) {
    const order = await this.orders.loadAccessible(orderId, auth, token);
    await this.limits.hit(LIMIT_VERIFY, order.id);
    const open = await this.prisma.payment.findMany({
      where: { orderId: order.id, status: { in: ['CREATED', 'PENDING'] } },
      select: { id: true },
    });
    for (const p of open) {
      try {
        await this.engine.settle(p.id, 'customer_return');
      } catch {
        // Provider unreachable: status stays pending; reconciliation will retry.
      }
    }
    return this.orders.read(order.id, auth, token);
  }

  /**
   * Retrieve the voucher code for a paid order (spec §8.2): only the order owner,
   * only while unused and within the delivery window.
   */
  async revealVoucher(
    orderId: string,
    auth: AuthContext | undefined,
    token: string | undefined,
    meta: RequestMetaValue,
  ) {
    const order = await this.orders.loadAccessible(orderId, auth, token);
    await this.limits.hit(LIMIT_REVEAL, order.id);
    const d = await this.prisma.voucherDelivery.findFirst({
      where: { orderId: order.id },
      include: { voucher: { select: { status: true, redeemBy: true } } },
    });
    if (!d || d.expiresAt <= new Date() || d.voucher.status !== 'ISSUED') {
      throw new ApiError(
        HttpStatus.GONE,
        'NOT_FOUND',
        'This code is no longer available here. If you have not used it, contact support to reissue it.',
      );
    }
    const code = decryptSecret(this.dKey, d.codeEnc) as VoucherCode;
    await this.prisma.$transaction(async (tx) => {
      await tx.voucherDelivery.update({
        where: { voucherId: d.voucherId },
        data: { revealCount: { increment: 1 }, lastRevealedAt: new Date() },
      });
      await this.audit.record(tx, {
        actorType: auth ? 'USER' : 'SYSTEM',
        actorUserId: auth?.user.id ?? null,
        propertyId: order.propertyId,
        action: 'voucher.revealed_to_buyer',
        targetType: 'voucher',
        targetId: d.voucherId,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { orderId: order.id, revealCount: d.revealCount + 1 },
      });
    });
    return {
      code: formatVoucherCode(code),
      redeemBy: d.voucher.redeemBy?.toISOString() ?? null,
      notice: 'Keep this code private. Anyone with it can use your access.',
    };
  }
}
