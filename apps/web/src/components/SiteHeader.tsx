'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

const LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/plans', label: 'Plans' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Help' },
];

/** Matches the CSS breakpoint where the full navigation appears. */
const DESKTOP = '(min-width: 960px)';

function isCurrent(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

function AccountIcon() {
  return (
    <svg className="header-account__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.75 19.5c1.3-3.3 4-5 7.25-5s5.95 1.7 7.25 5" />
    </svg>
  );
}

export function SiteHeader({ brand }: { brand: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  // Hairline border and stronger backdrop once the page scrolls under the header.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the menu after navigating.
  useEffect(() => {
    setOpen(false);
  }, [path]);

  // While the mobile menu is open: lock page scroll, close on Escape or when
  // the window grows to the desktop layout.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    const mq = window.matchMedia(DESKTOP);
    const onWide = () => {
      if (mq.matches) close();
    };
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onWide);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onWide);
    };
  }, [open, close]);

  return (
    <header
      className="site-header"
      data-scrolled={scrolled}
      data-open={open}
      // Transparent over the home page's video hero until the page scrolls.
      data-overlay={path === '/' && !scrolled && !open}
    >
      <div className="container site-header__inner">
        <Link href="/" className="brand" aria-label={`${brand} home`}>
          <Logo decorative />
        </Link>

        <nav id="primary-nav" aria-label="Main" className="primary-nav" data-open={open}>
          <ul className="primary-nav__list">
            {LINKS.map((l, i) => (
              <li key={l.href} style={{ '--i': i } as CSSProperties}>
                <Link
                  href={l.href}
                  className="primary-nav__link"
                  aria-current={isCurrent(path, l.href) ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span>{l.label}</span>
                  <svg
                    className="primary-nav__chevron"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M9 5.5 15.5 12 9 18.5" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-header__actions">
          <Link
            href="/account"
            className="header-account"
            aria-current={isCurrent(path, '/account') ? 'page' : undefined}
          >
            <AccountIcon />
            <span className="header-account__label">My account</span>
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="menu-toggle"
            aria-expanded={open}
            aria-controls="primary-nav"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="menu-toggle__bars" aria-hidden="true" />
            <span className="visually-hidden">Menu</span>
          </button>
        </div>
      </div>
    </header>
  );
}
