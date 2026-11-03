import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DecideRefund } from '@/components/admin/PaymentActions';
import { PaymentsNav } from '@/components/admin/PaymentsNav';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { REFUND_STATUS, when } from '@/lib/admin-payments';
import { money } from '@/lib/plans';

export const metadata = { title: 'Refunds' };

interface RefundRow {
  id: string;
  amountMinor: string;
  currency: string;
  status: string;
  reason: string;
  createdAt: string;
  requestedBy: { id: string; displayName: string };
  approvedBy: { id: string; displayName: string } | null;
  payment: {
    id: string;
    providerReference: string;
    order: { reference: string; planVersion: { name: string } };
  };
}

export default async function RefundsPage() {
  const me = await requireStaff('/admin/payments/refunds');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'payment.read', property.id)) redirect('/admin');
  const canApprove = allowed(me, 'payment.refund.approve', property.id);
  const canReconcile = allowed(me, 'payment.reconcile', property.id);
  const [all, mismatches] = await Promise.all([
    adminApi<RefundRow[]>(property.id, '/refunds'),
    canReconcile ? adminApi<unknown[]>(property.id, '/discrepancies') : Promise.resolve(null),
  ]);
  const rows = all.data ?? [];
  const waiting = rows.filter((r) => r.status === 'REQUESTED');
  const done = rows.filter((r) => r.status !== 'REQUESTED');

  const Row = ({ r }: { r: RefundRow }) => {
    const rs = REFUND_STATUS[r.status] ?? { label: r.status, tone: 'muted' };
    const amount = money(BigInt(r.amountMinor), r.currency);
    return (
      <li>
        <span className="adm-refund__top">
          <strong>{amount}</strong>
          <span className="adm-tag" data-tone={rs.tone}>
            {rs.label}
          </span>
        </span>
        <span className="adm-refund__why">
          <Link href={`/admin/payments/${r.payment.id}`} className="adm-mono">
            {r.payment.order.reference}
          </Link>{' '}
          · {r.payment.order.planVersion.name} · “{r.reason}”
        </span>
        <span className="adm-refund__who">
          Asked by {r.requestedBy.displayName} · {when(r.createdAt)}
          {r.approvedBy ? ` · approved by ${r.approvedBy.displayName}` : ''}
        </span>
        {r.status === 'REQUESTED' && canApprove ? (
          <DecideRefund
            propertyId={property.id}
            refundId={r.id}
            amount={amount}
            mine={r.requestedBy.id === me.user.id}
          />
        ) : null}
      </li>
    );
  };

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property.name}</p>
        <h1 className="adm-head__title">Refunds</h1>
        <p className="adm-head__lede">
          Two people for every refund: one asks, a different one approves. Money goes back through
          Paystack.
        </p>
      </header>
      <PaymentsNav
        at="refunds"
        waiting={waiting.length}
        mismatches={mismatches ? (mismatches.data?.length ?? 0) : null}
      />
      <section aria-labelledby="w-title" className="adm-section">
        <h2 id="w-title" className="adm-h2">
          Waiting for approval
        </h2>
        {waiting.length ? (
          <ul className="adm-refunds">
            {waiting.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <p className="adm-clear">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12.5 10 17.5 19 7" />
            </svg>
            Nothing waiting.
          </p>
        )}
      </section>
      {done.length ? (
        <section aria-labelledby="d-title" className="adm-section">
          <h2 id="d-title" className="adm-h2">
            Earlier
          </h2>
          <ul className="adm-refunds">
            {done.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
