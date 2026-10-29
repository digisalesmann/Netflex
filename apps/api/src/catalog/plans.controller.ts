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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma, PrismaClient } from '@netflex/database';
import {
  ACCESS_SCOPES,
  ACTIVATION_POLICIES,
  DURATION_UNITS,
  DomainError,
  RENEWAL_RULES,
  isCurrencyCode,
  parseMajorUnits,
  planStateMachine,
  validatePlanVersion,
  type PlanStatus,
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
import { conflictOnUnique, notFound } from '../common/prisma-errors.js';
import { ZodPipe, reason } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';
import { publicPlanView, toSnapshot } from './plan-mapper.js';

const duration = z.strictObject({
  value: z.number().int().positive(),
  unit: z.enum(DURATION_UNITS),
});
const VersionInput = z.strictObject({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(1).max(1000),
  scope: z.enum(ACCESS_SCOPES),
  /** Major units as a decimal string, e.g. "1500" or "1500.50". Never a float. */
  price: z
    .string()
    .trim()
    .regex(/^\d{1,15}(\.\d{1,2})?$/),
  currency: z.string().refine(isCurrencyCode, 'unsupported currency').optional(),
  duration,
  activationPolicy: z.enum(ACTIVATION_POLICIES),
  redemptionWindow: duration.nullable(),
  maxDevices: z.number().int(),
  maxConcurrentSessions: z.number().int(),
  downloadKbps: z.number().int().nullable(),
  uploadKbps: z.number().int().nullable(),
  maxGroupMembers: z.number().int().nullable(),
  renewalRule: z.enum(RENEWAL_RULES),
  availableFrom: z.coerce.date().nullable(),
  availableUntil: z.coerce.date().nullable(),
  fairUseText: z.string().trim().max(2000).nullable(),
  refundPolicyText: z.string().trim().min(1).max(2000),
  termsVersion: z.string().trim().min(1).max(40),
});
const CreatePlan = z.strictObject({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  version: VersionInput,
});
const Reason = z.strictObject({ reason });

type VersionInputT = z.infer<typeof VersionInput>;

/**
 * Plan catalog administration (spec §10). Versions are drafts until published;
 * a version is locked forever once an order uses it, so edits create new versions.
 */
@RequireKind('STAFF')
@ApiTags('admin: plans')
@Controller({ path: 'admin/properties/:propertyId/plans' })
export class PlansController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermission('plan.read')
  @Get()
  async list(@Param('propertyId', new ParseUUIDPipe()) propertyId: string) {
    const plans = await this.prisma.plan.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    return plans.map((p) => ({
      id: p.id,
      slug: p.slug,
      status: p.status,
      currentVersion: p.versions.find((v) => v.publishedAt)?.version ?? null,
      latestVersion: p.versions[0]?.version ?? null,
      versions: p.versions.map((v) => ({
        id: v.id,
        version: v.version,
        name: v.name,
        publishedAt: v.publishedAt,
        locked: v.lockedAt !== null,
        price: v.priceMinor.toString(),
      })),
    }));
  }

  @RequirePermission('plan.read')
  @Get(':planId')
  async get(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('planId', new ParseUUIDPipe()) planId: string,
  ) {
    const p = await this.prisma.plan.findFirst({
      where: { id: planId, propertyId },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!p) throw notFound();
    return {
      id: p.id,
      slug: p.slug,
      status: p.status,
      versions: p.versions.map((v) => ({
        ...publicPlanView(p, v),
        version: v.version,
        publishedAt: v.publishedAt,
        locked: v.lockedAt !== null,
      })),
    };
  }

  @RequirePermission('plan.manage')
  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body(new ZodPipe(CreatePlan)) body: z.infer<typeof CreatePlan>,
  ) {
    return this.prisma
      .$transaction(async (tx) => {
        const property = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
        const plan = await tx.plan.create({ data: { propertyId, slug: body.slug } });
        const v = await this.createVersion(tx, auth, plan, 1, body.version, property.currency);
        await this.log(tx, auth, meta, propertyId, 'plan.created', plan.id, undefined, {
          slug: plan.slug,
          versionId: v.id,
        });
        return { planId: plan.id, versionId: v.id, version: 1 };
      })
      .catch((e: unknown) => conflictOnUnique(e, 'A plan with this slug already exists.'));
  }

  /** New draft version (the only way to change a plan's terms). */
  @RequirePermission('plan.manage')
  @Post(':planId/versions')
  async newVersion(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body(new ZodPipe(VersionInput)) body: VersionInputT,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findFirst({
        where: { id: planId, propertyId },
        include: { property: true },
      });
      if (!plan) throw notFound();
      if (plan.status === 'ARCHIVED')
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'Archived plans cannot change.');
      const last = await tx.planVersion.findFirst({
        where: { planId },
        orderBy: { version: 'desc' },
      });
      const v = await this.createVersion(
        tx,
        auth,
        plan,
        (last?.version ?? 0) + 1,
        body,
        plan.property.currency,
      );
      await this.log(tx, auth, meta, propertyId, 'plan.version_created', plan.id, undefined, {
        versionId: v.id,
        version: v.version,
      });
      return { versionId: v.id, version: v.version };
    });
  }

  @RequirePermission('plan.manage')
  @Post(':planId/versions/:versionId/publish')
  @HttpCode(200)
  async publish(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { id: planId, propertyId } });
      const v = plan && (await tx.planVersion.findFirst({ where: { id: versionId, planId } }));
      if (!plan || !v) throw notFound();
      if (v.publishedAt)
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'This version is already published.');
      const newer = await tx.planVersion.findFirst({
        where: { planId, version: { gt: v.version }, publishedAt: { not: null } },
      });
      if (newer)
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'A newer version is already published.',
        );
      validatePlanVersion(toSnapshot(plan, v));
      await tx.planVersion.update({ where: { id: v.id }, data: { publishedAt: new Date() } });
      if (plan.status !== 'PUBLISHED') await this.transition(tx, plan.id, plan.status, 'PUBLISHED');
      await this.log(tx, auth, meta, propertyId, 'plan.version_published', plan.id, undefined, {
        versionId: v.id,
        version: v.version,
      });
      return { published: true };
    });
  }

  @RequirePermission('plan.manage')
  @Post(':planId/pause')
  @HttpCode(200)
  pause(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('planId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.changeStatus(a, m, p, id, 'PAUSED', b.reason);
  }

  @RequirePermission('plan.manage')
  @Post(':planId/resume')
  @HttpCode(200)
  resume(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('planId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.changeStatus(a, m, p, id, 'PUBLISHED', b.reason);
  }

  @RequirePermission('plan.manage')
  @Post(':planId/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('planId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.changeStatus(a, m, p, id, 'ARCHIVED', b.reason);
  }

  private changeStatus(
    auth: AuthContext,
    meta: RequestMetaValue,
    propertyId: string,
    planId: string,
    to: PlanStatus,
    why: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { id: planId, propertyId } });
      if (!plan) throw notFound();
      if (
        to === 'PUBLISHED' &&
        !(await tx.planVersion.findFirst({ where: { planId, publishedAt: { not: null } } }))
      ) {
        throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'Publish a version first.');
      }
      await this.transition(tx, plan.id, plan.status, to);
      await this.log(tx, auth, meta, propertyId, `plan.${to.toLowerCase()}`, plan.id, why, {
        from: plan.status,
      });
      return { status: to };
    });
  }

  private async transition(tx: Tx, planId: string, from: PlanStatus, to: PlanStatus) {
    planStateMachine.assertTransition(from, to);
    // Conditional update guards against a concurrent status change.
    const r = await tx.plan.updateMany({
      where: { id: planId, status: from },
      data: { status: to },
    });
    if (r.count !== 1)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'The plan changed meanwhile. Refresh and try again.',
      );
  }

  private async createVersion(
    tx: Tx,
    auth: AuthContext,
    plan: {
      id: string;
      propertyId: string;
      status: PlanStatus;
      slug: string;
      createdAt: Date;
      updatedAt: Date;
    },
    version: number,
    b: VersionInputT,
    propertyCurrency: string,
  ) {
    const currency = b.currency ?? propertyCurrency;
    if (!isCurrencyCode(currency))
      throw new DomainError('PLAN_NOT_PURCHASABLE', 'unsupported currency');
    const price = parseMajorUnits(b.price, currency);
    const data: Prisma.PlanVersionUncheckedCreateInput = {
      planId: plan.id,
      version,
      name: b.name,
      description: b.description,
      scope: b.scope,
      priceMinor: price.amountMinor,
      currency,
      durationValue: b.duration.value,
      durationUnit: b.duration.unit,
      activationPolicy: b.activationPolicy,
      redemptionWindowValue: b.redemptionWindow?.value ?? null,
      redemptionWindowUnit: b.redemptionWindow?.unit ?? null,
      maxDevices: b.maxDevices,
      maxConcurrentSessions: b.maxConcurrentSessions,
      downloadKbps: b.downloadKbps,
      uploadKbps: b.uploadKbps,
      maxGroupMembers: b.maxGroupMembers,
      renewalRule: b.renewalRule,
      availableFrom: b.availableFrom,
      availableUntil: b.availableUntil,
      fairUseText: b.fairUseText,
      refundPolicyText: b.refundPolicyText,
      termsVersion: b.termsVersion,
      createdById: auth.user.id,
    };
    // Validate with the domain rules before touching the database (clear errors, same rules as publish).
    validatePlanVersion(
      toSnapshot(plan, {
        ...data,
        id: 'draft',
        createdAt: new Date(),
        publishedAt: null,
        lockedAt: null,
      } as never),
    );
    return tx.planVersion.create({ data });
  }

  private log(
    tx: Tx,
    auth: AuthContext,
    meta: RequestMetaValue,
    propertyId: string,
    action: string,
    targetId: string,
    why?: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorType: 'USER',
      actorUserId: auth.user.id,
      propertyId,
      action,
      targetType: 'plan',
      targetId,
      reason: why ?? null,
      correlationId: meta.requestId,
      ipAddress: meta.ip,
      metadata: metadata ?? {},
    });
  }
}
