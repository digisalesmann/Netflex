import Link from 'next/link';
import { SignIn } from '@/components/account/SignIn';
import { Logo } from '@/components/Logo';
import { Notice } from '@/components/ui';
import { site } from '@/lib/site';

export const metadata = { title: 'Sign in', robots: { index: false, follow: false } };

type Params = Promise<Record<string, string | string[] | undefined>>;

const PERKS = [
  {
    text: 'See time left and connected devices',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  },
  { text: 'Renew without losing time', icon: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4' },
  {
    text: 'Room and floor plans for your housemates',
    icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 15c1.6.8 2.6 2.4 3 5',
  },
  {
    text: 'Every receipt in one place',
    icon: 'M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 8.5h6M9 12h6M9 15.5h3.5',
  },
];

export default async function SignInPage({ searchParams }: { searchParams: Params }) {
  const q = await searchParams;
  const next = typeof q.next === 'string' && q.next.startsWith('/account') ? q.next : '/account';
  return (
    <main id="main" className="auth">
      <aside className="auth__art" aria-hidden="true">
        <img src="/media/hero/night-sky-poster.jpg" alt="" width={1600} height={900} />
        <div className="auth__art-copy">
          <p className="auth__art-eyebrow">My account</p>
          <p className="auth__art-title">Your Wi-Fi, in your pocket.</p>
          <p className="auth__art-lede">
            Everything about your connection at the lodge, wherever you are.
          </p>
          <ul>
            {PERKS.map((p) => (
              <li key={p.text}>
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d={p.icon} />
                </svg>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="auth__panel">
        <div className="auth__inner">
          <Link href="/" className="auth__logo" aria-label={`${site.brand} home`}>
            <Logo decorative />
          </Link>
          <h1 className="auth__title">Sign in</h1>
          <p className="auth__lede">
            Sign in with your email. We&apos;ll send you a code, so there&apos;s no password to
            remember.
          </p>
          {q.staff ? (
            <Notice tone="warn">
              <p>Staff accounts use the admin portal, not the resident account pages.</p>
            </Notice>
          ) : null}
          <SignIn next={next} />
          <p className="auth__foot">
            No account needed for a personal plan: buy it on the Wi-Fi sign-in page.
          </p>
        </div>
      </div>
    </main>
  );
}
