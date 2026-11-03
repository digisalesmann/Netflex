import Link from 'next/link';
import { FinalCta } from '@/components/home/FinalCta';
import { Reveal } from '@/components/home/Reveal';
import { SignalGuide } from '@/components/coverage/SignalGuide';
import { getProperty } from '@/lib/property';
import { site } from '@/lib/site';

export const metadata = { title: 'Property and coverage', alternates: { canonical: '/coverage' } };

const FACTORS = [
  {
    title: 'How many people are online',
    body: 'The satellite connection is shared by everyone at the property, so busy times are slower.',
    icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 15c1.6.8 2.6 2.4 3 5',
  },
  {
    title: 'The weather',
    body: 'Heavy rain and storms can slow the satellite link or interrupt it for a while.',
    icon: 'M7 17.5h10a4 4 0 0 0 .7-7.9A6 6 0 0 0 6.3 9.4 4 4 0 0 0 7 17.5zM9 20.5l-1 1.5M13 20.5l-1 1.5M17 20.5l-1 1.5',
  },
  {
    title: 'Where you are',
    body: 'Distance and walls between you and the nearest access point weaken the signal.',
    icon: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  },
  {
    title: 'Your plan’s speed cap',
    body: 'Some plans cap speeds so everyone gets a fair share. Each plan shows its cap before you pay.',
    icon: 'M12 20a8 8 0 1 0-8-8M12 12l4-4M4 12H2.5M12 4V2.5',
  },
];

const OUTAGES = [
  {
    title: 'Outages can happen',
    body: 'Power cuts and satellite outages can interrupt the service.',
  },
  {
    title: 'Your plan keeps counting',
    body: 'Time-based plans keep running during an outage. If an outage is long, contact support: the property may extend your plan.',
  },
  {
    title: 'Tell us what you see',
    body: 'Report problems from the help page or your account. Include your room and when it started.',
  },
];

const SAFETY = [
  {
    title: 'Keep your code private',
    body: 'Your voucher code is the key to your access. Anyone with it can use it.',
    icon: 'M14.5 9.5a4.5 4.5 0 1 1-1.3 3.2L4 22l-1.5-1.5L4 19l-1-1 1.5-1.5 1 1 1.5-1.5-1-1L7.5 13.5M16.5 7.5h.01',
  },
  {
    title: 'Look for https',
    body: 'Use secure (https) websites for anything sensitive, like banking.',
    icon: 'M6.5 10.5V8a5.5 5.5 0 0 1 11 0v2.5M5 10.5h14v10H5zM12 14.5v2.5',
  },
  {
    title: 'Treat it as shared Wi-Fi',
    body: 'No public Wi-Fi network is perfectly secure, so be careful what you share.',
    icon: 'M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6zM9 12l2.2 2.2L15.5 10',
  },
];

export default async function Coverage() {
  const property = await getProperty();
  const where = property?.name ?? 'the property';
  return (
    <>
      <section className="page-hero container">
        <Reveal>
          <p className="mk-eyebrow">{property?.name ?? 'The property'}</p>
          <h1 className="page-hero__title">Property and coverage</h1>
          <p className="mk-lede">What to expect from the Wi-Fi where you live, plainly.</p>
        </Reveal>
      </section>

      <section className="mk-section cov-where" aria-labelledby="where-title">
        <div className="container mk-split">
          <Reveal className="mk-head">
            <p className="mk-eyebrow">Where it works</p>
            <h2 id="where-title" className="mk-title">
              Wi-Fi across the lodge.
            </h2>
            <p className="mk-lede">
              The Wi-Fi is available inside {where} through access points installed by the property.
              Signal strength varies between rooms and floors, and some spots may be weak or
              unavailable.
            </p>
            {site.coverageNotes ? (
              <p className="cov-note">
                <strong>From the property: </strong>
                {site.coverageNotes}
              </p>
            ) : null}
          </Reveal>
          <Reveal className="cov-visual" delay={120}>
            <SignalGuide />
          </Reveal>
        </div>
      </section>

      <section className="mk-section cov-speed" aria-labelledby="speed-title">
        <div className="container">
          <Reveal className="mk-head mk-head--center">
            <p className="mk-eyebrow">How fast it is</p>
            <h2 id="speed-title" className="mk-title">
              What affects your speed.
            </h2>
            <p className="mk-lede">
              We don&apos;t promise any particular speed, or that the service will never be
              interrupted. These are the things that make the difference.
            </p>
          </Reveal>
          <ul className="cov-tiles">
            {FACTORS.map((f, i) => (
              <Reveal as="li" key={f.title} delay={i * 80}>
                <span className="mk-points__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d={f.icon} />
                  </svg>
                </span>
                <strong className="mk-points__title">{f.title}</strong>
                <span className="mk-points__body">{f.body}</span>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section mk-fair cov-outages" aria-labelledby="outage-title">
        <div className="container mk-fair__grid">
          <Reveal className="mk-head mk-fair__head">
            <p className="mk-eyebrow">Outages</p>
            <h2 id="outage-title" className="mk-title">
              If the connection drops.
            </h2>
            <p className="mk-lede">What happens, and what to do.</p>
          </Reveal>
          <ol className="mk-fair__list">
            {OUTAGES.map((o, i) => (
              <Reveal as="li" key={o.title} delay={i * 80}>
                <span className="mk-fair__n" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="mk-fair__title">{o.title}</h3>
                  <p className="mk-fair__body">{o.body}</p>
                  {i === OUTAGES.length - 1 ? (
                    <Link href="/contact" className="mk-fair__link">
                      Contact and support
                    </Link>
                  ) : null}
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="mk-section cov-safe" aria-labelledby="safe-title">
        <div className="container">
          <Reveal className="mk-head mk-head--center">
            <p className="mk-eyebrow">Security and privacy</p>
            <h2 id="safe-title" className="mk-title">
              Staying safe on shared Wi-Fi.
            </h2>
          </Reveal>
          <ul className="mk-features cov-safe__list">
            {SAFETY.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 80}>
                <span className="mk-points__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d={s.icon} />
                  </svg>
                </span>
                <strong className="mk-points__title">{s.title}</strong>
                <span className="mk-points__body">{s.body}</span>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <FinalCta property={property} />
    </>
  );
}
