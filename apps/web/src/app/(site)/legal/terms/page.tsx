import Link from 'next/link';
import { LegalDoc, type LegalPoint, type LegalSection } from '@/components/legal/LegalDoc';
import { getProperty } from '@/lib/property';
import { site } from '@/lib/site';

export const metadata = { title: 'Terms of service', alternates: { canonical: '/legal/terms' } };

const POINTS: LegalPoint[] = [
  {
    title: 'Terms are fixed when you pay',
    body: 'Price, duration, device limits and refund terms are shown before you pay and don’t change after.',
  },
  {
    title: 'Speed isn’t guaranteed',
    body: 'Wi-Fi runs over a shared satellite link, so speed and coverage vary by time and room.',
  },
  {
    title: 'Keep your code private',
    body: 'Anyone with your voucher code can use your access until it is cancelled.',
  },
  {
    title: 'Fair, legal use only',
    body: 'No illegal use, attacks on other networks or reselling access.',
  },
];

export default async function Terms() {
  const p = await getProperty();
  const who = p?.name ?? 'the property operator';

  const sections: LegalSection[] = [
    {
      id: 'service',
      title: 'The service',
      body: (
        <>
          <p>
            These terms apply when you use the {site.brand} Wi-Fi service provided by {who}.
          </p>
          <ul>
            <li>
              You buy time-based access. Each plan states its price, duration, when the time starts,
              device and session limits, any speed cap and its refund terms before you pay. Those
              terms are fixed for your purchase.
            </li>
            <li>
              Access is delivered over a shared satellite connection. We do not guarantee any speed,
              uninterrupted service, or coverage in every room.
            </li>
            <li>
              Your plan&apos;s time keeps running during outages. For long outages, contact support:
              the operator may extend your plan at its discretion.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'vouchers',
      title: 'Voucher codes',
      body: (
        <ul>
          <li>
            A voucher code is the key to your access. Keep it private. Anyone with it can use your
            access until it is cancelled.
          </li>
          <li>
            Codes work only at this property and must be used before the &quot;use by&quot; date
            shown.
          </li>
          <li>
            Room and floor plans may be used only by residents the buyer adds. Sharing a code
            outside that group may lead to suspension.
          </li>
        </ul>
      ),
    },
    {
      id: 'use',
      title: 'Acceptable use',
      body: (
        <p>
          Do not use the service for anything illegal, to attack or disrupt other networks or users,
          or to resell access. We may suspend access that breaks these terms, and will tell you why
          when we can.
        </p>
      ),
    },
    {
      id: 'payments',
      title: 'Payments and refunds',
      body: (
        <p>
          Payments are processed by Paystack. Access starts only after the payment is confirmed.
          Refunds follow the <Link href="/legal/refunds">refund and cancellation policy</Link>.
        </p>
      ),
    },
    {
      id: 'liability',
      title: 'Liability',
      body: (
        <p>
          To the extent the law allows, the operator is not liable for losses caused by
          interruptions, slow speeds or events outside its control. Nothing in these terms limits
          rights you have under consumer protection law.
        </p>
      ),
    },
    {
      id: 'changes',
      title: 'Changes',
      body: (
        <p>We may update these terms; changes don&apos;t affect plans you have already bought.</p>
      ),
    },
  ];

  return (
    <LegalDoc
      title="Terms of service"
      lede={`The rules for using ${site.brand} Wi-Fi at ${p?.name ?? 'the lodge'}, in plain language.`}
      updated={site.policiesUpdated}
      reviewed={site.legalReviewed}
      points={POINTS}
      sections={sections}
      contact={{ name: who, email: p?.supportEmail, phone: p?.supportPhone }}
    />
  );
}
