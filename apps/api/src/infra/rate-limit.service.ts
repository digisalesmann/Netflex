import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ApiError } from '../common/api-error.js';
import { REDIS } from './tokens.js';

export interface LimitRule {
  /** Logical bucket, e.g. "login:email". */
  name: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counters in Redis. Fails CLOSED: if Redis is unavailable,
 * protected actions (sign-in, OTP, voucher redemption) are refused rather than
 * left unthrottled.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(rule: LimitRule, subject: string): Promise<void> {
    const key = `netflex:rl:${rule.name}:${subject}`;
    let count: number;
    try {
      const res = await this.redis.multi().incr(key).expire(key, rule.windowSeconds, 'NX').exec();
      count = Number(res?.[0]?.[1] ?? NaN);
      if (!Number.isFinite(count)) throw new Error('bad redis reply');
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Service temporarily unavailable. Please try again shortly.',
      );
    }
    if (count > rule.limit) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many attempts. Please wait and try again.',
      );
    }
  }

  async reset(rule: LimitRule, subject: string): Promise<void> {
    await this.redis.del(`netflex:rl:${rule.name}:${subject}`).catch(() => undefined);
  }
}

export const LIMITS = {
  staffLoginPerEmail: { name: 'staff-login-email', limit: 10, windowSeconds: 900 },
  staffLoginPerIp: { name: 'staff-login-ip', limit: 30, windowSeconds: 900 },
  mfaPerSession: { name: 'mfa-session', limit: 6, windowSeconds: 900 },
  otpRequestPerPhone: { name: 'otp-req-phone', limit: 3, windowSeconds: 900 },
  otpRequestPerIp: { name: 'otp-req-ip', limit: 10, windowSeconds: 900 },
  otpVerifyPerIp: { name: 'otp-verify-ip', limit: 20, windowSeconds: 900 },
} as const satisfies Record<string, LimitRule>;
