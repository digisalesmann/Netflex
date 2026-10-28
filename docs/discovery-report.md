# NetFlex — Phase 0 Discovery Report

| Field           | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| Date            | 2026-10-28                                                           |
| Phase           | 0 — Discovery and feasibility (in progress)                          |
| Source of truth | `NetFlex_Final_Master_Prompt.pdf` v1.0 (32 pages, read in full)      |
| Status          | Draft. Waiting on owner answers and a working development toolchain. |

Status vocabulary used in all NetFlex docs (spec §0):
**Implemented and tested** · **Implemented but not live-verified** · **Simulated in isolated tests only** · **Blocked by external dependency** · **Not implemented**.

---

## 1. Repository audit (files actually inspected)

### 1.1 What exists

| Path                              | Description                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `NetFlex_Final_Master_Prompt.pdf` | The master specification. Text extracted with macOS PDFKit; all 32 pages read. |
| `.DS_Store`                       | macOS Finder metadata. Not project content; should be git-ignored.             |

That is the whole repository. There is:

- **No source code**, `package.json`, lockfile, tests, migrations, CI, Docker files, env files, or deployment config.
- **No git repository** (`git status` would fail; the directory is not under version control).
- **No brand assets** (logo, colours, fonts). Any brand decision will be new and recorded in an ADR (spec §19).

### 1.2 Development machine (checked 2026-10-28)

| Tool                       | Found  | Impact                                                                                  |
| -------------------------- | ------ | --------------------------------------------------------------------------------------- |
| macOS (Darwin 22.6.0)      | yes    | —                                                                                       |
| Python 3.9.6, pip 21.2     | yes    | Not part of the target stack.                                                           |
| Swift (Command Line Tools) | yes    | Used only to read the PDF.                                                              |
| Node.js / npm              | **no** | **Blocks Phase 1.** Nothing in the TypeScript stack can be installed, built, or tested. |
| Docker                     | **no** | No local PostgreSQL/Redis containers.                                                   |
| PostgreSQL (`psql`)        | **no** | No local database for migrations/integration tests.                                     |
| Redis                      | **no** | No local queue for BullMQ tests.                                                        |
| Homebrew                   | **no** | No package manager for installing the above.                                            |
| poppler (`pdftotext`)      | no     | Irrelevant beyond PDF reading.                                                          |

### 1.3 Preserve / change / remove

- **Preserve:** the specification PDF (move to `docs/spec/` once git is set up, unchanged).
- **Remove from version control:** `.DS_Store` (git-ignore it).
- **Nothing else to preserve** — this is a greenfield build.

### 1.4 Monorepo decision

npm workspaces monorepo is appropriate: three deployables (web, api, worker) share a database schema, types, validation and design tokens. No existing package manager to preserve, so the spec's preference (npm) applies. See [ADR-0001](decisions/adr-0001-modular-monolith-npm-workspaces.md).

---

## 2. Known decisions (confirmed by the spec, §2)

1. Physical network hardware is **not yet confirmed**.
2. Access scopes: **INDIVIDUAL, ROOM, FLOOR**.
3. Plan validity is **time-based**.
4. Customer credential is a **voucher/access code**.
5. Deployment is **one residential lodge/apartment property in Nigeria**, extensible to more.
6. Three interfaces: **marketing site, captive/tenant portal, admin/operations portal**.
7. Visual design: **premium, restrained, mobile-first, not card-heavy**.
8. Stack baseline: Next.js (App Router) + React + strict TypeScript; NestJS; PostgreSQL + Prisma; Redis + BullMQ; Paystack behind a `PaymentProvider` interface; hardware-neutral `NetworkAdapter`.

### 2.1 A conflict to flag

The kick-off message asks for "a secure MikroTik RouterOS network adapter". The specification (§5.4, §11.3) says MikroTik is **a candidate, not a confirmed dependency**, and forbids live network work until the gateway is selected and a proof-of-concept passes. Per the spec's precedence rules (verified hardware capabilities outrank preferences), NetFlex will:

- build the hardware-neutral `NetworkAdapter` contract and a test-only fake now;
- design a MikroTik adapter as the **leading candidate** (see ADR-0004), with code written against official docs but labelled **Implemented but not live-verified** until tested on the owner's actual router;
- not mark MikroTik as "selected" until the owner confirms the hardware.

---

## 3. Unresolved unknowns

The full list, with owners and impact, is in the [assumptions register](assumptions-register.md). The most consequential:

| #   | Unknown                                                                                      | Blocks                                          |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| U1  | Starlink plan type and whether paid community Wi-Fi is permitted for this account in Nigeria | **Live paid access** (legal gate)               |
| U2  | Gateway/router make, model, firmware                                                         | Phase 6 (all real network enforcement)          |
| U3  | AP/switch models, topology, VLAN support                                                     | Room/floor enforcement design                   |
| U4  | Shared SSID vs per-floor SSID/VLAN zones                                                     | How ROOM/FLOOR scope is enforced on the network |
| U5  | Room/floor/tenant counts, concurrent devices                                                 | Capacity targets, hardware sizing               |
| U6  | Who issues vouchers (buyer, admin, both)                                                     | Phase 3 policy defaults                         |
| U7  | How room/floor group members are authorized                                                  | Phase 5 group policy                            |
| U8  | When validity starts (purchase / redemption / first authorization)                           | Phase 3/5 activation policy                     |
| U9  | Prices, durations, device limits, speeds, refund rules                                       | Plan seed data, marketing copy                  |
| U10 | Domain, hosting, Paystack account, SMS/OTP provider, email, monitoring                       | Phase 4, staging, launch                        |

---

## 4. Network / hardware discovery checklist (spec §5.2)

Every item is **Unavailable — not yet provided**. Do not put passwords in this file; secrets go through the procedure in §4.1.

| Item                                                                                               | Value                    | Status      |
| -------------------------------------------------------------------------------------------------- | ------------------------ | ----------- |
| Starlink kit model (dish/router generation)                                                        | _TBD_                    | Unavailable |
| Starlink service plan (Residential / Roam / Priority / Local Priority / other) and account country | _TBD_                    | Unavailable |
| Existing gateway/router make, model, firmware                                                      | _TBD_                    | Unavailable |
| Admin access to existing gateway (who holds it, how)                                               | _TBD_                    | Unavailable |
| Access points: make, model, firmware, controller, PoE needs                                        | _TBD_                    | Unavailable |
| Switches: make, model, managed/unmanaged, VLAN support, PoE budget                                 | _TBD_                    | Unavailable |
| Physical topology (Starlink → gateway → switch → APs → rooms/floors)                               | _TBD — sketch or photos_ | Unavailable |
| Subnets, DHCP, DNS, NAT, VLANs, client isolation, current SSIDs                                    | _TBD_                    | Unavailable |
| Floor plan, wall materials, known dead zones                                                       | _TBD_                    | Unavailable |
| Number of buildings / floors / rooms                                                               | _TBD_                    | Unavailable |
| Do users roam between APs?                                                                         | _TBD_                    | Unavailable |
| Estimated tenants, devices per tenant, peak concurrent devices                                     | _TBD_                    | Unavailable |
| Expected peak throughput / traffic profile (streaming, calls, work)                                | _TBD_                    | Unavailable |
| Power backup (inverter/UPS/generator) and runtime for network gear                                 | _TBD_                    | Unavailable |
| Safe recovery method if NetFlex/cloud is down (local console, physical port)                       | _TBD_                    | Unavailable |
| Can a dedicated gateway be inserted without breaking service?                                      | _TBD_                    | Unavailable |
| Can management traffic use VPN/private path? (Starlink is typically CGNAT — no inbound)            | _TBD_                    | Unavailable |

### 4.1 Secure secret-entry procedure (for later)

1. Owner creates a least-privilege API account on the gateway (never shares the main admin password).
2. Credentials are entered directly into the hosting provider's secret manager (or a password manager share to the operator) — never in chat, email, tickets, git, or this document.
3. NetFlex reads them from environment/secret store at runtime; config validation refuses to start in production if they're missing.
4. Rotation steps are documented in `docs/security/secret-rotation.md` (Phase 1).

---

## 5. Hardware-neutral feasibility

See [hardware capability matrix](network/hardware-capability-matrix.md). Summary: MikroTik RouterOS **documents** every required capability (HotSpot captive portal, local users and profiles, RADIUS auth/accounting, per-user rate limits, shared-users limits, REST API from v7.1). None of it is tested on the owner's equipment. UniFi documents a hotspot portal with vouchers, but its automation API surface needs verification. The existing gateway is entirely unknown.

## 6. Legal and feasibility gates (spec §4)

See [legal-feasibility-gates.md](legal-feasibility-gates.md). **Gate G1 (Starlink resale permission) is the single biggest launch risk.** Starlink's published terms generally prohibit resale, with a carve-out allowing community Wi-Fi/hotspot resale on Priority plans; terms vary by country, and Residential/Roam plans are reported as not permitting it. Nigeria-specific terms for the owner's actual plan have not been checked. **Paid access must stay disabled until G1 is evidenced in writing.**

## 7. Proposed architecture

See [architecture overview](architecture/overview.md) and [data flows](architecture/data-flows.md). In one paragraph: a modular monolith — Next.js web app (marketing + captive/tenant + admin route groups), NestJS API, and a separate NestJS worker process — sharing PostgreSQL (source of truth via Prisma) and Redis/BullMQ (job transport only). Every state change that needs follow-up work writes an outbox row in the same database transaction; the worker relays outbox rows to BullMQ with the outbox ID as job ID. Payments go through a `PaymentProvider` interface (Paystack first). Network enforcement goes through a `NetworkAdapter` interface; the leading candidate is MikroTik HotSpot with NetFlex acting as the RADIUS authority so vouchers never need to be stored in plaintext and the router enforces expiry even if the cloud is unreachable (ADR-0004, pending hardware).

## 8. Highest-risk failure modes

Full list in the [risk register](risk-register.md). Top six:

1. **Legal:** Starlink plan doesn't permit resale → account suspension, business stops.
2. **Payment:** double-provisioning or "connected" shown on an unverified payment (redirect spoofing, replayed/forged webhook, amount mismatch).
3. **Payment:** paid but never provisioned (crash between DB commit and job enqueue) — mitigated by outbox.
4. **Network:** cloud unreachable (Starlink outage) → new customers can't activate; existing sessions must keep working to their paid expiry.
5. **Network:** management path — Starlink CGNAT means no inbound access; needs router-initiated VPN.
6. **Security:** voucher guessing/sharing; group code shared outside a floor; compromised staff account issuing free vouchers.

## 9. Phased plan

See [implementation plan](implementation-plan.md).

## 10. First small implementation increment

**Increment 1.1 — Foundation skeleton (Phase 1), once Node.js is available:**

1. `git init`, `.gitignore`, `.editorconfig`, `.nvmrc` (Node 22 LTS), root `package.json` with npm workspaces.
2. `packages/config`: zod-validated environment schema that fails fast in production; `NETFLEX_ENV` with `development | test | staging | production`, and a hard rule that simulators cannot load when `NETFLEX_ENV=production`.
3. `packages/domain`: pure TypeScript (no framework) — money (integer minor units, `bigint`), duration/expiry calculation (incl. calendar months, exclusive expiry), voucher code generator/normalizer/verifier, and state machines for Voucher, Payment, Entitlement. These are the highest-value, hardware-independent pieces and are fully unit-testable.
4. Vitest unit tests for all of the above, `tsc --noEmit` in strict mode, ESLint.
5. GitHub Actions CI running lint, type-check, tests.

Nothing in Increment 1.1 touches a router, a payment provider, or UI.

## 11. Commands and expected evidence

| Command                                                           | Expected evidence                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `node -v && npm -v`                                               | Node 22.x LTS present                                                    |
| `npm ci`                                                          | Clean install from lockfile                                              |
| `npm run typecheck`                                               | `tsc -b` exits 0 across all workspaces                                   |
| `npm run lint`                                                    | ESLint exits 0                                                           |
| `npm test`                                                        | Vitest summary with pass counts; output pasted into `docs/test-results/` |
| `docker compose -f infra/deployment/docker-compose.dev.yml up -d` | Postgres + Redis healthy                                                 |
| `npm run db:migrate:deploy` then `npm run db:migrate:status`      | Migrations applied, no drift                                             |
| `npm run build`                                                   | All apps build                                                           |

Real command output will be recorded verbatim. Nothing is reported as passing until it has been run.

## 12. Owner questions

See [owner-decisions.md](owner-decisions.md), grouped by urgency.

## 13. What can start now vs. what is blocked

| Can start now (no hardware/provider needed)                                                        | Blocked                                                          |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Repo foundation, CI, config validation (needs Node.js locally — **blocked on this machine today**) | Live network enforcement — needs gateway (U2)                    |
| Domain logic: money, durations, expiry, voucher codes, state machines                              | Gateway proof-of-concept — needs physical hardware               |
| Database schema + migrations (needs PostgreSQL)                                                    | Paystack sandbox verification — needs owner's Paystack test keys |
| Auth/RBAC, property hierarchy, plans, orders, vouchers                                             | Live payments — needs Paystack live approval + legal gate G1     |
| Payment engine against a test-only fake + signature tests with known fixtures                      | OTP/SMS — needs provider choice + credentials                    |
| `NetworkAdapter` contract + test-only fake adapter                                                 | Final marketing copy/pricing — needs owner prices and policies   |
| Design tokens, UI shells with honest "not available yet" states                                    | Room/floor network enforcement design — needs topology (U3/U4)   |
| Docs: runbooks, threat model, env reference                                                        | Launch — needs all §4 gates                                      |

## Sources consulted (2026-10-28)

Official:

- MikroTik REST API — https://help.mikrotik.com/docs/display/ROS/REST+API
- MikroTik RADIUS — https://help.mikrotik.com/docs/display/ROS/RADIUS
- MikroTik AAA (7.25 manual) — https://manual.mikrotik.com/docs/7.25/authentication-authorization-accounting/
- MikroTik HotSpot profile (legacy wiki) — https://wiki.mikrotik.com/Manual:IP/Hotspot/Profile
- Starlink legal documents index (terms vary by country/plan) — https://www.starlink.com/legal/documents/DOC-1020-91087-64

Secondary (to be re-checked against official Paystack docs before Phase 4):

- Paystack webhook signature (HMAC-SHA512, `x-paystack-signature`, raw body) — https://hookdeck.com/webhooks/platforms/guide-to-paystack-webhooks-features-and-best-practices
- Starlink community host/pass program reporting (Oct 2026) — https://tech-ish.com/2026/10/05/starlink-is-looking-for-hosts-to-sell-hourly-and-weekly-internet-passes/
- Starlink community site overview — https://www.satelliteinternet.com/resources/starlink-community-site-program/

The official Paystack developer documentation (https://paystack.com/docs) was **not** reached in this session and must be read directly before Phase 4 code is written.
