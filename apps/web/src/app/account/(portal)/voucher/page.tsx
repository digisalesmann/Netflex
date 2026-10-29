import Link from 'next/link';
import { Status } from '@/components/ui';
import { STATE_LABEL, requireTenant, type Access } from '@/lib/account';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Vouchers' };

export default async function Vouchers() {
  await requireTenant('/account/voucher');
  const access = (await serverApi<Access[]>('/me/access', { auth: true })).data ?? [];
  return (
    <>
      <h1>Vouchers</h1>
      <p className="muted">
        Your voucher codes connect devices on the Wi-Fi sign-in page. Codes are only shown once, so
        we can&apos;t display them here again.
      </p>
      <ul className="rows">
        {access.map((a) => (
          <li key={a.entitlementId} className="row-head">
            <span>
              {a.planName} · code ending{' '}
              <span style={{ fontFamily: 'var(--nf-font-mono)' }}>…{a.voucherHint ?? '????'}</span>
            </span>
            <Status tone={STATE_LABEL[a.state]?.tone ?? 'info'}>
              {STATE_LABEL[a.state]?.label ?? a.state}
            </Status>
          </li>
        ))}
      </ul>
      <h2 className="h3" style={{ marginTop: 'var(--nf-space-6)' }}>
        Recovering a code
      </h2>
      <ul className="rows">
        <li>
          <strong>Bought it but never used it?</strong> Open the order under{' '}
          <Link href="/account/orders">Orders</Link>. The payment page can show the code until you
          first use it.
        </li>
        <li>
          <strong>Lost it after using it?</strong> Your devices stay connected. To add a new device,
          ask <Link href="/account/support">support</Link> to reissue the code. The old one stops
          working.
        </li>
        <li>
          <strong>Think someone else has it?</strong> Ask support to reissue it straight away.
        </li>
      </ul>
    </>
  );
}
