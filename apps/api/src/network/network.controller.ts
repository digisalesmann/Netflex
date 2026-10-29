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
import type { NetflexConfig } from '@netflex/config';
import { recordAudit, type NetworkEngine } from '@netflex/core';
import type { PrismaClient } from '@netflex/database';
import { NETWORK_OPERATION_STATUSES, networkOperationStateMachine } from '@netflex/domain';
import { z } from 'zod';
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
import { ZodPipe, reason, uuid } from '../common/zod.js';
import { CONFIG, NETWORK_ENGINE, PRISMA } from '../infra/tokens.js';

/**
 * Credentials are never sent through the API. `credentialRef` names a secret
 * (env var NETFLEX_GATEWAY_<REF>) held by the server. No URL, IP address, or
 * router command is ever accepted from a browser (spec §11.2, §24).
 */
const RegisterGateway = z.strictObject({
  name: z.string().trim().min(2).max(80),
  vendor: z.enum(['MIKROTIK', 'UNIFI', 'OTHER', 'FAKE']),
  model: z.string().trim().max(80).optional(),
  firmware: z.string().trim().max(40).optional(),
  credentialRef: z.string().regex(/^[A-Z][A-Z0-9_]{2,60}$/, 'secret name like MAIN_ROUTER'),
});
const Reason = z.strictObject({ reason });
const OpsQuery = z.strictObject({
  status: z.enum(NETWORK_OPERATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: uuid.optional(),
});

@RequireKind('STAFF')
@ApiTags('admin: network')
@Controller({ path: 'admin/properties/:propertyId' })
export class NetworkController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(NETWORK_ENGINE) private readonly engine: NetworkEngine,
    @Inject(CONFIG) private readonly config: NetflexConfig,
  ) {}

  @RequirePermission('network.read')
  @Get('gateways')
  gateways(@Param('propertyId', new ParseUUIDPipe()) propertyId: string) {
    return this.prisma.gateway.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        vendor: true,
        model: true,
        firmware: true,
        status: true,
        capabilities: true,
        lastHealthAt: true,
        lastHealthyAt: true,
        credentialRef: true,
      },
    });
  }

  @RequirePermission('network.operate')
  @Post('gateways')
  async register(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body(new ZodPipe(RegisterGateway)) body: z.infer<typeof RegisterGateway>,
  ) {
    if (body.vendor === 'FAKE' && this.config.NETWORK_ADAPTER !== 'fake') {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'UNPROCESSABLE',
        'Simulated gateways are only allowed in development/test with NETWORK_ADAPTER=fake.',
      );
    }
    return this.prisma
      .$transaction(async (tx) => {
        const g = await tx.gateway.create({ data: { propertyId, ...body } });
        await recordAudit(tx, {
          actorType: 'USER',
          actorUserId: auth.user.id,
          propertyId,
          action: 'gateway.registered',
          targetType: 'gateway',
          targetId: g.id,
          correlationId: meta.requestId,
          ipAddress: meta.ip,
          metadata: { vendor: g.vendor, model: g.model, credentialRef: g.credentialRef },
        });
        return { id: g.id, status: g.status };
      })
      .catch((e: unknown) => conflictOnUnique(e, 'A gateway with this name already exists.'));
  }

  @RequirePermission('network.operate')
  @Post('gateways/:gatewayId/health-check')
  @HttpCode(200)
  async health(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('gatewayId', new ParseUUIDPipe()) gatewayId: string,
  ) {
    if (!(await this.prisma.gateway.findFirst({ where: { id: gatewayId, propertyId } })))
      throw notFound();
    return this.engine.checkGateway(gatewayId);
  }

  @RequirePermission('network.operate')
  @Post('gateways/:gatewayId/disable')
  @HttpCode(200)
  disable(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('gatewayId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.setStatus(a, m, p, id, 'DISABLED', b.reason);
  }

  @RequirePermission('network.operate')
  @Post('gateways/:gatewayId/enable')
  @HttpCode(200)
  enable(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) p: string,
    @Param('gatewayId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.setStatus(a, m, p, id, 'UNVERIFIED', b.reason);
  }

  /** Run reconciliation now for this property (health, sessions, drift). */
  @RequirePermission('network.operate')
  @Post('network/reconcile')
  @HttpCode(200)
  async reconcile(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    const report = await this.engine.reconcileProperty(propertyId);
    await this.prisma.$transaction((tx) =>
      recordAudit(tx, {
        actorType: 'USER',
        actorUserId: a.user.id,
        propertyId,
        action: 'network.reconcile_requested',
        targetType: 'property',
        targetId: propertyId,
        correlationId: m.requestId,
        ipAddress: m.ip,
        metadata: report,
      }),
    );
    return report;
  }

  @RequirePermission('network.read')
  @Get('network/operations')
  async operations(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query(new ZodPipe(OpsQuery)) q: z.infer<typeof OpsQuery>,
  ) {
    const rows = await this.prisma.networkOperation.findMany({
      where: { propertyId, ...(q.status ? { status: q.status } : {}) },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        entitlementId: true,
        gatewayId: true,
        lastErrorCode: true,
        lastErrorDetail: true,
        verification: true,
        createdAt: true,
        completedAt: true,
        nextAttemptAt: true,
      },
    });
    const data = rows.slice(0, q.limit);
    return { data, meta: { nextCursor: rows.length > q.limit ? data.at(-1)?.id : null } };
  }

  /**
   * Authorized replay of a failed operation. Safe: it re-applies the CURRENT
   * desired state (idempotent), so it can't duplicate access or resurrect ended access.
   */
  @RequirePermission('network.operate')
  @Post('network/operations/:operationId/retry')
  @HttpCode(200)
  async retry(
    @CurrentAuth() a: AuthContext,
    @RequestMeta() m: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('operationId', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const op = await tx.networkOperation.findFirst({ where: { id, propertyId } });
      if (!op) throw notFound();
      if (!networkOperationStateMachine.canTransition(op.status, 'PENDING')) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CONFLICT',
          `A ${op.status.toLowerCase()} operation cannot be retried.`,
        );
      }
      await tx.networkOperation.update({
        where: { id },
        data: { status: 'PENDING', attempts: 0, completedAt: null, nextAttemptAt: null },
      });
      await tx.outboxEvent.create({
        data: {
          type: 'network.replay',
          aggregateType: 'network_operation',
          aggregateId: id,
          payload: { operationId: id },
        },
      });
      await recordAudit(tx, {
        actorType: 'USER',
        actorUserId: a.user.id,
        propertyId,
        action: 'network.operation_retried',
        targetType: 'network_operation',
        targetId: id,
        reason: b.reason,
        correlationId: m.requestId,
        ipAddress: m.ip,
        metadata: { previousError: op.lastErrorCode },
      });
      return { status: 'PENDING' };
    });
  }

  @RequirePermission('network.read')
  @Get('network/sessions')
  sessions(@Param('propertyId', new ParseUUIDPipe()) propertyId: string) {
    return this.prisma.networkSession.findMany({
      where: { propertyId, endedAt: null },
      orderBy: { startedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        gatewayId: true,
        entitlementId: true,
        ipAddress: true,
        startedAt: true,
        lastSeenAt: true,
        bytesIn: true,
        bytesOut: true,
        macAddress: true,
      },
    });
  }

  private setStatus(
    auth: AuthContext,
    meta: RequestMetaValue,
    propertyId: string,
    id: string,
    status: 'DISABLED' | 'UNVERIFIED',
    why: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.gateway.updateMany({ where: { id, propertyId }, data: { status } });
      if (r.count !== 1) throw notFound();
      await recordAudit(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        propertyId,
        action: status === 'DISABLED' ? 'gateway.disabled' : 'gateway.enabled',
        targetType: 'gateway',
        targetId: id,
        reason: why,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      });
      return { status };
    });
  }
}
