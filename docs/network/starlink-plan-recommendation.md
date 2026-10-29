# Starlink Plan and Kit Recommendation

Date: 2026-10-29. Prices and plan names come mostly from news and reseller sources and **must be confirmed on starlink.com / with Starlink Nigeria** before buying.

## What NetFlex needs from the uplink

1. **Terms that allow reselling access to tenants.** This is the deciding factor. Starlink's terms bar resale except community Wi-Fi/hotspot on **Priority** plans (other-market terms; Nigeria text to be confirmed in writing).
2. **Fixed, 24/7 operation** at one building, through a separate gateway (captive portal, vouchers).
3. **Enough capacity and data** for many tenants at the evening peak.

## Recommendation

| Item       | Recommendation                                                                                                                                                                                        | Why                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan       | **Business Priority** (Nigeria; reported ₦159,000/month, 1–2 TB priority data, public IPv4, available in Lagos/Abuja/Port Harcourt since Feb 2026). Choose the **largest priority-data tier** offered | The only tier whose terms (elsewhere) permit community Wi-Fi resale; priority data keeps speeds up at peak; a public IPv4 simplifies remote management |
| Kit        | **Standard kit (Gen 3)**, fixed roof mount                                                                                                                                                            | Built for fixed sites; roughly twice the Mini's throughput; rugged for permanent outdoor use                                                           |
| Mini       | Keep for testing/proof-of-concept (no selling), or as an owner backup                                                                                                                                 | Portable kit, about 100 Mbps class; one non-PoE Ethernet port; not designed to serve a whole building                                                  |
| Not needed | Flat High Performance                                                                                                                                                                                 | Built for in-motion use (vehicles, boats)                                                                                                              |
| Power      | UPS/inverter for the dish, gateway, switch and APs                                                                                                                                                    | Outages otherwise cut every tenant                                                                                                                     |

## Sizing (to confirm once the room count is known)

Assumptions: about 3 GB per active tenant per day (video and social media), and about 60% of tenants online at the evening peak.

| Lodge size      | Monthly data (approx.) | Peak share of a ~150 Mbps link | Setup                                                                                                                      |
| --------------- | ---------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Up to ~15 rooms | ~1.3 TB                | ~15 Mbps each                  | 1 Standard kit + Business Priority (1 TB tier or above)                                                                    |
| ~15–40 rooms    | 1.3–3.6 TB             | 6–15 Mbps each                 | 1 Standard kit + **largest priority tier**; plan speed limits per voucher                                                  |
| 40+ rooms       | 3.6 TB+                | under 6 Mbps each              | **Two terminals on two service lines**, load-balanced by the gateway (Local Priority allows one terminal per service line) |

After the priority allowance is used, Starlink keeps service going at lower priority, which means slower speeds at busy times. NetFlex plan speed limits (per-voucher rate caps) keep one heavy user from slowing everyone else.

## Before buying

1. **Written confirmation from Starlink Nigeria:** community Wi-Fi resale to tenants is allowed on Business Priority at this address, and which kits are supported.
2. **Adviser:** whether an NCC licence is needed to resell internet access (gate G3).
3. **Site survey:** dish location with a clear sky view, cable route, and power.

Sources: Legit.ng (2026-02-26), TechCabal (2026), mobility.com.ng, zuralink.ng (Oct 2026), the Starlink support article on Local/Global Priority, hardware comparisons (SlashGear, US Mobile), and the RV Mobile Internet bypass guide. See the chat log of 2026-10-29 for links.
