import Link from 'next/link';
import { Notice, Status } from '@/components/ui';
import { requireTenant } from '@/lib/account';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Orders and receipts' };

interface OrderRow {
  orderId: string;
  reference: string;
  planName: string;
  status: string;
  paymentStatus: string | null;
  amount: { display: string };
  createdAt: string;
  renewal: boolean;
}

const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info'> = {
  PAID: 'ok',
  REFUNDED: 'warn',
  AWAITING_PAYMENT: 'info',
  CREATED: 'info',
  EXPIRED: 'bad',
  FAILED: 'bad',
  CANCELLED: 'bad',
};
const LABEL: Record<string, string> = {
  PAID: 'Paid',
  REFUNDED: 'Refunded',
  AWAITING_PAYMENT: 'Payment pending',
  CREATED: 'Not paid',
  EXPIRED: 'Expired unpaid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export default async function Orders() {
  await requireTenant('/account/orders');
  const rows = (await serverApi<OrderRow[]>('/me/orders', { auth: true })).data ?? [];
  return (
    <>
      <h1>Orders and receipts</h1>
      {rows.length === 0 ? (
        <Notice>No orders yet.</Notice>
      ) : (
        <ul className="rows">
          {rows.map((o) => (
            <li key={o.orderId}>
              <div className="row-head">
                <strong>
                  {o.planName}
                  {o.renewal ? ' (renewal)' : ''}
                </strong>
                <span>{o.amount.display}</span>
              </div>
              <div className="row-head small">
                <span className="muted">
                  {o.reference} ·{' '}
                  {new Date(o.createdAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
                </span>
                <Status tone={TONE[o.status] ?? 'info'}>{LABEL[o.status] ?? o.status}</Status>
              </div>
              <p className="small" style={{ margin: 'var(--nf-space-2) 0 0' }}>
                {o.status === 'PAID' || o.status === 'REFUNDED' ? (
                  <Link href={`/account/orders/${o.orderId}`}>Receipt</Link>
                ) : null}
                {o.status === 'AWAITING_PAYMENT' ? (
                  <Link href={`/checkout/return?order=${o.orderId}`}>Check payment</Link>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
