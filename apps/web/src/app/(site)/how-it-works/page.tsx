import Link from 'next/link';
import { FinalCta } from '@/components/home/FinalCta';
import { Reveal } from '@/components/home/Reveal';
import { getProperty } from '@/lib/property';

export const metadata = { title: 'How it works', alternates: { canonical: '/how-it-works' } };

/** Each step pairs real copy with a real screen from the Wi-Fi sign-in page. */
const STEPS = [
  {
    title: 'Join the property Wi-Fi',
    body: [
      'Select the lodge network on your phone or laptop. The sign-in page opens by itself.',
      'Didn’t see the sign-in page? Open your browser and go to any website, like google.com. You’ll be taken there.',
    ],
    img: '/media/product/portal-step-1.webp',
    alt: 'The Netflex Wi-Fi sign-in page at ND Lodge on a phone, offering “I have a voucher” or “Choose a plan”.',
  },
  {
    title: 'Choose a plan, or enter a voucher',
    body: [
      'Every plan shows its price, how long it lasts and how many devices it covers.',
      'Got a code from the front desk? Enter it instead and skip paying online.',
    ],
    img: '/media/product/portal-step-2.webp',
    alt: 'The plan list on a phone: Daily ₦400, Weekly ₦2,500 and Monthly ₦8,000, each showing how long it lasts and how many devices it covers.',
  },
  {
    title: 'Check the terms, then pay securely',
    body: [
      'Before you pay you see everything: when time starts, devices, speed and refund terms.',
      'You pay on Paystack’s checkout. We never see your card details, and your access starts only after Paystack confirms the payment.',
    ],
    img: '/media/product/portal-review.webp',
    alt: 'The “Review your purchase” receipt for the Weekly plan, listing price, how long it lasts, when time starts, devices, speed, fair use and refund terms.',
  },
  {
    title: 'You’re connected',
    body: [
      'We switch on your access and the page tells you as soon as the network confirms it.',
      'It shows exactly how much time is left. Renew or manage devices from your account.',
    ],
    img: '/media/product/portal-step-3.webp',
    alt: 'The “You’re connected” screen on a phone, showing 6 days 23 hours left on the Weekly plan and when it ends.',
  },
];

const NOTES = [
  {
    title: 'Room and floor plans',
    body: 'A resident authorised by the property office can buy a plan for their whole room or floor and add the people who live there. Only added residents can use it, each on their own devices.',
    icon: 'M3.5 20.5V9l8.5-5.5L20.5 9v11.5M9 20.5v-6h6v6',
  },
  {
    title: 'Changing phones',
    body: 'Got a new phone? Free up a device slot from your account, then connect the new one on the sign-in page.',
    icon: 'M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5zM10.5 17h3',
  },
  {
    title: 'Phone refused after connecting?',
    body: 'Some phones use a different private address on each network. Turn off “private Wi-Fi address” (iPhone) or “randomised MAC” (Android) for this network, then reconnect.',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5M12 16h.01',
  },
];

export default async function HowItWorks() {
  const property = await getProperty();
  return (
    <>
      <section className="page-hero container">
        <Reveal>
          <p className="mk-eyebrow">Getting online</p>
          <h1 className="page-hero__title">How it works</h1>
          <p className="mk-lede">
            Join the Wi-Fi, choose a plan and you&apos;re online. No app to install, and no account
            needed for a personal plan.
          </p>
        </Reveal>
      </section>

      <section className="mk-section hiw" aria-label="Step by step">
        <ol className="container hiw__list">
          {STEPS.map((s, i) => (
            <li key={s.title} className="hiw__step">
              <Reveal className="hiw__media">
                <div className="steps__stage">
                  <div className="phone">
                    <div className="phone__screen">
                      <img
                        src={s.img}
                        alt={s.alt}
                        width={780}
                        height={1688}
                        loading={i === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                      />
                    </div>
                  </div>
                </div>
              </Reveal>
              <Reveal className="hiw__copy" delay={100}>
                <p className="hiw__n" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <h2 className="hiw__title">{s.title}</h2>
                {s.body.map((p) => (
                  <p key={p} className="hiw__body">
                    {p}
                  </p>
                ))}
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section className="mk-section hiw-notes" aria-labelledby="notes-title">
        <div className="container">
          <Reveal className="mk-head mk-head--center">
            <p className="mk-eyebrow">Good to know</p>
            <h2 id="notes-title" className="mk-title">
              A few things worth knowing.
            </h2>
          </Reveal>
          <ul className="mk-features hiw-notes__list">
            {NOTES.map((n, i) => (
              <Reveal as="li" key={n.title} delay={i * 80}>
                <span className="mk-points__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d={n.icon} />
                  </svg>
                </span>
                <strong className="mk-points__title">{n.title}</strong>
                <span className="mk-points__body">{n.body}</span>
              </Reveal>
            ))}
          </ul>
          <Reveal className="mk-account__cta">
            <Link href="/faq" className="mk-link">
              More questions and answers
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
              </svg>
            </Link>
          </Reveal>
        </div>
      </section>

      <FinalCta property={property} />
    </>
  );
}
