/**
 * Talks to the Omada controller on the lodge computer.
 *
 * Switching devices ON uses Omada's documented external-portal API (hotspot
 * operator login + extPortal/auth), which every Omada Controller 5.x/6.x has.
 * Switching OFF early and listing devices use the controller's Open API, which
 * must be enabled in the controller (Settings → Platform Integration → Open API)
 * and its paths confirmed against the controller's own API documentation; until
 * then those features report "unsupported" instead of pretending.
 */
import https from 'node:https';
import tls from 'node:tls';

/** "aa:bb:cc:dd:ee:ff" → "AA-BB-CC-DD-EE-FF" (Omada's format). */
export const toOmadaMac = (m) =>
  m
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase()
    .match(/../g)
    ?.join('-') ?? m;
/** Any MAC format → "aa:bb:cc:dd:ee:ff". */
export const toCanonicalMac = (m) =>
  String(m ?? '')
    .replace(/[^0-9a-f]/gi, '')
    .toLowerCase()
    .match(/../g)
    ?.join(':') ?? '';

/** "5.15.8.2" ≥ "6.2.10"? */
export function versionAtLeast(v, min) {
  const a = String(v ?? '')
    .split('.')
    .map((x) => Number.parseInt(x, 10) || 0);
  const b = min.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

const isLoopback = (host) => host === 'localhost' || host === '::1' || /^127\./.test(host);

export const DEFAULT_PATHS = {
  info: '/api/info',
  hotspotLogin: '/{omadacId}/api/v2/hotspot/login',
  authorize: '/{omadacId}/api/v2/hotspot/extPortal/auth',
  openApiToken: '/openapi/authorize/token?grant_type=client_credentials',
  openApiSites: '/openapi/v1/{omadacId}/sites?page=1&pageSize=100',
  openApiClients: '/openapi/v1/{omadacId}/sites/{siteId}/clients?page=1&pageSize=1000',
  // Not in Omada's public docs: set it from the controller's own Open API page on site.
  openApiUnauthorize: null,
};

export class OmadaError extends Error {}

/**
 * @param {{ url: string, operator: { name: string, password: string },
 *   openApi?: { clientId?: string, clientSecret?: string },
 *   fingerprint?: string, paths?: Record<string, string|null>,
 *   authTime?: 'duration' | 'epoch', authTimeUnit?: 'auto' | 'us' | 'ms' }} cfg
 */
export function createOmada(cfg, { request = httpsJson } = {}) {
  const base = new URL(cfg.url);
  const paths = { ...DEFAULT_PATHS, ...(cfg.paths ?? {}) };
  const state = {
    omadacId: /** @type {string|null} */ (null),
    version: /** @type {string|null} */ (null),
    cookie: '',
    csrf: '',
    loggedInAt: 0,
    openApiToken: '',
    openApiExpires: 0,
    sites: /** @type {Map<string,string>} */ (new Map()),
  };

  const fill = (p, vars = {}) =>
    p.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] ?? state[k] ?? ''));

  async function call(method, path, { body, headers = {} } = {}) {
    if (!isLoopback(base.hostname) && !cfg.fingerprint)
      throw new OmadaError('controller is not on this computer: set controller.fingerprint');
    const res = await request({
      method,
      url: new URL(path, base),
      body,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(state.cookie ? { cookie: state.cookie } : {}),
        ...headers,
      },
      fingerprint: cfg.fingerprint,
    });
    for (const c of res.setCookie) {
      const kv = c.split(';')[0];
      if (/^(TPOMADA_SESSIONID|TPEAP_SESSIONID)=/.test(kv)) state.cookie = kv;
    }
    const j = res.json;
    if (res.status >= 400 || !j || typeof j !== 'object')
      throw new OmadaError(`controller answered HTTP ${res.status}`);
    if (j.errorCode !== 0)
      throw new OmadaError(`controller error ${j.errorCode}: ${String(j.msg ?? '').slice(0, 120)}`);
    return j.result;
  }

  async function info() {
    const r = await call('GET', paths.info);
    state.omadacId = r?.omadacId ?? null;
    state.version = r?.controllerVer ?? null;
    if (!state.omadacId) throw new OmadaError('controller did not say its id');
    return { omadacId: state.omadacId, version: state.version };
  }

  async function login(force = false) {
    if (!force && state.csrf && Date.now() - state.loggedInAt < 20 * 60_000) return;
    if (!state.omadacId) await info();
    const r = await call('POST', fill(paths.hotspotLogin), {
      body: { name: cfg.operator.name, password: cfg.operator.password },
    });
    if (!r?.token) throw new OmadaError('operator sign-in gave no token');
    state.csrf = r.token;
    state.loggedInAt = Date.now();
  }

  /** Retry once after a fresh sign-in (sessions time out on the controller). */
  async function asOperator(fn) {
    await login();
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof OmadaError)) throw e;
      await login(true);
      return fn();
    }
  }

  function timeValue(untilMs) {
    const unit =
      cfg.authTimeUnit && cfg.authTimeUnit !== 'auto'
        ? cfg.authTimeUnit
        : versionAtLeast(state.version, '6.2.10')
          ? 'ms'
          : 'us';
    const ms = cfg.authTime === 'epoch' ? untilMs : Math.max(60_000, untilMs - Date.now());
    return unit === 'us' ? ms * 1000 : ms;
  }

  const openApiReady = () => !!(cfg.openApi?.clientId && cfg.openApi?.clientSecret);

  async function openApi(method, path, vars = {}, body) {
    if (!state.omadacId) await info();
    if (!state.openApiToken || Date.now() > state.openApiExpires) {
      const t = await call('POST', fill(paths.openApiToken), {
        body: {
          omadacId: state.omadacId,
          client_id: cfg.openApi?.clientId,
          client_secret: cfg.openApi?.clientSecret,
        },
      });
      state.openApiToken = t?.accessToken ?? '';
      state.openApiExpires = Date.now() + Math.max(60, Number(t?.expiresIn ?? 3600) - 60) * 1000;
      if (!state.openApiToken) throw new OmadaError('Open API gave no access token');
    }
    return call(method, fill(path, vars), {
      body,
      headers: { authorization: `AccessToken=${state.openApiToken}` },
    });
  }

  async function siteId(name) {
    if (!state.sites.size) {
      const r = await openApi('GET', paths.openApiSites);
      for (const s of r?.data ?? []) state.sites.set(s.name, s.siteId);
    }
    const id =
      state.sites.get(name) ?? (state.sites.size === 1 ? [...state.sites.values()][0] : null);
    if (!id) throw new OmadaError(`site "${name}" not found`);
    return id;
  }

  async function clients(site) {
    const sid = await siteId(site);
    const r = await openApi('GET', paths.openApiClients, { siteId: sid });
    return (r?.data ?? []).map((c) => ({
      mac: toCanonicalMac(c.mac),
      ip: typeof c.ip === 'string' ? c.ip : null,
      apMac: c.apMac ? toCanonicalMac(c.apMac) : null,
      authorized:
        typeof c.authStatus === 'number'
          ? c.authStatus === 2
          : typeof c.authorized === 'boolean'
            ? c.authorized
            : null,
      connectedSince:
        typeof c.uptime === 'number' ? new Date(Date.now() - c.uptime * 1000).toISOString() : null,
    }));
  }

  return {
    get version() {
      return state.version;
    },
    features() {
      return {
        unauthorize: openApiReady() && !!paths.openApiUnauthorize,
        listClients: openApiReady(),
      };
    },

    /** Is the controller answering, and does the operator account work? */
    async health() {
      try {
        await info();
        await login(true);
        return { reachable: true, version: state.version, detail: 'Controller answering' };
      } catch (e) {
        return {
          reachable: false,
          version: state.version,
          detail: e instanceof Error ? e.message.slice(0, 200) : 'error',
        };
      }
    },

    /** @param {{ clients: {mac:string, apMac:string, ssidName:string, radioId:number, site:string}[], untilMs: number }} p */
    async authorize(p) {
      const authorized = [];
      const failed = [];
      for (const c of p.clients) {
        try {
          await asOperator(() =>
            call('POST', fill(paths.authorize), {
              headers: { 'csrf-token': state.csrf },
              body: {
                clientMac: toOmadaMac(c.mac),
                apMac: toOmadaMac(c.apMac),
                ssidName: c.ssidName,
                radioId: String(c.radioId),
                site: c.site,
                time: String(timeValue(p.untilMs)),
                authType: '4',
              },
            }),
          );
          authorized.push(c.mac);
        } catch (e) {
          failed.push({
            mac: c.mac,
            detail: e instanceof Error ? e.message.slice(0, 150) : 'error',
          });
        }
      }
      return { authorized, failed };
    },

    /** @param {{ macs: string[], site: string }} p */
    async unauthorize(p) {
      if (!this.features().unauthorize) return { unsupported: true };
      const sid = await siteId(p.site);
      const done = [];
      const failed = [];
      for (const m of p.macs) {
        try {
          await openApi('POST', /** @type {string} */ (paths.openApiUnauthorize), {
            siteId: sid,
            clientMac: toOmadaMac(m),
          });
          done.push(m);
        } catch (e) {
          failed.push({ mac: m, detail: e instanceof Error ? e.message.slice(0, 150) : 'error' });
        }
      }
      return { done, failed };
    },

    /** @param {{ mac: string, site: string }} p */
    async findClient(p) {
      if (!this.features().listClients) return { unsupported: true };
      const c = (await clients(p.site)).find((x) => x.mac === toCanonicalMac(p.mac));
      return { connected: !!c, apMac: c?.apMac ?? null };
    },

    /** @param {{ site: string }} p */
    async listClients(p) {
      if (!this.features().listClients) return { unsupported: true };
      return { clients: await clients(p.site) };
    },
  };
}

/**
 * JSON over HTTPS to the controller. The controller uses a self-signed certificate,
 * so the usual check can't work: on this computer (loopback) nothing can sit in
 * between; for another computer the certificate's fingerprint must match.
 */
export function httpsJson({ method, url, body, headers, fingerprint }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const go = () => {
      const req = https.request(
        url,
        {
          method,
          headers: {
            ...headers,
            ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          },
          rejectUnauthorized: false,
          timeout: 15_000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              /* not JSON */
            }
            const sc = res.headers['set-cookie'];
            resolve({
              status: res.statusCode ?? 0,
              json,
              setCookie: Array.isArray(sc) ? sc : sc ? [sc] : [],
            });
          });
        },
      );
      req.on('timeout', () => req.destroy(new OmadaError('controller timed out')));
      req.on('error', (e) =>
        reject(
          e instanceof OmadaError ? e : new OmadaError(`controller unreachable: ${e.message}`),
        ),
      );
      if (payload) req.write(payload);
      req.end();
    };
    if (!fingerprint || isLoopback(url.hostname)) return go();
    // Check the certificate before sending anything (passwords included).
    const s = tls.connect(
      { host: url.hostname, port: Number(url.port || 443), rejectUnauthorized: false },
      () => {
        const fp = s.getPeerCertificate()?.fingerprint256 ?? '';
        s.end();
        if (fp.replace(/:/g, '').toLowerCase() !== fingerprint.replace(/:/g, '').toLowerCase())
          return reject(
            new OmadaError('controller certificate changed; refusing to send credentials'),
          );
        go();
      },
    );
    s.on('error', (e) => reject(new OmadaError(`controller unreachable: ${e.message}`)));
  });
}
