import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getProperty } from '@/lib/property';
import { site } from '@/lib/site';

/** Rendered per request (property settings are runtime config); API data is cached 60 s. */
export const dynamic = 'force-dynamic';

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const property = await getProperty();
  return (
    <>
      <SiteHeader brand={site.brand} />
      <main id="main">{children}</main>
      <SiteFooter
        brand={site.brand}
        propertyName={property?.name ?? null}
        supportPhone={property?.supportPhone ?? null}
        supportEmail={property?.supportEmail ?? null}
      />
    </>
  );
}
