import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@netflex/database';
import { AuditService, type Tx } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMetaValue } from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { notFound } from '../common/prisma-errors.js';
import { PRISMA } from '../infra/tokens.js';

interface Ctx {
  auth: AuthContext;
  meta: RequestMetaValue;
  propertyId: string;
}

const badRequest = (msg: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', msg);

/**
 * Tenants, room assignments (with history) and room/floor purchase authority.
 * All reads and writes are confined to the authorized property. A tenant is
 * visible to a property only through assignments in that property.
 */
@Injectable()
export class TenancyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async room(tx: Tx, propertyId: string, roomId: string) {
    const r = await tx.room.findFirst({
      where: { id: roomId, propertyId },
      select: { id: true, floorId: true },
    });
    if (!r) throw notFound();
    return r;
  }

  /** A tenant belongs to this property's view only if they have (or had) an assignment here. */
  private async tenantInProperty(tx: Tx | PrismaClient, propertyId: string, userId: string) {
    const u = await tx.user.findFirst({
      where: { id: userId, kind: 'TENANT', assignments: { some: { propertyId } } },
      select: { id: true, displayName: true, phoneE164: true, status: true },
    });
    if (!u) throw notFound();
    return u;
  }

  private async log(
    tx: Tx,
    c: Ctx,
    action: string,
    targetType: string,
    targetId: string,
    extra: { reason?: string; metadata?: Record<string, unknown> } = {},
  ) {
    await this.audit.record(tx, {
      actorType: 'USER',
      actorUserId: c.auth.user.id,
      propertyId: c.propertyId,
      action,
      targetType,
      targetId,
      reason: extra.reason ?? null,
      correlationId: c.meta.requestId,
      ipAddress: c.meta.ip,
      metadata: extra.metadata ?? {},
    });
  }

  async listTenants(propertyId: string, q: { search?: string; limit: number; cursor?: string }) {
    const where: Prisma.UserWhereInput = {
      kind: 'TENANT',
      assignments: { some: { propertyId } },
      ...(q.search
        ? {
            OR: [
              { displayName: { contains: q.search, mode: 'insensitive' } },
              { phoneE164: { contains: q.search.replace(/\s/g, '') } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        displayName: true,
        phoneE164: true,
        status: true,
        assignments: {
          where: { propertyId, endsAt: null },
          select: {
            id: true,
            startsAt: true,
            room: { select: { id: true, label: true, floorId: true } },
          },
        },
      },
    });
    const hasMore = rows.length > q.limit;
    const data = rows
      .slice(0, q.limit)
      .map(({ assignments, ...u }) => ({ ...u, currentAssignment: assignments[0] ?? null }));
    return { data, meta: { nextCursor: hasMore ? data.at(-1)?.id : null } };
  }

  async getTenant(propertyId: string, userId: string) {
    const u = await this.tenantInProperty(this.prisma, propertyId, userId);
    const [assignments, authorities] = await Promise.all([
      this.prisma.tenantAssignment.findMany({
        where: { propertyId, userId },
        orderBy: { startsAt: 'desc' },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          reason: true,
          room: { select: { id: true, label: true } },
        },
      }),
      this.prisma.groupAuthority.findMany({
        where: { propertyId, userId, revokedAt: null },
        select: { id: true, scope: true, roomId: true, floorId: true, grantedAt: true },
      }),
    ]);
    return { ...u, assignments, authorities };
  }

  /** Onboard a tenant by phone into a room. Reuses an existing tenant account with that phone. */
  async onboard(
    c: Ctx,
    input: { phone: string; displayName: string; roomId: string; startsAt: Date; reason?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const room = await this.room(tx, c.propertyId, input.roomId);
      let user = await tx.user.findUnique({ where: { phoneE164: input.phone } });
      if (user && user.kind !== 'TENANT')
        throw badRequest('This phone number belongs to a staff account.');
      const created = !user;
      user ??= await tx.user.create({
        data: { kind: 'TENANT', phoneE164: input.phone, displayName: input.displayName },
      });
      const open = await tx.tenantAssignment.findFirst({
        where: { userId: user.id, propertyId: c.propertyId, endsAt: null },
      });
      if (open)
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This tenant already has a room here. Use a room move instead.',
        );
      const a = await tx.tenantAssignment.create({
        data: {
          propertyId: c.propertyId,
          userId: user.id,
          roomId: room.id,
          startsAt: input.startsAt,
          reason: input.reason ?? 'onboarding',
          createdById: c.auth.user.id,
        },
      });
      if (created) await this.log(tx, c, 'tenant.created', 'user', user.id);
      await this.log(tx, c, 'tenant.assigned', 'tenant_assignment', a.id, {
        reason: input.reason,
        metadata: { userId: user.id, roomId: room.id },
      });
      return { userId: user.id, assignmentId: a.id, createdAccount: created };
    });
  }

  /**
   * Move a tenant to another room: closes the open assignment at `startsAt` and opens
   * a new one, atomically. Purchase authority tied to the old room/floor is revoked.
   */
  async move(c: Ctx, input: { userId: string; roomId: string; startsAt: Date; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.tenantInProperty(tx, c.propertyId, input.userId);
      const room = await this.room(tx, c.propertyId, input.roomId);
      const open = await tx.tenantAssignment.findFirst({
        where: { userId: input.userId, propertyId: c.propertyId, endsAt: null },
        include: { room: { select: { floorId: true } } },
      });
      if (open) {
        if (open.roomId === room.id) throw badRequest('The tenant is already in this room.');
        if (input.startsAt <= open.startsAt)
          throw badRequest('The move date must be after the current assignment started.');
        await tx.tenantAssignment.update({
          where: { id: open.id },
          data: { endsAt: input.startsAt },
        });
        await this.revokeStaleAuthorities(tx, c, input.userId, room, 'room move');
      }
      const a = await tx.tenantAssignment.create({
        data: {
          propertyId: c.propertyId,
          userId: input.userId,
          roomId: room.id,
          startsAt: input.startsAt,
          reason: input.reason,
          createdById: c.auth.user.id,
        },
      });
      await this.log(tx, c, open ? 'tenant.moved' : 'tenant.assigned', 'tenant_assignment', a.id, {
        reason: input.reason,
        metadata: { userId: input.userId, fromRoomId: open?.roomId ?? null, toRoomId: room.id },
      });
      return { assignmentId: a.id };
    });
  }

  /** Record a departure. All purchase authority in this property is revoked. */
  async endAssignment(c: Ctx, assignmentId: string, input: { endsAt: Date; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.tenantAssignment.findFirst({
        where: { id: assignmentId, propertyId: c.propertyId },
      });
      if (!a) throw notFound();
      if (a.endsAt)
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'This assignment has already ended.');
      if (input.endsAt <= a.startsAt)
        throw badRequest('The end date must be after the start date.');
      await tx.tenantAssignment.update({ where: { id: a.id }, data: { endsAt: input.endsAt } });
      await this.revokeStaleAuthorities(tx, c, a.userId, null, 'departure');
      await this.log(tx, c, 'tenant.departed', 'tenant_assignment', a.id, {
        reason: input.reason,
        metadata: { userId: a.userId },
      });
      return { ended: true };
    });
  }

  /** Revoke authorities the tenant no longer qualifies for after leaving `newRoom` (null = left the property). */
  private async revokeStaleAuthorities(
    tx: Tx,
    c: Ctx,
    userId: string,
    newRoom: { id: string; floorId: string } | null,
    why: string,
  ) {
    const active = await tx.groupAuthority.findMany({
      where: { userId, propertyId: c.propertyId, revokedAt: null },
    });
    for (const g of active) {
      const keep =
        newRoom !== null &&
        ((g.scope === 'ROOM' && g.roomId === newRoom.id) ||
          (g.scope === 'FLOOR' && g.floorId === newRoom.floorId));
      if (keep) continue;
      await tx.groupAuthority.update({ where: { id: g.id }, data: { revokedAt: new Date() } });
      await this.log(tx, c, 'group_authority.revoked', 'group_authority', g.id, {
        reason: `automatic: ${why}`,
        metadata: { userId },
      });
    }
  }

  /**
   * Grant room/floor purchase authority. The tenant must currently live in that
   * room (ROOM) or on that floor (FLOOR).
   */
  async grantAuthority(
    c: Ctx,
    input: { userId: string; scope: 'ROOM' | 'FLOOR'; targetId: string; reason: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.tenantInProperty(tx, c.propertyId, input.userId);
      const open = await tx.tenantAssignment.findFirst({
        where: { userId: input.userId, propertyId: c.propertyId, endsAt: null },
        include: { room: { select: { id: true, floorId: true } } },
      });
      let roomId: string | null = null;
      let floorId: string | null = null;
      if (input.scope === 'ROOM') {
        roomId = (await this.room(tx, c.propertyId, input.targetId)).id;
        if (open?.roomId !== roomId)
          throw badRequest('The tenant must currently live in this room.');
      } else {
        const f = await tx.floor.findFirst({
          where: { id: input.targetId, propertyId: c.propertyId },
        });
        if (!f) throw notFound();
        floorId = f.id;
        if (open?.room.floorId !== floorId)
          throw badRequest('The tenant must currently live on this floor.');
      }
      const existing = await tx.groupAuthority.findFirst({
        where: { userId: input.userId, propertyId: c.propertyId, revokedAt: null, roomId, floorId },
      });
      if (existing)
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'This authority is already granted.');
      const g = await tx.groupAuthority.create({
        data: {
          propertyId: c.propertyId,
          userId: input.userId,
          scope: input.scope,
          roomId,
          floorId,
          grantedById: c.auth.user.id,
        },
      });
      await this.log(tx, c, 'group_authority.granted', 'group_authority', g.id, {
        reason: input.reason,
        metadata: { userId: input.userId, scope: input.scope, roomId, floorId },
      });
      return { id: g.id };
    });
  }

  async revokeAuthority(c: Ctx, authorityId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const g = await tx.groupAuthority.findFirst({
        where: { id: authorityId, propertyId: c.propertyId, revokedAt: null },
      });
      if (!g) throw notFound();
      await tx.groupAuthority.update({ where: { id: g.id }, data: { revokedAt: new Date() } });
      await this.log(tx, c, 'group_authority.revoked', 'group_authority', g.id, {
        reason,
        metadata: { userId: g.userId },
      });
      return { revoked: true };
    });
  }
}
