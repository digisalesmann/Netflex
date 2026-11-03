#!/usr/bin/env node
/**
 * Read-only load test: hammers the pages and API calls a lodge's residents hit most.
 * Nothing is bought, created or emailed.
 *
 *   node scripts/load/load-test.mjs [baseUrl] [concurrency] [seconds] [lodgeSlug]
 *   node scripts/load/load-test.mjs https://netflexhq.com 20 30 nd-lodge
 */
const [base = 'http://localhost:3000', conc = '20', secs = '30', slug = 'nd-lodge'] =
  process.argv.slice(2);
const routes = [
  { name: 'home page', path: '/' },
  { name: 'plans page', path: '/plans' },
  { name: 'lodge details (API)', path: `/api/v1/catalog/properties/${slug}` },
  { name: 'plan list (API)', path: `/api/v1/catalog/properties/${slug}/plans` },
  { name: 'health', path: '/api/v1/health/ready' },
];
const until = Date.now() + Number(secs) * 1000;
const stats = new Map(routes.map((r) => [r.name, { ms: [], codes: {} }]));

async function user(i) {
  let n = i;
  while (Date.now() < until) {
    const r = routes[n++ % routes.length];
    const s = stats.get(r.name);
    const t = performance.now();
    let code = 'error';
    try {
      const res = await fetch(base + r.path, { headers: { 'user-agent': 'netflex-load-test' } });
      await res.arrayBuffer();
      code = String(res.status);
    } catch {
      /* counted as error */
    }
    s.ms.push(performance.now() - t);
    s.codes[code] = (s.codes[code] ?? 0) + 1;
  }
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] ?? 0;
const started = Date.now();
await Promise.all(Array.from({ length: Number(conc) }, (_, i) => user(i)));
const took = (Date.now() - started) / 1000;
let total = 0;
console.log(`\n${base} · ${conc} at once · ${took.toFixed(0)}s\n`);
console.log(
  'route'.padEnd(24),
  'reqs'.padStart(6),
  'p50'.padStart(7),
  'p95'.padStart(7),
  'p99'.padStart(7),
  ' status codes',
);
for (const [name, s] of stats) {
  const a = s.ms.sort((x, y) => x - y);
  total += a.length;
  console.log(
    name.padEnd(24),
    String(a.length).padStart(6),
    `${pct(a, 50).toFixed(0)}ms`.padStart(7),
    `${pct(a, 95).toFixed(0)}ms`.padStart(7),
    `${pct(a, 99).toFixed(0)}ms`.padStart(7),
    ' ' + JSON.stringify(s.codes),
  );
}
console.log(`\n${total} requests, ${(total / took).toFixed(1)} per second`);
