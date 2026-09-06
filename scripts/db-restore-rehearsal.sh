#!/usr/bin/env bash
#
# Prove the backup/restore path actually works, against the local sandbox stack (#852).
#
# "A backup you have never restored is a rumor." This script is what stops that
# being true here: it takes a real backup of the local database, destroys the
# application schema, restores from the backup alone, and then compares row
# counts table-by-table against the pre-backup baseline. It exits non-zero on any
# drift, so it can be re-run as a regression test whenever the dump flags,
# restore order, or schema change.
#
# It is deliberately NOT wired into CI: it needs the Docker-backed Supabase stack
# from scripts/cloud-sandbox-up.sh, and it is destructive to that stack's data.
# Run it by hand after touching db-backup.sh or db-restore.sh, and record the
# result in docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md § Rehearsal log.
#
# Usage: scripts/db-restore-rehearsal.sh [--keep <dir>]

set -euo pipefail

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
KEEP=""
if [ "${1:-}" = "--keep" ]; then
  KEEP="${2:-}"
  [ -n "$KEEP" ] || { echo "Error: --keep needs a directory" >&2; exit 2; }
fi

# Resolve WORK once. The earlier form created a mktemp dir and then reassigned
# WORK when --keep was passed, which leaked the temp dir on every kept run, and
# leaned on `a && b && c` under `set -e` where a false first test is easy to
# misread as an early exit.
if [ -n "$KEEP" ]; then
  WORK="$KEEP"
  mkdir -p "$WORK"
  cleanup() { :; }
else
  WORK="$(mktemp -d)"
  cleanup() { rm -rf "$WORK"; }
fi
trap cleanup EXIT

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Row counts for every non-empty table in the schemas this backup claims to
# cover. `storage` is excluded from the comparison because it is excluded from
# the dump on purpose (see db-backup.sh) — including it here would fail the
# rehearsal for a difference that is by design.
COUNTS_SQL="
SELECT string_agg(format('%s.%s=%s', schemaname, tablename, cnt), E'\n' ORDER BY schemaname, tablename)
FROM (
  SELECT schemaname, tablename,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint AS cnt
  FROM pg_tables WHERE schemaname IN ('public','auth')
) t WHERE cnt > 0;"

counts() { psql "$DB_URL" -tAc "$COUNTS_SQL" 2>/dev/null | sed '/^$/d'; }

psql "$DB_URL" -tAc "select 1" >/dev/null 2>&1 || {
  echo "Error: local Supabase database is not reachable at 127.0.0.1:54322." >&2
  echo "Bring the stack up first: scripts/cloud-sandbox-up.sh (or 'npx supabase start')." >&2
  exit 1
}

echo "═══ 1. Baseline ═══"
counts > "$WORK/baseline.txt"
echo "    $(grep -c '=' "$WORK/baseline.txt") non-empty tables"

echo "═══ 2. Backup ═══"
rm -rf "$WORK/backups"
./scripts/db-backup.sh --db-url "$DB_URL" --out-dir "$WORK/backups" --label rehearsal >/dev/null
echo "    ok"

echo "═══ 3. Destroy the application schema ═══"
# This is the simulated disaster, and it is also the closest local equivalent of
# Supabase's documented "restore into a NEW project" target: the managed schemas
# (auth/storage/extensions) survive, exactly as they would on a freshly
# provisioned project, while everything the application owns is gone.
#
# Every supabase_migrations table is truncated for the same reason — a fresh
# project has no migration history, and leaving ours in place collides with the
# copy the backup restores. It is enumerated dynamically rather than by name
# because the CLI owns that schema: the rehearsal first failed on
# schema_migrations, then on seed_files, which is a list that will keep growing.
#
# EVERY `auth` data table is truncated too, not just `auth.users`. The dump
# carries the whole `auth` schema (minus GoTrue's own `schema_migrations`
# ledger), and only some of those tables hang off `users` by FK — `sessions`,
# `identities`, `refresh_tokens`, `mfa_*` cascade from the users truncate, but
# `audit_log_entries`, `flow_state`, `instances` and the SSO/OAuth tables do
# not. On 2026-09-06 the first rehearsal against a database that had actually
# seen a sign-in died on `audit_log_entries_pkey` (the 2026-08-27 pass had an
# empty auth schema, so it never exercised this). A fresh Supabase project has
# every one of these tables empty, which is the state this step simulates.
# `auth.schema_migrations` is deliberately kept: it is GoTrue's, excluded from
# the dump, and populated on a fresh project too.
psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP SCHEMA public CASCADE;" \
  -c "CREATE SCHEMA public;" \
  -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;" \
  -c "DO \$\$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='auth' AND tablename <> 'schema_migrations' LOOP EXECUTE format('TRUNCATE auth.%I CASCADE', t.tablename); END LOOP; END \$\$;" \
  -c "DO \$\$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='supabase_migrations' LOOP EXECUTE format('TRUNCATE supabase_migrations.%I', t.tablename); END LOOP; END \$\$;" >/dev/null 2>&1
REMAINING="$(psql "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")"
[ "$REMAINING" = "0" ] || { echo "Error: wipe left $REMAINING public tables; the rehearsal would not prove anything." >&2; exit 1; }
AUTH_ROWS="$(psql "$DB_URL" -tAc "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='auth' and relname <> 'schema_migrations';")"
echo "    public schema dropped, auth data tables truncated (approx ${AUTH_ROWS} rows left by stats), supabase_migrations truncated"

echo "═══ 4. Restore from the backup alone ═══"
./scripts/db-restore.sh --backup-dir "$WORK/backups/rehearsal" --db-url "$DB_URL" >/dev/null
echo "    ok"

echo "═══ 5. Compare ═══"
counts > "$WORK/restored.txt"
if diff -u "$WORK/baseline.txt" "$WORK/restored.txt" > "$WORK/diff.txt"; then
  echo "    IDENTICAL — $(grep -c '=' "$WORK/restored.txt") tables, row-for-row"
  echo
  echo "REHEARSAL PASSED"
  exit 0
fi

echo "    DRIFT DETECTED:"
sed 's/^/      /' "$WORK/diff.txt"
echo
echo "REHEARSAL FAILED" >&2
exit 1
