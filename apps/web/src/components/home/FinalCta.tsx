import Link from 'next/link';
import type { PublicProperty } from '@/lib/types';
import { Reveal } from './Reveal';

/** Closing band: bookends the page with the hero's night sky. */
export function FinalCta({ property }: { property: PublicProperty | null }) {
  const phone = property?.supportPhone ?? null;
  const email = property?.supportEmail ?? null;
  return (
    <section className="mk-final" aria-labelledby="final-title">
      {/* decorative: the same still as the hero video */}
      <img
        className="mk-final__bg"
        src="/media/hero/night-sky-poster.jpg"
        alt=""
        width={1600}
        height={900}
        loading="lazy"
        decoding="async"
      />
      <div className="mk-final__shade" aria-hidden="true" />
      <div className="container mk-final__inner">
        <Reveal>
          <h2 id="final-title" className="mk-final__title">
            Get online at {property?.name ?? 'the lodge'}.
          </h2>
          <p className="mk-final__lede">
            Already on the Wi-Fi? Your phone opens the sign-in page by itself. If it doesn&apos;t,
            open your browser and visit any website.
          </p>
          <div className="hero__actions mk-final__actions">
            <Link className="hero__button hero__button--solid" href="/plans">
              See plans
            </Link>
            <Link className="hero__button hero__button--glass" href="/connect">
              Enter a voucher
            </Link>
          </div>
          <p className="mk-final__help">Need a hand?</p>
          {phone || email ? (
            <ul className="mk-final__contacts">
              {phone ? (
                <li>
                  <a href={`tel:${phone}`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M6.6 3.5h2.6l1.4 4-2 1.4a12 12 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" />
                    </svg>
                    <span className="visually-hidden">Call </span>
                    {phone}
                  </a>
                </li>
              ) : null}
              {email ? (
                <li>
                  <a href={`mailto:${email}`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M3.5 6h17v12h-17zM3.5 6.5l8.5 7 8.5-7" />
                    </svg>
                    <span className="visually-hidden">Email </span>
                    {email}
                  </a>
                </li>
              ) : null}
            </ul>
          ) : (
            <ul className="mk-final__contacts">
              <li>
                <Link href="/contact">Contact the lodge team</Link>
              </li>
            </ul>
          )}
        </Reveal>
      </div>
    </section>
  );
}
