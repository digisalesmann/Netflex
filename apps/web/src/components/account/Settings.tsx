'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { ConfirmButton } from '../ConfirmButton';

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

const SECTIONS = [
  {
    id: 'profile',
    label: 'Profile',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.3 4-5 7.5-5s6.3 1.7 7.5 5',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  },
  { id: 'devices', label: 'Devices', icon: 'M4 6.5h12v8H4zM2.5 17.5h15M18 9h3.5v9.5H18z' },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: 'M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z',
  },
] as const;

const KINDS = [
  ['expiryReminders', 'Reminder before my plan ends', 'A heads-up before your time runs out'],
  ['receipts', 'Payment receipts', 'A copy of each receipt after you pay'],
  ['outageNotices', 'Outage notices', 'When the connection is down or back'],
] as const;

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

/** "Chrome on Android" from a user-agent string, plus whether it's a phone. */
function describe(ua: string | null): { name: string; phone: boolean } {
  if (!ua) return { name: 'Unknown device', phone: false };
  const phone = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return { name: os ? `${browser} on ${os}` : browser, phone };
}

const ago = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

export function Settings({
  name,
  email,
  prefs,
  sessions,
}: {
  name: string;
  email: string | null;
  prefs: Prefs;
  sessions: SessionRow[];
}) {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [p, setP] = useState(prefs.preferences);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<string>('profile');
  const dirty = JSON.stringify(p) !== JSON.stringify(prefs.preferences);

  // highlight the section in view
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '-20% 0px -60% 0px' },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 4500);
    return () => window.clearTimeout(t);
  }, [msg]);

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
  const noChannels = !prefs.channelsAvailable.sms && !prefs.channelsAvailable.email;
  const initials = (name || 'You')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="set">
      <nav className="set__index" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="set__index-link"
            aria-current={active === s.id ? 'true' : undefined}
          >
            <Icon d={s.icon} />
            {s.label}
          </a>
        ))}
      </nav>

      <div className="set__body">
        <section id="profile" className="set__sec" aria-labelledby="profile-title">
          <h2 id="profile-title" className="set__title">
            Profile
          </h2>
          <p className="set__lede">How the lodge team sees you.</p>
          <div className="set__who">
            <span className="set__avatar" aria-hidden="true">
              {initials}
            </span>
            <span>
              <strong>{name || 'Guest'}</strong>
              <span>{email ? `${email} · ` : ''}signs in with an email code</span>
            </span>
          </div>
          <form
            className="set__form"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const displayName = String(new FormData(e.currentTarget).get('name') ?? '');
              void act(() => api('/me', { method: 'PATCH', body: { displayName } }), 'Name saved.');
            }}
          >
            <div className="set__field">
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
            <button className="acct-btn acct-btn--solid" type="submit" disabled={busy}>
              Save name
            </button>
          </form>
        </section>

        <section id="notifications" className="set__sec" aria-labelledby="notify-title">
          <h2 id="notify-title" className="set__title">
            Notifications
          </h2>
          <p className="set__lede">Choose what we send you, and how.</p>
          {noChannels ? (
            <p className="set__note">
              <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01" />
              Messages aren&apos;t being sent yet: receipts and reminders by email are coming soon.
              Your choices are saved for when they start.
            </p>
          ) : null}
          <div className="set__grid" role="group" aria-label="Notification choices">
            <span aria-hidden="true" />
            <span className="set__col" aria-hidden="true">
              Email
            </span>
            {KINDS.map(([k, label, hint]) => (
              <div key={k} className="set__row">
                <span className="set__kind">
                  <strong>{label}</strong>
                  <span>{hint}</span>
                </span>
                {(['email'] as const).map((ch) => (
                  <label key={ch} className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={p[ch][k]}
                      onChange={() => toggle(ch, k)}
                      aria-label={`${label} by email`}
                    />
                    <span className="switch__track" aria-hidden="true" />
                  </label>
                ))}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="acct-btn acct-btn--solid set__save"
            disabled={busy || !dirty}
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

        <section id="devices" className="set__sec" aria-labelledby="devices-title">
          <h2 id="devices-title" className="set__title">
            Where you&apos;re signed in
          </h2>
          <p className="set__lede">Sign out of any device you don&apos;t recognise.</p>
          <ul className="set__devices">
            {sessions.map((s) => {
              const d = describe(s.userAgent);
              return (
                <li key={s.id} className="set__device">
                  <span className="set__device-icon">
                    <Icon
                      d={
                        d.phone
                          ? 'M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5zM10.5 17h3'
                          : 'M4.5 5.5h15v10h-15zM2.5 18.5h19'
                      }
                    />
                  </span>
                  <span className="set__device-text">
                    <strong>
                      {d.name}
                      {s.current ? <span className="set__this">This device</span> : null}
                    </strong>
                    <span>Last active {ago(s.lastSeenAt)}</span>
                  </span>
                  {!s.current ? (
                    <ConfirmButton
                      className="acct-btn"
                      disabled={busy}
                      title={`Sign out ${d.name}?`}
                      body="That device will need a new code from your email to sign back in."
                      confirmLabel="Sign out that device"
                      onConfirm={() =>
                        act(
                          () => api(`/me/sessions/${s.id}/revoke`, { method: 'POST' }),
                          'Signed out on that device.',
                          () => window.location.reload(),
                        )
                      }
                    >
                      Sign out this device
                    </ConfirmButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <ConfirmButton
            className="acct-btn set__danger"
            title="Sign out everywhere?"
            body="Every device signed in to your account, including this one, will be signed out. Your plans keep running."
            confirmLabel="Sign out everywhere"
            onConfirm={() =>
              act(
                () => api('/auth/logout-all', { method: 'POST' }),
                'Signed out everywhere.',
                () => window.location.assign('/'),
              )
            }
          >
            Sign out everywhere
          </ConfirmButton>
        </section>

        <section id="privacy" className="set__sec" aria-labelledby="privacy-title">
          <h2 id="privacy-title" className="set__title">
            Privacy and your data
          </h2>
          <p className="set__lede">Your data stays yours.</p>
          <div className="set__privacy">
            <div className="set__priv-item">
              <Icon d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />
              <div>
                <strong>Download your data</strong>
                <p>A file with your profile, orders, plans, devices and requests.</p>
                <a href="/api/v1/me/export" download className="acct-btn">
                  Download my data
                </a>
              </div>
            </div>
            <div className="set__priv-item">
              <Icon d="M5 7h14M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7" />
              <div>
                <strong>Erase your data</strong>
                <p>
                  Payment records must be kept as long as the law requires; the team will tell you
                  what can be erased.
                </p>
                <button
                  type="button"
                  className="acct-btn"
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
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="set__toast" aria-live="polite" data-tone={msg?.tone} data-show={Boolean(msg)}>
        {msg ? (
          <>
            <Icon d={msg.tone === 'ok' ? 'M5 12.5 10 17.5 19 7' : 'M12 8v5M12 16.5h.01'} />
            {msg.text}
          </>
        ) : null}
      </div>
    </div>
  );
}
