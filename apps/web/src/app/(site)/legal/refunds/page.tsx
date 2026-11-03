import Link from 'next/link';
import { LegalDoc, type LegalPoint, type LegalSection } from '@/components/legal/LegalDoc';
import { getProperty } from '@/lib/property';
import { site } from '@/lib/site';

export const metadata = {
  title: 'Refunds and cancellations',
  alternates: { canonical: '/legal/refunds' },
};

const POINTS: LegalPoint[] = [
  {
    title: 'Unused code, full refund',
    body: 'If you haven’t used your voucher code yet, you can ask for your money back.',
  },
  {
    title: 'Charged twice? It comes back',
    body: 'Every payment is checked with Paystack, and any extra charge is refunded.',
  },
  {
    title: 'Nothing renews',
    body: 'Plans don’t renew automatically, so there is nothing to cancel.',
  },
  {
    title: 'Back the way you paid',
    body: 'Refunds go to your original payment method through Paystack.',
  },
];

export default async function Refunds() {
  const p = await getProperty();
  const who = p?.name ?? 'the property operator';

  const sections: LegalSection[] = [
    {
      id: 'before',
      title: 'Before you start using it',
      body: (
        <>
          <p>
            Each plan also shows its own refund terms before you pay. Where they differ, the terms
            shown for your plan apply.
          </p>
          <p>
            If you haven&apos;t used your voucher code yet, you can ask for a full refund. Once the
            refund is confirmed, the unused code stops working.
          </p>
        </>
      ),
    },
    {
      id: 'after',
      title: 'After it has started',
      body: (
        <p>
          Refunds for plans already in use are decided case by case, for example after a long outage
          you reported. The operator may offer extra time instead.
        </p>
      ),
    },
    {
      id: 'charges',
      title: 'Charged twice, or charged without access',
      body: (
        <p>
          We check every payment directly with Paystack. If you were charged twice for one order,
          the extra charge is refunded. If you paid and didn&apos;t get access, contact support with
          your order reference (NFX-…).
        </p>
      ),
    },
    {
      id: 'paid',
      title: 'How refunds are paid',
      body: (
        <ul>
          <li>Refunds go back to the original payment method through Paystack.</li>
          <li>Each refund is approved by a second member of staff.</li>
          <li>How long it takes to reach you depends on your bank.</li>
        </ul>
      ),
    },
    {
      id: 'cancelling',
      title: 'Cancelling',
      body: (
        <p>
          Plans don&apos;t renew automatically, so there is nothing to cancel: unused time simply
          ends. To request a refund or report a problem, use the{' '}
          <Link href="/contact">help page</Link> or your account.
        </p>
      ),
    },
  ];

  return (
    <LegalDoc
      title="Refunds and cancellations"
      lede="When you can get your money back, and how it reaches you."
      updated={site.policiesUpdated}
      reviewed={site.legalReviewed}
      points={POINTS}
      sections={sections}
      contact={{ name: who, email: p?.supportEmail, phone: p?.supportPhone }}
    />
  );
}
