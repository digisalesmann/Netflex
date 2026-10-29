'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { Notice } from '../ui';

export function SignIn({ next }: { next: string }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  async function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = String(new FormData(e.currentTarget).get('phone') ?? '');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/tenant/otp/request', { method: 'POST', body: { phone: p } });
      setPhone(p);
      setStep('code');
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setUnavailable(true);
      else
        setError(
          err instanceof ApiError
            ? err.code === 'VALIDATION_FAILED'
              ? 'Enter a valid phone number, e.g. 0803 000 0000.'
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
          phone,
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
      <Notice tone="warn" title="Phone sign-in isn’t available yet">
        <p>
          Text messages aren&apos;t set up for this property yet. You can still buy a personal plan
          on the Wi-Fi sign-in page without an account. For room plans or help, contact the property
          office.
        </p>
      </Notice>
    );
  }

  return step === 'phone' ? (
    <form onSubmit={(e) => void request(e)} noValidate>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="field">
        <label htmlFor="phone">Phone number</label>
        <span className="hint" id="phone-hint">
          We&apos;ll text you a 6-digit code.
        </span>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          aria-describedby="phone-hint"
          placeholder="0803 000 0000"
        />
      </div>
      <button className="button button--block" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send code'}
      </button>
    </form>
  ) : (
    <form onSubmit={(e) => void verify(e)} noValidate>
      <p>We sent a code to {phone}. It expires in 5 minutes.</p>
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
        <button type="button" className="linkbutton" onClick={() => setStep('phone')}>
          Use a different number or resend
        </button>
      </p>
    </form>
  );
}
