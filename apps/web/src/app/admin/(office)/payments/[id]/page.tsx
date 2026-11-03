import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  DecideRefund,
  RequestRefund,
  ResolveMismatch,
  VerifyPayment,
} from '@/components/admin/PaymentActions';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { MISMATCH, PAY_STATUS, REFUND_STATUS, major, when } from '@/lib/admin-payments';
import { money } from '@/lib/plans';

export const metadata = { title: 'Payment' };

interface Payment {
  id: string;
  provider: 'PAYSTACK' | 'FAKE';
  providerReference: string;
  providerTransactionId: string | null;
  status: string;
  amountMinor: string;
  refundedMinor: string;
  currency: string;
  createdAt: string;
  verifiedAt: string | null;
  failureCode: string | null;
  order: {
    id: string;
    reference: string;
    status: string;
    paidAt: string | null;
    customerPhone: string | null;
    planVersion: { name: string };
    customer: { displayName: string; email: string | null } | null;
  };
  refunds: {
    id: string;
    amountMinor: string;
    status: string;
    reason: string;
    createdAt: string;
    completedAt: string | null;
    requestedBy: { id: string; displayName: string };
    approvedBy: { id: string; displayName: string } | null;
  }[];
  discrepancies: {
    id: string;
    kind: string;
    detectedAt: string;
    resolvedAt: string | null;
    resolution: string | null;
  }[];
  webhookEvents: {
    id: string;
    eventType: string;
    receivedAt: string;
    processingError: string | null;
  }[];
}

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireStaff(`/admin/payments/${id}`);
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'payment.read', property.id)) redirect('/admin');
  const p = (await adminApi<Payment>(property.id, `/payments/${id}`)).data;
  if (!p) notFound();

  const st = PAY_STATUS[p.status] ?? { label: p.status, tone: 'muted' };
  const amount = (m: string) => money(BigInt(m), p.currency);
  const inFlight = p.refunds
    .filter((r) => ['REQUESTED', 'APPROVED', 'SUBMITTED'].includes(r.status))
    .reduce((n, r) => n + BigInt(r.amountMinor), 0n);
  const refundable = BigInt(p.amountMinor) - BigInt(p.refundedMinor) - inFlight;
  const canRefund =
    allowed(me, 'payment.refund.request', property.id) &&
    ['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(p.status) &&
    refundable > 0n;
  const canApprove = allowed(me, 'payment.refund.approve', property.id);
  const canReconcile = allowed(me, 'payment.reconcile', property.id);
  const buyer = p.order.customer
    ? [p.order.customer.displayName, p.order.customer.email].filter(Boolean).join(' · ')
    : (p.order.customerPhone ?? 'Guest');

  return (
    <>
      <Link href="/admin/payments" className="adm-back">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19 12H6M11 6.5 5.5 12 11 17.5" />
        </svg>
        Payments
      </Link>
      <header className="adm-head adm-head--row">
        <div>
          <p className="adm-head__eyebrow">
            <span className="adm-tag" data-tone={st.tone}>
              {st.label}
            </span>
          </p>
          <h1 className="adm-head__title">{amount(p.amountMinor)}</h1>
          <p className="adm-head__lede">
            {p.order.planVersion.name} · {buyer}
          </p>
        </div>
        <div className="adm-actions">
          {canReconcile ? <VerifyPayment propertyId={property.id} paymentId={p.id} /> : null}
          {canRefund ? (
            <RequestRefund
              propertyId={property.id}
              paymentId={p.id}
              maxMajor={major(refundable)}
              display={amount(refundable.toString())}
            />
          ) : null}
        </div>
      </header>

      <div className="adm-grid">
        <section aria-labelledby="sum-title">
          <h2 id="sum-title" className="adm-h2">
            Receipt
          </h2>
          <div className="receipt adm-receipt">
            <div className="receipt__paper">
              <div className="receipt__item">
                <div>
                  <p className="receipt__name">{p.order.planVersion.name}</p>
                  <p className="receipt__meta">{buyer}</p>
                </div>
                <p className="receipt__amt">{amount(p.amountMinor)}</p>
              </div>
              <hr className="receipt__tear" />
              <dl className="receipt__lines">
                <div>
                  <dt>Order</dt>
                  <dd>{p.order.reference}</dd>
                </div>
                <div>
                  <dt>{p.provider === 'FAKE' ? 'Test ref' : 'Paystack'}</dt>
                  <dd>{p.providerReference}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{when(p.createdAt)}</dd>
                </div>
                {p.verifiedAt ? (
                  <div>
                    <dt>Confirmed</dt>
                    <dd>{when(p.verifiedAt)}</dd>
                  </div>
                ) : null}
                {p.failureCode ? (
                  <div>
                    <dt>Reason</dt>
                    <dd>{p.failureCode}</dd>
                  </div>
                ) : null}
              </dl>
              <hr className="receipt__tear" />
              <dl className="receipt__lines receipt__lines--total">
                {BigInt(p.refundedMinor) > 0n ? (
                  <div>
                    <dt>Refunded</dt>
                    <dd>−{amount(p.refundedMinor)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Kept</dt>
                  <dd>
                    {['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)
                      ? amount((BigInt(p.amountMinor) - BigInt(p.refundedMinor)).toString())
                      : amount('0')}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <div>
          <section aria-labelledby="ref-title">
            <h2 id="ref-title" className="adm-h2">
              Refunds
            </h2>
            {p.refunds.length ? (
              <ul className="adm-refunds">
                {p.refunds.map((r) => {
                  const rs = REFUND_STATUS[r.status] ?? { label: r.status, tone: 'muted' };
                  return (
                    <li key={r.id}>
                      <span className="adm-refund__top">
                        <strong>{amount(r.amountMinor)}</strong>
                        <span className="adm-tag" data-tone={rs.tone}>
                          {rs.label}
                        </span>
                      </span>
                      <span className="adm-refund__why">“{r.reason}”</span>
                      <span className="adm-refund__who">
                        Asked by {r.requestedBy.displayName} · {when(r.createdAt)}
                        {r.approvedBy ? ` · approved by ${r.approvedBy.displayName}` : ''}
                      </span>
                      {r.status === 'REQUESTED' && canApprove ? (
                        <DecideRefund
                          propertyId={property.id}
                          refundId={r.id}
                          amount={amount(r.amountMinor)}
                          mine={r.requestedBy.id === me.user.id}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="adm-empty">No refunds.</p>
            )}
          </section>

          {p.discrepancies.length ? (
            <section aria-labelledby="mm-title" className="adm-section">
              <h2 id="mm-title" className="adm-h2">
                Mismatches
              </h2>
              <ul className="adm-list">
                {p.discrepancies.map((d) => (
                  <li key={d.id}>
                    <span className="adm-list__main">
                      <strong className="adm-plain">{MISMATCH[d.kind] ?? d.kind}</strong>
                      <span>
                        Found {when(d.detectedAt)}
                        {d.resolvedAt ? ` · resolved: ${d.resolution ?? ''}` : ''}
                      </span>
                    </span>
                    {!d.resolvedAt && canReconcile ? (
                      <ResolveMismatch propertyId={property.id} id={d.id} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {p.webhookEvents.length ? (
            <section aria-labelledby="ev-title" className="adm-section">
              <h2 id="ev-title" className="adm-h2">
                Messages from Paystack
              </h2>
              <ol className="adm-timeline">
                {p.webhookEvents.map((e) => (
                  <li key={e.id}>
                    <strong className="adm-mono">{e.eventType}</strong>
                    <span>
                      {when(e.receivedAt)}
                      {e.processingError ? ` · problem: ${e.processingError}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
