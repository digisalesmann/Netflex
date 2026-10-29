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
import type { PrismaClient } from '@netflex/database';
import { STAFF_ROLES, canGrantRole, propertiesWith } from '@netflex/domain';
import { hashPassword, passwordProblems } from '@netflex/security';
import { z } from 'zod';
import { AuditService, type Tx } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CurrentAuth,
  RequestMeta,
  RequirePermission,
  type RequestMetaValue,
  RequireKind,
} from '../auth/decorators.js';
import { SessionService } from '../auth/session.service.js';
import { ApiError } from '../common/api-error.js';
import { conflictOnUnique, notFound } from '../common/prisma-errors.js';
import { ZodPipe, email, reason, uuid } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';

const CreateStaff = z.strictObject({
  email,
  displayName: z.string().trim().min(2).max(120),
  initialPassword: z.string().min(1).max(200),
});
const GrantRole = z.strictObject({
  role: z.enum(STAFF_ROLES),
  propertyId: uuid.nullable(),
  reason,
});
const Reason = z.strictObject({ reason });
const ResetCredentials = z.strictObject({ temporaryPassword: z.string().min(1).max(200), reason });

const forbidden = (msg = 'You do not have access to this.') =>
  new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', msg);

@RequireKind('STAFF')
@ApiTags('admin: staff')
@Controller({ path: 'admin/staff' })
export class StaffController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /** Owners see all staff; others with staff.read see staff (and grants) on their properties only. */
  @Get()
  async list(@CurrentAuth() auth: AuthContext) {
    const scope = propertiesWith(auth.actor, 'staff.read');
    if (scope !== 'ALL' && scope.length === 0) throw forbidden();
    const grantFilter =
      scope === 'ALL' ? { revokedAt: null } : { revokedAt: null, propertyId: { in: scope } };
    const users = await this.prisma.user.findMany({
      where: { kind: 'STAFF', ...(scope === 'ALL' ? {} : { roles: { some: grantFilter } }) },
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        email: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
        roles: {
          where: grantFilter,
          select: { id: true, propertyId: true, role: { select: { key: true } } },
        },
      },
    });
    return users.map(({ roles, ...u }) => ({
      ...u,
      grants: roles.map((r) => ({ id: r.id, role: r.role.key, propertyId: r.propertyId })),
    }));
  }

  /** Platform owner only. The person must change the initial password and enroll MFA at first sign-in. */
  @RequirePermission('staff.manage')
  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(CreateStaff)) body: z.infer<typeof CreateStaff>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    const problems = passwordProblems(body.initialPassword, [
      body.email,
      ...body.displayName.split(/\s+/),
    ]);
    if (problems.length)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Choose a stronger initial password.',
        { password: problems },
      );
    const passwordHash = await hashPassword(body.initialPassword);
    return this.prisma
      .$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            kind: 'STAFF',
            email: body.email,
            displayName: body.displayName,
            passwordHash,
            mustChangePassword: true,
            passwordUpdatedAt: new Date(),
          },
          select: { id: true, email: true, displayName: true },
        });
        await this.log(tx, auth, meta, null, 'staff.created', u.id);
        return u;
      })
      .catch((e: unknown) => conflictOnUnique(e, 'An account with this email already exists.'));
  }

  @Post(':userId/roles')
  async grant(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodPipe(GrantRole)) body: z.infer<typeof GrantRole>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    if (!canGrantRole(auth.actor, body.role, body.propertyId))
      throw forbidden('You cannot grant this role.');
    return this.prisma
      .$transaction(async (tx) => {
        const user = await tx.user.findFirst({ where: { id: userId, kind: 'STAFF' } });
        if (!user) throw notFound();
        if (body.propertyId && !(await tx.property.findUnique({ where: { id: body.propertyId } })))
          throw notFound();
        const role = await tx.role.findUniqueOrThrow({ where: { key: body.role } });
        const g = await tx.userRole.create({
          data: { userId, roleId: role.id, propertyId: body.propertyId, grantedById: auth.user.id },
        });
        await this.log(tx, auth, meta, body.propertyId, 'staff.role_granted', userId, body.reason, {
          role: body.role,
          grantId: g.id,
        });
        return { id: g.id };
      })
      .catch((e: unknown) => conflictOnUnique(e, 'This role is already granted.'));
  }

  @Post(':userId/roles/:grantId/revoke')
  @HttpCode(200)
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const g = await tx.userRole.findFirst({
        where: { id: grantId, userId, revokedAt: null },
        include: { role: true },
      });
      if (!g) throw notFound();
      if (!canGrantRole(auth.actor, g.role.key as (typeof STAFF_ROLES)[number], g.propertyId))
        throw forbidden('You cannot revoke this role.');
      if (g.role.key === 'OWNER') await this.assertNotLastOwner(tx, userId);
      await tx.userRole.update({ where: { id: g.id }, data: { revokedAt: new Date() } });
      await this.log(tx, auth, meta, g.propertyId, 'staff.role_revoked', userId, body.reason, {
        role: g.role.key,
        grantId: g.id,
      });
      return { revoked: true };
    });
  }

  @RequirePermission('staff.manage')
  @Post(':userId/disable')
  @HttpCode(200)
  async disable(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    if (userId === auth.user.id) throw forbidden('You cannot disable your own account.');
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findFirst({ where: { id: userId, kind: 'STAFF', status: 'ACTIVE' } });
      if (!u) throw notFound();
      await this.assertNotLastOwner(tx, userId);
      await tx.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
      const revoked = await this.sessions.revokeAllForUser(tx, userId);
      await this.log(tx, auth, meta, null, 'staff.disabled', userId, body.reason, {
        sessionsRevoked: revoked,
      });
      return { disabled: true };
    });
  }

  /**
   * Account recovery for staff who lost their password or authenticator: owner sets
   * a temporary password, MFA is cleared (re-enrolled at next sign-in) and all
   * sessions end. Owners can't reset themselves; a second owner must do it.
   */
  @RequirePermission('staff.manage')
  @Post(':userId/reset-credentials')
  @HttpCode(200)
  async resetCredentials(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodPipe(ResetCredentials)) body: z.infer<typeof ResetCredentials>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    if (userId === auth.user.id) throw forbidden('Another owner must reset your credentials.');
    const user = await this.prisma.user.findFirst({ where: { id: userId, kind: 'STAFF' } });
    if (!user) throw notFound();
    const problems = passwordProblems(body.temporaryPassword, [
      user.email ?? '',
      ...user.displayName.split(/\s+/),
    ]);
    if (problems.length) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Choose a stronger temporary password.',
        { password: problems },
      );
    }
    const passwordHash = await hashPassword(body.temporaryPassword);
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordUpdatedAt: new Date(),
          mfaEnabled: false,
          mfaSecretEnc: null,
          mfaLastUsedStep: null,
        },
      });
      const revoked = await this.sessions.revokeAllForUser(tx, userId);
      await this.log(tx, auth, meta, null, 'staff.credentials_reset', userId, body.reason, {
        sessionsRevoked: revoked,
      });
      return { reset: true };
    });
  }

  /** Never leave the platform without an active owner (lockout protection). */
  private async assertNotLastOwner(tx: Tx, userId: string): Promise<void> {
    const owners = await tx.userRole.findMany({
      where: {
        revokedAt: null,
        propertyId: null,
        role: { key: 'OWNER' },
        user: { status: 'ACTIVE' },
      },
      select: { userId: true },
    });
    if (owners.some((o) => o.userId === userId) && new Set(owners.map((o) => o.userId)).size <= 1) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This is the last active owner. Add another owner first.',
      );
    }
  }

  private log(
    tx: Tx,
    auth: AuthContext,
    meta: RequestMetaValue,
    propertyId: string | null,
    action: string,
    targetId: string,
    reasonText?: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorType: 'USER',
      actorUserId: auth.user.id,
      propertyId,
      action,
      targetType: 'user',
      targetId,
      reason: reasonText ?? null,
      correlationId: meta.requestId,
      ipAddress: meta.ip,
      metadata: metadata ?? {},
    });
  }
}
