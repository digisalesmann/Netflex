'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { ConfirmButton } from '../ConfirmButton';
import { Logo } from '../Logo';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

const PROPERTY_COOKIE = 'nf_admin_property';

export function AdminShell({
  nav,
  user,
  property,
  properties,
  children,
}: {
  nav: NavItem[];
  user: { name: string; role: string };
  property: { id: string; name: string } | null;
  properties: { id: string; name: string }[];
  children: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const active = (href: string) => (href === '/admin' ? path === href : path.startsWith(href));

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => null);
    window.location.assign('/admin/sign-in');
  }

  function switchTo(id: string) {
    document.cookie = `${PROPERTY_COOKIE}=${id}; path=/admin; samesite=lax; max-age=31536000`;
    window.location.assign('/admin');
  }

  const sidebar = (
    <>
      <div className="adm-side__top">
        <Link href="/admin" className="adm-side__logo" aria-label="Office overview">
          <Logo decorative />
        </Link>
        {properties.length > 1 ? (
          <label className="adm-prop">
            <span className="adm-sr">Property</span>
            <select value={property?.id ?? ''} onChange={(e) => switchTo(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="adm-prop adm-prop--single">{property?.name ?? 'No property yet'}</p>
        )}
      </div>
      <nav className="adm-nav" aria-label="Office">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="adm-nav__link"
            aria-current={active(n.href) ? 'page' : undefined}
          >
            <Icon d={n.icon} />
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="adm-me">
        <span className="adm-me__avatar" aria-hidden="true">
          {user.name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <span className="adm-me__text">
          <strong>{user.name}</strong>
          <span>{user.role}</span>
        </span>
        <ConfirmButton
          className="adm-me__out"
          title="Sign out of the office?"
          body="You’ll need your password and authenticator code to sign back in."
          confirmLabel="Sign out"
          onConfirm={signOut}
        >
          Sign out
        </ConfirmButton>
      </div>
    </>
  );

  return (
    <div className="adm">
      <a className="skip-link" href="#adm-main">
        Skip to content
      </a>
      <header className="adm-bar">
        <Link href="/admin" aria-label="Office overview" className="adm-bar__logo">
          <Logo decorative />
        </Link>
        <span className="adm-bar__prop">{property?.name}</span>
        <button
          type="button"
          className="adm-bar__menu"
          aria-expanded={open}
          aria-controls="adm-side"
          onClick={() => setOpen((o) => !o)}
        >
          <Icon d={open ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} />
          <span className="adm-sr">Menu</span>
        </button>
      </header>
      <aside id="adm-side" className="adm-side" data-open={open}>
        {sidebar}
      </aside>
      {open ? (
        <div className="adm-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      ) : null}
      <main id="adm-main" className="adm-main">
        {children}
      </main>
    </div>
  );
}
