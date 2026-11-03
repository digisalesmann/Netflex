# Launch checklist: ND Lodge Wi-Fi

Tick each line and write the date and who checked it. Paid Wi-Fi is switched on (section D) only when sections A–C are all ticked.

## A. Already done (3 November 2026)

- [x] Website live at `https://netflexhq.com` (Railway, Cloudflare DNS, HTTPS)
- [x] Residents sign in with an email code (Resend, sending from `wifi@netflexhq.com`)
- [x] Paystack live keys set; Paystack compliance approved
- [x] Lodge, 3 floors, 31 rooms and plans (Daily ₦400, Weekly ₦2,500, Monthly ₦8,000) created
- [x] Office live: residents, rooms, plans, vouchers, payments and refunds, network, support, staff, activity, settings
- [x] Emails: sign-in codes, receipts, "plan ending" reminders, owner alerts
- [x] Terms, privacy and refund policies published and marked reviewed
- [x] Security review ([report](../security/security-review-2026-11.md)), load test ([results](../test-results/2026-11-03-load-test.md)), accessibility audit ([results](../test-results/2026-11-03-accessibility.md))
- [x] All automated tests passing (432 unit and integration, plus end-to-end on desktop and phone)

## B. Owner actions (no hardware needed)

- [ ] Add a second owner in Office → Staff, with their own authenticator app
- [ ] Turn on two-step sign-in for Railway, Paystack, Resend, Cloudflare and Gmail
- [ ] Paystack (live mode) → Settings → API Keys & Webhooks → Webhook URL = `https://netflexhq.com/api/v1/webhooks/paystack`
- [ ] Railway → Postgres → Backups → schedule **Daily** and **Weekly** ([runbook](../runbooks/backups-and-restore.md))
- [ ] Run the off-site backup once: `sh scripts/ops/backup-db.sh` (it should print "Saved …")
- [ ] File the Starlink confirmation and the adviser's memo with [legal-feasibility-gates.md](../legal-feasibility-gates.md) (gates G1–G3)
- [ ] Office → Settings: check the lodge phone and email residents will see
- [ ] Brief the office staff with the [office guide](../runbooks/office-guide.md)

## C. On-site Wi-Fi work (Phase 6, paused by the owner)

The equipment: Starlink router → ONV PoE switch → 3 TP-Link Omada EAP115 access points (one per floor).

- [ ] Office laptop on a cable to the switch, set never to sleep, on a surge protector
- [ ] Free Omada Software Controller installed on the laptop; the three EAP115s adopted
- [ ] Guest network with the Omada portal set to send people to `https://netflexhq.com/connect`
- [ ] The "lodge link" program on the laptop connected to netflexhq.com (the site has no public IP, so the laptop connects out)
- [ ] `NETWORK_ADAPTER` set for Omada on Railway; Office → Network shows the equipment as healthy
- [ ] On-site proof of concept passed ([poc-test-plan.md](../network/poc-test-plan.md)): a code turns Wi-Fi on, expiry turns it off, a second device beyond the plan's limit is refused, speed is fine in every hallway (gates G4–G7)
- [ ] Break-glass: staff can still reach the Omada controller and Starlink app if netflexhq.com or the internet is down (gate G7)

## D. Switching on paid Wi-Fi

Do this on a weekday morning, with the owner and the engineer on site.

1. **Free test first.** In Office → Vouchers → **Make vouchers**, make one Daily code (note "launch test"). On a phone on the guest Wi-Fi, open any website, enter the code on the sign-in page, and check the phone gets online.
2. **Switch on.** Railway → **api** → Variables → `PAID_ACCESS_ENABLED` = `true` → Deploy. Do the same on **worker**.
3. **One real purchase.** On a resident's phone (or your own), buy the **Daily ₦400** plan with a real card:
   - [ ] Paystack payment succeeds
   - [ ] The code shows on screen, and a receipt email arrives
   - [ ] The code gets the phone online within a minute
   - [ ] Office → Payments shows the payment as Paid
   - [ ] Office → Network shows the device online
4. **Refund test.** Office → Payments → that payment → **Refund**, then a second manager or owner approves it under Payments → Refunds. Check Paystack shows the refund.
5. **The next day:** check the Daily plan really switched off after 24 hours.
6. Tell residents: put up the notice with the QR code to `netflexhq.com` in each hallway.

**If anything in steps 3–4 fails:** set `PAID_ACCESS_ENABLED` back to `false` on api and worker, refund anyone charged, and fix before trying again. Residents can't be charged while it's `false`.

## E. First week after launch

- [ ] Each morning: Office → Overview: nothing under "Needs attention"
- [ ] Owner alert emails: none, or each one handled
- [ ] Paystack payouts arriving in the bank account
- [ ] Support messages answered within a day
- [ ] End of week: the off-site backup run again

Signed off by the owner: ______________________ Date: __________
