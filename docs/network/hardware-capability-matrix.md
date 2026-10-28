# NetFlex — Hardware Capability Matrix

Date: 2026-10-28 · Status: **No hardware tested.** All "supported" entries are vendor-documented claims only.

Legend for the per-candidate columns:

- **Doc** — documented by the vendor; **not tested** by NetFlex.
- **Partial** — documented with limits, or only through a non-public/unstable API.
- **?** — unknown; needs research or a PoC.
- **No** — documented as unsupported.

Existing gateway: **make/model unknown** — every cell is `?` until the owner provides it.

| Capability                        | Required            | MikroTik RouterOS v7 (candidate)                                  | UniFi (alternative)                                        | Existing gateway | Evidence / source                                         | Test needed (PoC §11.4)              | Impact if missing                                              |
| --------------------------------- | ------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- | --------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Captive portal + HTTP redirect    | **Yes**             | Doc (HotSpot)                                                     | Doc (Hotspot portal)                                       | ?                | MikroTik HotSpot docs; UniFi hotspot docs (to be re-read) | #1 redirect on Android, iOS, laptop  | No product without it                                          |
| Voucher / local users             | **Yes**             | Doc (HotSpot users; User Manager)                                 | Doc (built-in vouchers)                                    | ?                | MikroTik AAA manual 7.25                                  | #2                                   | Must use RADIUS or external portal instead                     |
| External portal integration       | **Yes**             | Doc (custom login pages, walled garden)                           | Doc (external portal)                                      | ?                | MikroTik HotSpot docs                                     | #1, #12                              | Branded flow + payments impossible on captive page             |
| API / controller automation       | **Yes**             | Doc (REST API since 7.1, HTTP Basic auth; classic API)            | Partial (controller API; stability/officialness to verify) | ?                | help.mikrotik.com REST API                                | #4, #13                              | Must rely on RADIUS only                                       |
| RADIUS auth/accounting            | Preferred           | Doc (HotSpot `use-radius`, accounting, interim updates)           | Doc (RADIUS for WPA-Enterprise; hotspot RADIUS ?)          | ?                | help.mikrotik.com RADIUS                                  | #2, #6, #9                           | Lose hashed-voucher auth + gateway-enforced timeout (ADR-0004) |
| Per-user/device bandwidth shaping | **Yes**             | Doc (profile `rate-limit`, `Mikrotik-Rate-Limit` RADIUS attr)     | Doc (per-voucher limits)                                   | ?                | MikroTik docs (attr name from secondary guide — verify)   | #7 incl. up/down direction           | Speed policy can't be sold                                     |
| Group/shared bandwidth policy     | ROOM/FLOOR          | Partial (queue trees / PCQ / address lists — design needed)       | ?                                                          | ?                | —                                                         | #5                                   | Room/floor plans share per-device limits only                  |
| Concurrent-session limits         | **Yes**             | Doc (`shared-users`)                                              | ?                                                          | ?                | MikroTik HotSpot profile docs                             | #6                                   | Device limits enforced only at redemption, not network         |
| Session disconnect                | **Yes**             | Doc (remove `/ip/hotspot/active`; RADIUS Disconnect/CoA incoming) | ?                                                          | ?                | MikroTik RADIUS docs                                      | #8                                   | Revocation waits until session timeout                         |
| Usage counters                    | Optional            | Doc (active session bytes; RADIUS accounting)                     | Doc (controller stats)                                     | ?                | —                                                         | compare with independent measurement | Show "usage unavailable"                                       |
| Scheduled expiry (gateway-side)   | **Yes** (2nd layer) | Doc (`limit-uptime`, RADIUS `Session-Timeout`)                    | Doc (voucher duration)                                     | ?                | —                                                         | #9, #10                              | Relies solely on cloud revocation                              |
| VLAN / SSID / zone support        | ROOM/FLOOR          | Doc (VLANs; HotSpot per interface) — APs determine SSID→VLAN      | Doc                                                        | ?                | —                                                         | #5                                   | Room/floor enforced by identity only                           |
| Health/status access              | **Yes**             | Doc (`/system/resource`, `/system/health`)                        | Doc                                                        | ?                | —                                                         | #11                                  | No gateway health dashboard                                    |
| Secure remote management          | **Yes**             | Doc (WireGuard client in v7 — router dials out)                   | Doc (cloud controller)                                     | ?                | —                                                         | #14 + CGNAT test                     | Cannot manage from cloud through Starlink CGNAT                |
| Firmware / vendor lifecycle       | **Yes**             | ? (check model EOL, local availability in Nigeria)                | ?                                                          | ?                | —                                                         | —                                    | Supportability risk                                            |

## Next steps to fill this matrix

1. Owner supplies the existing gateway/AP/switch models (discovery report §4).
2. Re-read current official docs for each candidate's hotspot, RADIUS, and API sections; replace "Doc" with exact doc links and RouterOS/UniFi versions.
3. Decide candidate (ADR-0004 update) after comparing cost, local availability, operator skill, and capacity.
4. Run the 14-point PoC on the chosen hardware; record model, firmware, config export (secrets stripped), devices, expected/actual results in `docs/network/poc-report.md`.
