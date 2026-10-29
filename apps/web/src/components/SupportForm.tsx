'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { Notice } from './ui';

const CATEGORIES = [
  ['CONNECTIVITY', 'Can’t connect / slow'],
  ['OUTAGE', 'Report an outage'],
  ['PAYMENT', 'Payment'],
  ['VOUCHER', 'Voucher code'],
  ['ACCOUNT', 'My account'],
  ['OTHER', 'Something else'],
] as const;

export function SupportForm({
  propertySlug,
  signedIn,
  defaultCategory = 'CONNECTIVITY',
  orderId,
}: {
  propertySlug: string;
  signedIn: boolean;
  defaultCategory?: string;
  orderId?: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState('sending');
    setError(null);
    try {
      await api('/support/tickets', {
        method: 'POST',
        body: {
          propertySlug,
          category: f.get('category'),
          subject: String(f.get('subject') ?? ''),
          body: String(f.get('body') ?? ''),
          ...(signedIn ? {} : { contactPhone: String(f.get('phone') ?? '') }),
          ...(orderId ? { orderId } : {}),
        },
      });
      setState('sent');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send. Try again.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <Notice tone="ok" title="Message sent">
        <p>
          Thanks. The property team will get back to you
          {signedIn ? ' — you can follow it in your account' : ' on the number you gave'}.
        </p>
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="field">
        <label htmlFor="category">What is it about?</label>
        <select id="category" name="category" defaultValue={defaultCategory}>
          {CATEGORIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="subject">Short summary</label>
        <input
          id="subject"
          name="subject"
          required
          minLength={3}
          maxLength={160}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="body">Details</label>
        <span className="hint" id="body-hint">
          Your room, what happened and when. Don&apos;t include card numbers or your voucher code.
        </span>
        <textarea
          id="body"
          name="body"
          required
          minLength={10}
          maxLength={4000}
          aria-describedby="body-hint"
        />
      </div>
      {!signedIn ? (
        <div className="field">
          <label htmlFor="phone">Phone number for a reply</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            placeholder="0803 000 0000"
          />
        </div>
      ) : null}
      <button className="button" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
