# Authentication, Sessions and Access Control

Status: Phase 2, implemented and tested against PostgreSQL 17 + Redis (see `apps/api/src/phase2.int.test.ts`).

## Staff sign-in

1. `POST /api/v1/auth/staff/login` with email + password. The same error is returned for an unknown account and a wrong password. A dummy hash check makes response times match too.
2. A session cookie is issued, but **nothing except MFA set-up/verification works** until MFA is complete (`details.next = MFA_ENROLL | MFA_VERIFY`).
3. `POST /auth/staff/mfa/enroll` returns a TOTP secret once (authenticator app); `POST /auth/staff/mfa/verify` confirms it. Each 30-second code can be used once (replay protection).
4. Accounts created by an owner must change the initial password before anything else (`next = PASSWORD_CHANGE`). Changing the password ends all other sessions.

| Control          | Setting                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Password hashing | scrypt N=2^17, r=8, p=1, 16-byte salt; weaker hashes upgraded on next sign-in                          |
| Password policy  | 12–128 chars, not a repeated character, not containing name/email, not a common password               |
| MFA              | RFC 6238 TOTP, ±30 s drift, secret encrypted at rest with AES-256-GCM (key derived from `AUTH_SECRET`) |
| Sign-in limits   | 10 attempts / 15 min per email, 30 / 15 min per IP; 6 MFA attempts / 15 min per session                |
| Failed sign-ins  | Audited (`auth.staff.login_failed`, `auth.staff.mfa_failed`) without the attempted secret              |

## Tenant sign-in (phone one-time code)

- `POST /auth/tenant/otp/request` always answers `202 "If this number can sign in, a code is on its way."`. Codes are never sent to staff phone numbers.
- Codes: 6 digits, 5 minutes, single use, 5 attempts, stored only as an HMAC.
- Limits: 3 requests / 15 min per phone, 10 per IP; 20 verifications / 15 min per IP.
- First successful sign-in creates a tenant account (guest checkout allowed, assumption A12).
- **Blocked:** no SMS provider is chosen (A13). With `OTP_PROVIDER=none` (default) these endpoints return 503. `OTP_PROVIDER=fake` is a test double, refused in staging/production.

## Sessions

- 256-bit random token in an HttpOnly, SameSite=Lax, Path=/ cookie (`__Host-nf_session` + Secure in staging/production). Only an HMAC of the token is stored.
- New token at every sign-in (no session fixation). Staff: 12 h absolute / 60 min idle. Tenants: 30 days / 14 days idle.
- Users can list and revoke their own sessions (`/me/sessions`), sign out, or sign out everywhere. Disabling an account or resetting credentials ends its sessions.

## Cross-site request forgery

Every POST/PUT/PATCH/DELETE, including sign-in, needs the header `x-netflex-csrf: 1`. A browser can only add it cross-site after a CORS preflight, and CORS only allows the NetFlex web origin. If an `Origin` header is present it must be the web or API origin. Payment webhooks (Phase 4) will opt out explicitly and rely on signature verification instead.

## Authorization

- Roles and permissions are defined in `packages/domain/src/permissions.ts` and mirrored into the database (`npm run db:sync-rbac`).
- Deny by default. Every route needs a session unless marked public. Admin routes need a staff account; property routes need the permission **on that property**. Only an OWNER granted platform-wide reaches every property.
- A denied property-scoped request answers **404**, so a property's existence isn't revealed. Every query is also filtered by property, so IDs from another property resolve to 404 (tested).
- Only a platform owner grants or revokes roles. The database refuses any non-owner role without a property, and any OWNER grant tied to a property.
- Lockout protection: the last active owner can't be disabled or lose the owner role, and nobody can disable themselves.

| Role             | Can                                                                                                               | Cannot                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| OWNER (platform) | Everything, all properties                                                                                        | Disable or reset themselves                                 |
| PROPERTY_ADMIN   | Structure, tenants, room/floor authority, plans, vouchers, subscriptions, support, settings, audit (own property) | Grant roles, refunds, network operations, create properties |
| NETWORK_ADMIN    | Gateways, sessions, provisioning (own property)                                                                   | Payments, tenants                                           |
| FINANCE          | Payments, refunds (request/approve with two-person rule), reconciliation, reports                                 | Network controls, tenant management                         |
| SUPPORT          | Read tenants, subscriptions, vouchers, payments; tickets                                                          | Refunds, network controls, changes to tenants               |

## Audit log

Append-only (database triggers block UPDATE/DELETE/TRUNCATE) with a SHA-256 hash chain linking each entry to the previous one. `AuditService.verifyChain()` recomputes it. Every admin mutation writes its audit entry in the same transaction as the change, with actor, property, reason, request ID and IP.

## Known limitations

- Staff password reset is owner-assisted only (no email provider yet). An owner who loses their own factor needs a second owner. Keep at least two owners (see runbook).
- Tenant phone sign-in is blocked until an SMS provider is chosen.
- Room/floor **group membership** (who shares a purchased room/floor plan) attaches to subscriptions and is built in Phase 5. Phase 2 delivers **purchase authority** (who may buy for a room/floor).
- Rate limits use fixed windows in Redis and fail closed: if Redis is down, sign-in is refused (503).
- `TRUST_PROXY` must be set correctly in production, or per-IP limits will see the load balancer's IP.
