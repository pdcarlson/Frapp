#!/usr/bin/env bash
#
# Offsite logical backup of a Supabase Postgres database (#852).
#
# WHY THIS EXISTS, AND WHY IT IS NOT REDUNDANT WITH SUPABASE'S OWN BACKUPS:
# the `Frapp Live` org is on the Supabase **free** plan, and Supabase only takes
# restorable daily backups for Pro/Team/Enterprise projects. Free-plan projects
# get no dashboard-accessible snapshot and no PITR, and Supabase's own guidance
# for that tier is exactly this script:
#
#   "We recommend that free tier plan projects regularly export their data using
#    the Supabase CLI `db dump` command and maintain off-site backups."
#   https://supabase.com/docs/guides/platform/backups
#
# So this is not defence-in-depth on top of a provider snapshot. Until the org is
# upgraded, it is the ONLY restorable backup either project has.
#
# Three files, per Supabase's documented backup recipe (same link, and
# /guides/platform/migrating-within-supabase/backup-restore). They are separate
# because `psql` must replay them in this order, and `data.sql` must be replayed
# with triggers disabled:
#
#   roles.sql   --role-only    custom roles (passwords are NOT included)
#   schema.sql  (default)      tables, RLS policies, functions, triggers
#   data.sql    --data-only    row data, as COPY
#
# `supabase db dump` rather than a bare `pg_dump`: it runs pg_dump inside a
# container built from the Supabase Postgres image, which (a) matches the remote
# server's major version — a local pg_dump 16 flatly refuses a 17 server, which
# is the case on this repo's own sandbox — and (b) applies Supabase's filtering,
# excluding managed schemas and reserved roles that would otherwise fail the
# restore on permission errors.
#
# NOT COVERED, and deliberately not papered over: Storage objects. Per the same
# guide, "Database backups do not include objects you store via the Storage API,
# as the database only includes metadata about these objects." This repo has eight
# buckets; a restore from these files yields rows that reference objects this
# backup never captured. See DB_ROLLBACK_PLAYBOOK.md § What this backup does not
# cover.
#
# Usage:
#   scripts/db-backup.sh --db-url <postgres-url> --out-dir <dir> [--label <label>]
#   scripts/db-backup.sh --linked            --out-dir <dir> [--label <label>]
#
# `--linked` dumps the project that `supabase link` is pointed at, and is what CI
# uses. It exists because a hardcoded connection string is a liability here:
# GitHub runners are IPv4-only while Supabase direct connections are IPv6-only
# without the IPv4 add-on, so CI must go through the session pooler — whose
# hostname encodes a region and a shard index that Supabase has changed before.
# Letting the CLI resolve it means a pooler rename cannot silently break the only
# backup this project has.
#
# Emits <out-dir>/<label>/{roles,schema,data}.sql.gz plus manifest.json, and
# prints the created directory on stdout as its last line.

set -euo pipefail

DB_URL=""
OUT_DIR=""
LABEL=""
LINKED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --db-url)  DB_URL="${2:-}"; shift 2 ;;
    --linked)  LINKED=1; shift ;;
    --out-dir) OUT_DIR="${2:-}"; shift 2 ;;
    --label)   LABEL="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d;s/^# \?//'; exit 0 ;;
    *) echo "Error: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

if [ "$LINKED" -eq 1 ] && [ -n "$DB_URL" ]; then
  echo "Error: --linked and --db-url are mutually exclusive" >&2; exit 2
fi
if [ "$LINKED" -eq 0 ] && [ -z "$DB_URL" ]; then
  echo "Error: one of --db-url or --linked is required" >&2; exit 2
fi
[ -n "$OUT_DIR" ] || { echo "Error: --out-dir is required" >&2; exit 2; }
# Default label is UTC-sorted so a lexical listing of the bucket is also
# chronological — the restore path picks "latest" by name, not by mtime, because
# object-store mtimes reflect upload order rather than dump order.
[ -n "$LABEL" ]   || LABEL="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

# Fail before dumping rather than after: a half-written backup directory that
# looks plausible is worse than no directory at all.
command -v gzip >/dev/null 2>&1 || { echo "Error: gzip not found" >&2; exit 1; }
if ! docker info >/dev/null 2>&1; then
  echo "Error: the Docker daemon is not reachable. 'supabase db dump' runs pg_dump inside a container and cannot work without it." >&2
  exit 1
fi

# Prefer a `supabase` already on PATH — in CI that is the binary supabase/setup-cli
# installed at the repo-wide pin, and using it keeps ONE CLI version across `link`
# and `dump`. They share the linked-project state under supabase/.temp, so running
# them on different versions is asking for a skew bug in the only backup this
# project has. Falls back to a pinned npx for local runs, where nothing is
# installed. Override with SUPABASE_CLI_VERSION to test another version.
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.77.0}"
if command -v supabase >/dev/null 2>&1; then
  SUPABASE="supabase"
else
  SUPABASE="npx --yes supabase@${SUPABASE_CLI_VERSION}"
fi

DEST="$OUT_DIR/$LABEL"
mkdir -p "$DEST"

if [ "$LINKED" -eq 1 ]; then
  SOURCE_ARGS=(--linked)
  SAFE_URL="the linked Supabase project"
else
  SOURCE_ARGS=(--db-url "$DB_URL")
  # Redact the password before anything reaches a log. GitHub masks registered
  # secrets, but this script also runs locally during a rehearsal where nothing
  # is masked, so it must not rely on the runner for that.
  SAFE_URL="$(printf '%s' "$DB_URL" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#')"
fi
echo "==> Dumping $SAFE_URL"
echo "    into $DEST"

echo "--> roles.sql (--role-only)"
$SUPABASE db dump "${SOURCE_ARGS[@]}" -f "$DEST/roles.sql" --role-only

echo "--> schema.sql"
$SUPABASE db dump "${SOURCE_ARGS[@]}" -f "$DEST/schema.sql"

# The `storage` schema's DATA is excluded on purpose, and this is a deviation
# from Supabase's generic recipe that the #852 rehearsal forced:
#
#   * `storage.buckets` rows are provisioned by this repo's own migrations
#     (supabase/migrations/*_bucket.sql), so they are configuration, not chapter
#     data. Including them makes the restore abort with
#     `duplicate key value violates unique constraint "buckets_pkey"` against any
#     project that already has its buckets — and because the restore runs in a
#     single transaction, that one collision discards the entire restore.
#     Storage also blocks deleting them out of the way first
#     ("Direct deletion from storage tables is not allowed").
#   * `storage.objects` rows are metadata for files that live outside the
#     database. A dump cannot carry the objects, so restoring their metadata
#     yields rows pointing at files that are not there — worse than omitting it.
#
# Both were observed for real; see DB_ROLLBACK_PLAYBOOK.md § Rehearsal log.
# `--schema` (an include-list) rather than `-x` (an exclude-list): `-x` takes
# explicit `schema.table` entries and does NOT accept wildcards, so `-x storage.*`
# silently matches nothing and ships the storage rows anyway — verified during the
# #852 rehearsal, where the restore then died on buckets_pkey. Enumerating every
# storage table instead would rot the moment Supabase adds one.
#
# `supabase_migrations` is included deliberately: without it a restored database
# has the schema but no migration history, so the next `db push` tries to replay
# everything from the beginning.
#
# `auth.schema_migrations` is excluded just as deliberately. That is GoTrue's OWN
# migration ledger, and Supabase populates it while provisioning every project —
# so it is never empty in a restore target, fresh or not, and restoring it aborts
# on `schema_migrations_pkey`. Also observed for real during the rehearsal.
echo "--> data.sql (--data-only --use-copy, schemas: public, auth, supabase_migrations)"
$SUPABASE db dump "${SOURCE_ARGS[@]}" -f "$DEST/data.sql" --data-only --use-copy \
  --schema public,auth,supabase_migrations \
  -x auth.schema_migrations

# A zero-byte schema.sql is the signature failure mode here: the CLI can exit 0
# having written nothing when it cannot reach the database. Catch it now, while
# there is still a human or a red CI job watching, rather than at 3am during a
# restore.
for f in roles schema data; do
  if [ ! -s "$DEST/$f.sql" ]; then
    echo "Error: $DEST/$f.sql is empty — refusing to publish a backup that cannot restore." >&2
    exit 1
  fi
done

# -f so re-running with an explicit --label overwrites cleanly. Without it gzip
# refuses, leaves the previous .gz in place, and the manifest written below would
# then describe files from an older dump.
echo "--> compressing"
gzip -9 -f "$DEST/roles.sql" "$DEST/schema.sql" "$DEST/data.sql"

# The manifest is what makes a restore auditable: it records what was dumped and
# lets the restore verify integrity before replaying anything into a database.
{
  printf '{\n'
  printf '  "label": "%s",\n' "$LABEL"
  printf '  "created_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "supabase_cli": "%s",\n' "$($SUPABASE --version 2>/dev/null | tail -1 | tr -d '\\n' || echo unknown)"
  printf '  "files": {\n'
  printf '    "roles": "%s",\n'  "$(sha256sum "$DEST/roles.sql.gz"  | cut -d' ' -f1)"
  printf '    "schema": "%s",\n' "$(sha256sum "$DEST/schema.sql.gz" | cut -d' ' -f1)"
  printf '    "data": "%s"\n'    "$(sha256sum "$DEST/data.sql.gz"   | cut -d' ' -f1)"
  printf '  },\n'
  printf '  "covers": "application data only — the storage schema (buckets + object metadata) and Storage objects themselves are NOT included"\n'
  printf '}\n'
} > "$DEST/manifest.json"

echo "==> Backup complete:"
ls -la "$DEST"
echo "$DEST"
