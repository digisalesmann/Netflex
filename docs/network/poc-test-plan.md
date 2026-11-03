# Gateway Proof-of-Concept Test Plan (spec §11.4)

Status: **not run yet.** The software is ready (Omada adapter, lodge link, tested against a simulated Omada controller); this plan runs on site once [omada-setup.md](omada-setup.md) is done. Record the results in `docs/test-results/<date>-gateway-poc.md`.

## Setup for this site

```
Starlink router ── ONV PoE switch ──┬── 3× TP-Link EAP115 v4 (one per floor)
                                    └── office laptop: Omada Software Controller + NetFlex lodge link
                                          └── HTTPS out to netflexhq.com (no public IP needed)
```

What this hardware can and can't do (shown in Office → Network):

- **Can:** captive portal, switch a device on for exactly the plan's time (Omada ends it itself, even if the internet drops), one device per authorization, health status.
- **Needs the Omada Open API set up:** switching a device off early (refunds, removing a device), seeing who's online.
- **Can't (on controller 5.x):** speed limits per plan, room/floor zones. The live plans use neither. Controller 6.2.10+ accepts speed limits; add them later if wanted.

Omada-specific checks, before the tests below: the **time format** (a 1-day code shows ~24 h in Authorized Clients) and the **unauthorize path**, as in omada-setup.md step 7.

## Record for every run

- Gateway make/model/firmware, AP and switch models, and the config export with **secrets removed**.
- Test devices: Android (Chrome), iPhone (Safari, captive mini-browser), Windows/macOS laptop.
- For each test: steps, expected result, actual result, evidence (screenshots, logs with request IDs), limitations.

## Tests

| #   | Test                                     | Pass criteria                                                                                      | NetFlex piece exercised                              |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Captive portal redirect                  | All three device types land on the portal; "open in browser" fallback works on iOS                 | Gateway walled garden + portal                       |
| 2   | Voucher validation                       | Valid code accepted; wrong, revoked and expired codes get the same generic message                 | `RedemptionService` + gateway context                |
| 3   | Paid voucher only after verified payment | A Paystack test payment produces a code; an unpaid order does not                                  | `PaymentEngine` (already live-verified in test mode) |
| 4   | Individual provisioning                  | Read-back matches; status ACTIVE; client can browse                                                | `NetworkEngine` apply + read-back                    |
| 5   | Room/floor scope                         | A member gets in, a non-member doesn't; zone limits enforced if VLAN/SSID per floor exists         | Group rules + `zones`                                |
| 6   | Device and session limits                | A third device is refused on a 2-device plan; concurrent-session cap enforced by the gateway       | Device binding + gateway policy                      |
| 7   | Speed limit mapping                      | Measured download/upload ≈ plan values, in the right direction                                     | `downloadKbps` / `uploadKbps`                        |
| 8   | Session disconnect                       | Staff/tenant device release drops the session within seconds                                       | `disconnectDevice`                                   |
| 9   | Expiry and revocation                    | Access ends at expiry (cloud) **and** via the gateway's own timeout with the cloud disconnected    | `expireDue` + gateway timeout                        |
| 10  | Router reboot / app outage               | After a reboot, reconciliation restores policy; existing sessions behave as documented             | Reconciliation + drift repair                        |
| 11  | Gateway loss / recovery                  | Operations retry and complete after the gateway returns; nothing is revoked while it's unreachable | Retries + unreachable rule                           |
| 12  | Real browsing                            | Each device browses real sites (not just the portal)                                               | End to end                                           |
| 13  | Interrupted provisioning                 | Kill the worker mid-operation; on restart the operation completes once                             | Durable operations + stalled sweep                   |
| 14  | Admin recovery if the cloud fails        | The break-glass procedure regains router access without exposing it publicly                       | Runbook (to write with the hardware)                 |

## Exit

All 14 pass, with evidence. Then:

1. Implement the real adapter against the exact firmware.
2. Remove the `mikrotik` refusal in config validation.
3. Update the capability matrix from **Doc** to **Verified**.
4. Mark Phase 6 complete.
