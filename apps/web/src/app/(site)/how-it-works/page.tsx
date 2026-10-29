import Link from 'next/link';
import { PageHead } from '@/components/ui';

export const metadata = { title: 'How it works', alternates: { canonical: '/how-it-works' } };

export default function HowItWorks() {
  return (
    <div className="container">
      <PageHead
        eyebrow="Getting online"
        title="How it works"
        lede="Four steps, no account required for a personal plan."
      />
      <ol className="steps">
        <li>
          <div>
            <h2 className="h3">Join the property Wi-Fi</h2>
            <p>
              Select the property network on your phone or laptop. The sign-in page opens
              automatically. If it doesn&apos;t, open your browser and visit any website.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h2 className="h3">Choose a plan, or enter a voucher</h2>
            <p>
              Every plan shows its price, how long it lasts, when the time starts, how many devices
              it covers and its refund terms before you pay.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h2 className="h3">Pay securely</h2>
            <p>
              Payments are handled by Paystack. We never see your card details. Your access starts
              only after Paystack confirms the payment to us directly.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h2 className="h3">Get your code and connect</h2>
            <p>
              You receive a voucher code. On the Wi-Fi sign-in page it&apos;s applied to your
              device, and we tell you as soon as the network confirms you&apos;re connected.
            </p>
          </div>
        </li>
      </ol>

      <section className="section">
        <h2>Room and floor plans</h2>
        <p>
          A resident authorised by the property office can buy a plan for their whole room or floor
          and add the people who live there. Each person uses their own devices, within the
          plan&apos;s device limit. Knowing the code isn&apos;t enough: only added residents can use
          it.
        </p>
        <h2>Changing phones</h2>
        <p>
          If you get a new phone, free up a device slot from{' '}
          <Link href="/account">your account</Link> and connect the new one. Some phones use a
          different private address on each network. If yours is refused unexpectedly, turn off
          &quot;private Wi-Fi address&quot; for this network.
        </p>
        <div className="actions">
          <Link className="button" href="/plans">
            See plans
          </Link>
        </div>
      </section>
    </div>
  );
}
