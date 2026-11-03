import { HttpStatus } from '@nestjs/common';
import { assertSimulatorAllowed, type NetflexEnvironment } from '@netflex/config';
import { ApiError } from '../common/api-error.js';
import type { RenderedEmail } from './templates.js';

export const MAILER = Symbol('MAILER');

/** Sends account emails (sign-in codes today). */
export interface Mailer {
  readonly configured: boolean;
  send(to: string, email: RenderedEmail): Promise<void>;
}

const unavailable = () =>
  new ApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'SERVICE_UNAVAILABLE',
    'Email sign-in is not available yet.',
  );

/** Default: email is off until a provider is configured. Never silently bypassed. */
export class UnconfiguredMailer implements Mailer {
  readonly configured = false;
  send(): Promise<void> {
    return Promise.reject(unavailable());
  }
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendMailer implements Mailer {
  readonly configured = true;
  constructor(
    private readonly opts: {
      apiKey: string;
      from: string;
      replyTo?: string;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async send(to: string, email: RenderedEmail): Promise<void> {
    const res = await (this.opts.fetchImpl ?? fetch)(
      `${this.opts.baseUrl ?? 'https://api.resend.com'}/emails`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.opts.from,
          to: [to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(this.opts.replyTo ? { reply_to: this.opts.replyTo } : {}),
          tags: [{ name: 'type', value: email.tag }],
        }),
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => null);
    if (!res?.ok) {
      // The provider's response is not passed on: it can echo the address or settings.
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'We couldn’t send the email. Please try again in a minute.',
      );
    }
  }
}

/**
 * TEST DOUBLE. Keeps sent emails in memory so tests and the dev mailbox can read
 * them. Refuses to construct outside development/test.
 */
export class FakeMailer implements Mailer {
  readonly configured = true;
  private readonly sent: { to: string; email: RenderedEmail; at: Date }[] = [];
  constructor(env: NetflexEnvironment) {
    assertSimulatorAllowed(env, 'FakeMailer');
  }
  send(to: string, email: RenderedEmail): Promise<void> {
    this.sent.push({ to, email, at: new Date() });
    if (this.sent.length > 200) this.sent.shift();
    return Promise.resolve();
  }
  /** Newest email to this address (any address when omitted). */
  last(to?: string) {
    const key = to?.trim().toLowerCase();
    return [...this.sent].reverse().find((m) => !key || m.to === key);
  }
  /** The 6-digit code in the newest sign-in email to this address. */
  lastCode(to: string): string | undefined {
    const m = [...this.sent]
      .reverse()
      .find((x) => x.to === to.trim().toLowerCase() && x.email.tag === 'sign-in-code');
    return m?.email.text.match(/^\d{6}$/m)?.[0];
  }
  count(to: string): number {
    return this.sent.filter((m) => m.to === to.trim().toLowerCase()).length;
  }
}
