import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AddResident } from '@/components/admin/ResidentActions';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import { allTenants, byLabel, propertyStructure, roomOptions, shortDate } from '@/lib/admin-data';

export const metadata = { title: 'Residents' };

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function ResidentsPage({ searchParams }: { searchParams: Params }) {
  const me = await requireStaff('/admin/residents');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'tenant.read', property.id)) redirect('/admin');
  const q = await searchParams;
  const search = typeof q.q === 'string' ? q.q.trim().slice(0, 60) : '';
  const show = q.show === 'past' ? 'past' : 'current';
  const canManage = allowed(me, 'tenant.manage', property.id);

  const [tenants, structure] = await Promise.all([
    allTenants(property.id, search || undefined),
    canManage ? propertyStructure(property.id) : Promise.resolve(null),
  ]);
  const current = tenants
    .flatMap((t) => (t.currentAssignment ? [{ ...t, at: t.currentAssignment }] : []))
    .sort((a, b) => byLabel(a.at.room, b.at.room));
  const past = tenants
    .filter((t) => !t.currentAssignment)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const rows = show === 'past' ? past : current;

  return (
    <>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">{property.name}</p>
          <h1 className="adm-head__title">Residents</h1>
          <p className="adm-head__lede">
            {current.length} living here now{past.length ? ` · ${past.length} moved out` : ''}
          </p>
        </div>
        {canManage && structure ? (
          <AddResident propertyId={property.id} groups={roomOptions(structure)} />
        ) : null}
      </header>

      <div className="adm-toolbar">
        <form className="adm-search" role="search" action="/admin/residents">
          <label className="adm-sr" htmlFor="q">
            Search residents
          </label>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
          </svg>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Name, email or phone"
            autoComplete="off"
          />
          {show === 'past' ? <input type="hidden" name="show" value="past" /> : null}
        </form>
        <nav className="adm-tabs" aria-label="Which residents">
          <Link
            href={`/admin/residents${search ? `?q=${encodeURIComponent(search)}` : ''}`}
            aria-current={show === 'current' ? 'page' : undefined}
          >
            Living here <span>{current.length}</span>
          </Link>
          <Link
            href={`/admin/residents?show=past${search ? `&q=${encodeURIComponent(search)}` : ''}`}
            aria-current={show === 'past' ? 'page' : undefined}
          >
            Moved out <span>{past.length}</span>
          </Link>
        </nav>
      </div>

      {rows.length ? (
        <ul className="adm-people">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/residents/${t.id}`} className="adm-person">
                <span className="adm-person__avatar" aria-hidden="true">
                  {t.displayName
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="adm-person__main">
                  <strong>{t.displayName}</strong>
                  <span>{t.email ?? t.phoneE164 ?? 'No contact on file'}</span>
                </span>
                <span className="adm-person__side">
                  {t.currentAssignment ? (
                    <>
                      <strong>Room {t.currentAssignment.room.label}</strong>
                      <span>since {shortDate(t.currentAssignment.startsAt)}</span>
                    </>
                  ) : (
                    <span>Moved out</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="adm-empty">
          {search
            ? `No residents match “${search}”.`
            : show === 'past'
              ? 'Nobody has moved out yet.'
              : 'No residents yet. Add the first one to give them room and floor plans.'}
        </p>
      )}
    </>
  );
}
