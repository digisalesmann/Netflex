import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the NetFlex API. The browser only talks to this site, so
 * session cookies stay first-party. The API address is read at RUNTIME
 * (API_INTERNAL_URL), so one build works in every environment. The client IP is
 * forwarded in X-Forwarded-For; the API must trust this server (TRUST_PROXY).
 */
export const dynamic = 'force-dynamic';

const FORWARD_REQUEST = [
  'content-type',
  'cookie',
  'x-netflex-csrf',
  'idempotency-key',
  'x-order-token',
  'x-request-id',
  'origin',
  'user-agent',
  'accept',
  'x-paystack-signature',
];
const FORWARD_RESPONSE = [
  'content-type',
  'set-cookie',
  'location',
  'x-request-id',
  'idempotent-replayed',
  'cache-control',
  'content-disposition',
];

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  const { path } = await ctx.params;
  const target = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, api);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const prior = req.headers.get('x-forwarded-for');
  const client = prior?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';
  if (client) headers.set('x-forwarded-for', client);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      ...(hasBody ? { body: await req.arrayBuffer() } : {}),
    });
  } catch {
    return Response.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service temporarily unavailable. Please try again shortly.',
          requestId: '',
        },
      },
      { status: 503 },
    );
  }

  const out = new Headers();
  for (const h of FORWARD_RESPONSE) {
    if (h === 'set-cookie') {
      for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
      continue;
    }
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.status === 204 ? null : await res.arrayBuffer(), {
    status: res.status,
    headers: out,
  });
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
