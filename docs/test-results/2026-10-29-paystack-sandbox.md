# Paystack sandbox verification — 2026-10-29

Environment: Paystack **test mode** with the owner's `sk_test_` key (in `.env`, never printed or committed). API base `https://api.paystack.co`.

## 1. Initialize (real API)

```
$ node --env-file=.env scripts/paystack-sandbox-check.mjs init <owner email>
{ "step": "init", "ok": true, "reference": "NFX-SANDBOX-MVTMR2QP",
  "checkoutUrl": "https://checkout.paystack.com/udg22r9on40y0o9", "amountMinor": "10000" }
```

## 2. Verify before payment (real API)

```
{ "status": "abandoned", "amountMinor": "10000", "currency": "NGN", "paidAt": null }
```

Finding: an open, unpaid checkout reports **`abandoned`**. The engine closed such payments immediately, which would have broken slow customers' payments. Fixed (commit 456a2fc): `abandoned` stays open for 48 h, with a regression test.

## 3. Owner paid with a Paystack test card; verify again (real API)

```
$ node --env-file=.env scripts/paystack-sandbox-check.mjs verify NFX-SANDBOX-MVTMR2QP
{ "status": "success", "amountMinor": "10000", "currency": "NGN",
  "paidAt": "2026-10-29T14:26:18.000Z",
  "checks": { "status": true, "amount": true, "currency": true, "reference": true }, "allPassed": true }
```

## 4. NetFlex PaymentEngine against the real transaction

Throwaway schema in `netflex_test` (migrated from zero, dropped afterwards). The order is priced ₦100.00, and the payment record references `NFX-SANDBOX-MVTMR2QP`. `PaymentEngine.settle()` was run with the real `PaystackProvider`:

```
{ "outcome": "SUCCEEDED_FULFILLED",
  "payment": { "status": "SUCCEEDED", "providerTransactionId": "6708899600", "verifiedAt": "2026-10-29T14:29:39.802Z" },
  "order": "PAID",
  "vouchers": [ { "issuanceType": "PAID", "status": "ISSUED" } ],
  "secondSettle": "ALREADY_FINAL",
  "realDataAgainstWrongPrice": { "ok": false, "mismatches": [ "AMOUNT" ] } }
```

## Still not live-verified

- **Webhook delivery from Paystack to NetFlex:** needs a public HTTPS URL. Signature verification is implemented per Paystack's documented scheme and tested with locally signed events, but no event sent by Paystack itself has been received yet.
- **Refunds against the real API:** not run. A test refund on this transaction can be done when wanted.
- **Live mode (`sk_live_`):** not used. It requires legal gate G1, which currently fails.
