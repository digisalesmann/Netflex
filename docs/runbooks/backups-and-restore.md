# Runbook: Backups and restore

## What needs backing up

| Data                                                                                           | Where               | Backed up?                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything that matters: residents, rooms, plans, orders, payments, codes, staff, activity log | Postgres on Railway | **Yes, see below**                                                                                                                                                                                                                                 |
| Job queues                                                                                     | Redis on Railway    | No. Work is written to Postgres before it's queued. If Redis is lost, the worker's regular checks re-confirm unfinished payments and re-sync Wi-Fi access, and plans still expire on time. At worst a few receipts or reminder emails aren't sent. |
| Code                                                                                           | GitHub (`main`)     | Yes, by git                                                                                                                                                                                                                                        |
| Settings and secrets                                                                           | Railway variables   | Keep a copy of the secret keys in a password manager (Paystack, Resend). Never in git or chat.                                                                                                                                                     |
| Payments history                                                                               | Paystack            | Paystack keeps its own records. Refunds and disputes can always be checked there.                                                                                                                                                                  |

## 1. Automatic backups on Railway (main protection)

Railway can back up the database volume on a schedule. **The owner switches this on once:**

1. Railway → project **netflex** → **Postgres** → **Backups**.
2. **Edit schedule** → tick **Daily** and **Weekly** → Save.
3. Check that a backup appears the next day.

Daily backups are kept for 6 days, weekly ones for 27 days. If the Backups tab says the plan doesn't include backups, upgrade the Railway plan; it's the cheapest insurance this system has.

## 2. Off-site copy (monthly, and before risky changes)

Railway backups live inside Railway, so keep a monthly copy on the office computer too, and make one before any big change. On a computer with the Railway CLI signed in to the project:

```sh
sh scripts/ops/backup-db.sh
```

It saves `backups/netflex-<date>.dump` (git ignores this folder) and changes nothing on the server. **The file holds residents' personal details:** keep it on an encrypted disk or in private cloud storage, never email it, and delete copies older than a year (NDPA).

> Not yet tested against the live database. Run it once now and confirm it prints "Saved …".

## 3. Restoring

**First, decide whether you need to.** A restore takes the whole database back in time: every payment, code and resident change since that backup is lost from the system. A single wrong edit is usually better fixed by hand in the office (the activity log shows what changed).

### From a Railway backup (fastest)

1. Turn on maintenance: Railway → **web** → Settings → scale to 0 replicas (or remove the domain), so nobody pays while the data is moving.
2. Railway → **Postgres** → **Backups** → pick the backup → **Restore**. Railway stages the change; review it and click **Deploy**.
3. Railway → **api** → **Redeploy**. Its pre-deploy step re-applies any newer migrations.
4. Bring **web** back.
5. Run the checks in section 4.
6. In Paystack, list payments made **after** the backup time. The restored database doesn't know about them. For each one, either give the buyer a code by hand (Office → Vouchers, reason "restored after backup") or refund it in Paystack.

### From an off-site `.dump` file (if Railway's backups are gone)

Needs PostgreSQL 17 client tools (`pg_restore`) on the computer, and a new, empty Railway Postgres service:

1. Railway → **+ New** → Database → PostgreSQL.
2. In the new database's **Settings → Networking**, turn on TCP Proxy for the restore only, and copy its public connection URL.
3. Restore:
   ```sh
   pg_restore --no-owner --clean --if-exists -d "<public connection URL>" backups/netflex-<date>.dump
   ```
4. Turn the TCP Proxy off again.
5. Point **api** and **worker** `DATABASE_URL` at the new database (`${{Postgres-xxxx.DATABASE_URL}}`) and redeploy both.
6. Run the checks in section 4.

## 4. After any restore, check

- [ ] `https://netflexhq.com` loads and shows the plans.
- [ ] Office sign-in works (password and authenticator code).
- [ ] Office → Overview shows the expected residents and rooms.
- [ ] Office → Payments: the newest payments match Paystack's dashboard.
- [ ] Office → Network: no pile-up of failed jobs.
- [ ] A resident sign-in code arrives by email.
- [ ] Write in the activity log or ops notes: when, why, which backup, who did it.

## 5. Practise

Restore a backup into a **new** Railway environment (not production) every 6 months, and run section 4 on it. A backup nobody has restored is only a hope.
