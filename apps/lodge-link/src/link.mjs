/**
 * The lodge link loop: check in with netflexhq.com, carry out its instructions on
 * the local Omada controller, report back. It only ever connects OUT, so it works
 * behind Starlink's shared address (no port forwarding, no public IP).
 */
import { createOmada } from './omada.mjs';

export const AGENT_VERSION = '1.0.0';
export const PROTOCOL = 1;

/**
 * @param {{ server: string, token: string, controller: any }} cfg
 * @param {{ fetchImpl?: typeof fetch, omada?: ReturnType<typeof createOmada>, log?: (m: string) => void, waitMs?: number }} [deps]
 */
export function createLink(cfg, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const omada = deps.omada ?? createOmada(cfg.controller);
  const log = deps.log ?? ((m) => console.log(`${new Date().toISOString()} ${m}`));
  let health = {
    reachable: false,
    version: /** @type {string|null} */ (null),
    detail: 'Not checked yet',
  };
  let checkedAt = 0;

  async function api(path, body, timeoutMs = 40_000) {
    const res = await fetchImpl(new URL(`/api/v1/link/${path}`, cfg.server), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-netflex-link': cfg.token,
        'user-agent': `netflex-lodge-link/${AGENT_VERSION}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json().catch(() => null);
    if (res.status === 401)
      throw Object.assign(new Error('not paired (token refused): pair again'), { fatal: true });
    if (!res.ok) throw new Error(`server answered HTTP ${res.status}`);
    return j?.data ?? j;
  }

  async function heartbeat() {
    if (Date.now() - checkedAt > 60_000) {
      const before = health.reachable;
      health = await omada.health();
      checkedAt = Date.now();
      if (before !== health.reachable) log(`controller: ${health.detail}`);
    }
    return {
      agentVersion: AGENT_VERSION,
      protocol: PROTOCOL,
      controller: { reachable: health.reachable, version: health.version, detail: health.detail },
      features: omada.features(),
    };
  }

  /** @param {{ id: string, kind: string, payload: any }} c */
  async function execute(c) {
    try {
      let result;
      if (c.kind === 'authorize') result = await omada.authorize(c.payload);
      else if (c.kind === 'unauthorize') result = await omada.unauthorize(c.payload);
      else if (c.kind === 'findClient') result = await omada.findClient(c.payload);
      else if (c.kind === 'listClients') result = await omada.listClients(c.payload);
      else throw new Error(`unknown instruction ${c.kind}`);
      await api('result', { id: c.id, ok: true, result });
      if (c.kind === 'authorize' || c.kind === 'unauthorize')
        log(
          `${c.kind}: ${JSON.stringify({ ok: result.authorized?.length ?? result.done?.length ?? 0, failed: result.failed?.length ?? 0 })}`,
        );
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : 'failed';
      log(`${c.kind} failed: ${msg}`);
      // A controller that stopped answering should show in the office at the next check-in.
      if (/unreachable|timed out/.test(msg)) checkedAt = 0;
      await api('result', { id: c.id, ok: false, error: msg }).catch(() => null);
    }
  }

  /** One check-in. Returns how many instructions it carried out. */
  async function once() {
    const r = await api('poll', { heartbeat: await heartbeat(), waitMs: deps.waitMs ?? 25_000 });
    const cmds = r?.commands ?? [];
    for (const c of cmds) await execute(c);
    return cmds.length;
  }

  async function run({ signal } = /** @type {{signal?: AbortSignal}} */ ({})) {
    log(`lodge link ${AGENT_VERSION} started; server ${new URL(cfg.server).host}`);
    let backoff = 2_000;
    while (!signal?.aborted) {
      try {
        await once();
        backoff = 2_000;
      } catch (e) {
        if (e && typeof e === 'object' && 'fatal' in e) {
          log(e instanceof Error ? e.message : 'stopped');
          throw e;
        }
        log(
          `check-in failed: ${e instanceof Error ? e.message : e}; retrying in ${backoff / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  /** Check the controller again at the next check-in instead of waiting up to a minute. */
  const recheck = () => {
    checkedAt = 0;
  };

  return { once, run, execute, heartbeat, recheck };
}

/** Swap the office's one-time code for this computer's link token. */
export async function pair(server, code, fetchImpl = fetch) {
  const res = await fetchImpl(new URL('/api/v1/link/pair', server), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': `netflex-lodge-link/${AGENT_VERSION}`,
    },
    body: JSON.stringify({ code, agentVersion: AGENT_VERSION }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message ?? `server answered HTTP ${res.status}`);
  return /** @type {{ token: string, gatewayId: string, gatewayName: string }} */ (j?.data ?? j);
}
