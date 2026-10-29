# Runbook: Staff Accounts

## Create the first owner

Run once per environment, on a trusted machine with access to the database:

```sh
npm run build
npm run db:migrate:deploy
# The password goes on stdin, so it never appears in shell history.
read -s NF_PW && printf '%s' "$NF_PW" | node --env-file=.env apps/api/dist/cli/create-owner.js --email you@example.com --name "Your Name"; unset NF_PW
```

The tool syncs roles, refuses weak passwords, and refuses to run if an active owner already exists. Then sign in and set up two-step verification with an authenticator app.

**Create a second owner straight away** (Admin → Staff, role OWNER, platform-wide) so that a lost phone can't lock the business out.

## Add staff

Owner: `POST /api/v1/admin/staff` with email, name and a temporary password, then grant a role on a property (`POST /admin/staff/:id/roles`). Give the temporary password to the person by a separate channel. They must change it and enroll MFA at first sign-in.

## Lost password or phone

Owner: `POST /api/v1/admin/staff/:id/reset-credentials` with a new temporary password and a reason. MFA is cleared, all sessions end, and the person re-enrolls at next sign-in. An owner can't reset themselves; another owner must.

## Someone leaves

Owner: `POST /api/v1/admin/staff/:id/disable` with a reason. Sessions end immediately. Accounts are disabled, never deleted, so the audit history stays intact.
