import type { Metadata } from 'next';
import { PortalFlow, type PortalCtx } from '@/components/portal/PortalFlow';
import { site } from '@/lib/site';

export const metadata: Metadata = { title: 'Connect', robots: { index: false, follow: false } };

type Params = Promise<Record<string, string | string[] | undefined>>;

/** Captive portal entry. The gateway redirects here with its own identifiers for the device. */
export default async function Connect({ searchParams }: { searchParams: Params }) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const gw = one(q.gw);
  const ip = one(q.ip);
  const mac = one(q.mac);
  const ctx: PortalCtx | null = gw && ip && mac ? { gw, ip, mac } : null;
  return (
    <main id="main" className="container narrow">
      <PortalFlow ctx={ctx} brand={site.brand} />
    </main>
  );
}
