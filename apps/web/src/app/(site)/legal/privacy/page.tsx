import { LegalDoc, type LegalPoint, type LegalSection } from '@/components/legal/LegalDoc';
import { getProperty } from '@/lib/property';
import { site } from '@/lib/site';

export const metadata = { title: 'Privacy policy', alternates: { canonical: '/legal/privacy' } };

const POINTS: LegalPoint[] = [
  {
    title: 'Only what runs the service',
    body: 'Your phone number, purchases and device address, used to switch your access on and off.',
  },
  {
    title: 'Card details stay with Paystack',
    body: 'Paystack handles card and bank details. We never receive them.',
  },
  {
    title: 'No selling, no ads',
    body: 'We don’t sell your data, use it for advertising or inspect what you browse.',
  },
  {
    title: 'Your data, your call',
    body: 'Download your data or ask for it to be erased from your account.',
  },
];

export default async function Privacy() {
  const p = await getProperty();
  const who = p?.name ?? 'the property operator';

  const sections: LegalSection[] = [
    {
      id: 'collect',
      title: 'What we collect',
      body: (
        <>
          <p>
            This explains what personal data the {site.brand} Wi-Fi service at {who} collects, why,
            how long it is kept and your rights. {who} is responsible for your data.
          </p>
          <ul>
            <li>
              <strong>Contact details:</strong> your phone number and the name you give, used for
              sign-in, receipts and support.
            </li>
            <li>
              <strong>Residence details</strong> (residents only): the room you live in and the
              dates, recorded by the property office, to decide who can use room and floor plans.
            </li>
            <li>
              <strong>Purchases:</strong> what you bought, when, the amount and the payment
              reference. Card and bank details are handled by Paystack; we never receive them.
            </li>
            <li>
              <strong>Device and connection data:</strong> your device&apos;s network (MAC) address,
              the IP address it is given, when sessions start and end and, where the equipment
              reports it, data usage. This is needed to switch your access on and off and to enforce
              device limits.
            </li>
            <li>
              <strong>Security records:</strong> sign-in times, the device type that signed in, and
              a log of account and staff actions.
            </li>
            <li>
              <strong>Messages</strong> you send to support.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'why',
      title: 'Why we use it',
      body: (
        <>
          <ul>
            <li>To provide the access you paid for, and to stop it when it ends.</li>
            <li>To take and confirm payments, issue receipts and handle refunds.</li>
            <li>To keep the service and your account secure and prevent abuse.</li>
            <li>To answer your questions and fix problems.</li>
            <li>To meet legal, tax and accounting obligations.</li>
          </ul>
          <p>
            We do not sell your data or use it for advertising. We do not inspect the content of
            your browsing.
          </p>
        </>
      ),
    },
    {
      id: 'sharing',
      title: 'Who we share it with',
      body: (
        <ul>
          <li>
            <strong>Paystack</strong>, to process payments and refunds.
          </li>
          <li>
            <strong>Our hosting and SMS providers</strong>, who store or deliver data on our behalf
            under contract (to be named before launch).
          </li>
          <li>Authorities, where the law requires it.</li>
        </ul>
      ),
    },
    {
      id: 'keeping',
      title: 'How long we keep it',
      body: (
        <p>
          Payment and accounting records are kept for as long as the law requires. Connection
          records are kept for a limited period and then deleted. The exact periods will be set by
          the operator before launch and published here.
        </p>
      ),
    },
    {
      id: 'rights',
      title: 'Your rights',
      body: (
        <p>
          Under applicable Nigerian data protection law, including the Nigeria Data Protection Act
          2023, you can ask to access, correct or erase your data, object to some uses, or complain
          to the Nigeria Data Protection Commission. From your account you can download your data
          and request erasure. Some records, such as payments, must be kept even after you ask.
        </p>
      ),
    },
  ];

  return (
    <LegalDoc
      title="Privacy policy"
      lede="What we collect, why we need it, how long we keep it and your rights."
      updated={site.policiesUpdated}
      reviewed={site.legalReviewed}
      points={POINTS}
      sections={sections}
      contact={{ name: who, email: p?.supportEmail, phone: p?.supportPhone }}
    />
  );
}
