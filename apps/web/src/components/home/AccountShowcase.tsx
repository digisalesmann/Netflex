import Link from 'next/link';
import { Reveal } from './Reveal';

const FEATURES = [
  {
    title: 'Time and devices at a glance',
    body: 'See how long your plan has left and which devices are connected.',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  },
  {
    title: 'Renew without losing time',
    body: 'Renewing adds time after your current plan ends, so nothing is wasted.',
    icon: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  },
  {
    title: 'Swap a device',
    body: 'Remove an old phone or laptop to free its slot for a new one.',
    icon: 'M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5zM10.5 17h3',
  },
  {
    title: 'Receipts and help',
    body: 'Every order and receipt in one list, and a direct line to support.',
    icon: 'M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 8.5h6M9 12h6M9 15.5h3.5',
  },
];

/** Screenshot: our own account page with demo data (resident "Amara", room G1). */
export function AccountShowcase() {
  return (
    <section className="mk-section mk-account" aria-labelledby="account-title">
      <div className="container">
        <Reveal className="mk-head mk-head--center">
          <p className="mk-eyebrow">Your account</p>
          <h2 id="account-title" className="mk-title">
            Everything in one place.
          </h2>
          <p className="mk-lede">
            Sign in with your phone number to see your plans, manage devices, renew and find your
            receipts. No password to remember.
          </p>
        </Reveal>
        <Reveal className="browser" delay={100}>
          <div className="browser__bar" aria-hidden="true">
            <span className="browser__dots">
              <i />
              <i />
              <i />
            </span>
          </div>
          <img
            className="browser__shot"
            src="/media/product/account-plan-1600.webp"
            srcSet="/media/product/account-plan-900.webp 900w, /media/product/account-plan-1600.webp 1600w"
            sizes="(min-width: 1100px) 1040px, 100vw"
            alt="The Netflex account page for a Week pass: connected, 6 days 23 hours left, 1 of 2 devices in use, with a Renew button and a list of devices."
            width={1600}
            height={1025}
            loading="lazy"
            decoding="async"
          />
        </Reveal>
        <ul className="mk-features">
          {FEATURES.map((f, i) => (
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
        <Reveal className="mk-account__cta">
          <Link href="/account" className="mk-link">
            Go to your account
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
