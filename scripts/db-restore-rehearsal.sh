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
# Two passes, because there are two restore shapes and the first cannot see what
# the second exists to fix. Pass A replays the dump alone (roles -> schema ->
# data), the fallback for when the repo is not to hand. Pass B is the preferred
# recovery: `supabase db push --local` rebuilds the schema from the repo's
# migrations, then `db-restore.sh --data-only` loads the dump's data into it.
# Both passes compare row counts table-by-table; pass B additionally compares
# the managed-schema objects our migrations create — the `realtime.messages`
# policies, the `supabase_realtime` publication membership and the
# `storage.buckets` rows — because `supabase db dump` excludes managed schemas
# and pass A therefore cannot restore them (the 2026-09-06 rehearsal found the
# realtime policy gone after a row-for-row-identical pass A).
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

# The objects our migrations create inside Supabase-managed schemas. None of
# them is in the dump, so pass A cannot bring them back and pass B must.
MANAGED_SQL="
select 'policy:'||schemaname||'.'||tablename||'.'||policyname||':'||cmd from pg_policies where schemaname in ('realtime','storage')
union all
select 'publication:'||schemaname||'.'||tablename from pg_publication_tables where pubname='supabase_realtime'
union all
select 'bucket:'||id from storage.buckets
order by 1;"
managed() { psql "$DB_URL" -tAc "$MANAGED_SQL" 2>/dev/null | sed '/^$/d'; }

# Resolve the Supabase CLI the same way db-backup.sh does, so pass B's
# `db push --local` runs the pinned version rather than whatever is on PATH.
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.77.0}"
if command -v supabase >/dev/null 2>&1; then SUPABASE="supabase"; else SUPABASE="npx --yes supabase@${SUPABASE_CLI_VERSION}"; fi

destroy() {
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
  #
  # Dropping `public` CASCADE also drops the `realtime.messages` policy (its
  # predicates live in public) and the publication rows for public tables, and
  # the storage.buckets rows are deleted outright — a fresh project has none of
  # these either, and pass B has to bring every one of them back. The bucket
  # delete runs with triggers off: Supabase's `storage.protect_delete()` refuses
  # direct deletes ("Use the Storage API instead"), which is the right guard for
  # a live project and the wrong one for a simulated disaster.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
    -c "DROP SCHEMA public CASCADE;" \
    -c "CREATE SCHEMA public;" \
    -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;" \
    -c "DO \$\$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='auth' AND tablename <> 'schema_migrations' LOOP EXECUTE format('TRUNCATE auth.%I CASCADE', t.tablename); END LOOP; END \$\$;" \
    -c "DO \$\$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='supabase_migrations' LOOP EXECUTE format('TRUNCATE supabase_migrations.%I', t.tablename); END LOOP; END \$\$;" \
    -c "SET session_replication_role = replica; DELETE FROM storage.objects; DELETE FROM storage.buckets;" >/dev/null 2>&1
  local remaining
  remaining="$(psql "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")"
  [ "$remaining" = "0" ] || { echo "Error: wipe left $remaining public tables; the rehearsal would not prove anything." >&2; exit 1; }
  echo "    public schema dropped, auth data tables truncated, supabase_migrations truncated, storage buckets removed"
}

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

echo "═══ 3. Pass A — destroy, then restore from the dump alone ═══"
managed > "$WORK/managed-baseline.txt"
destroy
./scripts/db-restore.sh --backup-dir "$WORK/backups/rehearsal" --db-url "$DB_URL" >/dev/null
counts > "$WORK/restored-a.txt"
if diff -u "$WORK/baseline.txt" "$WORK/restored-a.txt" > "$WORK/diff-a.txt"; then
  echo "    rows: IDENTICAL — $(grep -c '=' "$WORK/restored-a.txt") tables, row-for-row"
else
  echo "    rows: DRIFT DETECTED:"; sed 's/^/      /' "$WORK/diff-a.txt"; echo; echo "REHEARSAL FAILED (pass A rows)" >&2; exit 1
fi
managed > "$WORK/managed-a.txt"
if diff -u "$WORK/managed-baseline.txt" "$WORK/managed-a.txt" > "$WORK/managed-diff-a.txt"; then
  echo "    managed objects: identical (unexpected — the dump does not carry them; check the destroy step still removes them)"
else
  # Known and documented: the dump cannot carry these. Reported, not failed —
  # pass B is the recovery shape that restores them, and it IS failed below.
  echo "    managed objects: $(grep -c '^-[^-]' "$WORK/managed-diff-a.txt") missing after a dump-only restore (expected — this is why pass B exists):"
  grep '^-[^-]' "$WORK/managed-diff-a.txt" | sed 's/^-/      /'
fi

echo "═══ 4. Pass B — destroy, rebuild the schema from the repo, restore data only ═══"
destroy
echo "    supabase db push --local (rebuilding the schema from supabase/migrations)..."
# --include-all: the ledger is empty, so every migration is "new"; the flag is
# what the CLI wants for a history that does not start where it expects. Local
# only — production runs this through deploy-production.yml, never by hand.
if ! $SUPABASE db push --local --include-all --yes >"$WORK/push.log" 2>&1; then
  echo "Error: supabase db push --local failed while rebuilding the schema:" >&2
  tail -30 "$WORK/push.log" >&2
  echo "REHEARSAL FAILED (pass B push)" >&2; exit 1
fi
echo "    schema rebuilt: $(psql "$DB_URL" -tAc "select count(*) from supabase_migrations.schema_migrations") migrations applied"
./scripts/db-restore.sh --backup-dir "$WORK/backups/rehearsal" --db-url "$DB_URL" --data-only >/dev/null
counts > "$WORK/restored-b.txt"
managed > "$WORK/managed-b.txt"
OK=1
if diff -u "$WORK/baseline.txt" "$WORK/restored-b.txt" > "$WORK/diff-b.txt"; then
  echo "    rows: IDENTICAL — $(grep -c '=' "$WORK/restored-b.txt") tables, row-for-row"
else
  echo "    rows: DRIFT DETECTED:"; sed 's/^/      /' "$WORK/diff-b.txt"; OK=0
fi
if diff -u "$WORK/managed-baseline.txt" "$WORK/managed-b.txt" > "$WORK/managed-diff-b.txt"; then
  echo "    managed objects: IDENTICAL — $(wc -l < "$WORK/managed-b.txt") policies/publication rows/buckets"
else
  echo "    managed objects: DRIFT DETECTED:"; sed 's/^/      /' "$WORK/managed-diff-b.txt"; OK=0
fi

echo
if [ "$OK" = "1" ]; then
  echo "REHEARSAL PASSED"
  exit 0
fi
echo "REHEARSAL FAILED (pass B)" >&2
exit 1
