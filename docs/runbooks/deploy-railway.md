# Runbook: Deploy to Railway (netflexhq.com)

One Docker image ([Dockerfile](../../Dockerfile)) runs as three Railway services. Only **web** is public; the API and worker sit on Railway's private network, and the browser reaches the API through the web app's `/api` proxy, so cookies stay on `netflexhq.com`.

```
visitor ─► Cloudflare ─► web (netflexhq.com) ─► api (private) ─► Postgres, Redis
                                               worker (private) ─┘
```

## 1. Create the project

1. railway.com → **New project** → **Deploy from GitHub repo** → `digisalesmann/Netflex`.
2. Add **Postgres** and **Redis** to the project (New → Database).
3. Create three services from the same repo, named exactly `web`, `api`, `worker`. In each service → Settings → **Config-as-code file**, set:
   - web → `infra/railway/web.json`
   - api → `infra/railway/api.json` (runs database migrations before each deploy)
   - worker → `infra/railway/worker.json`
4. Only **web** gets a public domain. Remove any generated public domain from api and worker.

## 2. Variables

Set these on **api** and **worker** (Railway's "shared variables" saves typing them twice). Values in `${{ }}` are Railway references, typed as shown.

| Variable              | Value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| `NETFLEX_ENV`         | `production`                                                           |
| `DATABASE_URL`        | `${{Postgres.DATABASE_URL}}`                                           |
| `REDIS_URL`           | `${{Redis.REDIS_URL}}`                                                 |
| `API_PORT`            | `4000` (api only)                                                      |
| `TRUST_PROXY`         | `fd00::/8` (Railway's private network, where the web proxy calls from) |
| `PUBLIC_WEB_URL`      | `https://netflexhq.com`                                                |
| `PUBLIC_API_URL`      | `https://netflexhq.com`                                                |
| `AUTH_SECRET`         | new random value, see below. **Never reuse the local one.**            |
| `VOUCHER_PEPPER`      | new random value                                                       |
| `PAYMENT_PROVIDER`    | `paystack`                                                             |
| `PAYSTACK_SECRET_KEY` | your `sk_live_…` key (production refuses test keys)                    |
| `EMAIL_PROVIDER`      | `resend`                                                               |
| `RESEND_API_KEY`      | a **new** Resend key with sending access, just for production          |
| `EMAIL_FROM`          | `ND Lodge Wi-Fi <wifi@netflexhq.com>`                                  |
| `EMAIL_REPLY_TO`      | `networkflex24@gmail.com`                                              |
| `NETWORK_ADAPTER`     | `none` (until the router passes the on-site test)                      |
| `PAID_ACCESS_ENABLED` | `false` (see section 6)                                                |

Generate each secret on your laptop: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Paste secrets only into Railway, never into chat, email or the repo.

On **web**:

| Variable                   | Value                                                   |
| -------------------------- | ------------------------------------------------------- |
| `API_INTERNAL_URL`         | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000`           |
| `NETFLEX_PROPERTY_SLUG`    | the lodge slug you create in section 4, e.g. `nd-lodge` |
| `PUBLIC_WEB_URL`           | `https://netflexhq.com`                                 |
| `NETFLEX_LEGAL_REVIEWED`   | `true`                                                  |
| `NETFLEX_POLICIES_UPDATED` | `3 November 2026`                                       |

## 3. Domain (Cloudflare)

1. Railway → web → Settings → Networking → **Custom domain** → `netflexhq.com` (and `www.netflexhq.com` if wanted). Railway shows a CNAME target and a TXT verification record.
2. Cloudflare → netflexhq.com → DNS: add the records exactly as Railway shows. Cloudflare flattens a CNAME on the root automatically.
3. Cloudflare → SSL/TLS → set mode to **Full (strict)**. Leave the record proxied (orange cloud) once Railway shows the certificate as issued; if issuance stalls, switch it to DNS-only until it completes, then back.
4. Keep the Resend DNS records you already added; they don't conflict.

Check: `https://netflexhq.com/faq` loads, and `https://netflexhq.com/api/v1/health/ready` answers `ready`.

## 4. First owner and the lodge

Run once, from your laptop, with the [Railway CLI](https://docs.railway.com/guides/cli) (`railway login`, then `railway link` to this project). It runs the command with the api service's variables, so nothing is copied by hand:

```sh
npm run build
# The password goes on stdin so it never lands in shell history.
read -s NF_PW && printf '%s' "$NF_PW" | railway run --service api -- node apps/api/dist/cli/create-owner.js --email you@netflexhq.com --name "Your Name"; unset NF_PW
```

`railway run` uses the private database address, which your laptop can't reach. If it fails to connect, temporarily set `DATABASE_URL` to Postgres's **public** URL for this one command. Then sign in as staff and set up two-step verification, and create a **second owner** straight away.

The lodge, its rooms and the plans are created through the admin API (`POST /api/v1/admin/properties`, `…/buildings`, `…/floors`, `…/rooms`, `…/plans`). **The admin screens for this are the next build (Phase 8)**; until then the public site shows the lodge only after these calls are made.

## 5. Paystack

Paystack dashboard → Settings → API Keys & Webhooks (live mode):

- **Webhook URL:** `https://netflexhq.com/api/v1/webhooks/paystack`
- **Callback URL:** leave empty (the app sets it per payment).

## 6. Turning on paid access

`PAID_ACCESS_ENABLED=true` only after a paid sign-up at the lodge actually switches on Wi-Fi:

1. Router installed (Starlink Mini in bypass mode → router → access points).
2. On-site test passed ([poc-test-plan.md](../network/poc-test-plan.md)) and the real router adapter enabled.
3. One real ₦ purchase end to end: pay → code → online → expires → offline.

Until then the site, accounts, sign-in emails and plan pages are live, and nobody can be charged for access the network can't deliver.

## Updating

Merge to `main` → Railway rebuilds all three services; the api runs migrations before it starts. Migrations are additive only (never edit an applied one).
