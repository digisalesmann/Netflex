'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

const LINKS = [
  {
    href: '/account',
    label: 'Overview',
    icon: 'M3.5 11 12 4l8.5 7M6 9.5v10h12v-10M10 19.5v-5h4v5',
  },
  {
    href: '/account/plans',
    label: 'Plans',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  },
  {
    href: '/account/orders',
    label: 'Orders',
    icon: 'M5 8h14l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3zM8.5 8V6.5a3.5 3.5 0 0 1 7 0V8M9.5 11.5a2.5 2.5 0 0 0 5 0',
  },
  {
    href: '/account/voucher',
    label: 'Vouchers',
    icon: 'M5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5A1.5 1.5 0 0 1 5.5 6zM14.5 6.5v1.5M14.5 11.25v1.5M14.5 16v1.5',
  },
  {
    href: '/account/support',
    label: 'Help',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 16.5h.01',
  },
  {
    href: '/account/settings',
    label: 'Settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z',
  },
] as const;

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

/** Account shell: "My account" bar with sign-out, then an icon tab bar. */
/** On phones these live behind the "+" button instead of in the floating bar. */
const SECONDARY = new Set(['/account/voucher', '/account/settings']);
const SIGN_OUT_ICON = 'M14.5 4.5h4v15h-4M10 16.5 14.5 12 10 7.5M14.5 12H3.5';

function signOut() {
  void api('/auth/logout', { method: 'POST' }).finally(() => window.location.assign('/'));
}

export function AccountNav() {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const current = (href: string) =>
    path === href ||
    (href !== '/account' && path.startsWith(href)) ||
    (href === '/account/plans' && path.startsWith('/account/checkout'))
      ? ('page' as const)
      : undefined;

  // Close the "More" sheet on navigation, Escape, or a tap outside it.
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMore(false);
        toggle.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!sheet.current?.contains(t) && !toggle.current?.contains(t)) setMore(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [more]);

  const secondaryActive = LINKS.some((l) => SECONDARY.has(l.href) && current(l.href));

  return (
    <nav aria-label="Account" className="acct-shell">
      <div className="acct-shell__bar">
        <p className="acct-shell__title">My account</p>
        <button type="button" className="acct-shell__signout" onClick={signOut}>
          <Icon d={SIGN_OUT_ICON} />
          Sign out
        </button>
      </div>
      <div className="acct-tabs">
        {LINKS.map((l, i) => (
          <Fragment key={l.href}>
            <Link
              href={l.href}
              className="acct-tabs__link"
              data-secondary={SECONDARY.has(l.href)}
              aria-current={current(l.href)}
            >
              <Icon d={l.icon} />
              <span>{l.label}</span>
            </Link>
            {i === 1 ? (
              <button
                ref={toggle}
                type="button"
                className="acct-more"
                aria-expanded={more}
                aria-controls="acct-more-sheet"
                data-active={secondaryActive}
                onClick={() => setMore((m) => !m)}
              >
                <span className="acct-more__plus" aria-hidden="true" />
                <span className="visually-hidden">More</span>
              </button>
            ) : null}
          </Fragment>
        ))}
      </div>
      <div
        ref={sheet}
        id="acct-more-sheet"
        className="acct-sheet"
        data-open={more}
        role="group"
        aria-label="More"
      >
        {more ? (
          <>
            <div className="acct-sheet__grid">
              {LINKS.filter((l) => SECONDARY.has(l.href)).map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="acct-sheet__item"
                  aria-current={current(l.href)}
                >
                  <Icon d={l.icon} />
                  <span>{l.label}</span>
                </Link>
              ))}
              <button type="button" className="acct-sheet__item" onClick={signOut}>
                <Icon d={SIGN_OUT_ICON} />
                <span>Sign out</span>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}
