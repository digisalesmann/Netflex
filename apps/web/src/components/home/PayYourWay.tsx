import Link from 'next/link';
import { Reveal } from './Reveal';

const POINTS = [
  {
    title: 'Secure checkout by Paystack',
    body: 'You pay on Paystack’s checkout page. Your card and bank details go to Paystack, never to us.',
    icon: 'M6.5 10.5V8a5.5 5.5 0 0 1 11 0v2.5M5 10.5h14v10H5zM12 14.5v2.5',
  },
  {
    title: 'Access only after payment is confirmed',
    body: 'Your plan switches on once Paystack confirms the payment, so nothing starts before it’s paid.',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12.2l2.4 2.4 4.6-4.8',
  },
  {
    title: 'Vouchers from the front desk',
    body: 'Got a voucher code? Enter it on the Wi-Fi sign-in page. No online payment needed.',
    icon: 'M5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5A1.5 1.5 0 0 1 5.5 6zM14.5 6.5v1.5M14.5 11.25v1.5M14.5 16v1.5',
  },
  {
    title: 'Receipts and clear refunds',
    body: 'Every purchase has a receipt in your account, and refunds follow the terms shown before you pay.',
    icon: 'M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 8.5h6M9 12h6M9 15.5h3.5',
  },
];

/** Photo: supplied by the owner (media/photos/lady2.jpeg). */
export function PayYourWay() {
  return (
    <section className="mk-section mk-pay" aria-labelledby="pay-title">
      <div className="container mk-split mk-split--media mk-split--reverse">
        <div>
          <Reveal className="mk-head">
            <p className="mk-eyebrow">Payments</p>
            <h2 id="pay-title" className="mk-title">
              Pay your way, securely.
            </h2>
            <p className="mk-lede">
              Buy on the Wi-Fi sign-in page or from your account through Paystack&apos;s secure
              checkout, or skip paying online with a voucher from the front desk.
            </p>
          </Reveal>
          <ul className="mk-points">
            {POINTS.map((p, i) => (
              <Reveal as="li" key={p.title} delay={i * 90}>
                <span className="mk-points__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d={p.icon} />
                  </svg>
                </span>
                <span>
                  <strong className="mk-points__title">{p.title}</strong>
                  <span className="mk-points__body">{p.body}</span>
                </span>
              </Reveal>
            ))}
          </ul>
          <Reveal className="mk-split__foot">
            <Link href="/legal/refunds" className="mk-link">
              Read the refund policy
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
              </svg>
            </Link>
          </Reveal>
        </div>
        <Reveal className="mk-media" delay={120}>
          <figure className="mk-photo mk-photo--lady2">
            <img
              src="/media/photos/lady2.jpeg"
              alt="A woman in a mint jacket holding her phone, wearing wireless earbuds."
              width={736}
              height={976}
              loading="lazy"
              decoding="async"
            />
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
