# Environment Variable Reference

Validated at startup by `packages/config` (zod). Missing or invalid values stop the process with a message naming the variable, never its value. Real values live in the hosting provider's secret manager, never in git.

| Variable                 | Required    | Example / allowed values                       | Notes                                                                                             |
| ------------------------ | ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `NETFLEX_ENV`            | yes         | `development`, `test`, `staging`, `production` | Fakes (payment/network/OTP) are refused in `staging` and `production`                             |
| `LOG_LEVEL`              | no          | `info` (default)                               | `fatal`…`trace`                                                                                   |
| `DATABASE_URL`           | yes         | `postgresql://…`                               | App role must not own tables (keeps triggers enforced)                                            |
| `REDIS_URL`              | yes         | `redis://…`                                    | Queues and rate limits only; not a source of truth                                                |
| `API_PORT`               | no          | `4000`                                         |                                                                                                   |
| `PUBLIC_WEB_URL`         | yes         | `https://netflex.example`                      | Only CORS origin allowed; must be https in production                                             |
| `PUBLIC_API_URL`         | yes         | `https://api.netflex.example`                  | Must be https in production                                                                       |
| `VOUCHER_PEPPER`         | yes         | ≥32 random chars                               | HMAC key for voucher verifiers. Rotation needs `VOUCHER_PEPPER_VERSION` bump (runbook in Phase 3) |
| `VOUCHER_PEPPER_VERSION` | no          | `1`                                            | Stored on each voucher                                                                            |
| `AUTH_SECRET`            | yes         | ≥32 random chars                               | HMAC key for session tokens and OTP verifiers                                                     |
| `PAYMENT_PROVIDER`       | yes         | `paystack`, `fake`                             | `fake` only in development/test                                                                   |
| `PAYSTACK_SECRET_KEY`    | if paystack | `sk_test_…` / `sk_live_…`                      | Live key required in production; test key required elsewhere                                      |
| `PAYSTACK_BASE_URL`      | no          | `https://api.paystack.co`                      |                                                                                                   |
| `NETWORK_ADAPTER`        | no          | `none` (default), `fake`, `mikrotik`           | `mikrotik` is not live-verified (ADR-0004)                                                        |
| `OTP_PROVIDER`           | no          | `none` (default), `fake`                       | No real provider chosen yet                                                                       |
| `PAID_ACCESS_ENABLED`    | no          | `false` (default)                              | Keep `false` until legal gates pass                                                               |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## Web app (`apps/web`)

| Variable                   | Required | Example                            | Notes                                                                        |
| -------------------------- | -------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `API_INTERNAL_URL`         | yes      | `http://api.internal:4000`         | Read at **runtime** by the `/api` proxy route, so one build works everywhere |
| `NETFLEX_PROPERTY_SLUG`    | yes      | `harbour-view`                     | Property shown on the public site                                            |
| `NETFLEX_COVERAGE_NOTES`   | no       | `Strongest near the main corridor` | Owner-confirmed only; when empty, pages tell people to ask the office        |
| `NETFLEX_LEGAL_REVIEWED`   | no       | `false`                            | While `false`, the policy pages show "Draft pending legal review"            |
| `NETFLEX_POLICIES_UPDATED` | no       | `1 December 2026`                  | Shown on the policy pages                                                    |

**Deployment requirement:** the browser reaches the API through the web server's `/api` proxy, which forwards the client address in `X-Forwarded-For`. The load balancer must set that header, and the API's `TRUST_PROXY` must trust the web server and load balancer. Otherwise every visitor shares one rate-limit bucket and sign-in and voucher entry are throttled for everyone.
