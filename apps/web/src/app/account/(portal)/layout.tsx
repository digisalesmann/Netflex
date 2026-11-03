import type { ReactNode } from 'react';
import { AccountNav } from '@/components/account/AccountNav';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getProperty } from '@/lib/property';
import { site } from '@/lib/site';

export const metadata = { robots: { index: false, follow: false } };

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const property = await getProperty();
  return (
    <div className="acct-page">
      <SiteHeader brand={site.brand} />
      <main id="main" className="container acct">
        <AccountNav />
        {children}
      </main>
      <SiteFooter
        brand={site.brand}
        propertyName={property?.name ?? null}
        supportPhone={property?.supportPhone ?? null}
        supportEmail={property?.supportEmail ?? null}
      />
    </div>
  );
}
