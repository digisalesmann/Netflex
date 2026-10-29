# Web Experience (Phase 7)

`apps/web`: Next.js 15 App Router, React 19, the shared design tokens (`@netflex/ui`), plain CSS, no UI framework, system fonts only. Card-free layouts: hierarchy comes from type, spacing and hairline rules (spec §19).

## Pages

| Area          | Route                                              | Notes                                                                                                                                                     |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public        | `/`                                                | Hero, three value points, voucher and connection guidance, "plans from" using real catalog data                                                           |
|               | `/how-it-works`                                    | Four steps, room/floor sharing, changing phones (private MAC guidance)                                                                                    |
|               | `/plans`                                           | Live catalog with every pre-purchase term (price, duration, start rule, devices, speed "not guaranteed", fair use, refunds)                               |
|               | `/coverage`                                        | Honest coverage, speed and outage notes; owner-provided notes via `NETFLEX_COVERAGE_NOTES`                                                                |
|               | `/faq`                                             | 11 questions, as accessible disclosure widgets                                                                                                            |
|               | `/contact`                                         | Support contacts plus a support form (guest or signed-in)                                                                                                 |
|               | `/legal/privacy`, `/legal/terms`, `/legal/refunds` | Describe what the system actually does; marked **draft pending legal review** until `NETFLEX_LEGAL_REVIEWED=true`                                         |
| Wi-Fi sign-in | `/connect?gw&ip&mac`                               | All captive-portal states (below)                                                                                                                         |
|               | `/checkout/return`                                 | After Paystack: pending, failed, confirmed, voucher issued, reveal, connect this device                                                                   |
| Tenant        | `/account/sign-in`                                 | Phone + one-time code; says "not available yet" while no SMS provider is configured                                                                       |
|               | `/account`                                         | Access overview: state, time left, local expiry, devices in use, usage "not available yet"                                                                |
|               | `/account/access/[id]`                             | Devices (remove), members (manager: add/remove/make manager), leave plan (member), renew                                                                  |
|               | `/account/plans`                                   | Buy or renew; room/floor only when authorised and resident                                                                                                |
|               | `/account/orders`, `/account/orders/[id]`          | Transaction history; printable receipt ("not a tax invoice")                                                                                              |
|               | `/account/voucher`                                 | Voucher status (last 4 characters) and recovery guidance                                                                                                  |
|               | `/account/support`                                 | Own requests plus a new request or outage report                                                                                                          |
|               | `/account/settings`                                | Profile, notification choices (honest that delivery isn't set up), sessions with per-device sign-out, sign out everywhere, data download, erasure request |
| Other         | `not-found`, `error`, `robots.txt`, `sitemap.xml`  | Private areas are `noindex` and disallowed                                                                                                                |

## Captive-portal states (spec §12)

| Spec state                        | Where                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Welcome                           | `/connect` "Get online"                                                                            |
| Choose plan                       | "Choose a plan"                                                                                    |
| Enter voucher                     | "Enter your voucher"                                                                               |
| Phone entry/verification          | "Your details" (phone for receipt; tenant sign-in uses an SMS code)                                |
| Review purchase                   | "Review your purchase" (all terms + total)                                                         |
| Payment pending                   | `/checkout/return` "Payment pending", with "Check again" (asks Paystack)                           |
| Payment confirmed                 | "Payment confirmed"                                                                                |
| Voucher issued                    | "Your voucher code" (shown to the owner only, until first use)                                     |
| Provisioning in progress          | "Switching on your access" (polls; after 3 min "taking longer than usual")                         |
| Connected                         | "You're connected": **only after the gateway confirmed the policy**                                |
| Invalid voucher                   | "That code didn't work" (generic for unknown/revoked/other-property)                               |
| Voucher already used/exhausted    | "already in use on its maximum number of devices"                                                  |
| Expired                           | "This code has expired" / "Your access has ended"                                                  |
| Suspended                         | "Your access is suspended"                                                                         |
| Payment failed                    | "Payment didn't go through" (+ "not been charged", retry)                                          |
| Gateway unavailable               | "Wi-Fi sign-in is temporarily unavailable"                                                         |
| Provisioning failed/retry pending | "We're having trouble switching on your access" (safe, alerted, won't re-charge)                   |
| Support/recovery                  | "Help and recovery" (lost code, closed captive window, private MAC, open in browser, support form) |
| (extra) Reconnect                 | Device identity couldn't be confirmed by the gateway                                               |

## How the portal trusts a device

The gateway redirects to `/connect` with its gateway ID, the client IP and the MAC. The browser sends those back, but **the server asks the gateway which device holds that IP** (`NetworkAdapter.lookupClient`). It proceeds only if the MAC matches. Forged MACs, unknown IPs and other networks get "reconnect". With no reachable gateway adapter the portal says "gateway unavailable". It never pretends.

## Development simulators (development/test only)

Registered only when a test-only provider is active; configuration refuses those providers in staging and production, and each handler re-checks the environment.

| Endpoint                                        | Simulates                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/v1/dev/fake-gateway/join`             | A phone joining the Wi-Fi; redirects to `/connect` like a gateway would |
| `GET/POST /api/v1/dev/fake-checkout/:reference` | The Paystack hosted checkout (labelled "SIMULATED PAYMENT")             |
| `POST /api/v1/dev/otp-outbox`                   | The SMS inbox (last code for a phone)                                   |

## Accessibility and responsiveness

- Semantic landmarks, one `h1` per page, skip link, labelled fields with hints and `aria-invalid`.
- Live regions for errors and status changes, and focus moved to each new portal step's heading.
- 44 px touch targets, visible focus rings, reduced-motion support, light and dark modes from the tokens.
- One-time-code inputs use `autocomplete="one-time-code"`.
- Wide data is shown as row lists instead of tables, so nothing needs side-scrolling on phones.

## Test evidence (`e2e/`, Playwright)

- **48 browser tests pass** on desktop Chrome and mobile-emulated Chrome (Pixel 5 profile). They run against the real built API, worker and web app, with simulated payments, SMS and gateway, on an isolated database. The suite was run twice locally.
- **Automated WCAG 2.2 AA checks** (axe-core) on every public page, every portal state reached in the tests, and every account page: no serious or critical violations.
- **No horizontal overflow** at 320, 360, 390, 430, 768, 1024 and 1440 px.
- **Journeys covered:**
  - voucher → connected, with gateway confirmation via the worker;
  - invalid voucher;
  - plan purchase → simulated Paystack → voucher → connect this device;
  - payment failure;
  - missing order;
  - help screen;
  - tenant sign-in → every account page;
  - buy from the account → receipt;
  - room plan authorisation;
  - support request, preferences, data export, sign-out;
  - keyboard mobile menu;
  - robots and noindex.

## Not tested, and why

| Gap                                               | Reason                                                                                             | Plan                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Real iPhone/iOS captive mini-browser (WebKit)** | Playwright's WebKit doesn't run on this Mac's macOS 13; no physical device on the property network | Gateway PoC tests #1 and #12 on real iPhones |
| **Real Android captive portal**                   | Needs the real gateway's redirect                                                                  | Gateway PoC #1 and #12                       |
| Real Paystack checkout from the portal            | Simulated in end-to-end tests; the API path is live-verified separately                            | Run once with test keys and a public URL     |
| Real SMS delivery                                 | No SMS provider chosen                                                                             | When chosen                                  |
| Core Web Vitals on representative phones          | Needs real devices and the deployed site                                                           | Phase 9                                      |
