import type { Metadata } from 'next';
import { PortalFlow, type PortalCtx } from '@/components/portal/PortalFlow';

export const metadata: Metadata = { title: 'Connect', robots: { index: false, follow: false } };

type Params = Promise<{ gw: string }>;
type Query = Promise<Record<string, string | string[] | undefined>>;

/**
 * Omada external portal entry. In the Omada controller the portal URL is set to
 * https://<site>/connect/omada/<gateway id>, and Omada adds the device's details:
 * ?clientMac=…&apMac=…&ssidName=…&radioId=…&site=…&t=…&redirectUrl=…
 * The API only trusts them after the lodge link confirms the device is connected.
 */
export default async function ConnectOmada({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}) {
  const { gw } = await params;
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const mac = one(q.clientMac);
  const ap = one(q.apMac);
  const ssid = one(q.ssidName);
  const radio = Number(one(q.radioId));
  const site = one(q.site);
  const ctx: PortalCtx | null =
    /^[0-9a-f-]{36}$/i.test(gw) && mac && ap && ssid && site && Number.isInteger(radio)
      ? { gw, mac, ap, ssid, radio, site }
      : null;
  return (
    <main id="main" className="cn-page">
      <PortalFlow ctx={ctx} />
    </main>
  );
}
