import Link from 'next/link';
import { DraftPolicyNotice, PageHead } from '@/components/ui';
import { site } from '@/lib/site';

export const metadata = {
  title: 'Refunds and cancellations',
  alternates: { canonical: '/legal/refunds' },
};

export default function Refunds() {
  return (
    <div className="container prose">
      <PageHead
        eyebrow="Legal"
        title="Refunds and cancellations"
        lede={site.policiesUpdated ? `Last updated ${site.policiesUpdated}` : undefined}
      />
      <DraftPolicyNotice reviewed={site.legalReviewed} />
      <p>
        Each plan also shows its own refund terms before you pay. Where they differ, the terms shown
        for your plan apply.
      </p>
      <h2>Before you start using it</h2>
      <p>
        If you haven&apos;t used your voucher code yet, you can ask for a full refund. Once the
        refund is confirmed, the unused code stops working.
      </p>
      <h2>After it has started</h2>
      <p>
        Refunds for plans already in use are decided case by case, for example after a long outage
        you reported. The operator may offer extra time instead.
      </p>
      <h2>Charged twice, or charged without access</h2>
      <p>
        We check every payment directly with Paystack. If you were charged twice for one order, the
        extra charge is refunded. If you paid and didn&apos;t get access, contact support with your
        order reference (NFX-…).
      </p>
      <h2>How refunds are paid</h2>
      <ul>
        <li>Refunds go back to the original payment method through Paystack.</li>
        <li>Each refund is approved by a second member of staff.</li>
        <li>How long it takes to reach you depends on your bank.</li>
      </ul>
      <h2>Cancelling</h2>
      <p>
        Plans don&apos;t renew automatically, so there is nothing to cancel: unused time simply
        ends. To request a refund or report a problem, use the{' '}
        <Link href="/contact">help page</Link> or your account.
      </p>
    </div>
  );
}
