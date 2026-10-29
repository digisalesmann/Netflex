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
import type { Prisma, PrismaClient } from '@netflex/database';
import {
  VOUCHER_STATUSES,
  checkPurchasable,
  formatVoucherCode,
  voucherStateMachine,
  type ScopeTarget,
  type VoucherStatus,
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
import { toSnapshot } from '../catalog/plan-mapper.js';
import { ApiError } from '../common/api-error.js';
import { notFound } from '../common/prisma-errors.js';
import { ZodPipe, reason, uuid } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';
import { AccessService } from './access.service.js';

export const MAX_BULK_ISSUE = 50;

const Issue = z.strictObject({
  planVersionId: uuid,
  issuanceType: z.enum(['COMPLIMENTARY', 'MANUAL', 'PROMOTIONAL']),
  reason,
  target: z.discriminatedUnion('scope', [
    z.strictObject({ scope: z.literal('INDIVIDUAL'), userId: uuid.optional() }),
    z.strictObject({ scope: z.literal('ROOM'), roomId: uuid }),
    z.strictObject({ scope: z.literal('FLOOR'), floorId: uuid }),
  ]),
  quantity: z.number().int().min(1).max(MAX_BULK_ISSUE).default(1),
  /** Must be true when quantity > 1 (bulk issuance needs explicit confirmation). */
  confirmBulk: z.boolean().optional(),
});
const ListQuery = z.strictObject({
  status: z.enum(VOUCHER_STATUSES).optional(),
  hint: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[2-9A-HJKMNP-Z]{4}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: uuid.optional(),
});
const Reason = z.strictObject({ reason });

/**
 * Voucher administration (spec §8, §17). Codes are returned exactly once, at
 * issue/reissue, and never stored or shown again (staff see the last 4 chars).
 * Non-paid vouchers never imply payment: issuance type, issuer and reason are recorded.
 */
@RequireKind('STAFF')
@ApiTags('admin: vouchers')
@Controller({ path: 'admin/properties/:propertyId/vouchers' })
export class VouchersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  @RequirePermission('voucher.issue')
  @Post()
  async issue(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body(new ZodPipe(Issue)) body: z.infer<typeof Issue>,
  ) {
    if (body.quantity > 1 && body.confirmBulk !== true) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'UNPROCESSABLE',
        `Confirm bulk issuance of ${body.quantity} vouchers.`,
        { requires: 'confirmBulk' },
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.planVersion.findFirst({
        where: { id: body.planVersionId, plan: { propertyId } },
        include: { plan: { include: { property: true } } },
      });
      if (!v?.publishedAt) throw notFound();
      const snapshot = toSnapshot(v.plan, v);
      // Staff issuance ignores the paid-access switch but respects plan state, scope and availability.
      const ok = checkPurchasable(snapshot, {
        now: new Date(),
        propertyId,
        scope: body.target.scope,
        paidAccessEnabled: true,
      });
      if (!ok.ok)
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          `DOMAIN_${ok.reason}`,
          'This plan cannot be issued right now.',
        );
      const target = await this.resolveTarget(tx, propertyId, body.target);
      if (!v.lockedAt)
        await tx.planVersion.updateMany({
          where: { id: v.id, lockedAt: null },
          data: { lockedAt: new Date() },
        });

      const issued = [];
      for (let i = 0; i < body.quantity; i++) {
        const g = await this.access.grant(tx, {
          propertyId,
          timeZone: v.plan.property.timeZone,
          plan: { ...snapshot, status: 'PUBLISHED' },
          target,
          ownerUserId: target.scope === 'INDIVIDUAL' ? target.userId : null,
          orderId: null,
          issuance: { type: body.issuanceType, issuedById: auth.user.id, reason: body.reason },
          now: new Date(),
        });
        issued.push(g);
      }
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        propertyId,
        action: 'voucher.issued',
        targetType: 'plan_version',
        targetId: v.id,
        reason: body.reason,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        // Ids and hints only — never codes.
        metadata: {
          issuanceType: body.issuanceType,
          quantity: body.quantity,
          vouchers: issued.map((g) => ({ id: g.voucherId, hint: g.hint })),
        },
      });
      return {
        notice: 'Codes are shown once. Copy them now; they cannot be retrieved later.',
        vouchers: issued.map((g) => ({
          voucherId: g.voucherId,
          code: formatVoucherCode(g.code),
          redeemBy: g.redeemBy?.toISOString() ?? null,
        })),
      };
    });
  }

  @RequirePermission('voucher.read')
  @Get()
  async list(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    const where: Prisma.VoucherWhereInput = {
      propertyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.hint ? { hint: q.hint } : {}),
    };
    const rows = await this.prisma.voucher.findMany({
      where,
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        hint: true,
        status: true,
        issuanceType: true,
        scope: true,
        issuedAt: true,
        activatedAt: true,
        redeemBy: true,
        revokedAt: true,
        issueReason: true,
        orderId: true,
        entitlementId: true,
        replacesVoucherId: true,
        issuedBy: { select: { id: true, displayName: true } },
        _count: { select: { redemptions: { where: { releasedAt: null } } } },
      },
    });
    const data = rows
      .slice(0, q.limit)
      .map(({ _count, ...v }) => ({ ...v, activeDevices: _count.redemptions }));
    return { data, meta: { nextCursor: rows.length > q.limit ? data.at(-1)?.id : null } };
  }

  @RequirePermission('voucher.read')
  @Get(':voucherId/redemptions')
  async redemptions(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('voucherId', new ParseUUIDPipe()) voucherId: string,
  ) {
    const v = await this.prisma.voucher.findFirst({
      where: { id: voucherId, propertyId },
      select: { id: true },
    });
    if (!v) throw notFound();
    return this.prisma.voucherRedemption.findMany({
      where: { voucherId },
      orderBy: { redeemedAt: 'asc' },
      select: {
        id: true,
        redeemedAt: true,
        releasedAt: true,
        userId: true,
        device: { select: { id: true, macAddress: true, label: true } },
      },
    });
  }

  @RequirePermission('voucher.manage')
  @Post(':voucherId/suspend')
  @HttpCode(200)
  suspend(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('voucherId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.transition(a, m, p, id, b.reason, () => 'SUSPENDED');
  }

  /** Back to ACTIVE if it was ever redeemed, otherwise ISSUED. */
  @RequirePermission('voucher.manage')
  @Post(':voucherId/reinstate')
  @HttpCode(200)
  reinstate(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('voucherId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.transition(
      a,
      m,
      p,
      id,
      b.reason,
      (v) => (v.activatedAt ? 'ACTIVE' : 'ISSUED'),
      'SUSPENDED',
    );
  }

  @RequirePermission('voucher.manage')
  @Post(':voucherId/revoke')
  @HttpCode(200)
  revoke(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('voucherId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.transition(a, m, p, id, b.reason, () => 'REVOKED');
  }

  /** Revoke the current credential and issue a new one for the same entitlement (e.g. lost or leaked code). */
  @RequirePermission('voucher.manage')
  @Post(':voucherId/reissue')
  @HttpCode(200)
  async reissue(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('voucherId', new ParseUUIDPipe()) voucherId: string,
    @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.lockVoucher(tx, propertyId, voucherId);
      if (v.status === 'REVOKED' || v.status === 'EXPIRED')
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This voucher can no longer be reissued.',
        );
      if (!v.entitlementId)
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'This voucher has no access attached.');
      await tx.voucher.update({
        where: { id: v.id },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokeReason: `reissued: ${body.reason}`,
        },
      });
      const n = await this.access.reissue(tx, v, auth.user.id, body.reason);
      // Devices already bound stay bound to the entitlement; move them to the new credential.
      await tx.voucherRedemption.updateMany({
        where: { voucherId: v.id, releasedAt: null },
        data: { voucherId: n.voucherId },
      });
      if (v.activatedAt)
        await tx.voucher.update({
          where: { id: n.voucherId },
          data: {
            status: v.status === 'EXHAUSTED' ? 'EXHAUSTED' : 'ACTIVE',
            activatedAt: v.activatedAt,
          },
        });
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        propertyId,
        action: 'voucher.reissued',
        targetType: 'voucher',
        targetId: v.id,
        reason: body.reason,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { newVoucherId: n.voucherId, newHint: n.hint },
      });
      return {
        notice: 'The new code is shown once.',
        voucherId: n.voucherId,
        code: formatVoucherCode(n.code),
      };
    });
  }

  private async lockVoucher(tx: Tx, propertyId: string, voucherId: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "vouchers" WHERE "id" = ${voucherId}::uuid AND "propertyId" = ${propertyId}::uuid FOR UPDATE`;
    if (!rows[0]) throw notFound();
    return tx.voucher.findUniqueOrThrow({ where: { id: voucherId } });
  }

  private transition(
    auth: AuthContext,
    meta: RequestMetaValue,
    propertyId: string,
    voucherId: string,
    why: string,
    to: (v: { activatedAt: Date | null }) => VoucherStatus,
    requireFrom?: VoucherStatus,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.lockVoucher(tx, propertyId, voucherId);
      const target = to(v);
      if (requireFrom && v.status !== requireFrom)
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          `Only ${requireFrom.toLowerCase()} vouchers can be reinstated.`,
        );
      if (!voucherStateMachine.canTransition(v.status, target)) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          `A ${v.status.toLowerCase()} voucher cannot become ${target.toLowerCase()}.`,
        );
      }
      await tx.voucher.update({
        where: { id: v.id },
        data: {
          status: target,
          ...(target === 'REVOKED' ? { revokedAt: new Date(), revokeReason: why } : {}),
        },
      });
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        propertyId,
        action: `voucher.${target === 'SUSPENDED' ? 'suspended' : target === 'REVOKED' ? 'revoked' : 'reinstated'}`,
        targetType: 'voucher',
        targetId: v.id,
        reason: why,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { from: v.status, to: target },
      });
      return { status: target };
    });
  }

  private async resolveTarget(
    tx: Tx,
    propertyId: string,
    t: z.infer<typeof Issue>['target'],
  ): Promise<ScopeTarget | { scope: 'INDIVIDUAL'; userId: null }> {
    if (t.scope === 'INDIVIDUAL') {
      if (!t.userId) return { scope: 'INDIVIDUAL', userId: null };
      const u = await tx.user.findFirst({
        where: { id: t.userId, kind: 'TENANT', assignments: { some: { propertyId } } },
      });
      if (!u) throw notFound();
      return { scope: 'INDIVIDUAL', userId: u.id };
    }
    if (t.scope === 'ROOM') {
      if (!(await tx.room.findFirst({ where: { id: t.roomId, propertyId } }))) throw notFound();
      return { scope: 'ROOM', roomId: t.roomId };
    }
    if (!(await tx.floor.findFirst({ where: { id: t.floorId, propertyId } }))) throw notFound();
    return { scope: 'FLOOR', floorId: t.floorId };
  }
}
