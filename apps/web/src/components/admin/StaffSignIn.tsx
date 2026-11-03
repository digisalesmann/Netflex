'use client';

import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { Notice } from '../ui';
import { CopyButton } from './CopyButton';

export type Step = 'login' | 'enroll' | 'verify' | 'password';
type Next = 'DONE' | 'MFA_ENROLL' | 'MFA_VERIFY' | 'PASSWORD_CHANGE';

const STEP_OF: Record<Exclude<Next, 'DONE'>, Step> = {
  MFA_ENROLL: 'enroll',
  MFA_VERIFY: 'verify',
  PASSWORD_CHANGE: 'password',
};

const TITLES: Record<Step, [string, string]> = {
  login: ['Office sign-in', 'For lodge staff. Residents sign in from My account.'],
  enroll: [
    'Set up two-step sign-in',
    'Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator or 1Password), then enter the 6-digit code it shows.',
  ],
  verify: [
    'Enter your code',
    'Open your authenticator app and enter the 6-digit code for Netflex.',
  ],
  password: ['Choose a new password', 'Your account was set up with a temporary password.'],
};

export function StaffSignIn({ start, next }: { start: Step; next: string }) {
  const [step, setStep] = useState<Step>(start);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ text: string; svg: string } | null>(null);

  const go = (n: Next) => {
    if (n === 'DONE') window.location.assign(next);
    else setStep(STEP_OF[n]);
  };

  // Fetch a fresh secret when the enrolment step opens.
  useEffect(() => {
    if (step !== 'enroll' || secret) return;
    api<{ secret: string; otpauthUri: string }>('/auth/staff/mfa/enroll', { method: 'POST' })
      .then(async (r) =>
        setSecret({
          text: r.secret,
          svg: await QRCode.toString(r.otpauthUri, { type: 'svg', margin: 0, width: 184 }),
        }),
      )
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Try again.'));
  }, [step, secret]);

  async function submit(e: FormEvent<HTMLFormElement>, run: (f: FormData) => Promise<Next>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      go(await run(f));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? [
              err.message,
              ...Object.values(err.details ?? {})
                .flat()
                .map(String),
            ].join(' ')
          : 'Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const s = (f: FormData, k: string) => String(f.get(k) ?? '');
  const [title, lede] = TITLES[step];

  return (
    <>
      <h1 className="auth__title">{title}</h1>
      <p className="auth__lede">{lede}</p>
      {error ? <Notice tone="bad">{error}</Notice> : null}

      {step === 'login' ? (
        <form
          onSubmit={(e) =>
            void submit(e, async (f) => {
              const r = await api<{ next: Next }>('/auth/staff/login', {
                method: 'POST',
                body: { email: s(f, 'email').trim().toLowerCase(), password: s(f, 'password') },
              });
              return r.next;
            })
          }
          noValidate
        >
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="button button--block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      ) : null}

      {step === 'enroll' || step === 'verify' ? (
        <form
          onSubmit={(e) =>
            void submit(e, async (f) => {
              const r = await api<{ next: Next }>('/auth/staff/mfa/verify', {
                method: 'POST',
                body: { code: s(f, 'code').replace(/\s/g, '') },
              });
              return r.next;
            })
          }
          noValidate
        >
          {step === 'enroll' ? (
            <div className="adm-qr">
              {secret ? (
                <>
                  <span
                    className="adm-qr__code"
                    role="img"
                    aria-label="QR code for your authenticator app"
                    dangerouslySetInnerHTML={{ __html: secret.svg }}
                  />
                  <p className="adm-qr__key">Can&apos;t scan? Enter this key instead:</p>
                  <div className="adm-qr__row">
                    <code>
                      {/* Two halves that sit on one line, or stack neatly on narrow screens. */}
                      {[secret.text.slice(0, 16), secret.text.slice(16)].map((half) => (
                        <span key={half}>{half.replace(/(.{4})/g, '$1 ').trim()}</span>
                      ))}
                    </code>
                    <CopyButton value={secret.text} label="key" />
                  </div>
                </>
              ) : (
                <p className="adm-qr__key">Preparing your code…</p>
              )}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              required
              className="code-input"
            />
          </div>
          <button className="button button--block" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
        </form>
      ) : null}

      {step === 'password' ? (
        <form
          onSubmit={(e) =>
            void submit(e, async (f) => {
              if (s(f, 'newPassword') !== s(f, 'confirm'))
                throw new ApiError(400, 'VALIDATION_FAILED', 'The new passwords don’t match.');
              await api('/auth/staff/password', {
                method: 'POST',
                body: {
                  currentPassword: s(f, 'currentPassword'),
                  newPassword: s(f, 'newPassword'),
                },
              });
              return 'DONE';
            })
          }
          noValidate
        >
          <div className="field">
            <label htmlFor="currentPassword">Temporary password</label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="newPassword">New password</label>
            <span className="hint" id="pw-hint">
              At least 12 characters. A short sentence is easiest to remember.
            </span>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              aria-describedby="pw-hint"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirm">Repeat new password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
          <button className="button button--block" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save and continue'}
          </button>
        </form>
      ) : null}
    </>
  );
}
