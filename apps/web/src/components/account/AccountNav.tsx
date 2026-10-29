'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

const LINKS = [
  ['/account', 'Overview'],
  ['/account/plans', 'Plans'],
  ['/account/orders', 'Orders'],
  ['/account/voucher', 'Vouchers'],
  ['/account/support', 'Help'],
  ['/account/settings', 'Settings'],
] as const;

export function AccountNav() {
  const path = usePathname();
  return (
    <nav aria-label="Account" className="subnav">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={
            path === href || (href !== '/account' && path.startsWith(href)) ? 'page' : undefined
          }
        >
          {label}
        </Link>
      ))}
      <button
        type="button"
        className="linkbutton"
        style={{ marginLeft: 'auto' }}
        onClick={() => {
          void api('/auth/logout', { method: 'POST' }).finally(() => window.location.assign('/'));
        }}
      >
        Sign out
      </button>
    </nav>
  );
}
