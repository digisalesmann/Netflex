#!/usr/bin/env node
/**
 * NetFlex lodge link: connects the lodge's Omada controller to netflexhq.com.
 *
 *   node lodge-link.mjs setup     ask for the settings and save lodge-link.json
 *   node lodge-link.mjs pair CODE pair with the office (Network → Lodge link → Pair)
 *   node lodge-link.mjs check     test the controller and the server
 *   node lodge-link.mjs run       keep running (the installer starts this at boot)
 *
 * Settings live in lodge-link.json next to this file. It holds the controller's
 * operator password and the link token: only the Windows administrator should be
 * able to read it (install.ps1 sets that).
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { AGENT_VERSION, createLink, pair } from './src/link.mjs';
import { createOmada } from './src/omada.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG = process.env.NETFLEX_LINK_CONFIG ?? join(here, 'lodge-link.json');
const LOG = join(here, 'lodge-link.log');

function load() {
  if (!existsSync(CONFIG)) {
    console.error(`No settings yet. Run: node lodge-link.mjs setup`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}
const save = (cfg) => writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });

function fileLog(m) {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  try {
    if (existsSync(LOG) && statSync(LOG).size > 1_000_000) renameSync(LOG, `${LOG}.1`);
    appendFileSync(LOG, `${line}\n`);
  } catch {
    /* logging must never stop the link */
  }
}

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'setup') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const old = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {};
  const ask = async (q, d) => (await rl.question(`${q}${d ? ` [${d}]` : ''}: `)).trim() || d || '';
  const cfg = {
    server: await ask('NetFlex address', old.server ?? 'https://netflexhq.com'),
    token: old.token ?? '',
    controller: {
      ...(old.controller ?? {}),
      url: await ask('Omada controller address', old.controller?.url ?? 'https://127.0.0.1:8043'),
      operator: {
        name: await ask('Hotspot operator name', old.controller?.operator?.name ?? 'netflex-link'),
        password: await ask('Hotspot operator password', old.controller?.operator?.password),
      },
      openApi: {
        clientId: await ask(
          'Open API client ID (leave empty for now if not set up)',
          old.controller?.openApi?.clientId,
        ),
        clientSecret: await ask('Open API client secret', old.controller?.openApi?.clientSecret),
      },
    },
  };
  rl.close();
  save(cfg);
  console.log(`Saved ${CONFIG}. Next: node lodge-link.mjs check`);
} else if (cmd === 'pair') {
  const cfg = load();
  if (!arg) {
    console.error(
      'Usage: node lodge-link.mjs pair ABCD-EFGH  (code from the office: Network → Lodge link)',
    );
    process.exit(1);
  }
  const r = await pair(cfg.server, arg);
  save({ ...cfg, token: r.token, gatewayId: r.gatewayId });
  console.log(`Paired with "${r.gatewayName}". Next: node lodge-link.mjs check`);
} else if (cmd === 'check') {
  const cfg = load();
  const omada = createOmada(cfg.controller);
  const h = await omada.health();
  console.log(
    h.reachable ? `Controller OK (Omada ${h.version})` : `Controller problem: ${h.detail}`,
  );
  const f = omada.features();
  console.log(`Switch devices off early: ${f.unauthorize ? 'yes' : 'not set up (Open API)'}`);
  console.log(`List connected devices:   ${f.listClients ? 'yes' : 'not set up (Open API)'}`);
  if (!cfg.token) console.log('Not paired yet: node lodge-link.mjs pair CODE');
  else {
    const n = await createLink(cfg, { omada, waitMs: 0 })
      .once()
      .then(
        () => 'Server OK (paired)',
        (e) => `Server problem: ${e.message}`,
      );
    console.log(n);
  }
  process.exit(h.reachable ? 0 : 1);
} else if (cmd === 'run') {
  const cfg = load();
  if (!cfg.token) {
    fileLog('not paired yet: node lodge-link.mjs pair CODE');
    process.exit(1);
  }
  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());
  process.on('SIGTERM', () => ac.abort());
  await createLink(cfg, { log: fileLog }).run({ signal: ac.signal });
} else {
  console.log(`NetFlex lodge link ${AGENT_VERSION}\n\n  setup | pair CODE | check | run`);
}
