import Link from 'next/link';
import { requireTenant } from '@/lib/account';
import { money } from '@/lib/plans';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Orders and receipts' };

interface OrderRow {
  orderId: string;
  reference: string;
  planName: string;
  status: string;
  paymentStatus: string | null;
  amount: { amountMinor: string; currency: string; display: string };
  createdAt: string;
  paidAt: string | null;
  renewal: boolean;
}

const STATUS: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'info'; label: string }> = {
  PAID: { tone: 'ok', label: 'Paid' },
  REFUNDED: { tone: 'warn', label: 'Refunded' },
  AWAITING_PAYMENT: { tone: 'info', label: 'Payment pending' },
  CREATED: { tone: 'info', label: 'Not paid' },
  EXPIRED: { tone: 'bad', label: 'Expired unpaid' },
  FAILED: { tone: 'bad', label: 'Failed' },
  CANCELLED: { tone: 'bad', label: 'Cancelled' },
};

const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'paid', label: 'Paid', match: (s: string) => s === 'PAID' },
  {
    id: 'pending',
    label: 'Pending',
    match: (s: string) => s === 'AWAITING_PAYMENT' || s === 'CREATED',
  },
  {
    id: 'other',
    label: 'Other',
    match: (s: string) => !['PAID', 'AWAITING_PAYMENT', 'CREATED'].includes(s),
  },
] as const;

type Params = Promise<Record<string, string | string[] | undefined>>;

const dateFmt = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(
    new Date(iso),
  );
const monthFmt = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
const ORDER_ICON =
  'M5 8h14l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3zM8.5 8V6.5a3.5 3.5 0 0 1 7 0V8M9.5 11.5a2.5 2.5 0 0 0 5 0';

export default async function Orders({ searchParams }: { searchParams: Params }) {
  await requireTenant('/account/orders');
  const q = await searchParams;
  const rows = (await serverApi<OrderRow[]>('/me/orders', { auth: true })).data ?? [];
  const filterId = typeof q.show === 'string' ? q.show : 'all';
  const filter = FILTERS.find((f) => f.id === filterId) ?? FILTERS[0];
  const shown = rows.filter((o) => filter.match(o.status));

  const paid = rows.filter((o) => o.status === 'PAID');
  const currency = rows[0]?.amount.currency ?? 'NGN';
  const spent = paid.reduce((a, o) => a + BigInt(o.amount.amountMinor), 0n);
  const last = paid
    .map((o) => o.paidAt ?? o.createdAt)
    .sort()
    .at(-1);

  // group by month, newest first (the API already returns newest first)
  const groups: { month: string; items: OrderRow[] }[] = [];
  for (const o of shown) {
    const m = monthFmt(o.createdAt);
    const g = groups.at(-1);
    if (g && g.month === m) g.items.push(o);
    else groups.push({ month: m, items: [o] });
  }

  return (
    <>
      <header className="acct-page-head">
        <h1 className="acct-hello__title">Orders and receipts</h1>
        <p className="acct-hello__where">Every purchase, with a receipt you can open or print.</p>
      </header>

      <dl className="ord-stats">
        <div>
          <dt>Total spent</dt>
          <dd>{money(spent, currency)}</dd>
        </div>
        <div>
          <dt>Orders</dt>
          <dd>{rows.length}</dd>
        </div>
        <div>
          <dt>Last purchase</dt>
          <dd>{last ? dateFmt(last) : '—'}</dd>
        </div>
      </dl>

      {rows.length ? (
        <nav className="chips ord-filter" aria-label="Filter orders">
          {FILTERS.map((f) => {
            const n = rows.filter((o) => f.match(o.status)).length;
            return (
              <Link
                key={f.id}
                href={f.id === 'all' ? '/account/orders' : `/account/orders?show=${f.id}`}
                className="chip"
                aria-current={f.id === filter.id ? 'page' : undefined}
              >
                {f.label}
                <span className="ord-filter__n">{n}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {rows.length === 0 ? (
        <div className="acct-empty">
          <p className="acct-empty__title">No orders yet.</p>
          <p className="acct-empty__body">When you buy a plan, its receipt appears here.</p>
          <div className="acct-plan__actions">
            <Link href="/account/plans" className="acct-btn acct-btn--solid">
              Choose a plan
            </Link>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <p className="ord-none">No {filter.label.toLowerCase()} orders.</p>
      ) : (
        groups.map((g) => (
          <section key={g.month} className="ord-group" aria-label={g.month}>
            <h2 className="acct-label">{g.month}</h2>
            <ul className="ord-list">
              {g.items.map((o) => {
                const s = STATUS[o.status] ?? { tone: 'info' as const, label: o.status };
                return (
                  <li key={o.orderId} className="ord">
                    <span className="ord__icon">
                      <Icon d={ORDER_ICON} />
                    </span>
                    <div className="ord__main">
                      <p className="ord__name">
                        {o.planName}
                        {o.renewal ? <span className="ord__tag">Renewal</span> : null}
                      </p>
                      <p className="ord__meta">
                        <span className="ord__ref">{o.reference}</span> · {dateFmt(o.createdAt)}
                      </p>
                    </div>
                    <p className={`ord__status ord__status--${s.tone}`}>
                      <span aria-hidden="true" />
                      {s.label}
                    </p>
                    <p className="ord__amt">{o.amount.display}</p>
                    <p className="ord__act">
                      {o.status === 'PAID' || o.status === 'REFUNDED' ? (
                        <Link href={`/account/orders/${o.orderId}`} className="ord__link">
                          Receipt
                          <span className="visually-hidden"> for {o.reference}</span>
                          <Icon d="M5 12h13M13 6.5 18.5 12 13 17.5" />
                        </Link>
                      ) : o.status === 'AWAITING_PAYMENT' ? (
                        <Link href={`/checkout/return?order=${o.orderId}`} className="ord__link">
                          Check payment
                          <Icon d="M5 12h13M13 6.5 18.5 12 13 17.5" />
                        </Link>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
