import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/account/PrintButton';
import { Logo } from '@/components/Logo';
import { requireTenant } from '@/lib/account';
import { duration, scopeLabel } from '@/lib/format';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Receipt' };

interface Receipt {
  receiptFor: string;
  issuedBy: string;
  paidAt: string | null;
  item: {
    plan: string | null;
    duration: { value: number; unit: string } | null;
    scope: string | null;
    maxDevices: number | null;
  };
  amount: { display: string };
  payment: { provider: string; reference: string; status: string } | null;
  refunded: { display: string } | null;
  status: string;
  support: { phone: string | null; email: string | null };
  note: string;
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTenant(`/account/orders/${id}`);
  const r = (await serverApi<Receipt>(`/me/orders/${id}/receipt`, { auth: true })).data;
  if (!r) notFound();
  const stamp = r.refunded ? 'Refunded' : r.status === 'PAID' ? 'Paid' : null;
  const scope = r.item.scope ? scopeLabel[r.item.scope as keyof typeof scopeLabel] : null;
  return (
    <div className="rcpt-page">
      <div className="rcpt-page__bar no-print">
        <Link href="/account/orders" className="co-back">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M19 12H6M11 6.5 5.5 12 11 17.5" />
          </svg>
          Orders
        </Link>
        <PrintButton />
      </div>

      <article className="receipt rcpt" aria-labelledby="rcpt-title">
        <div className="receipt__paper">
          <div className="receipt__head">
            <Logo decorative />
            <p className="receipt__venue">{r.issuedBy}</p>
            <h1 id="rcpt-title" className="receipt__title">
              Receipt
            </h1>
            <p className="receipt__date">{r.paidAt ?? '—'}</p>
          </div>
          {stamp ? (
            <p className="rcpt__stamp" data-tone={r.refunded ? 'warn' : 'ok'}>
              {stamp}
            </p>
          ) : null}
          <hr className="receipt__tear" />
          <div className="receipt__item">
            <div>
              <p className="receipt__name">{r.item.plan}</p>
              <p className="receipt__meta">
                {[scope, r.item.duration ? duration(r.item.duration) : null]
                  .filter(Boolean)
                  .join(' · ')}
                {r.item.maxDevices ? ` · up to ${r.item.maxDevices} devices` : ''}
              </p>
            </div>
          </div>
          <dl className="receipt__lines">
            <div>
              <dt>Order</dt>
              <dd>{r.receiptFor}</dd>
            </div>
            {r.payment ? (
              <div>
                <dt>Paid via</dt>
                <dd>{r.payment.provider}</dd>
              </div>
            ) : null}
            {r.payment ? (
              <div>
                <dt>Payment ref</dt>
                <dd className="rcpt__ref">{r.payment.reference}</dd>
              </div>
            ) : null}
            {r.refunded ? (
              <div>
                <dt>Refunded</dt>
                <dd>{r.refunded.display}</dd>
              </div>
            ) : null}
          </dl>
          <hr className="receipt__tear" />
          <dl className="receipt__lines receipt__lines--total">
            <div>
              <dt>Total</dt>
              <dd>{r.amount.display}</dd>
            </div>
          </dl>
          <hr className="receipt__tear" />
          <p className="rcpt__note">{r.note}</p>
          <p className="rcpt__help">
            Questions:{' '}
            {[r.support.phone, r.support.email].filter(Boolean).join(' · ') ||
              'the property office'}
          </p>
          <div className="receipt__barcode" aria-hidden="true" />
          <p className="receipt__thanks">Thank you</p>
        </div>
      </article>
    </div>
  );
}
