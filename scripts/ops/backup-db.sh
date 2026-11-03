#!/bin/sh
# Off-site copy of the live database, saved on this computer.
# Read-only: it runs pg_dump inside Railway's Postgres service and changes nothing.
#
#   sh scripts/ops/backup-db.sh            -> backups/netflex-YYYY-MM-DD-HHMM.dump
#
# The dump goes through `railway ssh` as base64 text, because a terminal session
# can corrupt raw binary.
set -eu
RAILWAY="${RAILWAY:-$HOME/.local/node/bin/railway}"
mkdir -p backups
out="backups/netflex-$(date +%Y-%m-%d-%H%M).dump"
"$RAILWAY" ssh --service Postgres -- sh -c 'pg_dump -Fc --no-owner -U "$PGUSER" -d "$PGDATABASE" | base64 | tr -d "\n"; echo' \
  | tr -d '\r\n ' | base64 -d > "$out"
# A custom-format dump starts with "PGDMP".
if [ "$(head -c 5 "$out")" != "PGDMP" ]; then
  echo "Backup failed: $out is not a database dump." >&2
  rm -f "$out"
  exit 1
fi
echo "Saved $out ($(du -h "$out" | cut -f1)). Keep it somewhere safe and private: it holds residents' details."
