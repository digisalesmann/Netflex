import Link from 'next/link';
import { Reveal } from '@/components/home/Reveal';
import { STATE_LABEL, requireTenant, type Access } from '@/lib/account';
import { remaining, scopeLabel } from '@/lib/format';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Vouchers' };

const ENDED = ['SUBSCRIPTION_EXPIRED', 'ACCESS_REVOKED'];

const GROUPS = [
  {
    id: 'ready',
    title: 'Ready to use',
    match: (a: Access) => a.state === 'VOUCHER_AVAILABLE',
  },
  {
    id: 'inuse',
    title: 'In use',
    match: (a: Access) => a.state !== 'VOUCHER_AVAILABLE' && !ENDED.includes(a.state),
  },
] as const;

const RECOVER = [
  {
    title: 'Bought it but never used it?',
    body: 'Open the order under Orders. The payment page can show the code until you first use it.',
    link: { href: '/account/orders', label: 'Go to Orders' },
  },
  {
    title: 'Lost it after using it?',
    body: 'Your connected devices stay online. To add a new device, ask support to reissue the code. The old code then stops working.',
    link: { href: '/account/support', label: 'Ask support' },
  },
  {
    title: 'Think someone else has it?',
    body: 'Ask support to reissue it straight away, so only the new code works.',
    link: { href: '/account/support', label: 'Ask support' },
  },
];

function Ticket({ a }: { a: Access }) {
  const s = STATE_LABEL[a.state] ?? { tone: 'info' as const, label: a.state };
  const ended = ENDED.includes(a.state);
  const ready = a.state === 'VOUCHER_AVAILABLE';
  const hint = a.voucherHint ?? '••••';
  return (
    <article className="tkt" data-ended={ended} aria-labelledby={`tkt-${a.entitlementId}`}>
      <div className="tkt__main">
        <p className="tkt__eyebrow">Voucher · {scopeLabel[a.scope]}</p>
        <h3 id={`tkt-${a.entitlementId}`} className="tkt__plan">
          {a.planName}
        </h3>
        <p className="tkt__code" aria-label={`Code ending ${hint.split('').join(' ')}`}>
          <span aria-hidden="true">••••–••••–</span>
          <strong>{hint}</strong>
        </p>
        <dl className="tkt__facts">
          <div>
            <dt>Devices</dt>
            <dd>
              {a.devices.inUse} of {a.devices.limit}
            </dd>
          </div>
          <div>
            <dt>{ready ? 'Use by' : ended ? 'Ended' : 'Time left'}</dt>
            <dd>
              {ready
                ? (a.activateBy ?? '—')
                : ended
                  ? (a.expiresAtLocal ?? '—')
                  : remaining(a.remainingSeconds)}
            </dd>
          </div>
        </dl>
      </div>
      <div className="tkt__stub">
        <p className={`tkt__state tkt__state--${s.tone}`}>
          <span aria-hidden="true" />
          {ready ? 'Ready to use' : s.label}
        </p>
        {!ended ? (
          <Link href={`/account/access/${a.entitlementId}`} className="tkt__manage">
            Manage
            <span className="visually-hidden"> {a.planName}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
            </svg>
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export default async function Vouchers() {
  await requireTenant('/account/voucher');
  const access = (await serverApi<Access[]>('/me/access', { auth: true })).data ?? [];
  const ended = access.filter((a) => ENDED.includes(a.state));
  return (
    <>
      <header className="acct-page-head">
        <h1 className="acct-hello__title">Vouchers</h1>
        <p className="acct-hello__where">
          Your codes connect devices on the Wi-Fi sign-in page. For your security a code is shown
          only once, so here you&apos;ll see just its last characters.
        </p>
      </header>

      {access.length === 0 ? (
        <div className="acct-empty">
          <p className="acct-empty__title">No vouchers yet.</p>
          <p className="acct-empty__body">
            Buy a plan to get a voucher code, or enter one from the front desk on the Wi-Fi sign-in
            page.
          </p>
          <div className="acct-plan__actions">
            <Link href="/account/plans" className="acct-btn acct-btn--solid">
              Choose a plan
            </Link>
            <Link href="/connect" className="acct-btn">
              Enter a voucher
            </Link>
          </div>
        </div>
      ) : (
        GROUPS.map((g) => {
          const items = access.filter(g.match);
          if (!items.length) return null;
          return (
            <section key={g.id} className="tkt-group" aria-labelledby={`grp-${g.id}`}>
              <h2 id={`grp-${g.id}`} className="acct-label">
                {g.title} <span className="tkt-group__n">{items.length}</span>
              </h2>
              <ul className="tkt-grid">
                {items.map((a) => (
                  <li key={a.entitlementId}>
                    <Ticket a={a} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {ended.length ? (
        <section className="tkt-group">
          <details className="mk-faq__item tkt-ended">
            <summary>
              <span>Ended ({ended.length})</span>
              <span className="mk-faq__sign" aria-hidden="true" />
            </summary>
            <ul className="tkt-grid">
              {ended.map((a) => (
                <li key={a.entitlementId}>
                  <Ticket a={a} />
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      {access.length ? (
        <section className="tkt-use" aria-labelledby="use-title">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 18.5h.01M8.5 15a5 5 0 0 1 7 0M5.5 12a9.2 9.2 0 0 1 13 0M2.5 9a13.4 13.4 0 0 1 19 0" />
          </svg>
          <div>
            <h2 id="use-title" className="tkt-use__title">
              Have a voucher code?
            </h2>
            <p>Join the lodge Wi-Fi and enter it on the sign-in page to connect a device.</p>
          </div>
          <Link href="/connect" className="acct-btn acct-btn--solid">
            Enter a voucher
          </Link>
        </section>
      ) : null}

      <section className="mk-fair__grid tkt-recover" aria-labelledby="recover-title">
        <Reveal className="mk-head mk-fair__head">
          <p className="mk-eyebrow">Lost a code?</p>
          <h2 id="recover-title" className="tkt-recover__title">
            Recovering a code
          </h2>
          <p className="mk-lede">Codes can be recovered or replaced. Here&apos;s how.</p>
        </Reveal>
        <ol className="mk-fair__list">
          {RECOVER.map((r, i) => (
            <Reveal as="li" key={r.title} delay={i * 80}>
              <span className="mk-fair__n" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="mk-fair__title">{r.title}</h3>
                <p className="mk-fair__body">{r.body}</p>
                <Link href={r.link.href} className="mk-fair__link">
                  {r.link.label}
                </Link>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>
    </>
  );
}
