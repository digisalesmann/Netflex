import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AddStaff } from '@/components/admin/StaffActions';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/admin-activity';
import { initials, lastSeen, mainRole, staffList, type StaffRow } from '@/lib/admin-staff';

export const metadata = { title: 'Staff' };

type Params = Promise<Record<string, string | string[] | undefined>>;

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'OWNER', label: 'Owners' },
  { id: 'PROPERTY_ADMIN', label: 'Managers' },
  { id: 'FINANCE', label: 'Finance' },
  { id: 'SUPPORT', label: 'Front desk' },
  { id: 'NETWORK_ADMIN', label: 'Network' },
  { id: 'DISABLED', label: 'Disabled' },
];

export default async function StaffPage({ searchParams }: { searchParams: Params }) {
  const me = await requireStaff('/admin/staff');
  const { property, all } = await currentProperty();
  if (!property || !allowed(me, 'staff.read', property.id)) redirect('/admin');
  const isOwner = me.grants.some((g) => g.role === 'OWNER' && g.propertyId === null);
  const sp = await searchParams;
  const filter =
    typeof sp.role === 'string' && FILTERS.some((f) => f.id === sp.role) ? sp.role : '';
  const q = typeof sp.q === 'string' ? sp.q.trim().toLowerCase().slice(0, 60) : '';

  const staff = await staffList();
  const names = new Map(all.map((p) => [p.id, p.name]));
  const active = staff.filter((s) => s.status === 'ACTIVE');
  const owners = active.filter((s) => s.grants.some((g) => g.role === 'OWNER')).length;
  const noTwoStep = active.filter((s) => !s.mfaEnabled).length;
  const count = (id: string) =>
    id === ''
      ? active.length
      : id === 'DISABLED'
        ? staff.length - active.length
        : active.filter((s) => s.grants.some((g) => g.role === id)).length;

  const rows = staff
    .filter((s) =>
      filter === 'DISABLED'
        ? s.status !== 'ACTIVE'
        : s.status === 'ACTIVE' && (!filter || s.grants.some((g) => g.role === filter)),
    )
    .filter(
      (s) =>
        !q || s.displayName.toLowerCase().includes(q) || (s.email ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => (a.id === me.user.id ? -1 : b.id === me.user.id ? 1 : 0));

  const scope = (s: StaffRow) => {
    const g = s.grants.find((x) => x.role === mainRole(s));
    return g?.propertyId ? (names.get(g.propertyId) ?? 'Another lodge') : 'All lodges';
  };

  return (
    <>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">{property.name}</p>
          <h1 className="adm-head__title">Staff</h1>
          <p className="adm-head__lede">
            {active.length} {active.length === 1 ? 'member' : 'members'} · {owners}{' '}
            {owners === 1 ? 'owner' : 'owners'}
            {noTwoStep ? ` · ${noTwoStep} without two-step yet` : ''}
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

      <div className="adm-toolbar">
        <form className="adm-search" role="search" action="/admin/staff">
          <label className="adm-sr" htmlFor="q">
            Search staff
          </label>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
          </svg>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name or email"
            autoComplete="off"
          />
          {filter ? <input type="hidden" name="role" value={filter} /> : null}
        </form>
        <nav className="adm-tabs adm-tabs--scroll" aria-label="Filter by role">
          {FILTERS.filter((f) => f.id === '' || count(f.id) > 0).map((f) => (
            <Link
              key={f.id || 'all'}
              href={`/admin/staff?${new URLSearchParams({
                ...(f.id ? { role: f.id } : {}),
                ...(q ? { q } : {}),
              })}`}
              aria-current={filter === f.id ? 'page' : undefined}
            >
              {f.label} <em>{count(f.id)}</em>
            </Link>
          ))}
        </nav>
      </div>

      {rows.length ? (
        <div className="adm-table">
          <div className="adm-table__head" aria-hidden="true">
            <span>Member</span>
            <span>Role</span>
            <span>Two-step</span>
            <span>Last active</span>
            <span />
          </div>
          <ul className="adm-table__body" aria-label="Staff members">
            {rows.map((s) => {
              const role = mainRole(s);
              const extra = s.grants.length - 1;
              const self = s.id === me.user.id;
              return (
                <li key={s.id}>
                  <Link
                    href={`/admin/staff/${s.id}`}
                    className="adm-table__row"
                    data-disabled={s.status !== 'ACTIVE'}
                  >
                    <span className="adm-member">
                      <span className="adm-member__avatar" aria-hidden="true">
                        {initials(s.displayName)}
                      </span>
                      <span className="adm-member__text">
                        <strong>
                          {s.displayName}
                          {self ? <span className="adm-badge">You</span> : null}
                        </strong>
                        <span>{s.email}</span>
                      </span>
                    </span>
                    <span className="adm-table__role">
                      {role ? (
                        <>
                          <span className="adm-role-badge" data-role={role} title={ROLE_HINT[role]}>
                            {ROLE_LABEL[role] ?? role}
                            {extra > 0 ? <em> +{extra}</em> : null}
                          </span>
                          <span className="adm-table__sub">{scope(s)}</span>
                        </>
                      ) : (
                        <span className="adm-table__sub">No role</span>
                      )}
                    </span>
                    <span className="adm-table__mfa">
                      {s.status !== 'ACTIVE' ? (
                        <span className="adm-tag" data-tone="muted">
                          Disabled
                        </span>
                      ) : s.mfaEnabled ? (
                        <span className="adm-tag" data-tone="ok">
                          On
                        </span>
                      ) : (
                        <span className="adm-tag" data-tone="warn">
                          Not set up
                        </span>
                      )}
                    </span>
                    <span className="adm-table__seen">
                      <span className="adm-table__label">Last active </span>
                      {lastSeen(s.lastLoginAt)}
                    </span>
                    <span className="adm-table__go" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="m9.5 6 6 6-6 6" />
                      </svg>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="adm-empty">{q ? `No staff match “${q}”.` : 'Nobody here.'}</p>
      )}
    </>
  );
}
