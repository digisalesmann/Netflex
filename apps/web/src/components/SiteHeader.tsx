'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/plans', label: 'Plans' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Help' },
  { href: '/account', label: 'My account' },
];

export function SiteHeader({ brand }: { brand: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="brand">
          {brand}
        </Link>
        <button
          type="button"
          className="button button--quiet menu-toggle"
          aria-expanded={open}
          aria-controls="primary-nav"
          onClick={() => setOpen((o) => !o)}
        >
          Menu
        </button>
        <nav id="primary-nav" aria-label="Main" className="nav nav--collapsible" data-open={open}>
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={
                path === l.href || (l.href !== '/' && path.startsWith(`${l.href}/`))
                  ? 'page'
                  : undefined
              }
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
