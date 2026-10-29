import {
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
import type { PrismaClient } from '@netflex/database';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { PRISMA } from '../infra/tokens.js';
import type { AuthContext } from './auth.types.js';
import {
  AllowIncompleteLogin,
  CurrentAuth,
  RequestMeta,
  type RequestMetaValue,
} from './decorators.js';
import { SessionService } from './session.service.js';

@ApiTags('me')
@Controller({ path: 'me' })
export class MeController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @AllowIncompleteLogin()
  @Get()
  async me(@CurrentAuth() auth: AuthContext) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: {
        id: true,
        kind: true,
        displayName: true,
        email: true,
        phoneE164: true,
        mfaEnabled: true,
        mustChangePassword: true,
      },
    });
    // Tenants: where they currently live (for room/floor purchases and display).
    const residence =
      u.kind === 'TENANT'
        ? await this.prisma.tenantAssignment.findMany({
            where: { userId: u.id, endsAt: null },
            select: {
              startsAt: true,
              property: { select: { id: true, name: true, slug: true } },
              room: {
                select: { id: true, label: true, floor: { select: { id: true, label: true } } },
              },
            },
          })
        : [];
    const authorities =
      u.kind === 'TENANT'
        ? await this.prisma.groupAuthority.findMany({
            where: { userId: u.id, revokedAt: null },
            select: { scope: true, roomId: true, floorId: true, propertyId: true },
          })
        : [];
    return {
      user: u,
      grants: auth.actor.grants,
      session: { id: auth.sessionId, mfaSatisfied: auth.mfaSatisfied },
      residence,
      purchaseAuthority: authorities,
    };
  }

  /** The caller's own sessions only. */
  @Get('sessions')
  async listSessions(@CurrentAuth() auth: AuthContext) {
    const rows = await this.prisma.session.findMany({
      where: { userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === auth.sessionId }));
  }

  @Post('sessions/:sessionId/revoke')
  @HttpCode(200)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Ownership enforced in the query: another user's session id behaves as not found.
      const s = await tx.session.findFirst({
        where: { id: sessionId, userId: auth.user.id, revokedAt: null },
      });
      if (!s) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
      await this.sessions.revoke(tx, s.id);
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        action: 'auth.session_revoked',
        targetType: 'session',
        targetId: s.id,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      });
    });
    return { revoked: true };
  }
}
