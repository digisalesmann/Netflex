import Link from 'next/link';
import { Reveal } from './Reveal';

/** Every line here is backed by the product or the published policies. */
const PROMISES = [
  {
    title: 'One price, nothing added',
    body: 'Prices include everything you pay to us. No sign-up fee and nothing extra at checkout.',
    link: { href: '/plans', label: 'See plans and prices' },
  },
  {
    title: 'The terms, before you pay',
    body: 'How long it lasts, how many devices, when time starts and the refund policy are on every plan before you buy.',
    link: { href: '/legal/refunds', label: 'Refund policy' },
  },
  {
    title: 'Your data stays yours',
    body: 'We don’t sell your data or use it for advertising, and we don’t look at what you browse. Download your data or ask for it to be erased from your account settings.',
    link: { href: '/legal/privacy', label: 'Privacy policy' },
  },
  {
    title: 'Help from the lodge team',
    body: 'Raise a request from your account or the help page and the property team follows it up.',
    link: { href: '/contact', label: 'Contact and support' },
  },
];

export function FairPlay() {
  return (
    <section className="mk-section mk-fair" aria-labelledby="fair-title">
      <div className="container mk-fair__grid">
        <Reveal className="mk-head mk-fair__head">
          <p className="mk-eyebrow">Fair by design</p>
          <h2 id="fair-title" className="mk-title">
            Nothing hidden in the fine print.
          </h2>
          <p className="mk-lede">
            Everything that matters is in plain view, before you pay and after.
          </p>
        </Reveal>
        <ol className="mk-fair__list">
          {PROMISES.map((p, i) => (
            <Reveal as="li" key={p.title} delay={i * 80}>
              <span className="mk-fair__n" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="mk-fair__title">{p.title}</h3>
                <p className="mk-fair__body">{p.body}</p>
                <Link href={p.link.href} className="mk-fair__link">
                  {p.link.label}
                </Link>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
