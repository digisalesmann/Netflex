# Router and Wi-Fi shopping list (ND Lodge)

Date: 2026-11-03 · Status: recommendation, nothing bought or tested yet. Prices are rough estimates; check local sellers (Jumia, Computer Village, MikroTik resellers in Lagos/Abuja).

Layout: **Starlink Mini (bypass mode) → MikroTik gateway → PoE switch → ceiling access points**. The gateway runs the sign-in page and switches each paying device on and off; the app controls it over its API.

## Buy

| #   | Item                   | Recommended model                                                     | How many                                     | Why                                                                                   |
| --- | ---------------------- | --------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Gateway router         | **MikroTik hEX S** (RB760iGS); RB5009 if 40+ rooms                    | 1                                            | Hotspot/captive portal, per-device limits, REST API, WireGuard for remote management  |
| 2   | Access points          | **MikroTik cAP ax** (ceiling, Wi-Fi 6, PoE powered)                   | 1 per corridor or every 4–6 rooms, per floor | Same vendor as the gateway, so one set of settings; managed centrally                 |
| 3   | PoE switch             | **MikroTik CSS610-8P-2S+IN** or any 8-port PoE+ switch                | 1                                            | Powers the access points over the network cable                                       |
| 4   | Network cable          | Cat6, solid copper (not CCA), plus RJ45 ends/boots                    | Measure: switch to each access point + 10%   | CCA cable fails early and can't carry PoE well                                        |
| 5   | Backup power           | Line-interactive UPS, ~1 kVA, or a small inverter                     | 1                                            | Keeps Starlink, router and switch up through NEPA cuts; a power cut drops every guest |
| 6   | Surge protection       | Surge-protected power strip                                           | 1                                            | Protects the gear on the same circuit                                                 |
| 7   | Starlink Mini Ethernet | Check the Mini's port; buy Starlink's Ethernet adapter if it has none | 1                                            | The gateway must be wired to Starlink, not over Wi-Fi                                 |

## Small-lodge example (about 12 rooms, 2 floors)

1 hEX S + 2–3 cAP ax + 1 PoE switch + ~60 m Cat6 + 1 UPS. Rough total **₦450,000–₦800,000**, before installation.

## Before buying

- **Room count and floors:** tell us, and we'll size the access points.
- **Starlink capacity:** the Mini is a portable kit. Measure speed at the busiest hour; if it can't carry the lodge, plan for a Starlink Standard kit on the business plan.
- **Installer:** pick someone who has set up a MikroTik hotspot before. We'll give them the exact settings after the on-site test ([poc-test-plan.md](poc-test-plan.md)).
