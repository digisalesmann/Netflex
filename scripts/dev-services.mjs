#!/usr/bin/env node
// Local development services WITHOUT Docker: PostgreSQL 17 (embedded-postgres npm
// binaries) and Redis (a redis-server binary on PATH or REDIS_SERVER_BIN).
// Data lives in ./.local-data (git-ignored). Development/test use only.
//
//   node scripts/dev-services.mjs        start both, stay in foreground (Ctrl-C stops)
//
// Machines with Docker can use infra/deployment/docker-compose.dev.yml instead.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, '.local-data');
const PG_PORT = Number(process.env.DEV_PG_PORT ?? 54329);
const REDIS_PORT = Number(process.env.DEV_REDIS_PORT ?? 63799);
const PG_USER = 'netflex';
const PG_PASSWORD = 'netflex-dev-only';

if (process.env.NETFLEX_ENV === 'production' || process.env.NETFLEX_ENV === 'staging') {
  console.error('dev-services is for development/test only.');
  process.exit(1);
}

mkdirSync(join(dataDir, 'redis'), { recursive: true });

const pgDir = join(dataDir, 'pg');
const pg = new EmbeddedPostgres({
  databaseDir: pgDir,
  user: PG_USER,
  password: PG_PASSWORD,
  port: PG_PORT,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error('[postgres]', String(e).trim()),
});

if (!existsSync(join(pgDir, 'PG_VERSION'))) {
  console.log('[postgres] initialising data directory');
  await pg.initialise();
}
await pg.start();
for (const db of ['netflex_dev', 'netflex_test']) {
  try {
    await pg.createDatabase(db);
    console.log(`[postgres] created database ${db}`);
  } catch {
    /* already exists */
  }
}
console.log(
  `[postgres] ready  postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/netflex_dev`,
);

const redisBin =
  process.env.REDIS_SERVER_BIN ??
  [join(homedir(), '.local/redis/bin/redis-server')].find((p) => existsSync(p)) ??
  'redis-server';
const redis = spawn(
  redisBin,
  [
    '--port',
    String(REDIS_PORT),
    '--bind',
    '127.0.0.1',
    '--dir',
    join(dataDir, 'redis'),
    '--appendonly',
    'yes',
    '--save',
    '',
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
redis.on('error', (e) => {
  console.error(`[redis] could not start ${redisBin}: ${e.message}`);
});
console.log(`[redis] ready     redis://localhost:${REDIS_PORT}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('\nstopping services…');
  redis.kill('SIGTERM');
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
