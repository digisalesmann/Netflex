import Link from 'next/link';
import { getPlans, getProperty } from '@/lib/property';
import { HeroVideo } from '@/components/home/HeroVideo';
import { HowItWorks } from '@/components/home/HowItWorks';
import { PlansShowcase } from '@/components/home/PlansShowcase';
import { SharedLiving } from '@/components/home/SharedLiving';
import { PayYourWay } from '@/components/home/PayYourWay';
import { AccountShowcase } from '@/components/home/AccountShowcase';
import { Connectivity } from '@/components/home/Connectivity';
import { FairPlay } from '@/components/home/FairPlay';
import { FaqPreview } from '@/components/home/FaqPreview';
import { FinalCta } from '@/components/home/FinalCta';

export const metadata = { alternates: { canonical: '/' } };

export default async function Home() {
  const [property, plans] = await Promise.all([getProperty(), getPlans()]);
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <HeroVideo
          poster="/media/hero/night-sky-poster.jpg"
          srcSmall="/media/hero/night-sky-720.webm"
          srcLarge="/media/hero/night-sky-1080.webm"
        />
        <div className="hero__shade" aria-hidden="true" />
        <div className="container hero__content">
          <p className="hero__eyebrow">
            {property ? `Wi-Fi at ${property.name}` : 'Residential Wi-Fi'}
          </p>
          <h1 id="hero-title" className="hero__title">
            Connect, choose a plan, get online.
          </h1>
          <p className="hero__lede">
            Satellite-powered Wi-Fi for residents and guests. Pick a plan or enter a voucher, just
            you, your room, or your floor.
          </p>
          <div className="hero__actions">
            <Link className="hero__button hero__button--solid" href="/plans">
              See plans
            </Link>
            <Link className="hero__button hero__button--glass" href="/how-it-works">
              How it works
            </Link>
          </div>
        </div>
      </section>

      <HowItWorks />

      <PlansShowcase plans={plans} />

      <SharedLiving />

      <PayYourWay />

      <AccountShowcase />

      <Connectivity />

      <FairPlay />

      <FaqPreview />

      <FinalCta property={property} />
    </>
  );
}
