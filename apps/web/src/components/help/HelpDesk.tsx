'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { FAQ, faqId } from '@/lib/faq';

type Topic = {
  id: string;
  label: string;
  hint: string;
  icon: string;
  /** FAQ question to show as "Try this first". */
  tip?: string;
  extraLink?: { href: string; label: string };
};

const TOPICS: Topic[] = [
  {
    id: 'CONNECTIVITY',
    label: 'Can’t connect or slow',
    hint: 'Refused, dropping or slow',
    icon: 'M12 18.5h.01M8.5 15a5 5 0 0 1 5.6-1M5.5 12a9.2 9.2 0 0 1 4.3-2.3M15.5 10.3A9.2 9.2 0 0 1 18.5 12M2.5 9a13.4 13.4 0 0 1 4.2-2.7M11 5.5a13.4 13.4 0 0 1 10.5 3.5M3.5 3.5l17 17',
    tip: 'My phone was refused after I changed something.',
    extraLink: { href: '/coverage', label: 'What affects speed' },
  },
  {
    id: 'OUTAGE',
    label: 'Report an outage',
    hint: 'Nobody can get online',
    icon: 'M12 3.5 2.5 20.5h19zM12 10v4.5M12 17.5h.01',
    tip: 'How do I report an outage?',
  },
  {
    id: 'PAYMENT',
    label: 'Payment',
    hint: 'Paid but not connected',
    icon: 'M3.5 6.5h17v11h-17zM3.5 10h17M7 14.5h3',
    tip: 'I paid but I am not connected yet.',
  },
  {
    id: 'VOUCHER',
    label: 'Voucher code',
    hint: 'Lost or not working',
    icon: 'M5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5A1.5 1.5 0 0 1 5.5 6zM14.5 6.5v1.5M14.5 11.25v1.5M14.5 16v1.5',
    tip: 'I lost my voucher code.',
  },
  {
    id: 'ACCOUNT',
    label: 'My account',
    hint: 'Sign-in, plans, devices',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.3 4-5 7.5-5s6.3 1.7 7.5 5',
    tip: 'Do I need an account?',
  },
  {
    id: 'OTHER',
    label: 'Something else',
    hint: 'Anything we missed',
    icon: 'M4 5.5h16v10H9l-5 4zM8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01',
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export function HelpDesk({ propertySlug, signedIn }: { propertySlug: string; signedIn: boolean }) {
  const [topicId, setTopicId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const topic = TOPICS.find((t) => t.id === topicId) ?? null;
  const tip = topic?.tip ? FAQ.find(([q]) => q === topic.tip) : undefined;

  const choose = (id: string) => {
    setTopicId(id);
    setState('idle');
    setError(null);
    // bring the panel into view on small screens
    requestAnimationFrame(() =>
      panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    );
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!topic) return;
    const f = new FormData(e.currentTarget);
    setState('sending');
    setError(null);
    try {
      await api('/support/tickets', {
        method: 'POST',
        body: {
          propertySlug,
          category: topic.id,
          subject: String(f.get('subject') ?? ''),
          body: String(f.get('body') ?? ''),
          ...(signedIn ? {} : { contactPhone: String(f.get('phone') ?? '') }),
        },
      });
      setState('sent');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send. Please try again.');
      setState('idle');
    }
  }

  return (
    <div className="desk">
      <fieldset className="desk__topics">
        <legend className="desk__legend">
          <span className="desk__step">1</span>
          What’s going on?
        </legend>
        <div className="desk__grid">
          {TOPICS.map((t) => (
            <label key={t.id} className="desk__topic" data-on={t.id === topicId}>
              <input
                type="radio"
                name="topic"
                value={t.id}
                checked={t.id === topicId}
                onChange={() => choose(t.id)}
              />
              <span className="desk__topic-icon">
                <Icon d={t.icon} />
              </span>
              <span className="desk__topic-text">
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div ref={panel} className="desk__panel" data-open={Boolean(topic)} aria-live="polite">
        {topic ? (
          <div key={topic.id} className="desk__panel-inner">
            <div className="desk__tip">
              <p className="desk__eyebrow">Try this first</p>
              {tip ? (
                <>
                  <h2 className="desk__tip-title">{tip[0]}</h2>
                  <p className="desk__tip-body">{tip[1]}</p>
                  <div className="desk__tip-links">
                    <Link href={`/faq#${faqId(tip[0])}`}>Open in the FAQ</Link>
                    {topic.extraLink ? (
                      <Link href={topic.extraLink.href}>{topic.extraLink.label}</Link>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <h2 className="desk__tip-title">Tell us what you need.</h2>
                  <p className="desk__tip-body">
                    Browse the FAQ for quick answers, or send a message and the lodge team will get
                    back to you.
                  </p>
                  <div className="desk__tip-links">
                    <Link href="/faq">Browse the FAQ</Link>
                  </div>
                </>
              )}
            </div>

            <div className="desk__compose">
              {state === 'sent' ? (
                <div className="desk__sent" role="status">
                  <span className="desk__sent-mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M5 12.5 10 17.5 19 7" />
                    </svg>
                  </span>
                  <h2 className="desk__compose-title">Message sent</h2>
                  <p>
                    Thanks. The lodge team will get back to you
                    {signedIn ? '. You can follow it in your account.' : ' on the number you gave.'}
                  </p>
                  <button type="button" className="desk__again" onClick={() => setState('idle')}>
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => void submit(e)} noValidate>
                  <p className="desk__legend desk__legend--inline">
                    <span className="desk__step">2</span>
                    Still stuck? Message us
                  </p>
                  <p className="desk__topic-chip">
                    <span className="desk__topic-chip-icon">
                      <Icon d={topic.icon} />
                    </span>
                    {topic.label}
                  </p>
                  {error ? (
                    <p className="desk__error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <div className="desk__field">
                    <label htmlFor="desk-subject">Short summary</label>
                    <input
                      id="desk-subject"
                      name="subject"
                      required
                      minLength={3}
                      maxLength={160}
                      autoComplete="off"
                      placeholder="e.g. No signal in room G1"
                    />
                  </div>
                  <div className="desk__field">
                    <label htmlFor="desk-body">Details</label>
                    <textarea
                      id="desk-body"
                      name="body"
                      required
                      minLength={10}
                      maxLength={4000}
                      aria-describedby="desk-body-hint"
                      placeholder="Your room, what happened and when."
                    />
                    <span className="desk__hint" id="desk-body-hint">
                      Don’t include card numbers or your voucher code.
                    </span>
                  </div>
                  {!signedIn ? (
                    <div className="desk__field">
                      <label htmlFor="desk-phone">Phone number for a reply</label>
                      <input
                        id="desk-phone"
                        name="phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        required
                        placeholder="0803 000 0000"
                      />
                    </div>
                  ) : null}
                  <button className="desk__send" type="submit" disabled={state === 'sending'}>
                    {state === 'sending' ? 'Sending…' : 'Send message'}
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
                    </svg>
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : (
          <p className="desk__placeholder">Choose a topic above to see the quickest fix.</p>
        )}
      </div>
    </div>
  );
}
