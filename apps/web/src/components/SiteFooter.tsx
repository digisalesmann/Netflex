import Link from 'next/link';
import { Logo } from '@/components/Logo';

const COLUMNS = [
  {
    title: 'Wi-Fi',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/plans', label: 'Plans and pricing' },
      { href: '/coverage', label: 'Coverage' },
      { href: '/connect', label: 'Enter a voucher' },
    ],
  },
  {
    title: 'Help',
    links: [
      { href: '/faq', label: 'FAQ' },
      { href: '/contact', label: 'Contact and support' },
      { href: '/account', label: 'My account' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/legal/terms', label: 'Terms of service' },
      { href: '/legal/privacy', label: 'Privacy policy' },
      { href: '/legal/refunds', label: 'Refunds and cancellations' },
    ],
  },
];

export function SiteFooter({
  brand,
  propertyName,
  supportPhone,
  supportEmail,
}: {
  brand: string;
  propertyName: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
}) {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <Link href="/" className="site-footer__logo" aria-label={`${brand} home`}>
              <Logo variant="stacked" decorative />
            </Link>
            <p className="site-footer__tagline">
              Satellite-powered Wi-Fi{propertyName ? ` at ${propertyName}` : ''}.
            </p>
            <p className="site-footer__note">
              Speeds and availability vary and are not guaranteed.
            </p>
          </div>

          <nav className="site-footer__nav" aria-label="Footer">
            {COLUMNS.map((c) => (
              <div key={c.title} className="site-footer__col">
                <h2 className="site-footer__heading">{c.title}</h2>
                <ul className="site-footer__links">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href}>{l.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {supportPhone || supportEmail ? (
              <div className="site-footer__col site-footer__col--contact">
                <h2 className="site-footer__heading">Contact</h2>
                <ul className="site-footer__links site-footer__contact">
                  {supportPhone ? (
                    <li>
                      <a href={`tel:${supportPhone}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M6.6 3.5h2.6l1.4 4-2 1.4a12 12 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" />
                        </svg>
                        <span className="visually-hidden">Call </span>
                        {supportPhone}
                      </a>
                    </li>
                  ) : null}
                  {supportEmail ? (
                    <li>
                      <a href={`mailto:${supportEmail}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M3.5 6h17v12h-17zM3.5 6.5l8.5 7 8.5-7" />
                        </svg>
                        <span className="visually-hidden">Email </span>
                        {supportEmail}
                      </a>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </nav>
        </div>

        <div className="site-footer__bottom">
          <p>
            © {year} {brand}
            {propertyName ? ` · Wi-Fi at ${propertyName}` : ''}
          </p>
          {/* Licence credits; each item is a whole link (no underlined links inside sentences). */}
          <ul className="site-footer__credits" aria-label="Media credits">
            <li>
              <a href="https://commons.wikimedia.org/wiki/File:003_Starlink_satellites_passing_over_the_Swiss_night_sky_as_seen_from_M%C3%BCrren_Video_by_Giles_Laurent.webm">
                Video by Giles Laurent
              </a>
            </li>
            <li>
              <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license">
                CC BY-SA 4.0
              </a>
            </li>
            <li>
              <a href="https://images.nasa.gov/details/iss073e0982679">Earth photo: NASA</a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
