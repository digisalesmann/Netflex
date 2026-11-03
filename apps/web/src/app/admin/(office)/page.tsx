import Link from 'next/link';
import { adminApi, currentProperty, requireStaff } from '@/lib/admin';
import { money } from '@/lib/plans';

export const metadata = { title: 'Overview' };

interface Overview {
  rooms: { total: number; occupied: number };
  residents: number | null;
  access: { active: number; expiringSoon: number; unused: number } | null;
  sales: {
    today: { amountMinor: string; count: number };
    week: { amountMinor: string; count: number };
    recent: {
      id: string;
      status: string;
      amountMinor: string;
      currency: string;
      createdAt: string;
      order: { reference: string };
    }[];
  } | null;
  attention: {
    refundsToApprove: number | null;
    discrepancies: number | null;
    networkFailures: number | null;
    gatewaysDown: number | null;
    provisioningFailed: number | null;
  };
}

const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  SUCCEEDED: { label: 'Paid', tone: 'ok' },
  PARTIALLY_REFUNDED: { label: 'Part refunded', tone: 'warn' },
  REFUNDED: { label: 'Refunded', tone: 'muted' },
  PENDING: { label: 'Pending', tone: 'info' },
  CREATED: { label: 'Started', tone: 'muted' },
  FAILED: { label: 'Failed', tone: 'bad' },
  ABANDONED: { label: 'Abandoned', tone: 'muted' },
  EXPIRED: { label: 'Expired', tone: 'muted' },
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

function greeting(): string {
  const h = Number(
    new Intl.DateTimeFormat('en-NG', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' })
      .format(new Date())
      .replace(/\D/g, ''),
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default async function OverviewPage() {
  const me = await requireStaff('/admin');
  const { property } = await currentProperty();
  if (!property)
    return (
      <header className="adm-head">
        <h1 className="adm-head__title">No property yet</h1>
        <p className="adm-head__lede">
          Your account isn&apos;t linked to a property. Ask the platform owner to grant you a role.
        </p>
      </header>
    );

  const o = (await adminApi<Overview>(property.id, '/overview')).data;
  const cur = property.currency;
  const first = me.user.displayName.split(/\s+/)[0];

  const attention = o
    ? [
        o.attention.refundsToApprove
          ? {
              n: o.attention.refundsToApprove,
              text: 'refund requests waiting for approval',
              href: '/admin/payments/refunds',
            }
          : null,
        o.attention.discrepancies
          ? {
              n: o.attention.discrepancies,
              text: 'payment mismatches to resolve',
              href: '/admin/payments/mismatches',
            }
          : null,
        o.attention.provisioningFailed
          ? { n: o.attention.provisioningFailed, text: 'plans that couldn’t be switched on' }
          : null,
        o.attention.networkFailures
          ? { n: o.attention.networkFailures, text: 'network jobs that failed' }
          : null,
        o.attention.gatewaysDown ? { n: o.attention.gatewaysDown, text: 'gateways offline' } : null,
        o.access?.expiringSoon
          ? { n: o.access.expiringSoon, text: 'plans ending in the next 2 days' }
          : null,
      ].filter((x): x is { n: number; text: string; href?: string } => x !== null)
    : [];

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property.name}</p>
        <h1 className="adm-head__title">
          {greeting()}, {first}
        </h1>
        <p className="adm-head__lede">
          {new Intl.DateTimeFormat('en-NG', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'Africa/Lagos',
          }).format(new Date())}
        </p>
      </header>

      {!o ? (
        <p className="adm-empty">The overview couldn&apos;t load. Refresh to try again.</p>
      ) : (
        <>
          <dl className="adm-stats">
            {o.access ? (
              <div>
                <dt>Online now</dt>
                <dd className="adm-stats__num">{o.access.active}</dd>
                <dd className="adm-stats__sub">
                  {o.access.unused} unused {o.access.unused === 1 ? 'code' : 'codes'}
                </dd>
              </div>
            ) : null}
            {o.sales ? (
              <>
                <div>
                  <dt>Sales today</dt>
                  <dd className="adm-stats__num">
                    {money(BigInt(o.sales.today.amountMinor), cur)}
                  </dd>
                  <dd className="adm-stats__sub">
                    {o.sales.today.count} {o.sales.today.count === 1 ? 'payment' : 'payments'}
                  </dd>
                </div>
                <div>
                  <dt>Last 7 days</dt>
                  <dd className="adm-stats__num">{money(BigInt(o.sales.week.amountMinor), cur)}</dd>
                  <dd className="adm-stats__sub">
                    {o.sales.week.count} {o.sales.week.count === 1 ? 'payment' : 'payments'}
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Rooms occupied</dt>
              <dd className="adm-stats__num">
                {o.rooms.occupied}
                <small> / {o.rooms.total}</small>
              </dd>
              {o.residents !== null ? (
                <dd className="adm-stats__sub">
                  {o.residents} {o.residents === 1 ? 'resident' : 'residents'}
                </dd>
              ) : null}
            </div>
          </dl>

          <div className="adm-grid">
            <section aria-labelledby="att-title">
              <h2 id="att-title" className="adm-h2">
                Needs attention
              </h2>
              {attention.length ? (
                <ul className="adm-att">
                  {attention.map((a) => (
                    <li key={a.text}>
                      {a.href ? (
                        <Link href={a.href}>
                          <strong>{a.n}</strong> {a.text}
                        </Link>
                      ) : (
                        <>
                          <strong>{a.n}</strong> {a.text}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="adm-clear">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M5 12.5 10 17.5 19 7" />
                  </svg>
                  All clear. Nothing needs you right now.
                </p>
              )}
            </section>

            {o.sales ? (
              <section aria-labelledby="pay-title">
                <h2 id="pay-title" className="adm-h2">
                  Latest payments
                </h2>
                {o.sales.recent.length ? (
                  <ul className="adm-list">
                    {o.sales.recent.map((p) => {
                      const st = PAY_STATUS[p.status] ?? { label: p.status, tone: 'muted' };
                      return (
                        <li key={p.id}>
                          <span className="adm-list__main">
                            <strong>{p.order.reference}</strong>
                            <span>{when(p.createdAt)}</span>
                          </span>
                          <span className="adm-list__side">
                            <strong>{money(BigInt(p.amountMinor), p.currency)}</strong>
                            <span className="adm-tag" data-tone={st.tone}>
                              {st.label}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="adm-empty">No payments yet.</p>
                )}
              </section>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
