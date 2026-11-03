import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PaymentsNav } from '@/components/admin/PaymentsNav';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { PAY_STATUS, when } from '@/lib/admin-payments';
import { money } from '@/lib/plans';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Payments' };

type Params = Promise<Record<string, string | string[] | undefined>>;

interface PaymentRow {
  id: string;
  provider: 'PAYSTACK' | 'FAKE';
  providerReference: string;
  status: string;
  amountMinor: string;
  refundedMinor: string;
  currency: string;
  createdAt: string;
  order: {
    reference: string;
    customerPhone: string | null;
    planVersion: { name: string };
    customer: { displayName: string; email: string | null } | null;
  };
  _count: { refunds: number };
}

const TABS = [
  { id: '', label: 'All' },
  { id: 'SUCCEEDED', label: 'Paid' },
  { id: 'PENDING', label: 'Waiting' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'REFUNDED', label: 'Refunded' },
];

export default async function PaymentsPage({ searchParams }: { searchParams: Params }) {
  const me = await requireStaff('/admin/payments');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'payment.read', property.id)) redirect('/admin');
  const sp = await searchParams;
  const status = typeof sp.status === 'string' && PAY_STATUS[sp.status] ? sp.status : '';
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 60) : '';

  const qs = new URLSearchParams({ limit: '100' });
  if (status) qs.set('status', status);
  if (q.length >= 3) qs.set('q', q);
  const canReconcile = allowed(me, 'payment.reconcile', property.id);
  const [rows, waiting, mismatches] = await Promise.all([
    serverApi<PaymentRow[]>(`/admin/properties/${property.id}/payments?${qs}`, { auth: true }),
    adminApi<unknown[]>(property.id, '/refunds?status=REQUESTED'),
    canReconcile ? adminApi<unknown[]>(property.id, '/discrepancies') : Promise.resolve(null),
  ]);
  const list = rows.data ?? [];

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property.name}</p>
        <h1 className="adm-head__title">Payments</h1>
        <p className="adm-head__lede">
          Every Paystack payment, newest first. Card and bank details never reach us.
        </p>
      </header>
      <PaymentsNav
        at="all"
        waiting={waiting.data?.length ?? 0}
        mismatches={mismatches ? (mismatches.data?.length ?? 0) : null}
      />

      <div className="adm-toolbar">
        <form className="adm-search" role="search" action="/admin/payments">
          <label className="adm-sr" htmlFor="q">
            Find a payment by reference
          </label>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
          </svg>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Order NFX-… or Paystack reference"
            autoComplete="off"
          />
          {status ? <input type="hidden" name="status" value={status} /> : null}
        </form>
        <nav className="adm-tabs adm-tabs--scroll" aria-label="Filter payments">
          {TABS.map((t) => (
            <Link
              key={t.id || 'all'}
              href={`/admin/payments?${new URLSearchParams({
                ...(t.id ? { status: t.id } : {}),
                ...(q ? { q } : {}),
              })}`}
              aria-current={status === t.id ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {list.length ? (
        <ul className="adm-pays">
          {list.map((p) => {
            const st = PAY_STATUS[p.status] ?? { label: p.status, tone: 'muted' };
            const who =
              p.order.customer?.displayName && p.order.customer.displayName !== 'Guest'
                ? p.order.customer.displayName
                : (p.order.customer?.email ?? p.order.customerPhone ?? 'Guest');
            return (
              <li key={p.id}>
                <Link href={`/admin/payments/${p.id}`} className="adm-pay">
                  <span className="adm-pay__main">
                    <strong className="adm-mono">{p.order.reference}</strong>
                    <span>
                      {p.order.planVersion.name} · {who}
                    </span>
                    <span>
                      {when(p.createdAt)}
                      {p.provider === 'FAKE' ? ' · test payment' : ''}
                    </span>
                  </span>
                  <span className="adm-pay__side">
                    <strong>{money(BigInt(p.amountMinor), p.currency)}</strong>
                    <span className="adm-tag" data-tone={st.tone}>
                      {st.label}
                    </span>
                    {p._count.refunds ? (
                      <span className="adm-tag" data-tone="warn">
                        Refund waiting
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="adm-empty">
          {q
            ? `No payment matches “${q}”.`
            : status
              ? 'No payments here.'
              : 'No payments yet. They appear here as soon as someone checks out.'}
        </p>
      )}
    </>
  );
}
