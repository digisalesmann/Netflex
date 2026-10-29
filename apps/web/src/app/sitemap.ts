import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

/** Public pages only. Account, portal and checkout pages are never indexed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    '/',
    '/how-it-works',
    '/plans',
    '/coverage',
    '/faq',
    '/contact',
    '/legal/privacy',
    '/legal/terms',
    '/legal/refunds',
  ].map((p) => ({ url: `${site.siteUrl}${p}` }));
}
