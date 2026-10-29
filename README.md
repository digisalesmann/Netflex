# NetFlex

Managed Wi-Fi billing and access-control platform for a residential property in Nigeria. Vouchers, time-based plans, individual/room/floor access, Paystack payments, and gateway enforcement.

**Status:** Phases 0–5 done (access lifecycle complete). The live Paystack sandbox run is pending the owner's test key ([payments guide](docs/payments/payments-guide.md)). Phase 6: the network engine is built and tested against a simulated gateway; the real router adapter is blocked on hardware ([network-engine.md](docs/network/network-engine.md)). Nothing is live. See [docs/status/capability-status.md](docs/status/capability-status.md) for what is verified and what is blocked.

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
npm run build
npm run db:sync-rbac
```

Create the first owner account: see [docs/runbooks/staff-accounts.md](docs/runbooks/staff-accounts.md).

## Checks

```sh
npm run lint
npm run typecheck
npm test                          # unit tests
npm run test:integration          # needs services running; uses database netflex_test
npm run build
```

## Run

```sh
npm run start:api                 # http://localhost:4000/api/v1/health/ready
npm run start:worker
```

## Layout

```
packages/config      environment validation (fails fast; refuses simulators in staging/production)
packages/domain      framework-free business rules: money, time, vouchers, state machines, scope
packages/database    Prisma schema, migrations, DB integrity tests
packages/observability  JSON logging with secret redaction, request IDs
packages/network     NetworkAdapter contract, test-only simulated gateway
packages/payments    PaymentProvider interface, Paystack adapter, test-only fake
packages/core        shared business logic (audit, access, payment engine) for API and worker
packages/security    password hashing, TOTP, encryption, tokens
packages/ui          design tokens (CSS variables), WCAG contrast checks
apps/api             NestJS REST API (/api/v1): auth, RBAC, properties, tenancy, staff, audit, plans, catalog, orders, vouchers, payments, access lifecycle; OpenAPI at /api/docs (non-production)
apps/worker          outbox relay, payment/refund/network jobs, reconciliation (5 min), expiry (1 min), heartbeat
scripts/             local dev services, test setup
infra/deployment/    docker-compose for development
docs/                discovery, architecture, ADRs, registers, status
```

Install scripts are restricted by npm 11. Only the packages listed under `allowScripts` in `package.json` may run them.
