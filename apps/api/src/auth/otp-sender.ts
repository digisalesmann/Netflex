import { HttpStatus } from '@nestjs/common';
import { assertSimulatorAllowed, type NetflexEnvironment } from '@netflex/config';
import { ApiError } from '../common/api-error.js';

export const OTP_SENDER = Symbol('OTP_SENDER');

/** Delivers one-time codes. A real SMS provider is not chosen yet (assumption A13). */
export interface OtpSender {
  readonly configured: boolean;
  send(phoneE164: string, code: string): Promise<void>;
}

/** Default: phone sign-in is unavailable until a provider is configured. Never silently bypassed. */
export class UnconfiguredOtpSender implements OtpSender {
  readonly configured = false;
  send(): Promise<void> {
    throw new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'SERVICE_UNAVAILABLE',
      'Phone sign-in is not available yet.',
    );
  }
}

/**
 * TEST DOUBLE. Keeps codes in memory so tests can read them. Refuses to construct
 * outside development/test (config validation also rejects OTP_PROVIDER=fake there).
 */
export class FakeOtpSender implements OtpSender {
  readonly configured = true;
  private readonly sent = new Map<string, string[]>();
  constructor(env: NetflexEnvironment) {
    assertSimulatorAllowed(env, 'FakeOtpSender');
  }
  send(phoneE164: string, code: string): Promise<void> {
    this.sent.set(phoneE164, [...(this.sent.get(phoneE164) ?? []), code]);
    return Promise.resolve();
  }
  lastCode(phoneE164: string): string | undefined {
    return this.sent.get(phoneE164)?.at(-1);
  }
  count(phoneE164: string): number {
    return this.sent.get(phoneE164)?.length ?? 0;
  }
}
