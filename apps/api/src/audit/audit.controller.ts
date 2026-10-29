import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma, PrismaClient } from '@netflex/database';
import { z } from 'zod';
import { RequirePermission, RequireKind } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';

const AuditQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Return entries older than this id. */
  before: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
  action: z.string().max(80).optional(),
});

@RequireKind('STAFF')
@ApiTags('admin: audit')
@Controller({ path: 'admin' })
export class AuditController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @RequirePermission('audit.read')
  @Get('properties/:propertyId/audit')
  forProperty(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>,
  ) {
    return this.query({ propertyId }, q);
  }

  /** Platform-wide log including sign-in events (owner only). */
  @RequirePermission('audit.read')
  @Get('audit')
  all(@Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.query({}, q);
  }

  private async query(where: Prisma.AuditLogWhereInput, q: z.infer<typeof AuditQuery>) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...where,
        ...(q.action ? { action: q.action } : {}),
        ...(q.before ? { id: { lt: BigInt(q.before) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit,
      include: { actor: { select: { displayName: true } } },
    });
    const data = rows.map((r) => ({
      id: r.id.toString(),
      occurredAt: r.occurredAt,
      actorType: r.actorType,
      actor: r.actorUserId
        ? { id: r.actorUserId, displayName: r.actor?.displayName ?? null }
        : null,
      propertyId: r.propertyId,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      metadata: r.metadata,
      requestId: r.correlationId,
    }));
    return { data, meta: { nextBefore: rows.length === q.limit ? data.at(-1)?.id : null } };
  }
}
