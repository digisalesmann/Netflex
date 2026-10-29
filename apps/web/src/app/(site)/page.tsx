import Link from 'next/link';
import { getPlans, getProperty } from '@/lib/property';
import { duration } from '@/lib/format';

export const metadata = { alternates: { canonical: '/' } };

export default async function Home() {
  const [property, plans] = await Promise.all([getProperty(), getPlans()]);
  const cheapest = plans?.length
    ? [...plans].sort((a, b) =>
        Number(BigInt(a.price.amountMinor) - BigInt(b.price.amountMinor)),
      )[0]
    : null;
  return (
    <>
      <section
        className="container"
        style={{ padding: 'var(--nf-space-8) var(--nf-layout-gutter) var(--nf-space-7)' }}
      >
        <p className="eyebrow">{property ? `Wi-Fi at ${property.name}` : 'Residential Wi-Fi'}</p>
        <h1 style={{ maxWidth: '18ch' }}>Connect, choose a plan, get online.</h1>
        <p className="lede">
          Join the property Wi-Fi, pick a plan or enter a voucher code, and you&apos;re set.
          Time-based plans for just you, your room, or your floor.
        </p>
        <div className="actions">
          <Link className="button" href="/plans">
            See plans
          </Link>
          <Link className="button button--quiet" href="/how-it-works">
            How it works
          </Link>
        </div>
        {cheapest ? (
          <p className="small muted" style={{ marginTop: 'var(--nf-space-5)' }}>
            Plans from {cheapest.price.display} for {duration(cheapest.duration)}.
          </p>
        ) : null}
      </section>

      <section className="section section--subtle">
        <div className="container grid grid--3">
          <div>
            <h2 className="h3">Pay as you need it</h2>
            <p className="muted">
              Hours, days, weeks or months. Time-based, with the start rule shown before you pay.
            </p>
          </div>
          <div>
            <h2 className="h3">Share with your room</h2>
            <p className="muted">
              Room and floor plans cover the residents you add, each on their own devices, up to the
              plan&apos;s limit.
            </p>
          </div>
          <div>
            <h2 className="h3">Clear about what you get</h2>
            <p className="muted">
              Price, device limit, speed cap and refund terms are shown up front. Speeds vary and
              are never promised.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid grid--2">
          <div>
            <h2>Already on the Wi-Fi?</h2>
            <p>
              Your phone should open the sign-in page automatically. If it doesn&apos;t, open your
              browser and visit any website, and you&apos;ll be taken there.
            </p>
          </div>
          <div>
            <h2>Have a voucher?</h2>
            <p>
              Enter it on the Wi-Fi sign-in page. Codes look like{' '}
              <span style={{ fontFamily: 'var(--nf-font-mono)' }}>ABCD-EFGH-JKMN</span> and work
              only at this property.
            </p>
            <p>
              <Link href="/faq">Questions about vouchers</Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
