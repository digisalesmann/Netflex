import Link from 'next/link';
import { Reveal } from './Reveal';

/** Real screens from the Wi-Fi sign-in page (captured from the running app). */
const STEPS = [
  {
    n: '01',
    title: 'Join the Wi-Fi',
    body: 'Connect to the lodge network and the sign-in page opens by itself. Nothing to install.',
    img: '/media/product/portal-step-1.webp',
    alt: 'The Netflex Wi-Fi sign-in page at ND Lodge on a phone, offering “I have a voucher” or “Choose a plan”.',
  },
  {
    n: '02',
    title: 'Pick a plan or use a voucher',
    body: 'Price, devices and refund terms are shown before you pay. Pay securely with Paystack, or enter a code from the front desk.',
    img: '/media/product/portal-step-2.webp',
    alt: 'The plan list on a phone: Daily ₦400, Weekly ₦2,500 and Monthly ₦8,000, each showing how long it lasts and how many devices it covers.',
  },
  {
    n: '03',
    title: 'You’re online',
    body: 'The page confirms you’re connected and shows exactly how much time is left. Renew or manage devices from your account.',
    img: '/media/product/portal-step-3.webp',
    alt: 'The “You’re connected” screen on a phone, showing 6 days 23 hours left on the Weekly plan and when it ends.',
  },
];

export function HowItWorks() {
  return (
    <section id="more" className="mk-section mk-steps" aria-labelledby="steps-title">
      <div className="container">
        <Reveal className="mk-head">
          <p className="mk-eyebrow">How it works</p>
          <h2 id="steps-title" className="mk-title">
            Online in three steps.
          </h2>
          <p className="mk-lede">
            No forms at the front desk, no passwords taped to the wall. Join the network, choose how
            long you need, and you&apos;re connected.
          </p>
        </Reveal>
      </div>
      <div className="steps__rail" role="region" aria-label="The three steps" tabIndex={0}>
        <ol className="steps__list container">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.n} className="steps__item" delay={i * 120}>
              <div className="steps__stage">
                <div className="phone">
                  <div className="phone__screen">
                    <img
                      src={s.img}
                      alt={s.alt}
                      width={780}
                      height={1688}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </div>
              </div>
              <p className="steps__n" aria-hidden="true">
                {s.n}
              </p>
              <h3 className="steps__title">{s.title}</h3>
              <p className="steps__body">{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
      <div className="container">
        <Reveal className="steps__more">
          <Link href="/how-it-works" className="mk-link">
            See the full guide
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
