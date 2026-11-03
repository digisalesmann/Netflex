# Security review, 3 November 2026

Scope: the live site at `https://netflexhq.com` (web, API, worker on Railway), the code at commit `fc7a246`, and its dependencies. Reviewer: the development team. The review was run before paid Wi-Fi is switched on.

**Result: no open high or medium findings.** Two low findings were fixed during the review, and four items are left for the owner (listed at the end).

## What was checked on the live site

| Check                                                 | Expected                                                        | Result                                   |
| ----------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| Office and account API without signing in             | Refused (401)                                                   | Pass                                     |
| Paystack webhook with a fake or missing signature     | Refused (401)                                                   | Pass                                     |
| Request without the anti-forgery header (CSRF)        | Refused (403)                                                   | Pass                                     |
| Developer test routes (`/api/v1/dev/*`) in production | Not found (404)                                                 | Pass                                     |
| Staff sign-in with a wrong password                   | Refused (401), same message for unknown emails                  | Pass                                     |
| Request body of 2 MB                                  | Refused (413)                                                   | Pass                                     |
| Path traversal (`/../../etc/passwd`)                  | Not found (404)                                                 | Pass                                     |
| Repeated sign-in code requests for one email          | Limited after 3 (429)                                           | Pass                                     |
| Buying while paid access is off                       | Refused                                                         | Pass                                     |
| Security headers on pages                             | CSP, frame blocking, nosniff, referrer and permissions policies | Pass                                     |
| HTTPS-only header (HSTS)                              | Present                                                         | **Fixed** (was missing; added, one year) |
| Dependency audit (`npm audit --omit=dev`)             | No known vulnerabilities                                        | Pass (0 found)                           |

## What was checked in the code

- **Sign-in.** Residents sign in with a 6-digit email code: it is stored only as a hash, expires, and is limited per email and per IP. Staff sign in with a password (hashed with scrypt, salted) and a code from an authenticator app (TOTP), and each 30-second code works only once. Sessions are random tokens stored as hashes. The cookies are `HttpOnly`, `Secure` and `SameSite=Lax`.
- **Permissions.** Every office endpoint checks the staff member's role for that lodge. Asking for another lodge's data returns 404, so nobody can tell whether it exists. Residents can only see their own orders, codes and devices (covered by integration tests).
- **Payments.** Prices are worked out on the server. Any amount sent by the browser is rejected. Paystack webhooks are checked with HMAC-SHA512 before anything is read, and every payment is confirmed again with Paystack's verify API. Duplicate requests are blocked with idempotency keys.
- **Wi-Fi codes.** Codes are stored only as a hash and shown once. Code guessing is rate-limited per IP and per device.
- **Simulators.** The fake mailer, fake payments and fake network refuse to start when `NETFLEX_ENV=production`.
- **Secrets.** Secrets come from Railway variables only. No secret is in git, and logs mask tokens, codes, passwords and keys. Notification records never contain codes.
- **Audit.** Every office action (refunds, code changes, staff changes, settings) is written to the activity log with who did it and when.
- **Emails.** Every send is recorded, so retries never email anyone twice. Receipts only go to the account that paid, and email preferences are respected.

## Findings

| #   | Severity | Finding                                                                                      | Status                                                           |
| --- | -------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Low      | No HSTS header, so a first visit typed as `http://` could be intercepted before the redirect | Fixed: `Strict-Transport-Security: max-age=31536000`             |
| 2   | Low      | A backlog of old queued jobs could email receipts for old purchases after an outage          | Fixed: receipts are skipped for orders paid more than 2 days ago |
| 3   | Info     | The page Content Security Policy allows inline scripts and styles, which Next.js needs       | Accepted; no user content is rendered as HTML                    |
| 4   | Info     | Sign-in code requests to made-up addresses still try to send (up to the limit)               | Accepted; rate limits cap it                                     |

## For the owner

1. **Add a second owner** in Office → Staff, so the office is never locked out if one phone is lost.
2. **Turn on two-step sign-in** for the Railway, Paystack, Resend, Cloudflare and Gmail accounts. These control the money and the domain.
3. **Paystack webhook URL** must be `https://netflexhq.com/api/v1/webhooks/paystack` (Paystack → Settings → API Keys & Webhooks, live mode).
4. **When staff leave**, disable them in Office → Staff on the same day. Their sessions end at once.

Run this review again after any big change, and at least every six months.
