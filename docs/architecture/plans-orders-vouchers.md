# Plans, Orders and Vouchers (Phase 3)

Status: implemented and tested against PostgreSQL 17 + Redis (`apps/api/src/phase3.int.test.ts`).

## Plans

- A plan has versions. A version is a **draft** until published, and only the latest published version can be bought.
- The first order (or staff-issued voucher) **locks** a version; a database trigger then refuses any change, including removing the lock. Changing terms means creating and publishing a new version. Earlier buyers keep the terms and price they bought (tested).
- Prices are entered as decimal strings ("1500.50") and stored as integer kobo. Floats are rejected.
- Status: DRAFT → PUBLISHED ⇄ PAUSED → ARCHIVED. Paused and archived plans leave the catalog and can't be ordered.
- Public catalog: `GET /api/v1/catalog/properties/:slug/plans` shows everything a customer must see before paying (spec §10): price, duration, activation rule, redemption window, device limit, speed (marked "not guaranteed"), sharing limits, renewal rule, fair use and refund terms. Cached 60 s; caching never affects payment or access decisions.

## Orders

`POST /api/v1/orders` with an `Idempotency-Key` header.

- The price comes from the plan version on the server. Any amount in the request body is rejected as an unknown field.
- **Idempotency:** the first request claims the key. The order and the stored response commit in one transaction. Retries replay the same response, and parallel duplicates create exactly one order (tested). The same key with a different body is refused. A claim abandoned by a crash is retaken after 60 s.
- **Who can buy:** signed-in tenants, or guests with a phone number (individual plans only). Staff can't buy; they issue vouchers. Room and floor plans need explicit purchase authority for that exact room or floor (Phase 2).
- **Guest order access:** the response includes an order token (an HMAC of the order ID with a server key), and the database stores only an HMAC of that token. Without the token, or as a different tenant, the order is "not found".
- Online sales are refused unless `PAID_ACCESS_ENABLED=true`, which must stay off until the legal gates pass.
- Orders expire 30 minutes after creation if unpaid (the expiry job comes with Phase 4). Payment initiation is Phase 4.

## Vouchers

Every purchase or issuance creates three records (spec §8.5):

| Record       | Holds                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Subscription | The contract: immutable plan snapshot, owner, scope target, linked order (if paid)                     |
| Entitlement  | What the network should allow: limits, speed, activation deadline, start/expiry, desired network state |
| Voucher      | The credential: keyed verifier only, last-4 hint, issuance type/issuer/reason, redeem-by               |

- **Codes:** 12 characters, about 59.4 bits of entropy, shown as `XXXX-XXXX-XXXX`. They are returned **once** at issue or reissue and never stored, logged or shown again. Staff see only the last 4 characters.
- **Staff issuance** (`voucher.issue`): types COMPLIMENTARY, MANUAL or PROMOTIONAL, always with a reason. The type PAID can't be chosen by staff; it only comes from a verified payment (Phase 4). Bulk issue is capped at 50 and needs `confirmBulk: true`.
- **Management** (`voucher.manage`): suspend, reinstate, revoke and reissue, all following the state machine and all audited with a reason. Reissue revokes the old code and moves bound devices to the new one.

## Redemption engine

`RedemptionService.redeem({ propertyId, code, macAddress, userId, clientKey })`

1. Rate limits: 10 attempts per hour per client, and 600 per hour per property (fails closed if Redis is down).
2. The code is normalised, its keyed verifier is computed, and the voucher row is **locked** (`SELECT … FOR UPDATE`) for the whole decision.
3. The domain rules decide (`evaluateRedemption`): property, status, payment or issuance record, deadline, expiry (exclusive), device limit, and group membership for room/floor vouchers.
4. On success, in the same transaction:
   - the device is bound
   - the voucher becomes ACTIVE (or EXHAUSTED at the device limit)
   - the entitlement moves to PROVISIONING with the desired state ACTIVE
   - the clock starts if the policy is `ON_FIRST_REDEMPTION`
   - a `network.activate` outbox event is queued for the worker
   - an audit entry is written
5. Public answers are coarse: an unknown, malformed, revoked, unpaid or other-property code all return `INVALID_VOUCHER`.

**Concurrency evidence:** 12 devices redeeming one 2-device voucher at once bind exactly 2. The same device redeeming 8 times at once binds once (tested, repeated runs).

### Why there is no public redeem endpoint yet

The engine needs two facts the browser can't be trusted to supply: which property's network the device is on, and the device's identity. Both must come from the gateway, either as captive-portal parameters the gateway vouches for or through RADIUS (ADR-0004). Exposing the endpoint before Phase 6 would let anyone use up a voucher's device slots with invented MAC addresses. The endpoint is added with the gateway integration.

### Activation policy

| Policy                                 | Clock starts                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ON_PURCHASE`                          | At issue or payment (disclosed in the catalog)                                                                                     |
| `ON_FIRST_REDEMPTION`                  | At the first successful redemption                                                                                                 |
| `ON_FIRST_AUTHORIZATION` (recommended) | When the gateway confirms the first real network login (Phase 6). Until then the entitlement stays PROVISIONING with no expiry set |

## Limitations

- **Group membership for room/floor vouchers:** the redemption engine enforces it, but managing members (add/remove, purchaser as manager) is built in Phase 5.
- **Device binding uses MAC addresses,** which phones may randomise per network. A device-slot release and recovery flow arrives with the tenant portal (Phase 7).
- **Order expiry and payment** are Phase 4.
