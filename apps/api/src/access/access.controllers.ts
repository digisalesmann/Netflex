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
import { DURATION_UNITS, ENTITLEMENT_STATUSES } from '@netflex/domain';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CurrentAuth,
  RequestMeta,
  RequireKind,
  RequirePermission,
  type RequestMetaValue,
} from '../auth/decorators.js';
import { notFound } from '../common/prisma-errors.js';
import { ZodPipe, phoneE164, reason, uuid } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';
import { LifecycleService, accessState, actorOf } from './lifecycle.service.js';

const Reason = z.strictObject({ reason });
const Extend = z.strictObject({
  by: z.strictObject({ value: z.number().int().positive(), unit: z.enum(DURATION_UNITS) }),
  reason,
});
const AddMember = z.strictObject({ phone: phoneE164 });
const Transfer = z.strictObject({ toUserId: uuid, reason });
const ListQuery = z.strictObject({
  status: z.enum(ENTITLEMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: uuid.optional(),
});
const Empty = z.strictObject({});

@RequireKind('STAFF')
@ApiTags('admin: access')
@Controller({ path: 'admin/properties/:propertyId/entitlements' })
export class AdminAccessController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LifecycleService) private readonly svc: LifecycleService,
  ) {}

  @RequirePermission('subscription.read')
  @Get()
  async list(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    const rows = await this.prisma.entitlement.findMany({
      where: { propertyId, ...(q.status ? { status: q.status } : {}) },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        scope: true,
        status: true,
        startsAt: true,
        expiresAt: true,
        activationDeadline: true,
        desiredNetworkState: true,
        observedNetworkState: true,
        maxDevices: true,
        targetUserId: true,
        targetRoomId: true,
        targetFloorId: true,
        subscription: { select: { id: true, orderId: true, ownerUserId: true } },
        _count: { select: { redemptions: { where: { releasedAt: null } } } },
      },
    });
    const data = rows
      .slice(0, q.limit)
      .map(({ _count, ...e }) => ({ ...e, activeDevices: _count.redemptions }));
    return { data, meta: { nextCursor: rows.length > q.limit ? data.at(-1)?.id : null } };
  }

  @RequirePermission('subscription.read')
  @Get(':entitlementId')
  async get(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
  ) {
    const e = await this.prisma.entitlement.findFirst({
      where: { id, propertyId },
      include: {
        subscription: {
          include: {
            memberships: {
              where: { removedAt: null },
              include: { user: { select: { displayName: true, phoneE164: true } } },
            },
            order: { select: { id: true, reference: true, status: true } },
          },
        },
        vouchers: {
          select: {
            id: true,
            hint: true,
            status: true,
            issuanceType: true,
            issuedAt: true,
            revokedAt: true,
          },
        },
        redemptions: {
          orderBy: { redeemedAt: 'asc' },
          select: {
            id: true,
            redeemedAt: true,
            releasedAt: true,
            userId: true,
            device: { select: { macAddress: true } },
          },
        },
        renewalOrders: { select: { id: true, reference: true, status: true } },
      },
    });
    if (!e) throw notFound();
    const remaining = e.expiresAt
      ? Math.max(0, Math.floor((e.expiresAt.getTime() - Date.now()) / 1000))
      : null;
    return { ...e, customerState: accessState(e.status, e.observedNetworkState, remaining) };
  }

  @RequirePermission('subscription.manage')
  @Post(':entitlementId/suspend')
  @HttpCode(200)
  async suspend(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    await this.svc.suspend(p, id, actorOf(a, m), b.reason);
    return { status: 'SUSPENDED' };
  }

  @RequirePermission('subscription.manage')
  @Post(':entitlementId/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    await this.svc.reactivate(p, id, actorOf(a, m), b.reason);
    return { status: 'PROVISIONING' };
  }

  @RequirePermission('subscription.manage')
  @Post(':entitlementId/revoke')
  @HttpCode(200)
  async revoke(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    await this.svc.revoke(p, id, actorOf(a, m), b.reason);
    return { status: 'REVOKED' };
  }

  @RequirePermission('subscription.manage')
  @Post(':entitlementId/extend')
  @HttpCode(200)
  async extend(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Extend)) b: z.infer<typeof Extend>,
  ) {
    const r = await this.svc.extend(p, id, b.by, actorOf(a, m), b.reason);
    return {
      expiresAt: r.expiresAt?.toISOString() ?? null,
      activationDeadline: r.activationDeadline?.toISOString() ?? null,
    };
  }

  @RequirePermission('subscription.manage')
  @Post(':entitlementId/devices/:redemptionId/release')
  @HttpCode(200)
  async release(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Param('redemptionId', new ParseUUIDPipe()) rid: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    await this.svc.releaseByStaff(p, id, rid, actorOf(a, m), b.reason);
    return { released: true };
  }

  @RequirePermission('subscription.manage')
  @Post(':entitlementId/members')
  addMember(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AddMember)) b: z.infer<typeof AddMember>,
  ) {
    return this.svc.run((tx) => this.svc.addMember(tx, id, b.phone, actorOf(a, m), p));
  }

  @RequirePermission('subscription.manage')
  @Post(':entitlementId/members/:membershipId/remove')
  @HttpCode(200)
  async removeMember(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Param('membershipId', new ParseUUIDPipe()) mid: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    await this.svc.run((tx) =>
      this.svc.removeMemberChecked(tx, id, mid, actorOf(a, m), b.reason, p),
    );
    return { removed: true };
  }

  @RequirePermission('subscription.manage')
  @Post(':entitlementId/transfer-manager')
  @HttpCode(200)
  async transfer(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Transfer)) b: z.infer<typeof Transfer>,
  ) {
    await this.svc.run((tx) =>
      this.svc.transferManager(tx, id, b.toUserId, actorOf(a, m), b.reason, p),
    );
    return { transferred: true };
  }
}

/** Tenant self-service: only access the tenant owns, manages or belongs to. */
@RequireKind('TENANT')
@ApiTags('me: access')
@Controller({ path: 'me/access' })
export class MyAccessController {
  constructor(@Inject(LifecycleService) private readonly svc: LifecycleService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.svc.myAccess(auth.user.id);
  }

  @Post(':entitlementId/devices/:redemptionId/release')
  @HttpCode(200)
  async release(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Param('redemptionId', new ParseUUIDPipe()) rid: string,
    @Body(new ZodPipe(Empty)) _b: z.infer<typeof Empty>,
  ) {
    await this.svc.releaseByTenant(auth, meta, id, rid);
    return { released: true };
  }

  @Post(':entitlementId/members')
  addMember(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AddMember)) b: z.infer<typeof AddMember>,
  ) {
    return this.svc.run(async (tx) => {
      const v = await this.svc.accessFor(tx, auth.user.id, id);
      if (v.role !== 'MANAGER') throw notFound();
      return this.svc.addMember(tx, id, b.phone, actorOf(auth, meta));
    });
  }

  /** Managers remove members; members may remove themselves (leave). */
  @Post(':entitlementId/members/:membershipId/remove')
  @HttpCode(200)
  async removeMember(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Param('membershipId', new ParseUUIDPipe()) mid: string,
    @Body(new ZodPipe(Empty)) _b: z.infer<typeof Empty>,
  ) {
    await this.svc.run(async (tx) => {
      const v = await this.svc.accessFor(tx, auth.user.id, id);
      const target = await tx.groupMembership.findFirst({ where: { id: mid, removedAt: null } });
      if (!target || (v.role !== 'MANAGER' && target.userId !== auth.user.id)) throw notFound();
      await this.svc.removeMemberChecked(
        tx,
        id,
        mid,
        actorOf(auth, meta),
        v.role === 'MANAGER' ? 'removed by manager' : 'member left',
      );
    });
    return { removed: true };
  }

  @Post(':entitlementId/transfer-manager')
  @HttpCode(200)
  async transfer(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('entitlementId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Transfer)) b: z.infer<typeof Transfer>,
  ) {
    await this.svc.run(async (tx) => {
      const v = await this.svc.accessFor(tx, auth.user.id, id);
      if (v.role !== 'MANAGER') throw notFound();
      await this.svc.transferManager(tx, id, b.toUserId, actorOf(auth, meta), b.reason);
    });
    return { transferred: true };
  }
}
