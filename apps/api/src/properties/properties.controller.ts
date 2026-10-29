import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PrismaClient } from '@netflex/database';
import { assertValidTimeZone, isCurrencyCode, propertiesWith } from '@netflex/domain';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CurrentAuth,
  RequestMeta,
  RequirePermission,
  type RequestMetaValue,
  RequireKind,
} from '../auth/decorators.js';
import { conflictOnUnique, notFound } from '../common/prisma-errors.js';
import { ZodPipe, email } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';

const timeZone = z.string().refine((tz) => {
  try {
    assertValidTimeZone(tz);
    return true;
  } catch {
    return false;
  }
}, 'unknown time zone');

const CreateProperty = z.strictObject({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  name: z.string().trim().min(2).max(120),
  timeZone: timeZone.default('Africa/Lagos'),
  currency: z.string().refine(isCurrencyCode, 'unsupported currency').default('NGN'),
  supportPhone: z.string().trim().max(32).optional(),
  supportEmail: email.optional(),
});
const Name = z.strictObject({ name: z.string().trim().min(1).max(80) });
const CreateFloor = z.strictObject({
  label: z.string().trim().min(1).max(40),
  level: z.number().int().min(-5).max(200),
});
const Label = z.strictObject({ label: z.string().trim().min(1).max(40) });

/**
 * Property structure administration. Every query is filtered by the :propertyId
 * the guard authorized, so IDs from another property resolve to 404.
 */
@RequireKind('STAFF')
@ApiTags('admin: properties')
@Controller({ path: 'admin/properties' })
export class PropertiesController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext) {
    const scope = propertiesWith(auth.actor, 'property.read');
    return this.prisma.property.findMany({
      where: scope === 'ALL' ? {} : { id: { in: scope } },
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, timeZone: true, currency: true },
    });
  }

  @RequirePermission('property.create')
  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(CreateProperty)) body: z.infer<typeof CreateProperty>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.prisma
      .$transaction(async (tx) => {
        const p = await tx.property.create({ data: body });
        await this.audit.record(tx, {
          actorType: 'USER',
          actorUserId: auth.user.id,
          propertyId: p.id,
          action: 'property.created',
          targetType: 'property',
          targetId: p.id,
          correlationId: meta.requestId,
          ipAddress: meta.ip,
          metadata: { slug: p.slug, name: p.name },
        });
        return p;
      })
      .catch((e: unknown) => conflictOnUnique(e, 'A property with this slug already exists.'));
  }

  @RequirePermission('property.read')
  @Get(':propertyId')
  async get(@Param('propertyId', new ParseUUIDPipe()) propertyId: string) {
    const p = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        buildings: {
          orderBy: { name: 'asc' },
          include: {
            floors: {
              orderBy: { level: 'asc' },
              include: { rooms: { orderBy: { label: 'asc' }, select: { id: true, label: true } } },
            },
          },
        },
      },
    });
    if (!p) throw notFound();
    return p;
  }

  @RequirePermission('property.manage')
  @Post(':propertyId/buildings')
  async createBuilding(
    @CurrentAuth() auth: AuthContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body(new ZodPipe(Name)) body: z.infer<typeof Name>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.mutate(auth, meta, propertyId, 'building.created', 'building', (tx) =>
      tx.building.create({ data: { propertyId, name: body.name } }),
    ).catch((e: unknown) => conflictOnUnique(e, 'A building with this name already exists.'));
  }

  @RequirePermission('property.manage')
  @Patch(':propertyId/buildings/:buildingId')
  async renameBuilding(
    @CurrentAuth() auth: AuthContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('buildingId', new ParseUUIDPipe()) buildingId: string,
    @Body(new ZodPipe(Name)) body: z.infer<typeof Name>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.mutate(auth, meta, propertyId, 'building.renamed', 'building', async (tx) => {
      const b = await tx.building.findFirst({ where: { id: buildingId, propertyId } });
      if (!b) throw notFound();
      return tx.building.update({ where: { id: b.id }, data: { name: body.name } });
    }).catch((e: unknown) => conflictOnUnique(e, 'A building with this name already exists.'));
  }

  @RequirePermission('property.manage')
  @Post(':propertyId/buildings/:buildingId/floors')
  async createFloor(
    @CurrentAuth() auth: AuthContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('buildingId', new ParseUUIDPipe()) buildingId: string,
    @Body(new ZodPipe(CreateFloor)) body: z.infer<typeof CreateFloor>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.mutate(auth, meta, propertyId, 'floor.created', 'floor', async (tx) => {
      const b = await tx.building.findFirst({ where: { id: buildingId, propertyId } });
      if (!b) throw notFound();
      return tx.floor.create({
        data: { propertyId, buildingId: b.id, label: body.label, level: body.level },
      });
    }).catch((e: unknown) =>
      conflictOnUnique(e, 'This building already has a floor at that level.'),
    );
  }

  @RequirePermission('property.manage')
  @Post(':propertyId/floors/:floorId/rooms')
  async createRoom(
    @CurrentAuth() auth: AuthContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('floorId', new ParseUUIDPipe()) floorId: string,
    @Body(new ZodPipe(Label)) body: z.infer<typeof Label>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.mutate(auth, meta, propertyId, 'room.created', 'room', async (tx) => {
      const f = await tx.floor.findFirst({ where: { id: floorId, propertyId } });
      if (!f) throw notFound();
      return tx.room.create({ data: { propertyId, floorId: f.id, label: body.label } });
    }).catch((e: unknown) => conflictOnUnique(e, 'This floor already has a room with that label.'));
  }

  @RequirePermission('property.manage')
  @Patch(':propertyId/rooms/:roomId')
  async renameRoom(
    @CurrentAuth() auth: AuthContext,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('roomId', new ParseUUIDPipe()) roomId: string,
    @Body(new ZodPipe(Label)) body: z.infer<typeof Label>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.mutate(auth, meta, propertyId, 'room.renamed', 'room', async (tx) => {
      const r = await tx.room.findFirst({ where: { id: roomId, propertyId } });
      if (!r) throw notFound();
      return tx.room.update({ where: { id: r.id }, data: { label: body.label } });
    }).catch((e: unknown) => conflictOnUnique(e, 'This floor already has a room with that label.'));
  }

  private mutate<T extends { id: string }>(
    auth: AuthContext,
    meta: RequestMetaValue,
    propertyId: string,
    action: string,
    targetType: string,
    fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const result = await fn(tx);
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        propertyId,
        action,
        targetType,
        targetId: result.id,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      });
      return result;
    });
  }
}
