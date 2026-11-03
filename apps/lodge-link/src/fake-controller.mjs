/**
 * TEST DOUBLE: an in-memory Omada controller speaking the same JSON as the real
 * one (hotspot login, extPortal/auth, Open API). Used by tests only; it enforces
 * nothing on any network.
 */
export const TEST_UNAUTH_PATH =
  '/openapi/v1/{omadacId}/sites/{siteId}/hotspot/clients/{clientMac}/unauth';

export function fakeController({
  version = '5.15.8',
  omadacId = 'abc123',
  site = 'ND Lodge',
} = {}) {
  const st = {
    up: true,
    operator: { name: 'netflex-link', password: 'op-pass' },
    sessions: new Set(),
    csrf: new Set(),
    /** clientMac (AA-BB-…) → { time, apMac, ssidName, radioId, site, at } */
    authorized: new Map(),
    /** Devices on the Wi-Fi: clientMac → apMac */
    connected: new Map(),
    calls: /** @type {string[]} */ ([]),
    refuse: /** @type {Set<string>} */ (new Set()),
  };
  const ok = (result, setCookie = []) => ({
    status: 200,
    json: { errorCode: 0, msg: 'Success.', result },
    setCookie,
  });
  const err = (code, msg) => ({ status: 200, json: { errorCode: code, msg }, setCookie: [] });

  /** @param {{ method: string, url: URL, body?: any, headers: Record<string,string> }} r */
  async function request(r) {
    if (!st.up)
      throw Object.assign(new Error('controller unreachable: ECONNREFUSED'), {
        name: 'OmadaError',
      });
    const p = r.url.pathname;
    st.calls.push(`${r.method} ${p}`);
    const cookie = (r.headers.cookie ?? '').split('=')[1];
    if (p === '/api/info') return ok({ omadacId, controllerVer: version, apiVer: '3' });
    if (p === `/${omadacId}/api/v2/hotspot/login`) {
      if (r.body?.name !== st.operator.name || r.body?.password !== st.operator.password)
        return err(-30109, 'Invalid username or password.');
      const sid = `s${st.sessions.size + 1}`;
      const token = `t${st.sessions.size + 1}`;
      st.sessions.add(sid);
      st.csrf.add(token);
      return ok({ token }, [`TPOMADA_SESSIONID=${sid}; Path=/; HttpOnly`]);
    }
    if (p === `/${omadacId}/api/v2/hotspot/extPortal/auth`) {
      if (!st.sessions.has(cookie) || !st.csrf.has(r.headers['csrf-token']))
        return err(-1, 'Login required.');
      if (st.refuse.has(r.body.clientMac)) return err(-41501, 'Client not found.');
      st.authorized.set(r.body.clientMac, { ...r.body, at: Date.now() });
      return ok(undefined);
    }
    if (p === '/openapi/authorize/token') return ok({ accessToken: 'AT-1', expiresIn: 7200 });
    if (p.startsWith(`/openapi/v1/${omadacId}/`)) {
      if (r.headers.authorization !== 'AccessToken=AT-1')
        return err(-44112, 'Access token invalid.');
      if (p === `/openapi/v1/${omadacId}/sites`)
        return ok({ data: [{ siteId: 'site-1', name: site }] });
      if (p === `/openapi/v1/${omadacId}/sites/site-1/clients`)
        return ok({
          data: [...st.connected].map(([mac, apMac]) => ({
            mac,
            apMac,
            ip: '10.0.0.9',
            authStatus: st.authorized.has(mac) ? 2 : 0,
            uptime: 120,
          })),
        });
      const m = p.match(/\/sites\/site-1\/hotspot\/clients\/([^/]+)\/unauth$/);
      if (m) {
        st.authorized.delete(decodeURIComponent(m[1] ?? ''));
        return ok(undefined);
      }
    }
    return { status: 404, json: null, setCookie: [] };
  }
  return { request, state: st };
}
