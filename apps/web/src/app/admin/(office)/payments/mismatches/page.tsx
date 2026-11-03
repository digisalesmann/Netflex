import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ResolveMismatch } from '@/components/admin/PaymentActions';
import { PaymentsNav } from '@/components/admin/PaymentsNav';
import { adminApi, allowed, currentProperty, requireStaff } from '@/lib/admin';
import { MISMATCH, when } from '@/lib/admin-payments';

export const metadata = { title: 'Mismatches' };

interface Mismatch {
  id: string;
  kind: string;
  paymentId: string | null;
  detectedAt: string;
}

export default async function MismatchesPage() {
  const me = await requireStaff('/admin/payments/mismatches');
  const { property } = await currentProperty();
  if (!property || !allowed(me, 'payment.reconcile', property.id)) redirect('/admin/payments');
  const [list, waiting] = await Promise.all([
    adminApi<Mismatch[]>(property.id, '/discrepancies'),
    adminApi<unknown[]>(property.id, '/refunds?status=REQUESTED'),
  ]);
  const rows = list.data ?? [];

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property.name}</p>
        <h1 className="adm-head__title">Mismatches</h1>
        <p className="adm-head__lede">
          Things our nightly check found that don&apos;t add up between Paystack, plans and the
          Wi-Fi. Check each one, fix it if needed, then mark it resolved with a note.
        </p>
      </header>
      <PaymentsNav at="mismatches" waiting={waiting.data?.length ?? 0} mismatches={rows.length} />
      {rows.length ? (
        <ul className="adm-list">
          {rows.map((d) => (
            <li key={d.id}>
              <span className="adm-list__main">
                <strong className="adm-plain">{MISMATCH[d.kind] ?? d.kind}</strong>
                <span>
                  Found {when(d.detectedAt)}
                  {d.paymentId ? (
                    <>
                      {' · '}
                      <Link href={`/admin/payments/${d.paymentId}`}>Open payment</Link>
                    </>
                  ) : null}
                </span>
              </span>
              <ResolveMismatch propertyId={property.id} id={d.id} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="adm-clear">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
          Everything matches.
        </p>
      )}
    </>
  );
}
