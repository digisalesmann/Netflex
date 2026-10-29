import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/account/PrintButton';
import { requireTenant } from '@/lib/account';
import { duration } from '@/lib/format';
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
  return (
    <article>
      <p className="no-print">
        <Link href="/account/orders">← Orders</Link>
      </p>
      <h1>Receipt</h1>
      <p className="muted">{r.note}</p>
      <dl className="facts">
        <dt>Order</dt>
        <dd>{r.receiptFor}</dd>
        <dt>Issued by</dt>
        <dd>{r.issuedBy}</dd>
        <dt>Paid</dt>
        <dd>{r.paidAt ?? '—'}</dd>
        <dt>Plan</dt>
        <dd>
          {r.item.plan}
          {r.item.duration ? `, ${duration(r.item.duration)}` : ''}
          {r.item.maxDevices ? `, up to ${r.item.maxDevices} devices` : ''}
        </dd>
        <dt>Amount</dt>
        <dd>{r.amount.display}</dd>
        {r.payment ? (
          <>
            <dt>Paid via</dt>
            <dd>
              {r.payment.provider} · ref {r.payment.reference}
            </dd>
          </>
        ) : null}
        {r.refunded ? (
          <>
            <dt>Refunded</dt>
            <dd>{r.refunded.display}</dd>
          </>
        ) : null}
        <dt>Questions</dt>
        <dd>
          {[r.support.phone, r.support.email].filter(Boolean).join(' · ') || 'Property office'}
        </dd>
      </dl>
      <PrintButton />
    </article>
  );
}
