# Gateway Proof-of-Concept Test Plan (spec §11.4)

Status: **not run — blocked on hardware.** To be executed on the selected physical gateway before any real adapter is enabled. Record the results in `docs/test-results/<date>-gateway-poc.md`.

## Setup for this site

```
Starlink Mini (Bypass Mode ON) ──Ethernet── Gateway (captive portal + NetFlex adapter)
                                              ├── switch ── access points ── rooms/floors
                                              └── WireGuard/VPN to NetFlex cloud (Residential = CGNAT, no inbound)
```

- The Mini's built-in Wi-Fi is switched off by Bypass Mode; the gateway serves all clients.
- The gateway needs **its own power**: the Mini's Ethernet port supplies no PoE.
- Management path: the gateway dials **out** to the NetFlex VPN hub (ADR-0004). With Business Priority's reported public IPv4 this can be simplified, but management is still never exposed publicly.

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
