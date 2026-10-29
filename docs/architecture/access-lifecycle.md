# Access Lifecycle (Phase 5)

Status: implemented and tested against PostgreSQL 17 + Redis (`apps/api/src/phase5.int.test.ts`). Network effects are queued as outbox events (`network.activate | suspend | revoke | disconnect | apply_policy`). They take effect at the gateway once the gateway integration (Phase 6) consumes them. Until then the tenant status says "access being configured", never "connected".

## Rules

| Rule                                  | Implementation                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Time is decided by the database clock | `expireDue()` compares with PostgreSQL `now()`. A test-only `asOf` parameter makes the exact boundary testable                                               |
| Expiry is exclusive                   | Access ends at the instant `now() >= expiresAt`. A test proves 1 ms before is still valid and the instant itself is not, and a mutation to `<` makes it fail |
| Expiry is enforced on a schedule      | Worker job `entitlements.expire` runs every minute. The gateway's own session timeout will be the second layer (Phase 6)                                     |
| Expiry is exactly once                | `FOR UPDATE SKIP LOCKED`; four concurrent runs expire each entitlement once, with one gateway revoke                                                         |
| Never-used vouchers expire            | After the activation deadline: voucher EXPIRED, no gateway call (nothing was granted)                                                                        |
| Ending access ends everything         | Vouchers EXPIRED/REVOKED, subscription EXPIRED/REVOKED, the encrypted code delivery deleted, gateway told to revoke                                          |

## Staff actions (`subscription.manage`, reason required, audited)

| Action           | Effect                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suspend          | ACTIVE/PROVISIONING → SUSPENDED; gateway suspend. **The clock keeps running** (a time product); extend afterwards to compensate. Access that hasn't started can't be suspended; suspend its voucher instead |
| Reactivate       | SUSPENDED → PROVISIONING; gateway activate. Refused once expired                                                                                                                                            |
| Revoke           | Ends access permanently                                                                                                                                                                                     |
| Extend           | Started access: a later expiry. Unstarted: a later activation deadline (and voucher redeem-by). Durations must be positive, so nothing can be shortened                                                     |
| Release a device | Frees a slot; device disconnected; an exhausted voucher reopens. No daily cap for staff                                                                                                                     |
| Members          | Add (residents only, within the plan's cap), remove (devices released), transfer the manager role                                                                                                           |

## Tenants (`/api/v1/me/access`)

- See only access they own (individual), manage, or belong to (room/floor). Anything else is "not found".
- Status is truthful:
  - VOUCHER_AVAILABLE
  - ACCESS_BEING_CONFIGURED
  - ACTIVE / EXPIRING_SOON (only after the gateway confirms)
  - ACCESS_SUSPENDED
  - SUBSCRIPTION_EXPIRED
  - PROVISIONING_NEEDS_ATTENTION
- Expiry is shown in the property's local time. Usage says "not available" until the gateway provides real counters.
- **Device recovery:** owners and managers can free any slot; members only their own. At most **3 releases per entitlement per 24 hours** (assumption A11) so one code can't be rotated endlessly; staff can help beyond that.
- **Room/floor groups:**
  - The manager adds housemates by phone. They must be registered tenants **currently living in that room (or on that floor)**, within the plan's member cap.
  - Members can leave.
  - The manager role can be transferred.
  - The manager can't be removed until the role is handed over.
- **Moving out or moving rooms** automatically ends memberships of groups the tenant no longer qualifies for, and disconnects their devices.

## Renewal (explicit)

`POST /orders` with `renewEntitlementId`:

- Allowed only for the owner or manager, for the **same plan** and **same target**, while access has started and not ended. A renewal rule that would shorten current access is refused up front (`DOMAIN_RENEWAL_WOULD_SHORTEN`).
- On verified payment, the existing entitlement is extended using the plan's rule. The default `STACK_AFTER_CURRENT_EXPIRY` adds the new time after the current expiry, and expiry never moves earlier.
  - The **same code and devices** keep working; no new voucher is issued.
  - The renewal subscription links into a linear chain (`renewsId`).
  - The gateway is told to update the session timeout.
- If the access ended while the payment was pending, the customer receives **fresh access** instead, and this is audited as `order.renewal_fell_back`.
- The renewal link on an order is immutable (database trigger).

## Not in scope here

- **Customer-initiated cancellation:** handled as a refund request through support (Phase 7 support tickets). The refund rules are in the payments guide.
- **Plan upgrades:** buy the new plan; renewals stay on the same plan.
