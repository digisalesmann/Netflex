import Link from 'next/link';
import { SignIn } from '@/components/account/SignIn';
import { Notice } from '@/components/ui';
import { site } from '@/lib/site';

export const metadata = { title: 'Sign in', robots: { index: false, follow: false } };

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: Params }) {
  const q = await searchParams;
  const next = typeof q.next === 'string' && q.next.startsWith('/account') ? q.next : '/account';
  return (
    <main id="main" className="container narrow portal">
      <p className="eyebrow">
        <Link href="/">{site.brand}</Link>
      </p>
      <h1>Sign in</h1>
      {q.staff ? (
        <Notice tone="warn">
          <p>Staff accounts use the admin portal, not the resident account pages.</p>
        </Notice>
      ) : null}
      <SignIn next={next} />
      <p className="small muted" style={{ marginTop: 'var(--nf-space-6)' }}>
        No account needed for a personal plan: buy it on the Wi-Fi sign-in page.
      </p>
    </main>
  );
}
