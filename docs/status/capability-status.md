# NetFlex — Verified Capability / Requirement Status

Updated: 2026-10-29. Only things with evidence move out of "Not implemented".
Status vocabulary: Implemented and tested · Implemented but not live-verified · Simulated in isolated tests only · Blocked by external dependency · Not implemented.

| Area                                                                                                                                                      | Status                                                      | Evidence                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Phase 0 discovery documents                                                                                                                               | Done — awaiting owner review of remaining questions         | `docs/`                                                                     |
| Repo foundation (npm 11 workspaces, strict TS, ESLint, Prettier, Vitest 4)                                                                                | **Implemented and tested** locally                          | `npm run lint`, `npm run typecheck`, `npm test` all pass (see test-results) |
| CI workflow                                                                                                                                               | Implemented, **not yet run** (no git remote)                | `.github/workflows/ci.yml`                                                  |
| Config validation (fail-fast, simulators refused in staging/production, no secret echo)                                                                   | **Implemented and tested**                                  | `packages/config/src/env.test.ts` (12 tests)                                |
| Domain rules: money, time/expiry, calendar months, voucher codes + verifiers, state machines, scope, plan eligibility, redemption rules, payment matching | **Implemented and tested** (pure logic)                     | `packages/domain` (96 tests)                                                |
| Database schema (38 tables), 4 migrations, DB-level constraints and immutability triggers                                                                 | **Implemented and tested** on PostgreSQL 17                 | `packages/database/src/constraints.int.test.ts` (19 tests); drift check = 0 |
| Local dev services without Docker                                                                                                                         | Implemented and used                                        | `npm run services:start`                                                    |
| Logging / correlation IDs, design tokens                                                                                                                  | Not implemented (next increment)                            | —                                                                           |
| Auth, RBAC, property hierarchy services/API                                                                                                               | Not implemented                                             | —                                                                           |
| Plans, vouchers, orders services/API                                                                                                                      | Not implemented (rules exist in `packages/domain`)          | —                                                                           |
| Paystack integration                                                                                                                                      | Not implemented — sandbox **Blocked** (no test keys)        | —                                                                           |
| Entitlement engine, expiry jobs                                                                                                                           | Not implemented                                             | —                                                                           |
| Network adapter (any)                                                                                                                                     | Not implemented — live **Blocked** (hardware unknown)       | —                                                                           |
| RADIUS                                                                                                                                                    | Not implemented — decision pending (ADR-0004)               | —                                                                           |
| OTP/SMS                                                                                                                                                   | Not implemented — **Blocked** (no provider)                 | —                                                                           |
| Marketing / captive / tenant / admin UI                                                                                                                   | Not implemented                                             | —                                                                           |
| Observability, backups, runbooks                                                                                                                          | Not implemented                                             | —                                                                           |
| Legal gates G1–G9                                                                                                                                         | G1 open (Nigeria account, plan unknown); others not checked | legal-feasibility-gates.md                                                  |

## Launch blockers

1. Starlink resale permission (G1): plan type unknown.
2. Gateway hardware unknown → no live network enforcement.
3. No Paystack test/live credentials.
4. No OTP/SMS provider, domain, or hosting chosen.
5. No git remote, so CI has never run.
