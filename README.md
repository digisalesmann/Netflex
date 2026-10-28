# NetFlex

Managed Wi-Fi billing and access-control platform for a residential property in Nigeria. Vouchers, time-based plans, individual/room/floor access, Paystack payments, and gateway enforcement.

**Status:** Phase 1 (foundation). Nothing is live. See [docs/status/capability-status.md](docs/status/capability-status.md) for what is verified and what is blocked.

The product spec is [docs/spec/NetFlex_Final_Master_Prompt.pdf](docs/spec/NetFlex_Final_Master_Prompt.pdf). Start with [docs/discovery-report.md](docs/discovery-report.md).

## Requirements

- Node.js 22 LTS and **npm 11.21+** (`npm install -g npm@11.21.1`). npm 10 hits a resolver bug with this dependency tree.
- PostgreSQL 17 and Redis 7.2. No Docker needed: `npm run services:start` runs both locally. It expects `redis-server` on PATH, at `~/.local/redis/bin`, or in `REDIS_SERVER_BIN`. With Docker, use `infra/deployment/docker-compose.dev.yml` instead.

## Setup

```sh
npm ci
cp .env.example .env              # then set VOUCHER_PEPPER and AUTH_SECRET to random values
npm run services:start            # separate terminal; Ctrl-C stops
npm run db:generate
npm run db:migrate:deploy
```

## Checks

```sh
npm run lint
npm run typecheck
npm test                          # unit tests
npm run test:integration          # needs services running; uses database netflex_test
```

## Layout

```
packages/config      environment validation (fails fast; refuses simulators in staging/production)
packages/domain      framework-free business rules: money, time, vouchers, state machines, scope
packages/database    Prisma schema, migrations, DB integrity tests
scripts/             local dev services, test setup
infra/deployment/    docker-compose for development
docs/                discovery, architecture, ADRs, registers, status
```

Install scripts are restricted by npm 11. Only the packages listed under `allowScripts` in `package.json` may run them.
