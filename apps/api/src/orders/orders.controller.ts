import {
  Body,
  Controller,
  Get,
  Headers,
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
import { OrdersService } from './orders.service.js';

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
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

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
}
