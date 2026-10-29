import type { ReactNode } from 'react';
import { AccountNav } from '@/components/account/AccountNav';
import { SiteHeader } from '@/components/SiteHeader';
import { site } from '@/lib/site';

export const metadata = { robots: { index: false, follow: false } };

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader brand={site.brand} />
      <main
        id="main"
        className="container"
        style={{ paddingTop: 'var(--nf-space-5)', paddingBottom: 'var(--nf-space-8)' }}
      >
        <AccountNav />
        {children}
      </main>
    </>
  );
}
