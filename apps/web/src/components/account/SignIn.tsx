'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { Notice } from '../ui';

export function SignIn({ next }: { next: string }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  async function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = String(new FormData(e.currentTarget).get('email') ?? '')
      .trim()
      .toLowerCase();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/tenant/otp/request', { method: 'POST', body: { email: p } });
      setEmail(p);
      setStep('code');
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setUnavailable(true);
      else
        setError(
          err instanceof ApiError
            ? err.code === 'VALIDATION_FAILED'
              ? 'Enter a valid email address, e.g. amara@gmail.com.'
              : err.message
            : 'Try again.',
        );
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/auth/tenant/otp/verify', {
        method: 'POST',
        body: {
          email,
          code: String(f.get('code') ?? '').trim(),
          displayName: String(f.get('name') ?? '').trim() || undefined,
        },
      });
      window.location.assign(next.startsWith('/account') ? next : '/account');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (unavailable) {
    return (
      <Notice tone="warn" title="Email sign-in isn’t available yet">
        <p>
          Sign-in emails aren&apos;t set up for this property yet. You can still buy a personal plan
          on the Wi-Fi sign-in page without an account. For room plans or help, contact the property
          office.
        </p>
      </Notice>
    );
  }

  return step === 'email' ? (
    <form onSubmit={(e) => void request(e)} noValidate>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="field">
        <label htmlFor="email">Email address</label>
        <span className="hint" id="email-hint">
          We&apos;ll email you a 6-digit code.
        </span>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-describedby="email-hint"
          placeholder="you@example.com"
        />
      </div>
      <button className="button button--block" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send code'}
      </button>
    </form>
  ) : (
    <form onSubmit={(e) => void verify(e)} noValidate>
      <p>
        We sent a code to <strong>{email}</strong>. It expires in 5 minutes. Check your spam folder
        if it isn&apos;t there.
      </p>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="field">
        <label htmlFor="code">6-digit code</label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          className="code-input"
        />
      </div>
      <div className="field">
        <label htmlFor="name">Your name (first time only, optional)</label>
        <input id="name" name="name" autoComplete="name" maxLength={120} />
      </div>
      <button className="button button--block" type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
      <p className="small" style={{ marginTop: 'var(--nf-space-4)' }}>
        <button type="button" className="linkbutton" onClick={() => setStep('email')}>
          Use a different email or resend
        </button>
      </p>
    </form>
  );
}
