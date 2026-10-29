import Link from 'next/link';
import { DraftPolicyNotice, PageHead } from '@/components/ui';
import { getProperty } from '@/lib/property';
import { site } from '@/lib/site';

export const metadata = { title: 'Terms of service', alternates: { canonical: '/legal/terms' } };

export default async function Terms() {
  const p = await getProperty();
  const who = p?.name ?? 'the property operator';
  return (
    <div className="container prose">
      <PageHead
        eyebrow="Legal"
        title="Terms of service"
        lede={site.policiesUpdated ? `Last updated ${site.policiesUpdated}` : undefined}
      />
      <DraftPolicyNotice reviewed={site.legalReviewed} />
      <p>
        These terms apply when you use the {site.brand} Wi-Fi service provided by {who}.
      </p>
      <h2>The service</h2>
      <ul>
        <li>
          You buy time-based access. Each plan states its price, duration, when the time starts,
          device and session limits, any speed cap and its refund terms before you pay. Those terms
          are fixed for your purchase.
        </li>
        <li>
          Access is delivered over a shared satellite connection. We do not guarantee any speed,
          uninterrupted service, or coverage in every room.
        </li>
        <li>
          Your plan&apos;s time keeps running during outages. For long outages, contact support: the
          operator may extend your plan at its discretion.
        </li>
      </ul>
      <h2>Voucher codes</h2>
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
          Room and floor plans may be used only by residents the buyer adds. Sharing a code outside
          that group may lead to suspension.
        </li>
      </ul>
      <h2>Acceptable use</h2>
      <p>
        Do not use the service for anything illegal, to attack or disrupt other networks or users,
        or to resell access. We may suspend access that breaks these terms, and will tell you why
        when we can.
      </p>
      <h2>Payments and refunds</h2>
      <p>
        Payments are processed by Paystack. Access starts only after the payment is confirmed.
        Refunds follow the <Link href="/legal/refunds">refund and cancellation policy</Link>.
      </p>
      <h2>Liability</h2>
      <p>
        To the extent the law allows, the operator is not liable for losses caused by interruptions,
        slow speeds or events outside its control. Nothing in these terms limits rights you have
        under consumer protection law.
      </p>
      <h2>Changes and contact</h2>
      <p>
        We may update these terms; changes don&apos;t affect plans you have already bought.
        Questions: {who}
        {p?.supportPhone ? `, ${p.supportPhone}` : ''}.
      </p>
    </div>
  );
}
