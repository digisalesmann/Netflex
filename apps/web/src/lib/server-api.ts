import { cookies, headers } from 'next/headers';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Server-side API read. Forwards the visitor's cookie for account pages. Returns null on any failure. */
export async function serverApi<T>(
  path: string,
  opts: { auth?: boolean; revalidate?: number } = {},
): Promise<{ status: number; data: T | null }> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (opts.auth) {
    const c = (await cookies()).toString();
    if (c) h.Cookie = c;
    const fwd = (await headers()).get('x-forwarded-for');
    if (fwd) h['X-Forwarded-For'] = fwd;
  }
  try {
    const res = await fetch(`${API}/api/v1${path}`, {
      headers: h,
      ...(opts.auth
        ? { cache: 'no-store' as const }
        : { next: { revalidate: opts.revalidate ?? 60 } }),
    });
    const json = (await res.json().catch(() => null)) as { data?: T } | null;
    return { status: res.status, data: res.ok ? (json?.data ?? null) : null };
  } catch {
    return { status: 0, data: null };
  }
}
