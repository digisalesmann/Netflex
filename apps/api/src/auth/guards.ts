import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NetflexConfig } from '@netflex/config';
import { can, type Permission } from '@netflex/domain';
import { ApiError } from '../common/api-error.js';
import { CONFIG } from '../infra/tokens.js';
import type { AppRequest } from './auth.types.js';
import {
  ALLOW_INCOMPLETE_LOGIN,
  IS_PUBLIC,
  REQUIRE_KIND,
  REQUIRE_PERMISSION,
} from './decorators.js';
import { SessionService } from './session.service.js';

export const CSRF_HEADER = 'x-netflex-csrf';
export const SKIP_CSRF = 'netflex:skip-csrf';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence for cookie sessions (spec §14), applied to every state-changing
 * request including sign-in:
 * 1. A custom header must be present. Browsers can't add it cross-site without a
 *    CORS preflight, and CORS only allows the NetFlex web origin.
 * 2. If the browser sends Origin, it must be an allowed origin.
 * Server-to-server callbacks (payment webhooks) opt out with @SkipCsrf().
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowed: Set<string>;
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) config: NetflexConfig,
  ) {
    this.allowed = new Set([
      new URL(config.PUBLIC_WEB_URL).origin,
      new URL(config.PUBLIC_API_URL).origin,
    ]);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!UNSAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]))
      return true;
    const origin = req.headers.origin;
    if (origin !== undefined && !this.allowed.has(origin)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Request origin not allowed.');
    }
    if (req.headers[CSRF_HEADER] !== '1') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Missing request verification header.');
    }
    return true;
  }
}

/**
 * Deny-by-default authentication + authorization. Every route needs a valid
 * session unless marked @Public(). Staff must have completed MFA and any forced
 * password change before reaching anything except the routes that complete them.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const auth = await this.sessions.resolve(cookies[this.sessions.cookieName]);
    if (!auth)
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in to continue.');
    req.auth = auth;

    const incompleteOk = this.reflector.getAllAndOverride<boolean>(ALLOW_INCOMPLETE_LOGIN, targets);
    if (!incompleteOk && auth.user.kind === 'STAFF') {
      if (!auth.mfaSatisfied) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Complete two-step verification to continue.',
          {
            next: auth.user.mfaEnabled ? 'MFA_VERIFY' : 'MFA_ENROLL',
          },
        );
      }
      if (auth.user.mustChangePassword) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Change your password to continue.', {
          next: 'PASSWORD_CHANGE',
        });
      }
    }

    const kind = this.reflector.getAllAndOverride<'STAFF' | 'TENANT' | undefined>(
      REQUIRE_KIND,
      targets,
    );
    if (kind && auth.user.kind !== kind)
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have access to this.');

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRE_PERMISSION,
      targets,
    );
    if (permission) {
      const params = req.params as Record<string, string | undefined>;
      const propertyId = params.propertyId ?? null;
      if (!can(auth.actor, permission, propertyId)) {
        // 404 for property-scoped routes so other properties' existence isn't revealed.
        throw propertyId
          ? new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.')
          : new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have access to this.');
      }
    }
    return true;
  }
}
