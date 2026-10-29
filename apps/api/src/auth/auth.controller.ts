import { Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe, email, phoneE164 } from '../common/zod.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import type { AuthContext } from './auth.types.js';
import {
  AllowIncompleteLogin,
  CurrentAuth,
  Public,
  RequestMeta,
  RequireKind,
  type RequestMetaValue,
} from './decorators.js';
import { SessionService } from './session.service.js';

const StaffLogin = z.strictObject({ email, password: z.string().min(1).max(200) });
const MfaCode = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
const PasswordChange = z.strictObject({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});
const OtpRequest = z.strictObject({ phone: phoneE164 });
const OtpVerify = z.strictObject({
  phone: phoneE164,
  code: z.string().trim().max(10),
  displayName: z.string().trim().min(1).max(120).optional(),
});

@ApiTags('auth')
@Controller({ path: 'auth' })
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private setCookie(
    res: Response,
    s: IssuedSession,
  ): { next: IssuedSession['next']; expiresAt: string } {
    res.cookie(this.sessions.cookieName, s.token, this.sessions.cookieOptions(s.expiresAt));
    return { next: s.next, expiresAt: s.expiresAt.toISOString() };
  }

  @Public()
  @Post('staff/login')
  @HttpCode(200)
  async staffLogin(
    @Body(new ZodPipe(StaffLogin)) body: z.infer<typeof StaffLogin>,
    @RequestMeta() meta: RequestMetaValue,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.setCookie(res, await this.auth.staffLogin(body.email, body.password, meta));
  }

  @AllowIncompleteLogin()
  @RequireKind('STAFF')
  @Post('staff/mfa/enroll')
  @HttpCode(200)
  async mfaEnroll(@CurrentAuth() auth: AuthContext) {
    // The secret is shown exactly once, for the authenticator app.
    return this.auth.mfaEnrollStart(auth);
  }

  @AllowIncompleteLogin()
  @RequireKind('STAFF')
  @Post('staff/mfa/verify')
  @HttpCode(200)
  async mfaVerify(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(MfaCode)) body: z.infer<typeof MfaCode>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    return this.auth.mfaVerify(auth, body.code, meta);
  }

  @AllowIncompleteLogin()
  @RequireKind('STAFF')
  @Post('staff/password')
  @HttpCode(200)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(PasswordChange)) body: z.infer<typeof PasswordChange>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    await this.auth.changePassword(auth, body.currentPassword, body.newPassword, meta);
    return { changed: true };
  }

  @Public()
  @Post('tenant/otp/request')
  @HttpCode(202)
  async otpRequest(
    @Body(new ZodPipe(OtpRequest)) body: z.infer<typeof OtpRequest>,
    @RequestMeta() meta: RequestMetaValue,
  ) {
    await this.auth.requestOtp(body.phone, meta);
    return { message: 'If this number can sign in, a code is on its way.' };
  }

  @Public()
  @Post('tenant/otp/verify')
  @HttpCode(200)
  async otpVerify(
    @Body(new ZodPipe(OtpVerify)) body: z.infer<typeof OtpVerify>,
    @RequestMeta() meta: RequestMetaValue,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.setCookie(
      res,
      await this.auth.verifyOtp(body.phone, body.code, body.displayName, meta),
    );
  }

  @AllowIncompleteLogin()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(auth, meta, false);
    res.clearCookie(this.sessions.cookieName, this.sessions.clearCookieOptions());
    return { signedOut: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(auth, meta, true);
    res.clearCookie(this.sessions.cookieName, this.sessions.clearCookieOptions());
    return { signedOut: true };
  }
}
