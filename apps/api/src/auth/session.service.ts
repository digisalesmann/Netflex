import { Inject, Injectable } from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
import type { PrismaClient } from '@netflex/database';
import type { Actor, RoleKey } from '@netflex/domain';
import { deriveKey, generateToken, keyedVerifier } from '@netflex/security';
import type { CookieOptions } from 'express';
import type { Tx } from '../audit/audit.service.js';
import { CONFIG, PRISMA } from '../infra/tokens.js';
import type { AuthContext } from './auth.types.js';

/** Session lifetimes (absolute / idle). Staff sessions are short; tenant sessions long-lived. */
export const SESSION_POLICY = {
  STAFF: { absoluteMs: 12 * 3600_000, idleMs: 60 * 60_000 },
  TENANT: { absoluteMs: 30 * 24 * 3600_000, idleMs: 14 * 24 * 3600_000 },
} as const;
const TOUCH_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class SessionService {
  private readonly key: Buffer;
  readonly cookieName: string;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: NetflexConfig,
  ) {
    this.key = deriveKey(config.AUTH_SECRET, 'session-token');
    // __Host- prefix forces Secure, Path=/ and no Domain in browsers (production only, needs HTTPS).
    this.cookieName = this.secureCookies ? '__Host-nf_session' : 'nf_session';
  }

  private get secureCookies(): boolean {
    return this.config.NETFLEX_ENV === 'production' || this.config.NETFLEX_ENV === 'staging';
  }

  cookieOptions(expires: Date): CookieOptions {
    return { httpOnly: true, secure: this.secureCookies, sameSite: 'lax', path: '/', expires };
  }

  clearCookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secureCookies, sameSite: 'lax', path: '/' };
  }

  /**
   * Create a fresh session (new random token on every sign-in: prevents session
   * fixation). Returns the raw token for the cookie; only its HMAC is stored.
   */
  async create(
    tx: Tx,
    user: { id: string; kind: 'STAFF' | 'TENANT' },
    meta: { ip: string | null; userAgent: string },
    mfaVerified: boolean,
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_POLICY[user.kind].absoluteMs);
    const s = await tx.session.create({
      data: {
        userId: user.id,
        tokenVerifier: keyedVerifier(this.key, token),
        expiresAt,
        mfaVerifiedAt: mfaVerified ? new Date() : null,
        ipAddress: meta.ip,
        userAgent: meta.userAgent || null,
      },
    });
    return { token, sessionId: s.id, expiresAt };
  }

  /** Resolve a cookie token to an auth context, enforcing expiry, idle timeout, revocation and account status. */
  async resolve(token: string | undefined): Promise<AuthContext | null> {
    if (!token || token.length > 100) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenVerifier: keyedVerifier(this.key, token) },
      include: {
        user: {
          include: {
            roles: { where: { revokedAt: null }, include: { role: { select: { key: true } } } },
          },
        },
      },
    });
    if (!session || session.revokedAt) return null;
    const now = Date.now();
    const policy = SESSION_POLICY[session.user.kind];
    if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > policy.idleMs)
      return null;
    if (session.user.status !== 'ACTIVE') return null;

    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    const u = session.user;
    const actor: Actor = {
      userId: u.id,
      kind: u.kind,
      grants:
        u.kind === 'STAFF'
          ? u.roles.map((r) => ({ role: r.role.key as RoleKey, propertyId: r.propertyId }))
          : [],
    };
    return {
      actor,
      sessionId: session.id,
      user: {
        id: u.id,
        kind: u.kind,
        displayName: u.displayName,
        mfaEnabled: u.mfaEnabled,
        mustChangePassword: u.mustChangePassword,
      },
      mfaSatisfied: u.kind === 'TENANT' || session.mfaVerifiedAt !== null,
    };
  }

  async revoke(tx: Tx | PrismaClient, sessionId: string): Promise<void> {
    await tx.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(
    tx: Tx | PrismaClient,
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const r = await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return r.count;
  }
}
