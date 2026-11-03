'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { describeDevice } from '@/lib/devices';
import { ConfirmButton } from '../ConfirmButton';
import { ActionForm, Field, Panel, errorText } from './kit';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** Lodge name and contacts, with a live preview and a save button that wakes up on change. */
export function LodgeProfile({
  propertyId,
  name,
  supportPhone,
  supportEmail,
  canEdit,
}: {
  propertyId: string;
  name: string;
  supportPhone: string | null;
  supportEmail: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const initial = { name, phone: supportPhone ?? '', email: supportEmail ?? '' };
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = v.name !== saved.name || v.phone !== saved.phone || v.email !== saved.email;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (v.name.trim().length < 2) return setMsg({ ok: false, text: 'Give the lodge a name.' });
    setBusy(true);
    setMsg(null);
    try {
      await api(`/admin/properties/${propertyId}`, {
        method: 'PATCH',
        body: {
          name: v.name.trim(),
          supportPhone: v.phone.trim() || null,
          supportEmail: v.email.trim().toLowerCase() || null,
        },
      });
      setSaved(v);
      setMsg({ ok: true, text: 'Saved. The website shows the new details within a minute.' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  const preview = (
    <figure className="adm-preview" aria-label="How residents see it">
      <figcaption>How residents see it</figcaption>
      <p className="adm-preview__name">{v.name || 'Your lodge'} Wi-Fi</p>
      <p className="adm-preview__help">Need a hand?</p>
      <p className="adm-preview__line">{v.phone || 'No phone'}</p>
      <p className="adm-preview__line">{v.email || 'No email'}</p>
    </figure>
  );

  if (!canEdit)
    return (
      <div className="adm-split">
        <dl className="adm-facts">
          <dt>Name</dt>
          <dd>{name}</dd>
          <dt>Phone</dt>
          <dd>{supportPhone ?? 'Not set'}</dd>
          <dt>Email</dt>
          <dd>{supportEmail ?? 'Not set'}</dd>
        </dl>
        {preview}
      </div>
    );

  return (
    <div className="adm-split">
      <form className="adm-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Lodge name">
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </Field>
        <Field label="Phone for residents" hint="Help pages, receipts, the Wi-Fi sign-in page.">
          <input
            name="supportPhone"
            type="tel"
            inputMode="tel"
            maxLength={32}
            value={v.phone}
            onChange={(e) => setV({ ...v, phone: e.target.value })}
            placeholder="+234 704 033 2279"
          />
        </Field>
        <Field label="Email for residents" hint="Also where replies to account emails go.">
          <input
            name="supportEmail"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={v.email}
            onChange={(e) => setV({ ...v, email: e.target.value })}
          />
        </Field>
        <div className="adm-form__bar">
          <button className="adm-btn adm-btn--solid" type="submit" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {dirty ? (
            <button
              type="button"
              className="adm-btn adm-btn--quiet"
              onClick={() => {
                setV(saved);
                setMsg(null);
              }}
            >
              Discard
            </button>
          ) : null}
          {msg ? (
            <span className="adm-inline__msg" data-ok={msg.ok} role={msg.ok ? 'status' : 'alert'}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </form>
      {preview}
    </div>
  );
}

export function ChangePassword() {
  return (
    <Panel label="Change password" title="Change your password" tone="quiet">
      {(close) => (
        <ActionForm
          cta="Change password"
          done={close}
          submit={(f) => {
            if (str(f, 'next') !== str(f, 'again'))
              throw new Error('The new passwords don’t match.');
            return api('/auth/staff/password', {
              method: 'POST',
              body: {
                currentPassword: String(f.get('current') ?? ''),
                newPassword: String(f.get('next') ?? ''),
              },
            });
          }}
        >
          <Field label="Current password">
            <input name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 12 characters. A short sentence works well.">
            <input name="next" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Repeat new password">
            <input name="again" type="password" autoComplete="new-password" required />
          </Field>
          <p className="adm-sub">Your other devices are signed out when it changes.</p>
        </ActionForm>
      )}
    </Panel>
  );
}

export interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  current: boolean;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

const PHONE =
  'M8 3.5h8A1.5 1.5 0 0 1 17.5 5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5zM11 17.5h2';
const LAPTOP = 'M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5zM3 18h18';

export function Devices({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const sorted = [...sessions].sort((a, b) =>
    a.current ? -1 : b.current ? 1 : b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
  return (
    <>
      <ul className="adm-devices">
        {sorted.map((s) => {
          const d = describeDevice(s.userAgent);
          return (
            <li key={s.id}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d={d.phone ? PHONE : LAPTOP} />
              </svg>
              <span className="adm-devices__text">
                <strong>
                  {d.name}
                  {s.current ? <span className="adm-badge">This device</span> : null}
                </strong>
                <span>
                  {s.current ? 'Active now' : `Last active ${when(s.lastSeenAt)}`} · signed in{' '}
                  {when(s.createdAt)}
                </span>
              </span>
              {!s.current ? (
                <ConfirmButton
                  className="adm-btn adm-btn--quiet"
                  title={`Sign out ${d.name}?`}
                  body="That device will need your password and a two-step code to get back in."
                  confirmLabel="Sign out"
                  onConfirm={() =>
                    api(`/me/sessions/${s.id}/revoke`, { method: 'POST' })
                      .then(() => router.refresh())
                      .catch((e: unknown) => setError(errorText(e)))
                  }
                >
                  Sign out
                </ConfirmButton>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="adm-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="adm-after">
        <ConfirmButton
          className="adm-btn adm-btn--danger"
          title="Sign out everywhere?"
          body="Every device signed in to your office account, including this one, will be signed out."
          confirmLabel="Sign out everywhere"
          onConfirm={async () => {
            await api('/auth/logout-all', { method: 'POST' }).catch(() => null);
            window.location.assign('/admin/sign-in');
          }}
        >
          Sign out everywhere
        </ConfirmButton>
      </div>
    </>
  );
}
