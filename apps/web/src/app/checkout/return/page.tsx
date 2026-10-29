import type { Metadata } from 'next';
import { CheckoutReturn } from '@/components/portal/CheckoutReturn';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Payment status',
  robots: { index: false, follow: false },
};

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function ReturnPage({ searchParams }: { searchParams: Params }) {
  const q = await searchParams;
  const order = Array.isArray(q.order) ? q.order[0] : q.order;
  const valid = order && /^[0-9a-f-]{36}$/i.test(order) ? order : null;
  return (
    <main id="main" className="container narrow portal">
      <p className="eyebrow">{site.brand}</p>
      <CheckoutReturn orderIdFromUrl={valid} />
    </main>
  );
}
