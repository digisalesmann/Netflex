import Link from 'next/link';

/** Sub-sections of Payments. */
export function PaymentsNav({
  at,
  waiting,
  mismatches,
}: {
  at: 'all' | 'refunds' | 'mismatches';
  waiting: number | null;
  mismatches: number | null;
}) {
  return (
    <nav className="adm-tabs adm-tabs--scroll adm-subnav" aria-label="Payments sections">
      <Link href="/admin/payments" aria-current={at === 'all' ? 'page' : undefined}>
        Payments
      </Link>
      <Link href="/admin/payments/refunds" aria-current={at === 'refunds' ? 'page' : undefined}>
        Refunds {waiting ? <span>{waiting}</span> : null}
      </Link>
      {mismatches !== null ? (
        <Link
          href="/admin/payments/mismatches"
          aria-current={at === 'mismatches' ? 'page' : undefined}
        >
          Mismatches {mismatches ? <span>{mismatches}</span> : null}
        </Link>
      ) : null}
    </nav>
  );
}
