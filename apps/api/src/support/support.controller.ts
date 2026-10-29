import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { recordAudit } from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../auth/auth.types.js';
import {
  CurrentAuth,
  OptionalAuth,
  Public,
  RequestMeta,
  RequireKind,
  type RequestMetaValue,
} from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { notFound } from '../common/prisma-errors.js';
import { ZodPipe, phoneE164, uuid } from '../common/zod.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { PRISMA } from '../infra/tokens.js';

export const TICKET_CATEGORIES = [
  'PAYMENT',
  'CONNECTIVITY',
  'VOUCHER',
  'ACCOUNT',
  'OUTAGE',
  'PRIVACY',
  'OTHER',
] as const;

const NewTicket = z.strictObject({
  propertySlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(4000),
  contactPhone: phoneE164.optional(),
  orderId: uuid.optional(),
});
const LIMIT_IP = { name: 'ticket-ip', limit: 5, windowSeconds: 3600 };

/** Help requests and outage reports from tenants and guests (spec §16). Staff handle them in the admin portal. */
@ApiTags('support')
@Controller({ path: '' })
export class SupportController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Public()
  @OptionalAuth()
  @Post('support/tickets')
  async create(
    @Req() req: AppRequest,
    @RequestMeta() meta: RequestMetaValue,
    @Body(new ZodPipe(NewTicket)) body: z.infer<typeof NewTicket>,
  ) {
    await this.limits.hit(LIMIT_IP, meta.ip ?? 'unknown');
    const auth = req.auth?.user.kind === 'TENANT' ? req.auth : undefined;
    if (!auth && !body.contactPhone) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Add a phone number so the property can reply.',
        { fields: [{ path: 'contactPhone', rule: 'required' }] },
      );
    }
    const property = await this.prisma.property.findUnique({
      where: { slug: body.propertySlug },
      select: { id: true },
    });
    if (!property) throw notFound();
    if (body.orderId) {
      // Only link orders the requester owns (signed-in) — never someone else's.
      const owned = auth
        ? await this.prisma.order.findFirst({
            where: { id: body.orderId, customerUserId: auth.user.id, propertyId: property.id },
          })
        : null;
      if (!owned) throw notFound();
    }
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.supportTicket.create({
        data: {
          propertyId: property.id,
          requesterId: auth?.user.id ?? null,
          contactPhone: body.contactPhone ?? null,
          category: body.category,
          subject: body.subject,
          body: body.body,
          orderId: body.orderId ?? null,
        },
        select: { id: true, status: true, createdAt: true },
      });
      await recordAudit(tx, {
        actorType: auth ? 'USER' : 'SYSTEM',
        actorUserId: auth?.user.id ?? null,
        propertyId: property.id,
        action: 'support.ticket_created',
        targetType: 'support_ticket',
        targetId: t.id,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { category: body.category },
      });
      return {
        ticketId: t.id,
        status: t.status,
        createdAt: t.createdAt,
        message: 'Thanks. The property team will get back to you.',
      };
    });
  }

  @RequireKind('TENANT')
  @Get('me/tickets')
  mine(@CurrentAuth() auth: AuthContext) {
    return this.prisma.supportTicket.findMany({
      where: { requesterId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        category: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
