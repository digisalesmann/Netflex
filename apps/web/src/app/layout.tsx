import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { site } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(site.siteUrl),
  title: { default: `${site.brand} Wi-Fi`, template: `%s · ${site.brand}` },
  description:
    'Paid Wi-Fi for residents and guests: choose a plan or enter a voucher, and get online.',
  openGraph: { type: 'website', siteName: site.brand },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Always light, whatever the device's dark-mode setting (owner preference).
  colorScheme: 'light',
  themeColor: '#fbfaf8',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
