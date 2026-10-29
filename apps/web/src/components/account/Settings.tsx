'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { Notice } from '../ui';

type Channel = { expiryReminders: boolean; receipts: boolean; outageNotices: boolean };
interface Prefs {
  preferences: { sms: Channel; email: Channel };
  channelsAvailable: { sms: boolean; email: boolean };
}
interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  current: boolean;
}

export function Settings({
  name,
  prefs,
  sessions,
}: {
  name: string;
  prefs: Prefs;
  sessions: SessionRow[];
}) {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [p, setP] = useState(prefs.preferences);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, ok: string, then?: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'ok', text: ok });
      then?.();
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof ApiError ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (ch: 'sms' | 'email', k: keyof Channel) =>
    setP((x) => ({ ...x, [ch]: { ...x[ch], [k]: !x[ch][k] } }));

  return (
    <>
      <div aria-live="polite">{msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}</div>

      <section
        aria-labelledby="profile"
        className="section"
        style={{ borderTop: 0, paddingTop: 0 }}
      >
        <h2 id="profile" className="h3">
          Profile
        </h2>
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const displayName = String(new FormData(e.currentTarget).get('name') ?? '');
            void act(() => api('/me', { method: 'PATCH', body: { displayName } }), 'Name saved.');
          }}
        >
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              defaultValue={name}
              maxLength={120}
              required
              autoComplete="name"
            />
          </div>
          <button className="button" type="submit" disabled={busy}>
            Save
          </button>
        </form>
      </section>

      <section aria-labelledby="notify" className="section">
        <h2 id="notify" className="h3">
          Notifications
        </h2>
        {!prefs.channelsAvailable.sms && !prefs.channelsAvailable.email ? (
          <p className="small muted">
            Messages aren&apos;t being sent yet: the property hasn&apos;t set up text or email
            delivery. Your choices are saved for when it does.
          </p>
        ) : null}
        {(['sms', 'email'] as const).map((ch) => (
          <fieldset key={ch} style={{ border: 0, padding: 0, margin: '0 0 var(--nf-space-4)' }}>
            <legend style={{ fontWeight: 'var(--nf-weight-medium)' as never }}>
              {ch === 'sms' ? 'Text messages' : 'Email'}
            </legend>
            {(
              [
                ['expiryReminders', 'Reminder before my plan ends'],
                ['receipts', 'Payment receipts'],
                ['outageNotices', 'Outage notices'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="checkbox">
                <input type="checkbox" checked={p[ch][k]} onChange={() => toggle(ch, k)} /> {label}
              </label>
            ))}
          </fieldset>
        ))}
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() =>
            void act(
              () => api('/me/preferences', { method: 'PUT', body: p }),
              'Notification choices saved.',
            )
          }
        >
          Save choices
        </button>
      </section>

      <section aria-labelledby="sessions" className="section">
        <h2 id="sessions" className="h3">
          Where you&apos;re signed in
        </h2>
        <ul className="rows">
          {sessions.map((s) => (
            <li key={s.id} className="row-head">
              <span>
                {s.userAgent ? s.userAgent.slice(0, 60) : 'Unknown device'}
                {s.current ? ' · this device' : ''}
                <br />
                <span className="small muted">
                  last active {new Date(s.lastSeenAt).toLocaleString('en-NG')}
                </span>
              </span>
              {!s.current ? (
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => api(`/me/sessions/${s.id}/revoke`, { method: 'POST' }),
                      'Signed out on that device.',
                      () => window.location.reload(),
                    )
                  }
                >
                  Sign out
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="actions">
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={() =>
              void act(
                () => api('/auth/logout-all', { method: 'POST' }),
                'Signed out everywhere.',
                () => window.location.assign('/'),
              )
            }
          >
            Sign out everywhere
          </button>
        </div>
      </section>

      <section aria-labelledby="privacy" className="section">
        <h2 id="privacy" className="h3">
          Privacy
        </h2>
        <p>
          <a href="/api/v1/me/export" download>
            Download my data
          </a>{' '}
          <span className="small muted">
            (a JSON file with your profile, orders, plans, devices and requests)
          </span>
        </p>
        <p className="muted small">
          You can ask us to erase your personal data. Payment records must be kept for as long as
          the law requires; the team will tell you what can be erased.
        </p>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() =>
            void act(
              () =>
                api<{ message: string }>('/me/privacy/erasure-request', {
                  method: 'POST',
                  body: {},
                }),
              'Erasure request sent. The property team will contact you.',
            )
          }
        >
          Request erasure
        </button>
      </section>
    </>
  );
}
