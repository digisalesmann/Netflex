'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { ActionForm, Field, Panel } from './kit';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export function LodgeDetails({
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
  const [saved, setSaved] = useState(false);
  if (!canEdit)
    return (
      <dl className="adm-facts">
        <dt>Name</dt>
        <dd>{name}</dd>
        <dt>Phone</dt>
        <dd>{supportPhone ?? 'Not set'}</dd>
        <dt>Email</dt>
        <dd>{supportEmail ?? 'Not set'}</dd>
      </dl>
    );
  return (
    <ActionForm
      cta={saved ? 'Saved' : 'Save details'}
      done={() => setSaved(true)}
      submit={(f) => {
        setSaved(false);
        const email = str(f, 'supportEmail').toLowerCase();
        return api(`/admin/properties/${propertyId}`, {
          method: 'PATCH',
          body: {
            name: str(f, 'name'),
            supportPhone: str(f, 'supportPhone') || null,
            supportEmail: email || null,
          },
        });
      }}
    >
      <Field label="Lodge name" hint="Shown on the website, the Wi-Fi sign-in page and emails.">
        <input name="name" required minLength={2} maxLength={120} defaultValue={name} />
      </Field>
      <Field label="Phone for residents" hint="Shown on the help pages and receipts.">
        <input
          name="supportPhone"
          type="tel"
          inputMode="tel"
          maxLength={32}
          defaultValue={supportPhone ?? ''}
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
          defaultValue={supportEmail ?? ''}
        />
      </Field>
    </ActionForm>
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
          <Field
            label="New password"
            hint="At least 12 characters. Your other sessions are signed out."
          >
            <input name="next" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Repeat new password">
            <input name="again" type="password" autoComplete="new-password" required />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}
