import Link from 'next/link';
import { HOME_FAQ } from '@/lib/faq';
import { Reveal } from './Reveal';

export function FaqPreview() {
  return (
    <section className="mk-section mk-faq" aria-labelledby="faq-title">
      <div className="container">
        <Reveal className="mk-head mk-head--center">
          <p className="mk-eyebrow">Questions</p>
          <h2 id="faq-title" className="mk-title">
            Good to know.
          </h2>
        </Reveal>
        <Reveal className="mk-faq__list">
          {HOME_FAQ.map(([q, a]) => (
            <details key={q} className="mk-faq__item">
              <summary>
                <span>{q}</span>
                <span className="mk-faq__sign" aria-hidden="true" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </Reveal>
        <Reveal className="mk-account__cta">
          <Link href="/faq" className="mk-link">
            All questions and answers
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
