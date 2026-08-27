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
#   scripts/db-restore.sh --backup-dir <dir> --db-url <url> [--force]
#
# THIS OVERWRITES THE TARGET DATABASE. It refuses to run against anything that is
# not obviously a local database unless --force is passed, because the difference
# between a rehearsal and an outage is one mistyped host.

set -euo pipefail

BACKUP_DIR=""
DB_URL=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --db-url)     DB_URL="${2:-}"; shift 2 ;;
    --force)      FORCE=1; shift ;;
    -h|--help)    sed -n '2,25p' "$0"; exit 0 ;;
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
MISSING_SCHEMAS="$(psql --dbname "$DB_URL" -tAc "
  SELECT string_agg(s, ', ')
  FROM unnest(ARRAY['auth','storage','extensions']) AS s
  WHERE s NOT IN (SELECT nspname FROM pg_namespace);" 2>/dev/null || true)"
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
