import Link from 'next/link';
import { Notice } from '@/components/ui';
import { FinalCta } from '@/components/home/FinalCta';
import { Reveal } from '@/components/home/Reveal';
import { PlanExplorer } from '@/components/plans/PlanExplorer';
import { getPlans, getProperty } from '@/lib/property';

export const metadata = { title: 'Plans and pricing', alternates: { canonical: '/plans' } };

const HOW_TO_BUY = [
  {
    title: 'On the Wi-Fi sign-in page',
    body: 'Join the lodge Wi-Fi and choose a plan. No account needed for a personal plan.',
    icon: 'M12 18.5h.01M8.5 15a5 5 0 0 1 7 0M5.5 12a9.2 9.2 0 0 1 13 0M2.5 9a13.4 13.4 0 0 1 19 0',
  },
  {
    title: 'From your account',
    body: 'Sign in with your phone number to buy, renew and keep every receipt in one place.',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.3 4-5 7.5-5s6.3 1.7 7.5 5',
  },
  {
    title: 'Room and floor plans',
    body: 'Bought from your account by residents the property office has authorised for that room or floor.',
    icon: 'M3.5 20.5V9l8.5-5.5L20.5 9v11.5M9 20.5v-6h6v6',
  },
];

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Plans({ searchParams }: { searchParams: Params }) {
  const [plans, property, q] = await Promise.all([getPlans(), getProperty(), searchParams]);
  return (
    <>
      <section className="page-hero container">
        <Reveal>
          <p className="mk-eyebrow">Pricing</p>
          <h1 className="page-hero__title">Plans and pricing</h1>
          <p className="mk-lede">
            Prices include everything you pay to us. Buy on the Wi-Fi sign-in page or from your
            account.
          </p>
        </Reveal>
      </section>

      {plans === null ? (
        <div className="container">
          <Notice tone="warn" title="Plans are unavailable right now">
            <p>We couldn&apos;t load the plan list. Please try again in a moment.</p>
          </Notice>
        </div>
      ) : plans.length === 0 ? (
        <div className="container">
          <Notice title="No plans on sale yet">
            <p>The property hasn&apos;t published any plans yet. Ask at the office.</p>
          </Notice>
        </div>
      ) : (
        <section className="mk-section explorer" aria-label="Plans">
          <div className="container">
            <PlanExplorer plans={plans} initial={{ for: one(q.for), length: one(q.length) }} />
          </div>
        </section>
      )}

      <section className="mk-section plans-buy" aria-labelledby="buy-title">
        <div className="container">
          <Reveal className="mk-head mk-head--center">
            <p className="mk-eyebrow">How to buy</p>
            <h2 id="buy-title" className="mk-title">
              Where to buy.
            </h2>
          </Reveal>
          <ul className="mk-features plans-buy__list">
            {HOW_TO_BUY.map((h, i) => (
              <Reveal as="li" key={h.title} delay={i * 80}>
                <span className="mk-points__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d={h.icon} />
                  </svg>
                </span>
                <strong className="mk-points__title">{h.title}</strong>
                <span className="mk-points__body">{h.body}</span>
              </Reveal>
            ))}
          </ul>
          <p className="plans-buy__note">
            Internet access is delivered by satellite through the property&apos;s network. Speeds
            depend on demand, weather and coverage in your room, and are not guaranteed.
          </p>
          <Reveal className="mk-account__cta">
            <Link href="/legal/refunds" className="mk-link">
              Read the refund policy
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
