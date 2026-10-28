# NetFlex — Questions for the Owner

## Answers received

| Date       | Question               | Answer                                               | Effect                                                                                                                                                                                                  |
| ---------- | ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-28 | Q1 dev environment     | "Proceed with the overall best recommended approach" | Node.js 22 installed per-user in `~/.local/node`; PostgreSQL 17 (embedded-postgres) and Redis 7.2 (built from source, `~/.local/redis`) run without Docker or admin rights via `npm run services:start` |
| 2026-10-28 | Q2 version control     | Same instruction                                     | Local git repo created on `main`; no remote yet                                                                                                                                                         |
| 2026-10-28 | Q3 Starlink            | Plan unknown; account registered in **Nigeria**      | Gate G1 stays open; paid access stays disabled                                                                                                                                                          |
| 2026-10-28 | Q4–Q10 policy defaults | Delegated ("best recommended approach")              | Recommended defaults adopted **provisionally** (assumptions A3, A7, A10, A11, A12, A16). Owner should confirm before launch                                                                             |

Please answer in writing (this file, email, or a reply). Don't send passwords or API keys here — see discovery report §4.1.

## Urgent — blocks work starting this week

1. **Dev environment:** may we install Node.js 22 LTS and Docker Desktop (or PostgreSQL 16 + Redis 7) on this Mac, or should development run in a cloud dev environment? _(Nothing can be built or tested until this is resolved.)_
2. **Version control:** may we initialise a git repository here, and is there a GitHub/GitLab remote to push to?

## High — needed before Phases 3–5 are finalised

3. **Starlink:** which plan is the account on (Residential, Roam, Priority, Local Priority, other), and in which country is it registered? Can you get written confirmation that paid Wi-Fi for tenants is allowed?
4. **Activation:** should a plan's time start at purchase, at voucher redemption, or at first successful connection? (Recommended: first successful connection, with a 30-day redemption deadline.)
5. **Who issues vouchers:** tenants buying online, staff issuing them, or both?
6. **Room/floor plans:** who is allowed to buy them, how are members added/removed, and what's the maximum number of devices per room/floor plan?
7. **Renewals:** if someone renews early, should the new time stack after the current expiry? (Recommended: yes.)
8. **Plans:** draft price list, durations, device limits, and speed policy.
9. **Refunds:** when are refunds allowed (e.g. only before first use)?
10. **Accounts:** may guests buy without creating an account (phone number for receipt/recovery only)?

## Medium — needed before Phase 6 (hardware)

11. Router/gateway make, model, and firmware; who has admin access.
12. Access point and switch models; is there a controller (UniFi, Omada, etc.)?
13. Number of buildings, floors, rooms; rough number of tenants and devices at peak.
14. One SSID for everyone, or separate SSIDs/VLANs per floor?
15. Power backup for network equipment and how long it lasts.
16. Budget and willingness to buy a dedicated gateway (e.g. a MikroTik model) if the current router can't do the job.

## Before launch

17. Production domain name and preferred hosting provider/region.
18. Paystack business account status (test keys for Phase 4; live approval later).
19. SMS/OTP provider preference (or none at launch) and email provider.
20. Support phone/email/WhatsApp and support hours.
21. Legal/tax adviser for Nigerian requirements (gate G3) and review of terms/privacy text.
22. Where alerts should go (email, SMS, WhatsApp, Slack).
23. Brand: name usage, logo, colours, or approval of a neutral proposed brand.
