import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { NetflexConfig } from '@netflex/config';
import type { PrismaClient } from '@netflex/database';
import {
  decryptSecret,
  deriveKey,
  dummyPasswordHash,
  encryptSecret,
  generateOtpCode,
  generateTotpSecret,
  hashPassword,
  keyedVerifier,
  needsRehash,
  otpauthUri,
  passwordProblems,
  verifyPassword,
  verifyTotp,
} from '@netflex/security';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { LIMITS, RateLimitService } from '../infra/rate-limit.service.js';
import { CONFIG, PRISMA } from '../infra/tokens.js';
import type { AuthContext } from './auth.types.js';
import type { RequestMetaValue } from './decorators.js';
import { OTP_SENDER, type OtpSender } from './otp-sender.js';
import { SessionService } from './session.service.js';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const INVALID_LOGIN = 'Email or password is incorrect.';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  next: 'DONE' | 'MFA_ENROLL' | 'MFA_VERIFY' | 'PASSWORD_CHANGE';
}

@Injectable()
export class AuthService {
  private readonly mfaKey: Buffer;
  private readonly otpKey: Buffer;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONFIG) config: NetflexConfig,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(OTP_SENDER) private readonly otp: OtpSender,
  ) {
    this.mfaKey = deriveKey(config.AUTH_SECRET, 'mfa-secret');
    this.otpKey = deriveKey(config.AUTH_SECRET, 'otp-code');
  }

  // ------------------------------------------------------------------ staff

  async staffLogin(
    emailAddr: string,
    password: string,
    meta: RequestMetaValue,
  ): Promise<IssuedSession> {
    await this.limits.hit(LIMITS.staffLoginPerIp, meta.ip ?? 'unknown');
    await this.limits.hit(LIMITS.staffLoginPerEmail, emailAddr);

    const user = await this.prisma.user.findUnique({ where: { email: emailAddr } });
    // Always run a password check so response time doesn't reveal whether the account exists.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !ok || user.kind !== 'STAFF' || user.status !== 'ACTIVE' || !user.passwordHash) {
      await this.audit.recordStandalone({
        actorType: 'USER',
        actorUserId: user?.id ?? null,
        action: 'auth.staff.login_failed',
        targetType: 'user',
        targetId: user?.id ?? null,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        metadata: {
          reason: !user
            ? 'unknown_account'
            : user.status !== 'ACTIVE'
              ? 'disabled'
              : 'bad_password',
        },
      });
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', INVALID_LOGIN);
    }

    await this.limits.reset(LIMITS.staffLoginPerEmail, emailAddr);
    const rehash = needsRehash(user.passwordHash) ? await hashPassword(password) : null;
    const issued = await this.prisma.$transaction(async (tx) => {
      if (rehash) await tx.user.update({ where: { id: user.id }, data: { passwordHash: rehash } });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const s = await this.sessions.create(tx, user, meta, false);
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: user.id,
        action: 'auth.staff.password_ok',
        targetType: 'session',
        targetId: s.sessionId,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      });
      return s;
    });
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      next: user.mfaEnabled ? 'MFA_VERIFY' : 'MFA_ENROLL',
    };
  }

  /** Start MFA enrollment: store an encrypted pending secret and return it once for the authenticator app. */
  async mfaEnrollStart(auth: AuthContext): Promise<{ secret: string; otpauthUri: string }> {
    this.assertStaff(auth);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.mfaEnabled)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Two-step verification is already set up.',
      );
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: encryptSecret(this.mfaKey, secret), mfaLastUsedStep: null },
    });
    return { secret, otpauthUri: otpauthUri(secret, user.email ?? user.id) };
  }

  /** Confirm enrollment or verify an existing factor; marks this session MFA-verified. */
  async mfaVerify(
    auth: AuthContext,
    code: string,
    meta: RequestMetaValue,
  ): Promise<{ next: IssuedSession['next'] }> {
    this.assertStaff(auth);
    await this.limits.hit(LIMITS.mfaPerSession, auth.sessionId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!user.mfaSecretEnc)
      throw new ApiError(HttpStatus.CONFLICT, 'CONFLICT', 'Start two-step setup first.');

    const result = verifyTotp(
      decryptSecret(this.mfaKey, user.mfaSecretEnc),
      code,
      Math.floor(Date.now() / 1000),
      user.mfaLastUsedStep,
    );
    if (!result.ok) {
      await this.audit.recordStandalone({
        actorType: 'USER',
        actorUserId: user.id,
        action: 'auth.staff.mfa_failed',
        targetType: 'session',
        targetId: auth.sessionId,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      });
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'That code is not valid. Try the latest code.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Conditional update: a concurrent request with the same code can't both succeed.
      const updated = await tx.user.updateMany({
        where: {
          id: user.id,
          OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: result.step } }],
        },
        data: { mfaLastUsedStep: result.step, mfaEnabled: true },
      });
      if (updated.count !== 1)
        throw new ApiError(
          HttpStatus.UNAUTHORIZED,
          'UNAUTHENTICATED',
          'That code is not valid. Try the latest code.',
        );
      await tx.session.update({
        where: { id: auth.sessionId },
        data: { mfaVerifiedAt: new Date() },
      });
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: user.id,
        action: user.mfaEnabled ? 'auth.staff.mfa_verified' : 'auth.staff.mfa_enrolled',
        targetType: 'user',
        targetId: user.id,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      });
    });
    return { next: user.mustChangePassword ? 'PASSWORD_CHANGE' : 'DONE' };
  }

  async changePassword(
    auth: AuthContext,
    current: string,
    next: string,
    meta: RequestMetaValue,
  ): Promise<void> {
    this.assertStaff(auth);
    if (!auth.mfaSatisfied)
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Complete two-step verification to continue.',
      );
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!user.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Current password is incorrect.',
      );
    }
    const problems = passwordProblems(next, [user.email ?? '', ...user.displayName.split(/\s+/)]);
    if (current === next) problems.push('must be different from the current password');
    if (problems.length) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Choose a stronger password.',
        { password: problems },
      );
    }
    const hash = await hashPassword(next);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, mustChangePassword: false, passwordUpdatedAt: new Date() },
      });
      // Other sessions may belong to whoever knew the old password.
      const revoked = await this.sessions.revokeAllForUser(tx, user.id, auth.sessionId);
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: user.id,
        action: 'auth.staff.password_changed',
        targetType: 'user',
        targetId: user.id,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { otherSessionsRevoked: revoked },
      });
    });
  }

  // ------------------------------------------------------------------ tenant (phone OTP)

  /**
   * Always answers the same way whether or not the number is known (anti-enumeration).
   * Staff phone numbers never receive tenant codes: staff must use password + MFA.
   */
  async requestOtp(phone: string, meta: RequestMetaValue): Promise<void> {
    if (!this.otp.configured) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Phone sign-in is not available yet.',
      );
    }
    await this.limits.hit(LIMITS.otpRequestPerIp, meta.ip ?? 'unknown');
    await this.limits.hit(LIMITS.otpRequestPerPhone, phone);

    const existing = await this.prisma.user.findUnique({
      where: { phoneE164: phone },
      select: { kind: true, status: true },
    });
    if (existing && (existing.kind !== 'TENANT' || existing.status !== 'ACTIVE')) return;

    const code = generateOtpCode();
    await this.prisma.otpChallenge.create({
      data: {
        phoneE164: phone,
        purpose: 'SIGN_IN',
        codeVerifier: keyedVerifier(this.otpKey, `${phone}:${code}`),
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await this.otp.send(phone, code);
  }

  async verifyOtp(
    phone: string,
    code: string,
    displayName: string | undefined,
    meta: RequestMetaValue,
  ): Promise<IssuedSession> {
    await this.limits.hit(LIMITS.otpVerifyPerIp, meta.ip ?? 'unknown');
    const fail = () =>
      new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'That code is not valid or has expired. Request a new code.',
      );

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the newest live challenge so concurrent guesses are counted correctly.
      const rows = await tx.$queryRaw<
        { id: string; codeVerifier: string; attempts: number; maxAttempts: number }[]
      >`
        SELECT "id", "codeVerifier", "attempts", "maxAttempts" FROM "otp_challenges"
        WHERE "phoneE164" = ${phone} AND "purpose" = 'SIGN_IN' AND "consumedAt" IS NULL AND "expiresAt" > now()
        ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`;
      const ch = rows[0];
      if (!ch || ch.attempts >= ch.maxAttempts) return null;

      const matches =
        /^\d{6}$/.test(code) && keyedVerifier(this.otpKey, `${phone}:${code}`) === ch.codeVerifier;
      if (!matches) {
        // Count the failed attempt and COMMIT it (we return instead of throwing so it isn't rolled back).
        await tx.otpChallenge.update({
          where: { id: ch.id },
          data: { attempts: { increment: 1 } },
        });
        return null;
      }
      await tx.otpChallenge.update({
        where: { id: ch.id },
        data: { consumedAt: new Date(), attempts: { increment: 1 } },
      });

      let user = await tx.user.findUnique({ where: { phoneE164: phone } });
      if (user && (user.kind !== 'TENANT' || user.status !== 'ACTIVE')) return null;
      const created = !user;
      user ??= await tx.user.create({
        data: { kind: 'TENANT', phoneE164: phone, displayName: displayName?.trim() || 'Guest' },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const s = await this.sessions.create(tx, user, meta, true);
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: user.id,
        action: created ? 'auth.tenant.registered' : 'auth.tenant.login',
        targetType: 'session',
        targetId: s.sessionId,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
      });
      return { token: s.token, expiresAt: s.expiresAt, next: 'DONE' as const };
    });
    if (!result) throw fail();
    return result;
  }

  // ------------------------------------------------------------------ shared

  async logout(auth: AuthContext, meta: RequestMetaValue, everywhere: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const count = everywhere
        ? await this.sessions.revokeAllForUser(tx, auth.user.id)
        : (await this.sessions.revoke(tx, auth.sessionId), 1);
      await this.audit.record(tx, {
        actorType: 'USER',
        actorUserId: auth.user.id,
        action: everywhere ? 'auth.logout_all' : 'auth.logout',
        targetType: 'session',
        targetId: auth.sessionId,
        correlationId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { sessionsRevoked: count },
      });
    });
  }

  private assertStaff(auth: AuthContext): void {
    if (auth.user.kind !== 'STAFF')
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have access to this.');
  }
}
