import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { AppRequest } from '../auth/auth.types.js';
import { OptionalAuth, Public, RequestMeta, type RequestMetaValue } from '../auth/decorators.js';
import { ZodPipe, phoneE164, uuid } from '../common/zod.js';
import { PaymentsService } from '../payments/payments.service.js';
import { OrdersService } from './orders.service.js';

const Checkout = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});
const Empty = z.strictObject({});

const CreateOrder = z.strictObject({
  planVersionId: uuid,
  target: z.discriminatedUnion('scope', [
    z.strictObject({ scope: z.literal('INDIVIDUAL') }),
    z.strictObject({ scope: z.literal('ROOM'), roomId: uuid }),
    z.strictObject({ scope: z.literal('FLOOR'), floorId: uuid }),
  ]),
  customerPhone: phoneE164.optional(),
});

/**
 * Orders. Signed-in tenants and guests (phone only) can order; prices always come
 * from the server. Clients must send an Idempotency-Key so retries never create
 * duplicate orders. Any price/amount field in the body is rejected.
 */
@Public()
@OptionalAuth()
@ApiTags('orders')
@Controller({ path: 'orders' })
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  @Post()
  async create(
    @Req() req: AppRequest,
    @Body(new ZodPipe(CreateOrder)) body: z.infer<typeof CreateOrder>,
    @Headers('idempotency-key') key: string | undefined,
    @RequestMeta() meta: RequestMetaValue,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.orders.create(req.auth, body, key ?? '', meta);
    res.status(r.status);
    if (r.replayed) res.setHeader('idempotent-replayed', 'true');
    return r.body;
  }

  @Get(':orderId')
  read(
    @Req() req: AppRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Headers('x-order-token') token: string | undefined,
  ) {
    return this.orders.read(orderId, req.auth, token);
  }

  /** Start (or replay) a payment attempt; returns the provider checkout URL. */
  @Post(':orderId/checkout')
  async checkout(
    @Req() req: AppRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body(new ZodPipe(Checkout)) body: z.infer<typeof Checkout>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-order-token') token: string | undefined,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.payments.checkout(orderId, req.auth, token, body.email, key ?? '', meta);
  }

  /** "I've paid" / return from checkout: re-checks with the provider. */
  @Post(':orderId/payment/verify')
  @HttpCode(200)
  verify(
    @Req() req: AppRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body(new ZodPipe(Empty)) _body: z.infer<typeof Empty>,
    @Headers('x-order-token') token: string | undefined,
  ) {
    return this.payments.verifyForCustomer(orderId, req.auth, token);
  }

  /** Retrieve the paid voucher code (owner only, while unused, within 72 h). */
  @Post(':orderId/voucher')
  @HttpCode(200)
  voucher(
    @Req() req: AppRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body(new ZodPipe(Empty)) _body: z.infer<typeof Empty>,
    @Headers('x-order-token') token: string | undefined,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.payments.revealVoucher(orderId, req.auth, token, meta);
  }
}
