# Paystack: Verified Integration Facts

Checked 2026-10-29. paystack.com/docs blocks automated readers (HTTP 403), so the facts below come from Paystack's own published sources:

- **API description:** `PaystackOSS/openapi`, `dist/paystack.yaml` (last pushed 2026-06-09).
- **Documentation code snippets:** `PaystackOSS/doc-code-snippets`, `dist/doc/payments/webhooks/*`, `dist/api/webhook-endpoints/*`.

| Fact                  | Value                                                                                                                                                                                                                | Source                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Base URL              | `https://api.paystack.co`                                                                                                                                                                                            | openapi `servers`                       |
| Auth                  | `Authorization: Bearer <secret key>`                                                                                                                                                                                 | openapi `security`, snippets            |
| Initialize            | `POST /transaction/initialize`. Required: `email`, `amount`. Optional: `currency`, `reference`, `callback_url`, `metadata`, `channels`                                                                               | openapi `TransactionInitialize`         |
| Amount unit           | "smallest denomination of the currency" (kobo for NGN), integer                                                                                                                                                      | openapi                                 |
| Reference characters  | "Only -, ., = and alphanumeric characters allowed"                                                                                                                                                                   | openapi                                 |
| Initialize response   | `data.authorization_url`, `data.access_code`, `data.reference`                                                                                                                                                       | openapi `TransactionInitializeResponse` |
| Verify                | `GET /transaction/verify/{reference}`. `data.id`, `data.status` (string), `data.reference`, `data.amount` (integer), `data.currency`, `data.paid_at`                                                                 | openapi `VerifyResponse`                |
| Refund create         | `POST /refund` with `transaction` (reference), optional `amount` (≤ original), `currency`, `customer_note`, `merchant_note`                                                                                          | openapi `RefundCreate`                  |
| Refund fetch          | `GET /refund/{id}`. `data.status` (string), `data.amount`, `data.transaction_reference`                                                                                                                              | openapi `RefundFetchResponse`           |
| Webhook signature     | `x-paystack-signature` = hex HMAC-SHA512 of the **raw** request body, keyed with the secret key                                                                                                                      | snippets `verifying-transaction.js`     |
| Webhook response      | Respond 200 quickly; do long work afterwards                                                                                                                                                                         | snippets (comments)                     |
| Refund events         | `refund.pending`, `refund.processing`, `refund.processed`, `refund.failed`. `data.amount` is a **string**, `data.transaction_reference` identifies the payment, `data.refund_reference` is the processor's reference | snippets `events.js`                    |
| Webhook endpoints API | `/integration/webhooks/endpoints` (multiple endpoints with event filters). No separate signing secret appears in the documented responses                                                                            | snippets `api/webhook-endpoints/*`      |

## Not verified (treat as unknown)

- **Webhook source IP addresses:** not in the sources above. NetFlex relies on the signature, which is mandatory. An IP allowlist is optional hardening once confirmed from the Paystack dashboard or support.
- **The complete set of `data.status` values from verify:** NetFlex accepts only `success` as paid. `failed` and `abandoned` are terminal failures, `reversed` raises a discrepancy, and anything else is treated as still pending and re-checked later.
- **Retry schedule for undelivered webhooks:** NetFlex does not depend on it. A reconciliation job verifies pending payments directly with the API.
- **Real sandbox behaviour:** not tested yet. It needs the owner's `sk_test_` key in `.env` (never in chat or git).
