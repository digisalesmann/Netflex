# ADR-0005: Time and money conventions

- Status: Accepted (Phase 0); A3/A4/A5 defaults pending owner confirmation
- Date: 2026-10-28

## Decision

- **Storage:** `timestamptz` UTC everywhere. Expiry decisions use database time (`now()`) inside the deciding transaction.
- **Expiry:** exclusive; `expires_at` computed once at activation and persisted; all devices in a group entitlement share it.
- **Duration units:** `MINUTE | HOUR | DAY | WEEK | CALENDAR_MONTH`. Calendar months are added in the property's time zone with end-of-month clamping (Jan 31 + 1 month → Feb 28/29 at the same local time), then converted to UTC. Day units are 24h × n in UTC (Lagos has no DST; the rule is documented for future properties).
- **Money:** `bigint` minor units + `char(3)` ISO currency. Arithmetic through a `Money` value type that refuses cross-currency operations. Paystack amounts are sent in the currency subunit (kobo for NGN) — to be re-confirmed in official Paystack docs before Phase 4.
- **Renewal:** stack after current expiry for the same scope (pending owner confirmation, A10).
