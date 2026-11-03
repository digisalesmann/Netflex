'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/admin-activity';
import { Select } from '../Select';
import { ActionForm, Field, Panel } from './kit';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const WORDS = [
  'amber',
  'baobab',
  'cobalt',
  'delta',
  'ember',
  'falcon',
  'garden',
  'harbour',
  'indigo',
  'jasmine',
  'kettle',
  'lantern',
  'mango',
  'nectar',
  'orbit',
  'palm',
  'quartz',
  'river',
  'savanna',
  'tiger',
  'umbrella',
  'velvet',
  'willow',
  'zenith',
];

/** Four random words and a number: long, easy to read out, easy to type. */
function tempPassword(): string {
  const r = new Uint32Array(5);
  crypto.getRandomValues(r);
  const w = Array.from(r.slice(0, 4), (n) => WORDS[n % WORDS.length]);
  return `${w.join('-')}-${10 + ((r[4] ?? 0) % 90)}`;
}

const ROLES = ['PROPERTY_ADMIN', 'SUPPORT', 'FINANCE', 'NETWORK_ADMIN', 'OWNER'].map((k) => ({
  value: k,
  label: ROLE_LABEL[k] ?? k,
  hint: ROLE_HINT[k],
}));

function Handover({
  email,
  password,
  onDone,
}: {
  email: string;
  password: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="adm-codes">
      <p className="adm-codes__warn" role="status">
        <strong>Give these to them privately</strong> (in person or by phone). The password is shown
        once.
      </p>
      <dl className="adm-handover">
        <dt>Sign in at</dt>
        <dd>netflexhq.com/admin/sign-in</dd>
        <dt>Email</dt>
        <dd>{email}</dd>
        <dt>Temporary password</dt>
        <dd>
          <code>{password}</code>
        </dd>
      </dl>
      <p className="adm-sub">
        At first sign-in they set up two-step sign-in on their phone and choose their own password.
      </p>
      <div className="adm-actions">
        <button
          type="button"
          className="adm-btn adm-btn--quiet"
          onClick={() =>
            void navigator.clipboard
              .writeText(password)
              .then(() => setCopied(true))
              .catch(() => null)
          }
        >
          {copied ? 'Copied' : 'Copy password'}
        </button>
        <button type="button" className="adm-btn adm-btn--solid" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export function AddStaff({
  propertyId,
  propertyName,
}: {
  propertyId: string;
  propertyName: string;
}) {
  const router = useRouter();
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);
  const [suggested] = useState(tempPassword);
  return (
    <Panel
      label="Add staff"
      title={made ? 'Staff member added' : 'Add a staff member'}
      lede={made ? undefined : `They’ll work at ${propertyName}.`}
    >
      {(close) =>
        made ? (
          <Handover
            {...made}
            onDone={() => {
              setMade(null);
              close();
              router.refresh();
            }}
          />
        ) : (
          <ActionForm
            cta="Add staff member"
            busyCta="Adding…"
            refresh={false}
            submit={async (f) => {
              const email = str(f, 'email').toLowerCase();
              const password = str(f, 'password');
              const role = str(f, 'role') || 'SUPPORT';
              const u = await api<{ id: string }>('/admin/staff', {
                method: 'POST',
                body: { email, displayName: str(f, 'name'), initialPassword: password },
              });
              await api(`/admin/staff/${u.id}/roles`, {
                method: 'POST',
                body: {
                  role,
                  propertyId: role === 'OWNER' ? null : propertyId,
                  reason: str(f, 'reason') || 'New staff member',
                },
              });
              setMade({ email, password });
              return u;
            }}
          >
            <Field label="Full name">
              <input name="name" required minLength={2} maxLength={120} autoComplete="off" />
            </Field>
            <Field label="Work email" hint="They sign in with this.">
              <input
                name="email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoComplete="off"
              />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="SUPPORT" options={ROLES} />
            </Field>
            <Field
              label="Temporary password"
              hint="Suggested for you. They replace it at first sign-in."
            >
              <input name="password" required defaultValue={suggested} autoComplete="off" />
            </Field>
            <Field label="Note (optional)" hint="Saved in the activity log.">
              <input name="reason" maxLength={500} autoComplete="off" />
            </Field>
          </ActionForm>
        )
      }
    </Panel>
  );
}

export function GiveRole({
  userId,
  propertyId,
  have,
}: {
  userId: string;
  propertyId: string;
  have: string[];
}) {
  const options = ROLES.filter((r) => !have.includes(r.value));
  if (!options.length) return null;
  return (
    <Panel label="Give role" title="Give another role" tone="quiet">
      {(close) => (
        <ActionForm
          cta="Give role"
          done={close}
          submit={(f) => {
            const role = str(f, 'role') || options[0]?.value || 'SUPPORT';
            return api(`/admin/staff/${userId}/roles`, {
              method: 'POST',
              body: {
                role,
                propertyId: role === 'OWNER' ? null : propertyId,
                reason: str(f, 'reason'),
              },
            });
          }}
        >
          <Field label="Role">
            <Select name="role" defaultValue={options[0]?.value} options={options} />
          </Field>
          <Field label="Reason" hint="Saved in the activity log.">
            <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

export function RemoveRole({
  userId,
  grantId,
  label,
}: {
  userId: string;
  grantId: string;
  label: string;
}) {
  return (
    <Panel
      label="Remove"
      ariaLabel={`Remove ${label}`}
      title={`Remove the ${label} role?`}
      tone="quiet"
    >
      {(close) => (
        <ActionForm
          cta="Remove role"
          tone="danger"
          done={close}
          submit={(f) =>
            api(`/admin/staff/${userId}/roles/${grantId}/revoke`, {
              method: 'POST',
              body: { reason: str(f, 'reason') },
            })
          }
        >
          <Field label="Reason" hint="Saved in the activity log.">
            <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

export function ResetSignIn({
  userId,
  name,
  email,
}: {
  userId: string;
  name: string;
  email: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState<string | null>(null);
  const [suggested] = useState(tempPassword);
  return (
    <Panel
      label="Reset sign-in"
      title={done ? 'Sign-in reset' : `Reset ${name}’s sign-in?`}
      lede={
        done
          ? undefined
          : 'For a lost phone or forgotten password. They’re signed out everywhere, get a temporary password and set up two-step again.'
      }
      tone="quiet"
    >
      {(close) =>
        done ? (
          <Handover
            email={email}
            password={done}
            onDone={() => {
              setDone(null);
              close();
              router.refresh();
            }}
          />
        ) : (
          <ActionForm
            cta="Reset sign-in"
            refresh={false}
            submit={async (f) => {
              const pw = str(f, 'password');
              await api(`/admin/staff/${userId}/reset-credentials`, {
                method: 'POST',
                body: { temporaryPassword: pw, reason: str(f, 'reason') },
              });
              setDone(pw);
            }}
          >
            <Field label="Temporary password">
              <input name="password" required defaultValue={suggested} autoComplete="off" />
            </Field>
            <Field label="Reason" hint="Saved in the activity log.">
              <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
            </Field>
          </ActionForm>
        )
      }
    </Panel>
  );
}

export function DisableStaff({ userId, name }: { userId: string; name: string }) {
  return (
    <Panel
      label="Disable"
      title={`Disable ${name}?`}
      lede="They’re signed out straight away and can’t sign in again. Their history stays in the activity log."
      tone="danger"
    >
      {(close) => (
        <ActionForm
          cta="Disable account"
          tone="danger"
          done={close}
          submit={(f) =>
            api(`/admin/staff/${userId}/disable`, {
              method: 'POST',
              body: { reason: str(f, 'reason') },
            })
          }
        >
          <Field label="Reason" hint="Saved in the activity log.">
            <input name="reason" required minLength={3} maxLength={500} autoComplete="off" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}
