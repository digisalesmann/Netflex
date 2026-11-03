import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PrismaClient } from '@netflex/database';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CurrentAuth,
  RequestMeta,
  RequireKind,
  RequirePermission,
  type RequestMetaValue,
} from '../auth/decorators.js';
import { notFound } from '../common/prisma-errors.js';
import { ZodPipe } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
const ListQuery = z.strictObject({ status: z.enum(STATUSES).optional() });
const Update = z
  .strictObject({
    status: z.enum(STATUSES).optional(),
    /** Take the ticket (true) or hand it back (false). */
    assignToMe: z.boolean().optional(),
    note: z.string().trim().min(3).max(500).optional(),
  })
  .refine((b) => b.status !== undefined || b.assignToMe !== undefined, 'Nothing to change.');

/** Support requests for staff (spec §16). Replies happen by phone or email; this tracks the work. */
@RequireKind('STAFF')
@ApiTags('admin: support')
@Controller({ path: 'admin/properties/:propertyId/tickets' })
export class SupportAdminController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermission('support.manage')
  @Get()
  list(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    return this.prisma.supportTicket.findMany({
      where: { propertyId, ...(q.status ? { status: q.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: {
        id: true,
        category: true,
        subject: true,
        body: true,
        status: true,
        contactPhone: true,
        orderId: true,
        createdAt: true,
        updatedAt: true,
        requester: { select: { id: true, displayName: true, email: true, phoneE164: true } },
        assignedTo: { select: { id: true, displayName: true } },
      },
    });
  }

  @RequirePermission('support.manage')
  @Post(':ticketId')
  @HttpCode(200)
  async update(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('ticketId', new ParseUUIDPipe()) ticketId: string,
    @Body(new ZodPipe(Update)) body: z.infer<typeof Update>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.supportTicket.findFirst({ where: { id: ticketId, propertyId } });
      if (!t) throw notFound();
      const data = {
        ...(body.status ? { status: body.status } : {}),
        ...(body.assignToMe === true ? { assignedToId: auth.user.id } : {}),
        ...(body.assignToMe === false ? { assignedToId: null } : {}),
      };
      await tx.supportTicket.update({ where: { id: t.id }, data });
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        propertyId,
        action: 'support.ticket_updated',
        targetType: 'support_ticket',
        targetId: t.id,
        reason: body.note ?? null,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { from: t.status, to: body.status ?? t.status, assignToMe: body.assignToMe },
      });
      return { status: data.status ?? t.status };
    });
  }
}
