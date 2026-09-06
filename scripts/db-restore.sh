#!/usr/bin/env bash
#
# Restore a backup produced by scripts/db-backup.sh (#852).
#
# This is the executable half of DB_ROLLBACK_PLAYBOOK.md § "Full rollback to
# backup/snapshot". That branch used to say "Restore latest verified
# backup/snapshot in Supabase", which on the free plan pointed at a snapshot
# that does not exist. This script is what replaced it.
#
# Replay order is not negotiable — it is Supabase's documented restore recipe:
#
#   roles.sql -> schema.sql -> SET session_replication_role = replica -> data.sql
#
# The `session_replication_role` flip disables triggers for the data load. Without
# it, triggers fire during the restore and can double-apply their effects (the
# documented case is double-encrypting an encrypted column).
#
# Usage:
#   scripts/db-restore.sh --backup-dir <dir> --db-url <url> [--force] [--data-only]
#
# THIS OVERWRITES THE TARGET DATABASE. It refuses to run against anything that is
# not obviously a local database unless --force is passed, because the difference
# between a rehearsal and an outage is one mistyped host.
#
# ── `--data-only`: schema from the repo, data from the dump ──────────────────
# `supabase db dump` excludes the Supabase-managed schemas, and that exclusion
# is not only about `auth`/`storage` TABLES: every object our own migrations
# create INSIDE a managed schema is left out of schema.sql too. Today that is
# the `realtime_messages_scoped_select` policy on `realtime.messages` (the
# authorisation for every private change-ping topic — without it they join,
# report SUBSCRIBED and deliver nothing, the #867 shape) and the
# `storage.buckets` rows. The 2026-09-06 rehearsal proved it: after a full
# restore `pg_policies` on `realtime` was empty while every row count matched.
# And because data.sql restores `supabase_migrations.schema_migrations`, a
# later `supabase db push` believes those migrations already ran and never
# recreates them.
#
# `--data-only` is the recovery shape that has no such hole: point the repo's
# migrations at the fresh project FIRST (`supabase db push`, at the commit that
# was live), which recreates the whole schema including the managed-schema
# objects, then load the dump's DATA into it. roles.sql and schema.sql are not
# replayed, and the `supabase_migrations.*` tables are filtered out of data.sql
# because `db push` has already written the ledger. The precondition is that
# the target's ledger and the dump's ledger name the SAME migrations — the data
# is only shaped for the schema those migrations produce — and the script
# refuses on any difference rather than loading rows into a schema they were
# not dumped from.

set -euo pipefail

BACKUP_DIR=""
DB_URL=""
FORCE=0
DATA_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --db-url)     DB_URL="${2:-}"; shift 2 ;;
    --force)      FORCE=1; shift ;;
    --data-only)  DATA_ONLY=1; shift ;;
    -h|--help)    sed -n '2,/^set -euo/p' "$0" | sed '$d;s/^# \?//'; exit 0 ;;
    *) echo "Error: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

[ -n "$BACKUP_DIR" ] || { echo "Error: --backup-dir is required" >&2; exit 2; }
[ -n "$DB_URL" ]     || { echo "Error: --db-url is required" >&2; exit 2; }
[ -d "$BACKUP_DIR" ] || { echo "Error: no such backup directory: $BACKUP_DIR" >&2; exit 2; }
command -v psql >/dev/null 2>&1 || { echo "Error: psql not found" >&2; exit 1; }

# The blast-radius guard. Matching on the host is deliberate: a restore is the
# one operation here that destroys data, and the only safe default is to assume
# an unrecognised host is real infrastructure.
case "$DB_URL" in
  *@127.0.0.1:*|*@localhost:*|*@host.docker.internal:*) LOCAL_TARGET=1 ;;
  *) LOCAL_TARGET=0 ;;
esac
if [ "$LOCAL_TARGET" -eq 0 ] && [ "$FORCE" -eq 0 ]; then
  cat >&2 <<'GUARD'
Error: refusing to restore into a non-local database without --force.

This command REPLACES the contents of the target database. Restoring staging or
production is a real incident-response action: announce it, freeze writes, and
follow docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md rather than running this from a
shell on a hunch. Re-run with --force once that is true.
GUARD
  exit 2
fi

SAFE_URL="$(printf '%s' "$DB_URL" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#')"

# Verify integrity BEFORE touching the target. A truncated download that is only
# discovered halfway through the data load leaves the database in neither the old
# state nor the new one.
if [ -f "$BACKUP_DIR/manifest.json" ]; then
  echo "==> Verifying checksums against manifest.json"
  for f in roles schema data; do
    want="$(grep -o "\"$f\": \"[0-9a-f]\{64\}\"" "$BACKUP_DIR/manifest.json" | head -1 | grep -o '[0-9a-f]\{64\}' || true)"
    if [ -z "$want" ]; then
      echo "    $f: no checksum recorded — skipping" >&2
      continue
    fi
    got="$(sha256sum "$BACKUP_DIR/$f.sql.gz" | cut -d' ' -f1)"
    if [ "$want" != "$got" ]; then
      echo "Error: checksum mismatch for $f.sql.gz (manifest $want, actual $got). Refusing to restore a corrupt backup." >&2
      exit 1
    fi
    echo "    $f: ok"
  done
else
  echo "::warning::no manifest.json in $BACKUP_DIR — restoring without integrity verification" >&2
fi

# Preflight: the dump is NOT self-contained. `supabase db dump` deliberately
# excludes Supabase-managed schemas (auth, storage, extensions, and those created
# by extensions), so schema.sql references them without creating them. Restoring
# into a bare `CREATE DATABASE` therefore dies partway through with a bare
# `ERROR: schema "extensions" does not exist` — observed for real during the #852
# rehearsal, which is the only reason this check exists.
#
# The supported target is a Supabase-provisioned database: a new project (per
# Supabase's own restore guide) or a reset local stack. Checking up front turns
# an obscure mid-replay failure into a precondition you can act on.
echo "==> Preflight: checking the target is a Supabase-provisioned database"
# Not `|| true`: swallowing a connection failure here would report a clean
# preflight for a database we never reached, and the restore would then fail
# later with a far less obvious error.
if ! MISSING_SCHEMAS="$(psql --dbname "$DB_URL" -tAc "
  SELECT string_agg(s, ', ')
  FROM unnest(ARRAY['auth','storage','extensions']) AS s
  WHERE s NOT IN (SELECT nspname FROM pg_namespace);" 2>&1)"; then
  echo "Error: could not connect to the target database to run preflight checks:" >&2
  echo "  $MISSING_SCHEMAS" >&2
  exit 1
fi
if [ -n "${MISSING_SCHEMAS// /}" ]; then
  cat >&2 <<GUARD
Error: the target database is missing Supabase-managed schema(s): $MISSING_SCHEMAS

These dumps are not self-contained — 'supabase db dump' excludes Supabase's
managed schemas, so schema.sql expects them to already exist. Restore into a
Supabase-provisioned database (a fresh project, or a reset local stack), not an
empty 'CREATE DATABASE'. See DB_ROLLBACK_PLAYBOOK.md § Restoring from an offsite dump.
GUARD
  exit 1
fi
echo "    auth, storage, extensions present"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Decompressing"
for f in roles schema data; do
  gunzip -c "$BACKUP_DIR/$f.sql.gz" > "$WORK/$f.sql"
done

if [ "$DATA_ONLY" -eq 1 ]; then
  echo "==> Data-only mode: schema must already be in place from the repo's migrations"
  # The ledger check. Both sides are the set of version strings; the dump's come
  # from its own COPY block for schema_migrations, the target's from the table
  # `db push` just wrote. Any asymmetric difference is a refusal.
  awk '/^COPY "supabase_migrations"\."schema_migrations"/{grab=1; next} grab && /^\\\.$/{grab=0} grab{print $1}' "$WORK/data.sql" \
    | sort -u > "$WORK/dump-versions.txt"
  if [ ! -s "$WORK/dump-versions.txt" ]; then
    echo "Error: the dump carries no supabase_migrations.schema_migrations rows, so the schema it was taken from cannot be checked against the target. Use the full restore." >&2
    exit 1
  fi
  psql --dbname "$DB_URL" -tAc "select version from supabase_migrations.schema_migrations order by 1" \
    | sort -u > "$WORK/target-versions.txt"
  if ! diff -q "$WORK/dump-versions.txt" "$WORK/target-versions.txt" >/dev/null; then
    echo "Error: the target's applied migrations differ from the ones the dump was taken under." >&2
    echo "  only in dump:   $(comm -23 "$WORK/dump-versions.txt" "$WORK/target-versions.txt" | tr '\n' ' ')" >&2
    echo "  only in target: $(comm -13 "$WORK/dump-versions.txt" "$WORK/target-versions.txt" | tr '\n' ' ')" >&2
    echo "Run 'supabase db push' at the commit that produced the dump, then retry. Loading rows into a schema they were not dumped from is not a restore." >&2
    exit 1
  fi
  echo "    ledger matches: $(wc -l < "$WORK/dump-versions.txt") migrations on both sides"

  # Drop the ledger's COPY blocks from data.sql: db push already wrote them and
  # COPY has no ON CONFLICT. Everything else in the file is loaded as-is.
  awk '/^COPY "supabase_migrations"\./{skip=1} skip && /^\\\.$/{skip=0; next} !skip' "$WORK/data.sql" > "$WORK/data-only.sql"

  # Empty every table the file is about to COPY into, in the same transaction
  # as the load. A freshly pushed schema is not empty: migrations seed rows —
  # today `public.users` carries the system sender (`00000000-…-000000000000`)
  # — and the dump carries the same rows, so COPY would stop on the first
  # duplicate key. TRUNCATE ... CASCADE on the exact table list the dump names
  # replaces those seeds with the dump's copy of them. On a fresh project that
  # is the only thing it removes; on a reused target it is the "REPLACES the
  # contents" this script's header already promises.
  grep -oE '^COPY "[a-z_]+"\."[a-z_]+"' "$WORK/data-only.sql" \
    | sed -E 's/^COPY "([a-z_]+)"\."([a-z_]+)"/\1.\2/' \
    | sort -u > "$WORK/data-tables.txt"
  {
    echo 'SET session_replication_role = replica;'
    # The cascade NOTICEs are one line per FK and say nothing an operator needs.
    echo 'SET client_min_messages = warning;'
    while read -r t; do echo "TRUNCATE TABLE $t CASCADE;"; done < "$WORK/data-tables.txt"
  } > "$WORK/truncate.sql"
  echo "    emptying $(wc -l < "$WORK/data-tables.txt") target tables before the load"

  echo "==> Restoring data into $SAFE_URL"
  psql \
    --quiet \
    --single-transaction \
    --variable ON_ERROR_STOP=1 \
    --file "$WORK/truncate.sql" \
    --command 'SET session_replication_role = replica' \
    --file "$WORK/data-only.sql" \
    --dbname "$DB_URL"
  echo "==> Data restore complete."
  exit 0
fi

# Documented restore failure: roles.sql carries a grant that only supabase_admin
# may issue, and it aborts the whole --single-transaction replay. Supabase's own
# troubleshooting section says to comment this line out before restoring.
if grep -q 'GRANT "postgres" TO "cli_login_postgres"' "$WORK/roles.sql"; then
  echo "==> Neutralising the cli_login_postgres grant (Supabase documented restore fix)"
  sed -i 's#^GRANT "postgres" TO "cli_login_postgres".*#-- & (removed by db-restore.sh)#' "$WORK/roles.sql"
fi

echo "==> Restoring into $SAFE_URL"
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$WORK/roles.sql" \
  --file "$WORK/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$WORK/data.sql" \
  --dbname "$DB_URL"

echo "==> Restore complete."
