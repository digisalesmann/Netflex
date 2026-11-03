import { redirect } from 'next/navigation';
import {
  AddStaff,
  DisableStaff,
  GiveRole,
  RemoveRole,
  ResetSignIn,
} from '@/components/admin/StaffActions';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/admin-activity';
import { shortDate } from '@/lib/admin-data';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Staff' };

interface StaffRow {
  id: string;
  displayName: string;
  email: string | null;
  status: 'ACTIVE' | 'DISABLED';
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  grants: { id: string; role: string; propertyId: string | null }[];
}

export default async function StaffPage() {
  const me = await requireStaff('/admin/staff');
  const { property, all } = await currentProperty();
  if (!property || !allowed(me, 'staff.read', property.id)) redirect('/admin');
  // Only platform owners can add staff or change roles (also enforced by the API).
  const isOwner = me.grants.some((g) => g.role === 'OWNER' && g.propertyId === null);
  const staff = (await serverApi<StaffRow[]>('/admin/staff', { auth: true })).data ?? [];
  const names = new Map(all.map((p) => [p.id, p.name]));
  const active = staff.filter((s) => s.status === 'ACTIVE');
  const disabled = staff.filter((s) => s.status !== 'ACTIVE');
  const owners = active.filter((s) => s.grants.some((g) => g.role === 'OWNER')).length;

  const Person = ({ s }: { s: StaffRow }) => {
    const self = s.id === me.user.id;
    return (
      <li className="adm-staff" data-disabled={s.status !== 'ACTIVE'}>
        <span className="adm-person__avatar" aria-hidden="true">
          {s.displayName
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <span className="adm-staff__main">
          <strong>
            {s.displayName}
            {self ? <span className="adm-staff__you">You</span> : null}
          </strong>
          <span>{s.email}</span>
          <span>
            {s.status !== 'ACTIVE'
              ? 'Disabled'
              : s.lastLoginAt
                ? `Last signed in ${shortDate(s.lastLoginAt)}`
                : 'Hasn’t signed in yet'}
            {s.status === 'ACTIVE' && !s.mfaEnabled ? ' · two-step not set up' : ''}
          </span>
        </span>
        <span className="adm-staff__roles">
          {s.grants.map((g) => (
            <span key={g.id} className="adm-role" title={ROLE_HINT[g.role]}>
              {ROLE_LABEL[g.role] ?? g.role}
              <small>
                {g.propertyId ? (names.get(g.propertyId) ?? 'another lodge') : 'all lodges'}
              </small>
              {isOwner && !self && s.status === 'ACTIVE' ? (
                <RemoveRole userId={s.id} grantId={g.id} label={ROLE_LABEL[g.role] ?? g.role} />
              ) : null}
            </span>
          ))}
        </span>
        {isOwner && !self && s.status === 'ACTIVE' ? (
          <span className="adm-staff__actions">
            <GiveRole
              userId={s.id}
              propertyId={property.id}
              have={s.grants
                .filter((g) => g.propertyId === property.id || g.propertyId === null)
                .map((g) => g.role)}
            />
            <ResetSignIn userId={s.id} name={s.displayName} email={s.email ?? ''} />
            <DisableStaff userId={s.id} name={s.displayName} />
          </span>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">{property.name}</p>
          <h1 className="adm-head__title">Staff</h1>
          <p className="adm-head__lede">
            Everyone signs in with a password and a code from their phone. Roles decide what they
            can see and do.
          </p>
        </div>
        {isOwner ? <AddStaff propertyId={property.id} propertyName={property.name} /> : null}
      </header>

      {owners < 2 && isOwner ? (
        <p className="adm-callout" role="note">
          <strong>Add a second owner.</strong> If you lose your phone, another owner is the only way
          back in without technical help. Refunds also need a second person to approve.
        </p>
      ) : null}

      <ul className="adm-staffs">
        {active.map((s) => (
          <Person key={s.id} s={s} />
        ))}
      </ul>
      {disabled.length ? (
        <section className="adm-section" aria-labelledby="dis-title">
          <h2 id="dis-title" className="adm-h2">
            Disabled
          </h2>
          <ul className="adm-staffs">
            {disabled.map((s) => (
              <Person key={s.id} s={s} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="adm-section" aria-labelledby="roles-title">
        <h2 id="roles-title" className="adm-h2">
          What each role can do
        </h2>
        <dl className="adm-roles-key">
          {Object.entries(ROLE_HINT).map(([k, v]) => (
            <div key={k}>
              <dt>{ROLE_LABEL[k]}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
