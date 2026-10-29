# Payments: Setup, Flow, Reconciliation and Refunds

Status: the payment engine is **implemented and tested against a test-only provider that mimics Paystack** (`apps/api/src/phase4.int.test.ts`). The Paystack adapter is **implemented but not live-verified**: the real sandbox run needs the owner's test key (below). Verified Paystack facts and their sources are in [paystack-reference.md](paystack-reference.md).

## Flow

1. `POST /api/v1/orders`: an order with a server-computed price (Phase 3).
2. `POST /api/v1/orders/:id/checkout` with `{ email }` and an `Idempotency-Key`:
   - a Payment row is created **before** Paystack is called (reference `NFX-XXXX-XXXX-<6 hex>`);
   - the customer is sent to `checkoutUrl`;
   - at most 3 open attempts per order.
3. The customer pays on Paystack and is redirected to `PUBLIC_WEB_URL/checkout/return?order=<id>`. **The redirect proves nothing.** The page calls `POST /orders/:id/payment/verify`, which asks Paystack directly.
4. Paystack sends a webhook to `POST /api/v1/webhooks/paystack`:
   - the signature (HMAC-SHA512 over the raw body) is checked;
   - the event is stored once, deduplicated by a fingerprint of the body;
   - an outbox job is written in the same transaction, and the API answers 200 immediately.
5. The worker runs the job and **re-verifies with the Paystack API**. Only an exact match of reference, amount and currency with status `success` marks the payment SUCCEEDED. In the same transaction:
   - the order becomes PAID;
   - the subscription, entitlement and PAID voucher are created;
   - an encrypted copy of the code is stored for the buyer;
   - a `notification.voucher_ready` outbox event is written.
6. The buyer retrieves the code with `POST /orders/:id/voucher`. This works only as the owner, only while the voucher is unused, and only for 72 hours; then the encrypted copy is deleted.

## What happens when things go wrong

| Situation                                        | Behaviour                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Forged, tampered or unsigned webhook             | 401; nothing stored                                                                                            |
| Duplicate webhook delivery                       | Stored once; processing is idempotent                                                                          |
| Webhook says success, Paystack says pending      | Nothing changes (the webhook body is never trusted)                                                            |
| Wrong amount or currency                         | Payment FAILED with `MISMATCH:…`; **no access**; discrepancy for staff to refund                               |
| Charged twice for one order                      | Both charges recorded SUCCEEDED; access issued once; discrepancy for refund                                    |
| Success arrives after NetFlex closed the payment | Payment record unchanged; `LATE_SUCCESS_ON_CLOSED_PAYMENT` discrepancy                                         |
| Paystack down at checkout                        | 503 "You have not been charged"; attempt closed `INIT_<code>`                                                  |
| Paystack down during verification                | Job fails and retries with backoff; payment stays PENDING                                                      |
| Webhook never arrives                            | Reconciliation (every 5 min) verifies payments pending for over 5 minutes                                      |
| Customer never pays                              | Order EXPIRED after 30 minutes once no attempt is open; attempts still pending after 48 hours close as EXPIRED |
| Paid but provisioning fails later                | Order stays PAID; network retries; never re-charged (Phases 5–6)                                               |

## Refunds

1. Someone with `payment.refund.request` requests an amount (up to what is still refundable) with a reason.
2. **A different person** with `payment.refund.approve` approves. This is enforced in code and by a database CHECK.
3. The worker submits it to Paystack. The refund is marked SUBMITTED **before** the call. If the call times out, the outcome is unknown, so it is **not retried**; it becomes a discrepancy for a human to check on the Paystack dashboard. This prevents double refunds.
4. The refund completes only when Paystack confirms `processed`, via a webhook or reconciliation, through `GET /refund/:id`. Then:
   - the payment becomes PARTIALLY_REFUNDED or REFUNDED;
   - on a full refund, the order becomes REFUNDED;
   - **unused** vouchers are revoked;
   - vouchers already in use are left for an operator to decide (spec §13.5), and the audit log records that.

## Owner setup (Paystack test mode)

1. In the Paystack dashboard (test mode), copy the **test secret key** (`sk_test_…`).
2. Put it in `.env` on the server or development machine. **Never paste it into chat, email or git.**
   ```
   PAYMENT_PROVIDER=paystack
   PAYSTACK_SECRET_KEY=sk_test_...
   ```
3. Run the live check:
   ```sh
   npm run build
   node --env-file=.env scripts/paystack-sandbox-check.mjs init you@example.com
   # open the printed checkout URL, pay with a Paystack test card
   node --env-file=.env scripts/paystack-sandbox-check.mjs verify <reference>
   ```
4. For webhooks, set the webhook URL in the dashboard to `https://<api-domain>/api/v1/webhooks/paystack`. Local testing needs a public tunnel; the production URL needs the hosted API.
5. Production uses the live key (`sk_live_…`). Config validation refuses a test key in production and a live key anywhere else. `PAID_ACCESS_ENABLED` must stay `false` until the legal gates pass.

## Operations

- Payment views: `GET /api/v1/admin/properties/:id/payments`, `…/payments/:paymentId` (includes refunds, discrepancies and webhook history).
- Re-check one payment: `POST …/payments/:paymentId/verify` (`payment.reconcile`).
- Discrepancy queue: `GET …/discrepancies`; close with `POST …/discrepancies/:id/resolve` and a written resolution. The record is kept.
