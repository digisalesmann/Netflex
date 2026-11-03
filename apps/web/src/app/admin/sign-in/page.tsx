import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StaffSignIn, type Step } from '@/components/admin/StaffSignIn';
import { Logo } from '@/components/Logo';
import type { StaffMe } from '@/lib/admin';
import { serverApi } from '@/lib/server-api';
import { site } from '@/lib/site';

export const metadata = { title: 'Office sign-in', robots: { index: false, follow: false } };

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminSignInPage({ searchParams }: { searchParams: Params }) {
  const q = await searchParams;
  const next = typeof q.next === 'string' && q.next.startsWith('/admin') ? q.next : '/admin';

  // Resume a half-finished sign-in (two-step or password change) instead of starting over.
  const me = await serverApi<StaffMe>('/me', { auth: true });
  let start: Step = 'login';
  if (me.data?.user.kind === 'STAFF') {
    if (!me.data.session.mfaSatisfied) start = me.data.user.mfaEnabled ? 'verify' : 'enroll';
    else if (me.data.user.mustChangePassword) start = 'password';
    else redirect(next);
  }

  return (
    <main id="main" className="auth">
      <aside className="auth__art" aria-hidden="true">
        <img src="/media/hero/night-sky-poster.jpg" alt="" width={1600} height={900} />
        <div className="auth__art-copy">
          <p className="auth__art-eyebrow">Office</p>
          <p className="auth__art-title">Run the lodge Wi-Fi.</p>
          <p className="auth__art-lede">
            Residents, plans, vouchers, payments and the network, in one place.
          </p>
        </div>
      </aside>
      <div className="auth__panel">
        <div className="auth__inner">
          <Link href="/" className="auth__logo" aria-label={`${site.brand} home`}>
            <Logo decorative />
          </Link>
          <StaffSignIn start={start} next={next} />
          <p className="auth__foot">
            Lost your phone or password? Ask the platform owner to reset your sign-in.
          </p>
        </div>
      </div>
    </main>
  );
}
