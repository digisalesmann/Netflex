import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@netflex/domain';
import type { AppRequest, AuthContext } from './auth.types.js';

export const IS_PUBLIC = 'netflex:public';
export const ALLOW_INCOMPLETE_LOGIN = 'netflex:allow-incomplete';
export const REQUIRE_PERMISSION = 'netflex:permission';
export const REQUIRE_KIND = 'netflex:kind';
export const OPTIONAL_AUTH = 'netflex:optional-auth';

/** No session needed (sign-in, health, public catalog). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Server-to-server callbacks (payment webhooks) authenticated by signature instead of CSRF header. */
export const SkipCsrf = () => SetMetadata('netflex:skip-csrf', true);
/** On a public route: attach the session if a valid one is present, otherwise continue anonymously. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
/** Reachable before MFA is complete or while a password change is pending. */
export const AllowIncompleteLogin = () => SetMetadata(ALLOW_INCOMPLETE_LOGIN, true);
/**
 * Require a staff permission on the property in the `:propertyId` route param.
 * Without that param the permission must be held platform-wide (OWNER).
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRE_PERMISSION, permission);
export const RequireKind = (kind: 'STAFF' | 'TENANT') => SetMetadata(REQUIRE_KIND, kind);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.auth) throw new Error('CurrentAuth used on a public route');
    return req.auth;
  },
);

export const RequestMeta = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return {
    requestId: String(req.id ?? ''),
    ip: req.ip ?? null,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 400),
  };
});
export interface RequestMetaValue {
  requestId: string;
  ip: string | null;
  userAgent: string;
}
