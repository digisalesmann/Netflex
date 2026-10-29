import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PaymentEngine } from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import {
  PAYMENT_STATUSES,
  isCurrencyCode,
  parseMajorUnits,
  refundStateMachine,
} from '@netflex/domain';
import { z } from 'zod';
import { AuditService, type Tx } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CurrentAuth,
  RequestMeta,
  RequireKind,
  RequirePermission,
  type RequestMetaValue,
} from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { notFound } from '../common/prisma-errors.js';
import { ZodPipe, reason, uuid } from '../common/zod.js';
import { PAYMENT_ENGINE, PRISMA } from '../infra/tokens.js';

const ListQuery = z.strictObject({
  status: z.enum(PAYMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: uuid.optional(),
});
const RefundRequest = z.strictObject({
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,15}(\.\d{1,2})?$/),
  reason,
});
const Reason = z.strictObject({ reason });
const Resolve = z.strictObject({ resolution: z.string().trim().min(5).max(500) });

/**
 * Finance and reconciliation (spec §13.5, §17). Refunds use a two-person rule:
 * the approver must differ from the requester (also enforced by the database).
 * Nothing here edits financial history; corrections are new records.
 */
@RequireKind('STAFF')
@ApiTags('admin: payments')
@Controller({ path: 'admin/properties/:propertyId' })
export class AdminPaymentsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PAYMENT_ENGINE) private readonly engine: PaymentEngine,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermission('payment.read')
  @Get('payments')
  async list(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    const rows = await this.prisma.payment.findMany({
      where: { order: { propertyId }, ...(q.status ? { status: q.status } : {}) },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        provider: true,
        providerReference: true,
        status: true,
        amountMinor: true,
        refundedMinor: true,
        currency: true,
        createdAt: true,
        verifiedAt: true,
        failureCode: true,
        order: { select: { id: true, reference: true, status: true } },
      },
    });
    const data = rows.slice(0, q.limit);
    return { data, meta: { nextCursor: rows.length > q.limit ? data.at(-1)?.id : null } };
  }

  @RequirePermission('payment.read')
  @Get('payments/:paymentId')
  async get(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    const p = await this.prisma.payment.findFirst({
      where: { id: paymentId, order: { propertyId } },
      include: {
        order: { select: { id: true, reference: true, status: true, paidAt: true } },
        refunds: { orderBy: { createdAt: 'asc' } },
        discrepancies: { orderBy: { detectedAt: 'asc' } },
      },
    });
    if (!p) throw notFound();
    const events = await this.prisma.paymentEvent.findMany({
      where: { providerReference: p.providerReference },
      orderBy: { receivedAt: 'asc' },
      select: {
        id: true,
        eventType: true,
        receivedAt: true,
        processedAt: true,
        processingError: true,
      },
    });
    return { ...p, webhookEvents: events };
  }

  /** Re-check a payment with the provider now (e.g. customer says they paid). */
  @RequirePermission('payment.reconcile')
  @Post('payments/:paymentId/verify')
  @HttpCode(200)
  async verify(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    const p = await this.prisma.payment.findFirst({
      where: { id: paymentId, order: { propertyId } },
      select: { id: true },
    });
    if (!p) throw notFound();
    const outcome = await this.engine.settle(p.id, `admin:${auth.user.id}`);
    await this.audit.recordStandalone({
      actorType: 'USER',
      actorUserId: auth.user.id,
      propertyId,
      action: 'payment.manual_verify',
      targetType: 'payment',
      targetId: p.id,
      correlationId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { outcome },
    });
    return { outcome };
  }

  @RequirePermission('payment.refund.request')
  @Post('payments/:paymentId/refunds')
  async requestRefund(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Body(new ZodPipe(RefundRequest)) body: z.infer<typeof RefundRequest>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the payment so concurrent refund requests can't exceed the paid amount.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT p."id" FROM "payments" p JOIN "orders" o ON o."id" = p."orderId"
        WHERE p."id" = ${paymentId}::uuid AND o."propertyId" = ${propertyId}::uuid FOR UPDATE OF p`;
      if (!locked[0]) throw notFound();
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.status !== 'SUCCEEDED' && p.status !== 'PARTIALLY_REFUNDED') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'Only successful payments can be refunded.',
        );
      }
      if (!isCurrencyCode(p.currency))
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'Unsupported currency.');
      const amount = parseMajorUnits(body.amount, p.currency).amountMinor;
      const inFlight = await tx.refund.aggregate({
        where: { paymentId, status: { in: ['REQUESTED', 'APPROVED', 'SUBMITTED'] } },
        _sum: { amountMinor: true },
      });
      const available = p.amountMinor - p.refundedMinor - (inFlight._sum.amountMinor ?? 0n);
      if (amount <= 0n || amount > available) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'UNPROCESSABLE',
          'Refund amount exceeds what can still be refunded.',
          { availableMinor: available.toString() },
        );
      }
      const r = await tx.refund.create({
        data: {
          paymentId,
          amountMinor: amount,
          currency: p.currency,
          reason: body.reason,
          requestedById: auth.user.id,
        },
      });
      await this.log(tx, auth, meta, propertyId, 'refund.requested', r.id, body.reason, {
        paymentId,
        amountMinor: amount.toString(),
      });
      return { refundId: r.id, status: r.status };
    });
  }

  @RequirePermission('payment.refund.approve')
  @Post('refunds/:refundId/approve')
  @HttpCode(200)
  async approve(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('refundId', new ParseUUIDPipe()) refundId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.lockRefund(tx, propertyId, refundId);
      if (r.requestedById === auth.user.id)
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'A refund must be approved by someone other than the requester.',
        );
      refundStateMachine.assertTransition(r.status, 'APPROVED');
      await tx.refund.update({
        where: { id: r.id },
        data: { status: 'APPROVED', approvedById: auth.user.id },
      });
      await tx.outboxEvent.create({
        data: {
          type: 'refund.submit',
          aggregateType: 'refund',
          aggregateId: r.id,
          payload: { refundId: r.id },
        },
      });
      await this.log(tx, auth, meta, propertyId, 'refund.approved', r.id, null, {
        amountMinor: r.amountMinor.toString(),
      });
      return { status: 'APPROVED' };
    });
  }

  @RequirePermission('payment.refund.approve')
  @Post('refunds/:refundId/reject')
  @HttpCode(200)
  async reject(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('refundId', new ParseUUIDPipe()) refundId: string,
    @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.lockRefund(tx, propertyId, refundId);
      refundStateMachine.assertTransition(r.status, 'REJECTED');
      await tx.refund.update({ where: { id: r.id }, data: { status: 'REJECTED' } });
      await this.log(tx, auth, meta, propertyId, 'refund.rejected', r.id, body.reason, {});
      return { status: 'REJECTED' };
    });
  }

  @RequirePermission('payment.reconcile')
  @Get('discrepancies')
  discrepancies(@Param('propertyId', new ParseUUIDPipe()) propertyId: string) {
    return this.prisma.reconciliationDiscrepancy.findMany({
      where: { propertyId, resolvedAt: null },
      orderBy: { detectedAt: 'asc' },
      take: 200,
    });
  }

  /** Close a discrepancy with an explanation (the record itself is kept). */
  @RequirePermission('payment.reconcile')
  @Post('discrepancies/:discrepancyId/resolve')
  @HttpCode(200)
  async resolve(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('discrepancyId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Resolve)) body: z.infer<typeof Resolve>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.reconciliationDiscrepancy.updateMany({
        where: { id, propertyId, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedById: auth.user.id, resolution: body.resolution },
      });
      if (r.count !== 1) throw notFound();
      await this.log(
        tx,
        auth,
        meta,
        propertyId,
        'reconciliation.resolved',
        id,
        body.resolution,
        {},
      );
      return { resolved: true };
    });
  }

  private async lockRefund(tx: Tx, propertyId: string, refundId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT r."id" FROM "refunds" r JOIN "payments" p ON p."id" = r."paymentId" JOIN "orders" o ON o."id" = p."orderId"
      WHERE r."id" = ${refundId}::uuid AND o."propertyId" = ${propertyId}::uuid FOR UPDATE OF r`;
    if (!rows[0]) throw notFound();
    return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  private log(
    tx: Tx,
    auth: AuthContext,
    meta: RequestMetaValue,
    propertyId: string,
    action: string,
    targetId: string,
    why: string | null,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorType: 'USER',
      actorUserId: auth.user.id,
      propertyId,
      action,
      targetType: 'refund',
      targetId,
      reason: why,
      correlationId: meta.requestId,
      ipAddress: meta.ip,
      metadata,
    });
  }
}
