/** Browser-side API client: same-origin /api proxy, cookies included, CSRF header on writes. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Opts = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
};

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'x-netflex-csrf': '1' } : {}),
        ...opts.headers,
      },
      ...(opts.body !== undefined
        ? { body: JSON.stringify(opts.body) }
        : method !== 'GET'
          ? { body: '{}' }
          : {}),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'You appear to be offline. Check your connection and try again.',
    );
  }
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  } | null;
  if (!res.ok || !json || json.error) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'ERROR',
      json?.error?.message ?? 'Something went wrong. Please try again.',
      json?.error?.details,
    );
  }
  return json.data as T;
}

/** Random idempotency key for a create request (kept per attempt so retries don't duplicate). */
export function newIdempotencyKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** localStorage wrapper that never throws (private mode, captive mini-browsers). */
export const store = {
  get<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const v = JSON.parse(raw) as { value: T; expires: number };
      if (v.expires < Date.now()) {
        window.localStorage.removeItem(key);
        return null;
      }
      return v.value;
    } catch {
      return null;
    }
  },
  set<T>(key: string, value: T, ttlMs = 24 * 3600_000): void {
    try {
      window.localStorage.setItem(key, JSON.stringify({ value, expires: Date.now() + ttlMs }));
    } catch {
      /* storage unavailable: the flow still works on this page */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
