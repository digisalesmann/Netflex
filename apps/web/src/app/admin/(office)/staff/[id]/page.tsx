import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DisableStaff, GiveRole, RemoveRole, ResetSignIn } from '@/components/admin/StaffActions';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import { ROLE_HINT, ROLE_LABEL, actionLabel } from '@/lib/admin-activity';
import { when } from '@/lib/admin-payments';
import { initials, lastSeen, staffList } from '@/lib/admin-staff';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Staff member' };

interface Entry {
  id: string;
  occurredAt: string;
  actor: { id: string } | null;
  action: string;
  reason: string | null;
}

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireStaff(`/admin/staff/${id}`);
  const { property, all } = await currentProperty();
  if (!property || !allowed(me, 'staff.read', property.id)) redirect('/admin');
  const isOwner = me.grants.some((g) => g.role === 'OWNER' && g.propertyId === null);
  const s = (await staffList()).find((x) => x.id === id);
  if (!s) notFound();
  const self = s.id === me.user.id;
  const active = s.status === 'ACTIVE';
  const canManage = isOwner && !self && active;
  const names = new Map(all.map((p) => [p.id, p.name]));

  // Their recent actions (owners can read the company-wide log).
  const log = isOwner
    ? ((await serverApi<Entry[]>('/admin/audit?limit=200', { auth: true })).data ?? [])
        .filter((e) => e.actor?.id === s.id)
        .slice(0, 8)
    : [];

  return (
    <>
      <Link href="/admin/staff" className="adm-back">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19 12H6M11 6.5 5.5 12 11 17.5" />
        </svg>
        Staff
      </Link>

      <header className="adm-profile">
        <span className="adm-profile__avatar" aria-hidden="true">
          {initials(s.displayName)}
        </span>
        <div className="adm-profile__text">
          <h1 className="adm-head__title">{s.displayName}</h1>
          <p className="adm-head__lede">{s.email}</p>
          <p className="adm-profile__tags">
            {self ? <span className="adm-badge">You</span> : null}
            <span className="adm-tag" data-tone={active ? 'ok' : 'muted'}>
              {active ? 'Active' : 'Disabled'}
            </span>
          </p>
        </div>
      </header>

      <section className="adm-setting" aria-labelledby="acc-title">
        <div className="adm-setting__about">
          <h2 id="acc-title" className="adm-h2">
            Access
          </h2>
          <p>What they can see and do. Each role is for one lodge, except Owner.</p>
        </div>
        <div className="adm-setting__body">
          {s.grants.length ? (
            <ul className="adm-rolelist">
              {s.grants.map((g) => (
                <li key={g.id}>
                  <span className="adm-role-badge" data-role={g.role}>
                    {ROLE_LABEL[g.role] ?? g.role}
                  </span>
                  <span className="adm-rolelist__text">
                    <strong>
                      {g.propertyId ? (names.get(g.propertyId) ?? 'Another lodge') : 'All lodges'}
                    </strong>
                    <span>{ROLE_HINT[g.role]}</span>
                  </span>
                  {canManage ? (
                    <RemoveRole userId={s.id} grantId={g.id} label={ROLE_LABEL[g.role] ?? g.role} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-empty">No roles. They can sign in but see nothing.</p>
          )}
          {canManage ? (
            <div className="adm-after">
              <GiveRole
                userId={s.id}
                propertyId={property.id}
                have={s.grants
                  .filter((g) => g.propertyId === property.id || g.propertyId === null)
                  .map((g) => g.role)}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="adm-setting" aria-labelledby="sec-title">
        <div className="adm-setting__about">
          <h2 id="sec-title" className="adm-h2">
            Sign-in and security
          </h2>
          <p>Everyone signs in with a password and a code from an authenticator app.</p>
        </div>
        <div className="adm-setting__body">
          <dl className="adm-facts">
            <dt>Two-step</dt>
            <dd>
              {s.mfaEnabled ? (
                <span className="adm-tag" data-tone="ok">
                  On
                </span>
              ) : (
                <span className="adm-tag" data-tone="warn">
                  Not set up yet
                </span>
              )}
            </dd>
            <dt>Last active</dt>
            <dd>{lastSeen(s.lastLoginAt)}</dd>
          </dl>
          {canManage ? (
            <div className="adm-after">
              <ResetSignIn userId={s.id} name={s.displayName} email={s.email ?? ''} />
              <p className="adm-sub adm-after">
                For a lost phone or forgotten password: they get a temporary password and set up
                two-step again.
              </p>
            </div>
          ) : self ? (
            <p className="adm-sub adm-after">
              Change your password in <Link href="/admin/settings">Settings</Link>.
            </p>
          ) : null}
        </div>
      </section>

      {isOwner ? (
        <section className="adm-setting" aria-labelledby="act-title">
          <div className="adm-setting__about">
            <h2 id="act-title" className="adm-h2">
              Recent activity
            </h2>
            <p>The last things they did.</p>
          </div>
          <div className="adm-setting__body">
            {log.length ? (
              <ol className="adm-log adm-log--compact">
                {log.map((e) => (
                  <li key={e.id}>
                    <span className="adm-log__time">{when(e.occurredAt)}</span>
                    <span className="adm-log__text">
                      {actionLabel(e.action)}
                      {e.reason ? <span className="adm-log__why">“{e.reason}”</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="adm-empty">Nothing yet.</p>
            )}
            <p className="adm-after">
              <Link href="/admin/activity" className="adm-link">
                All activity
              </Link>
            </p>
          </div>
        </section>
      ) : null}

      {canManage ? (
        <section className="adm-setting adm-setting--danger" aria-labelledby="dz-title">
          <div className="adm-setting__about">
            <h2 id="dz-title" className="adm-h2">
              Remove access
            </h2>
            <p>They’re signed out at once. Their history stays in the activity log.</p>
          </div>
          <div className="adm-setting__body">
            <DisableStaff userId={s.id} name={s.displayName} />
          </div>
        </section>
      ) : null}
    </>
  );
}
