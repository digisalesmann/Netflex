import Link from 'next/link';
import { redirect } from 'next/navigation';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import { actionLabel, actionTone } from '@/lib/admin-activity';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Activity' };

type Params = Promise<Record<string, string | string[] | undefined>>;

interface Entry {
  id: string;
  occurredAt: string;
  actorType: 'USER' | 'SYSTEM' | 'PROVIDER' | string;
  actor: { id: string; displayName: string | null } | null;
  action: string;
  targetType: string | null;
  reason: string | null;
}

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));
const time = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

export default async function ActivityPage({ searchParams }: { searchParams: Params }) {
  const me = await requireStaff('/admin/activity');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'audit.read', property.id)) redirect('/admin');
  const q = await searchParams;
  const before = typeof q.before === 'string' && /^\d{1,19}$/.test(q.before) ? q.before : '';
  const qs = new URLSearchParams({ limit: '100', ...(before ? { before } : {}) });
  // Owners also see company-wide entries (staff accounts, sign-ins); others see this lodge only.
  const isOwner = me.grants.some((g) => g.role === 'OWNER' && g.propertyId === null);
  const r = await serverApi<Entry[]>(
    isOwner ? `/admin/audit?${qs}` : `/admin/properties/${property.id}/audit?${qs}`,
    { auth: true },
  );
  const rows = r.data ?? [];
  const next = (r.meta as { nextBefore?: string | null } | undefined)?.nextBefore ?? null;

  // Group by day for scanning.
  const groups: { day: string; items: Entry[] }[] = [];
  for (const e of rows) {
    const d = day(e.occurredAt);
    const g = groups.at(-1);
    if (g && g.day === d) g.items.push(e);
    else groups.push({ day: d, items: [e] });
  }

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property.name}</p>
        <h1 className="adm-head__title">Activity</h1>
        <p className="adm-head__lede">
          Everything staff and the system did, newest first. It can&apos;t be edited or deleted.
        </p>
      </header>

      {groups.length ? (
        groups.map((g) => (
          <section key={g.day} className="adm-day" aria-label={g.day}>
            <h2 className="adm-day__title">{g.day}</h2>
            <ol className="adm-log">
              {g.items.map((e) => (
                <li key={e.id}>
                  <span className="adm-log__time">{time(e.occurredAt)}</span>
                  <span
                    className="adm-log__dot"
                    data-tone={actionTone(e.action)}
                    aria-hidden="true"
                  />
                  <span className="adm-log__text">
                    <strong>
                      {e.actor?.displayName ??
                        (e.actorType === 'SYSTEM'
                          ? 'System'
                          : e.actorType === 'PROVIDER'
                            ? 'Paystack'
                            : 'Someone')}
                    </strong>{' '}
                    {actionLabel(e.action)}
                    {e.reason ? <span className="adm-log__why">“{e.reason}”</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))
      ) : (
        <p className="adm-empty">Nothing recorded yet.</p>
      )}

      {next ? (
        <p className="adm-more">
          <Link href={`/admin/activity?before=${next}`} className="adm-btn adm-btn--quiet">
            Older activity
          </Link>
        </p>
      ) : null}
    </>
  );
}
