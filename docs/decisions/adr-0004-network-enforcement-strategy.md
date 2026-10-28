# ADR-0004: Network enforcement strategy (gateway + RADIUS)

- Status: **Proposed — blocked on hardware selection and PoC**
- Date: 2026-10-28

## Context

Hardware is unknown. MikroTik RouterOS is the leading candidate (documents HotSpot, RADIUS auth/accounting, REST API v7.1+, rate limits, shared-users, uptime limits). Starlink typically uses CGNAT, so the cloud can't reach the router inbound. Spec wants gateway-side expiry as a second layer and read-back verification.

## Options

**A. HotSpot local users via REST API.** Worker creates a per-entitlement HotSpot user/profile on the router (random router-side username/password, not the voucher), the portal logs the device in via the gateway's login URL.

- Pro: Works without a RADIUS server; offline sessions continue.
- Con: Router holds credentials; more mutations to reconcile; API must be reachable (VPN).

**B. HotSpot with NetFlex as RADIUS authority.** Router sends the voucher (as username/password) to NetFlex RADIUS; NetFlex checks the HMAC verifier, entitlement, scope, and device limits, and replies with `Session-Timeout` = remaining seconds, rate-limit attribute, and group/profile. Accounting gives sessions/usage. Revocation via RADIUS Disconnect-Message (needs incoming RADIUS enabled on router) plus API removal of the active session.

- Pro: Vouchers stay verifier-only; expiry enforced by router even if cloud goes down mid-session; single source of truth.
- Con: New activations need cloud reachability (fail-closed — acceptable per A15); one more service to run; RADIUS over VPN only.

**C. Vendor controller (UniFi) vouchers/external portal.** Depends on equipment already present and on API stability.

## Proposed decision

**B, with A's REST API used for health, session listing, and disconnect.** Final decision after: (1) owner confirms hardware, (2) PoC tests #1–#14 pass on the exact model/firmware.

## Network-side scope enforcement

- If topology allows per-floor VLAN/SSID: ROOM/FLOOR entitlements also restrict to the zone (RADIUS can reject auth from a non-matching NAS/called-station/VLAN).
- Otherwise: scope is enforced by identity (group membership + device cap) only, and this limitation is disclosed. **Owner decision after site survey.**

## Consequences

Until accepted, the `MikrotikAdapter` is labelled **Implemented but not live-verified** and is never enabled in production configuration.
