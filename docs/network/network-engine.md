# Network Engine (Phase 6, hardware-independent part)

Status: **simulated in isolated tests only.** Everything below runs against `FakeNetworkAdapter`, a test-only simulated gateway that enforces nothing on a real network. **No real router has been driven yet.** The real adapter is blocked until the gateway hardware is chosen and passes the proof-of-concept ([poc-test-plan.md](poc-test-plan.md)).

## Contract (`packages/network`)

`NetworkAdapter`:

- `getCapabilities`, `healthCheck`
- `applyEntitlement(desired)`, `revokeEntitlement`, `disconnectDevice`
- `readEntitlement` (read-back), `listActiveSessions`

Rules every adapter must follow:

- **Capabilities are declared honestly.** If a desired state needs an unsupported capability (for example a rate limit), the adapter returns `UNSUPPORTED`. It never "applies" something it can't enforce.
- **The full desired state is applied every time** (idempotent), never a delta.
- **Results are structured** with safe details. Never raw router output, addresses or credentials.

## Engine (`packages/core/src/network.ts`)

| Step                                                                        | Behaviour                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command arrives                                                             | An outbox event (`network.activate / suspend / revoke / disconnect / apply_policy`) creates **one durable `NetworkOperation`** (idempotency key = outbox event ID)                                                                                         |
| Desired state                                                               | **Always recomputed from the database** at run time: status, bound devices, speed limits, session limit, expiry, room/floor zones. So retries and out-of-order commands converge (tested: a stale "activate" after a revoke leaves nothing on the gateway) |
| Mutation                                                                    | Apply, revoke, or disconnect through the adapter                                                                                                                                                                                                           |
| **Read-back**                                                               | `readEntitlement` must match the desired state exactly; "API said OK" is not proof (spec §3.14). Mutation-tested                                                                                                                                           |
| Success                                                                     | Operation SUCCEEDED, observed state recorded. Access becomes ACTIVE **only when the gateway confirms it and the access window exists**                                                                                                                     |
| Temporary failure (unreachable, rejected, read-back mismatch)               | RETRY_SCHEDULED with backoff (5 s doubling, capped at 15 min), up to 8 attempts                                                                                                                                                                            |
| Permanent failure (unsupported, credentials rejected) or attempts exhausted | FAILED. Activating access moves to `PROVISIONING_FAILED` ("needs attention"), with a `NETWORK_DRIFT` discrepancy and audit entry. **Paid access stays paid.** It is never re-charged                                                                       |
| No gateway registered                                                       | FAILED `NO_GATEWAY_CONFIGURED`. Access stays "being configured", with no false failure                                                                                                                                                                     |
| Real vendor, no adapter yet                                                 | FAILED `ADAPTER_NOT_IMPLEMENTED`                                                                                                                                                                                                                           |
| Lost retry job                                                              | `resumeStalledOperations()` re-runs retries overdue by more than 30 minutes (part of reconciliation)                                                                                                                                                       |
| Manual replay                                                               | `POST …/network/operations/:id/retry` (`network.operate`, reason required). Safe because it re-applies current desired state                                                                                                                               |

## Reconciliation (every 5 min, plus `POST …/network/reconcile`)

1. Health check: gateway status, last healthy time, capabilities, firmware.
2. **Gateway unreachable → change nothing.** Access is never revoked because one source is down (tested).
3. Sync sessions into `network_sessions`; mark vanished sessions ended.
4. A session for **ended** access → `EXPIRED_BUT_ACTIVE_ON_GATEWAY` discrepancy and a revoke. The database is the truth for expiry.
5. A session with **no** access at all → `SESSION_WITHOUT_ENTITLEMENT` discrepancy (flagged; the gateway's own auth should never allow this).
6. **ON_FIRST_AUTHORIZATION:** the first real login seen on the gateway starts the clock, sets the expiry, makes access ACTIVE, and pushes the absolute expiry to the gateway (tested).
7. Desired vs actual for every entitlement the gateway should know about. Drift → discrepancy and a corrective command (tested with config removed by hand).

## Administration (`/api/v1/admin/properties/:id/…`)

| Endpoint                                                                                                                                                                     | Permission        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `GET gateways`, `GET network/operations`, `GET network/sessions`                                                                                                             | `network.read`    |
| `POST gateways` (name, vendor, model, firmware, **credentialRef**), `…/health-check`, `…/disable`, `…/enable`, `POST network/reconcile`, `POST network/operations/:id/retry` | `network.operate` |

- `credentialRef` is a **secret name** (`[A-Z][A-Z0-9_]+`, e.g. `MAIN_ROUTER`). The server reads `NETFLEX_GATEWAY_<REF>` from its secret store. URLs, IPs, passwords and unknown fields are rejected (tested).
- **No endpoint runs router commands** (tested: 404).
- `vendor: FAKE` is accepted only when `NETWORK_ADAPTER=fake` (development/test). Config refuses `NETWORK_ADAPTER=mikrotik` until the PoC passes.
