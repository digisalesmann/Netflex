import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActivityFilters } from '@/components/admin/ActivityFilters';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import {
  CATEGORIES,
  TARGET_LABEL,
  actionLabel,
  actionTone,
  categoryOf,
  targetHref,
  type CategoryId,
} from '@/lib/admin-activity';
import { initials, staffList } from '@/lib/admin-staff';
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
  targetId: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  requestId: string | null;
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

/** Recorded details as short "key: value" lines (nested values kept compact). */
function details(m: Record<string, unknown> | null): [string, string][] {
  if (!m) return [];
  const label = (k: string) =>
    k
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
  return Object.entries(m)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 12)
    .map(([k, v]) => [
      label(k),
      typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : String(v).slice(0, 160),
    ]);
}

export default async function ActivityPage({ searchParams }: { searchParams: Params }) {
  const me = await requireStaff('/admin/activity');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'audit.read', property.id)) redirect('/admin');
  const q = await searchParams;
  const before = typeof q.before === 'string' && /^\d{1,19}$/.test(q.before) ? q.before : '';
  const cat = (
    typeof q.cat === 'string' && CATEGORIES.some((c) => c.id === q.cat) ? q.cat : ''
  ) as CategoryId;
  const who = typeof q.who === 'string' ? q.who.slice(0, 40) : '';

  // Owners also see company-wide entries (staff accounts, sign-ins); others see this lodge only.
  const isOwner = me.grants.some((g) => g.role === 'OWNER' && g.propertyId === null);
  const qs = new URLSearchParams({ limit: '200', ...(before ? { before } : {}) });
  const [r, staff] = await Promise.all([
    serverApi<Entry[]>(
      isOwner ? `/admin/audit?${qs}` : `/admin/properties/${property.id}/audit?${qs}`,
      { auth: true },
    ),
    allowed(me, 'staff.read', property.id) ? staffList() : Promise.resolve([]),
  ]);
  const all = r.data ?? [];
  const next = (r.meta as { nextBefore?: string | null } | undefined)?.nextBefore ?? null;
  const staffIds = new Set(staff.map((s) => s.id));

  const actorName = (e: Entry) =>
    e.actor?.displayName ??
    (e.actorType === 'SYSTEM' ? 'System' : e.actorType === 'PROVIDER' ? 'Paystack' : 'Someone');
  const actorKey = (e: Entry) => e.actor?.id ?? e.actorType;

  // People who appear in this page of the log, for the person filter.
  const people = [...new Map(all.map((e) => [actorKey(e), actorName(e)])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const rows = all.filter(
    (e) => (!cat || categoryOf(e.action) === cat) && (!who || actorKey(e) === who),
  );
  const groups: { day: string; items: Entry[] }[] = [];
  for (const e of rows) {
    const d = day(e.occurredAt);
    const g = groups.at(-1);
    if (g && g.day === d) g.items.push(e);
    else groups.push({ day: d, items: [e] });
  }
  const filtered = Boolean(cat || who);

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property.name}</p>
        <h1 className="adm-head__title">Activity</h1>
        <p className="adm-head__lede">
          Everything staff, residents and the system did, newest first. Entries can&apos;t be edited
          or deleted.
        </p>
      </header>

      <ActivityFilters categories={[...CATEGORIES]} cat={cat} who={who} people={people} />

      {groups.length ? (
        groups.map((g) => (
          <section key={g.day} className="adm-day" aria-label={g.day}>
            <h2 className="adm-day__title">
              {g.day} <span>{g.items.length}</span>
            </h2>
            <ol className="adm-feed">
              {g.items.map((e) => {
                const href = targetHref(e.targetType, e.targetId, staffIds);
                const d = details(e.metadata);
                const name = actorName(e);
                return (
                  <li key={e.id} className="adm-feed__item">
                    <span
                      className="adm-feed__avatar"
                      data-kind={e.actor ? 'person' : 'system'}
                      aria-hidden="true"
                    >
                      {e.actor ? (
                        initials(name)
                      ) : (
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
                        </svg>
                      )}
                    </span>
                    <details className="adm-feed__body">
                      <summary>
                        <span className="adm-feed__line">
                          <span
                            className="adm-log__dot"
                            data-tone={actionTone(e.action)}
                            aria-hidden="true"
                          />
                          <span>
                            <strong>{name}</strong> {actionLabel(e.action)}
                          </span>
                        </span>
                        <time className="adm-feed__time" dateTime={e.occurredAt}>
                          {time(e.occurredAt)}
                        </time>
                        {e.reason ? <span className="adm-feed__why">“{e.reason}”</span> : null}
                      </summary>
                      <div className="adm-feed__more">
                        {href && e.targetType ? (
                          <Link href={href} className="adm-link">
                            {TARGET_LABEL[e.targetType] ?? 'Open'}
                          </Link>
                        ) : null}
                        {d.length ? (
                          <dl className="adm-feed__facts">
                            {d.map(([k, v]) => (
                              <div key={k}>
                                <dt>{k}</dt>
                                <dd>{v}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                        <p className="adm-feed__ref">
                          {e.action}
                          {e.requestId ? ` · ref ${e.requestId.slice(0, 8)}` : ''}
                        </p>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      ) : (
        <p className="adm-empty">
          {filtered
            ? 'Nothing matches these filters on this page of the log.'
            : 'Nothing recorded yet.'}
        </p>
      )}

      {next ? (
        <p className="adm-more">
          <Link
            href={`/admin/activity?${new URLSearchParams({
              before: next,
              ...(cat ? { cat } : {}),
              ...(who ? { who } : {}),
            })}`}
            className="adm-btn adm-btn--quiet"
          >
            Older activity
          </Link>
        </p>
      ) : null}
    </>
  );
}
