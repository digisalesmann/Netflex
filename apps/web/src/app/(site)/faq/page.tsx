import { PageHead } from '@/components/ui';

export const metadata = { title: 'FAQ', alternates: { canonical: '/faq' } };

const QA: [string, string][] = [
  [
    'What is a voucher code?',
    'A 12-character code (like ABCD-EFGH-JKMN) that unlocks a plan you bought or were given. It works only at this property. Keep it private: anyone with the code can use your access.',
  ],
  [
    'When does my time start?',
    'Each plan says so before you pay: either when payment is confirmed, when you first enter the code, or when you first connect. Unused codes also have a "use by" date.',
  ],
  [
    'How many devices can I use?',
    'Each plan shows a device limit and how many can be online at once. To swap devices, free a slot from your account (a few times per day) or ask the property office.',
  ],
  [
    'My phone was refused after I changed something.',
    'Some phones use a private, changing Wi-Fi address. Turn off "private Wi-Fi address" (iPhone) or "randomized MAC" (Android) for this network, then reconnect.',
  ],
  [
    'I paid but I am not connected yet.',
    'After payment we confirm it with Paystack and then switch on your access. This usually takes a moment. Use "check payment" on the order page. If it still says pending, contact support with your order reference. Never pay twice.',
  ],
  [
    'I lost my voucher code.',
    'If you bought it signed in, you can retrieve it from the order page until you first use it. Otherwise contact support: the code can be cancelled and reissued.',
  ],
  [
    'Can I share a room or floor plan?',
    'Yes, with the residents the plan buyer adds. Only people who live in that room or on that floor can be added, up to the plan limit.',
  ],
  [
    'Do I need an account?',
    'Not for a personal plan: a phone number for your receipt is enough. Room and floor plans, renewals and device management need a sign-in with your phone number.',
  ],
  [
    'Is the speed guaranteed?',
    'No. The connection is shared and delivered by satellite. Speeds vary with demand, weather and where you are in the building.',
  ],
  [
    'Can I get a refund?',
    'See the refund and cancellation policy. In short: unused plans can usually be refunded; plans that have started are decided case by case.',
  ],
  [
    'How do I report an outage?',
    'Use the help page or your account. Tell us your room and what you see. If you can, include the time it started.',
  ],
];

export default function Faq() {
  return (
    <div className="container">
      <PageHead eyebrow="Help" title="Frequently asked questions" />
      <div style={{ maxWidth: 'var(--nf-layout-measure)' }}>
        {QA.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
