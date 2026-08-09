#!/usr/bin/env bash
# Shared repair for the LOCAL Supabase stack's Postgres default ACLs, plus the container
# resolution both callers need. Sourced, not executed. No `set -e` here — callers decide
# their own error policy; these helpers signal failure via return codes.
#
# Sourced by BOTH bootstrap paths, which is the whole point of the file:
#   * scripts/cloud-sandbox-up.sh  — Claude Code web sandbox (primary dev env)
#   * scripts/local-dev-setup.sh   — laptop / WSL (secondary dev env)
#
# This lib deliberately does NOT source scripts/lib/cloud-sandbox-common.sh and has no
# `cs_*` dependencies. That lib is not side-effect-free at source time (it exports the
# telemetry vars, pins CS_SUPABASE_CLI_VERSION, and normalizes the retry knobs), so
# sourcing it from the laptop path would silently pull the sandbox's pinned-CLI machinery
# into a script that intentionally uses `npx supabase`. Whether those two converge is an
# open decision tracked separately, not something this repair should settle by accident.

# Log prefix. Callers set this BEFORE sourcing so these lines are indistinguishable from
# their own output; the default only matters if the lib is sourced standalone in a test.
: "${FRAPP_ACL_LOG_PREFIX:=[local-postgres-acl]}"

frapp_acl_log() {
  printf '%s %s\n' "${FRAPP_ACL_LOG_PREFIX}" "$*" >&2
}

# The repair itself.
#
# The pinned supabase/postgres image (17.6.x) ships a default ACL for role `postgres` in
# schema `public` that grants anon / authenticated / service_role only `Dxtm` (TRUNCATE,
# REFERENCES, TRIGGER, MAINTAIN) on tables — the DML bits `arwd` (SELECT/INSERT/UPDATE/DELETE)
# are missing. Sequences are crippled the same way (`w` only, missing `rU`). `supabase db push`
# applies migrations as `postgres`, so every table it creates inherits that ACL and the API's
# first query dies with `42501 permission denied for table chapters` while /health reports
# `degraded`. The `supabase_admin` default ACL is correct (`arwdDxtm`) but irrelevant — the CLI
# does not create objects as that role. A full `supabase db reset --local` reproduces it, so
# this is the image's shipped state, not drift in one session's database — and therefore it
# affects the laptop path exactly as much as the sandbox.
#
# Two halves, both required and both idempotent:
#   * GRANT ... ON ALL TABLES/SEQUENCES repairs the objects the migrations just created.
#   * ALTER DEFAULT PRIVILEGES repairs the objects later migrations will create, so a session
#     that adds a migration does not have to re-run this by hand.
#
# Function EXECUTE is deliberately NOT granted, and this is the one line here that must not be
# "tidied" into symmetry with the table grants. Nine migrations under supabase/migrations/
# (anonymize_user, confirm_task_completion, approve_service_entry, the stripe_webhook_events
# RPCs, …) explicitly `revoke execute … from public/anon/authenticated` and then grant it to
# service_role alone. A blanket `GRANT EXECUTE ON ALL FUNCTIONS` would silently undo all nine.
# Functions are also not affected by the defect in the first place: they fall back to
# PostgreSQL's PUBLIC EXECUTE default, so there is nothing here to repair.
#
# Local stack only. Hosted Supabase projects ship correct default grants, which is why this
# lives in bootstrap tooling and NOT in supabase/migrations/ — as a migration it would be a
# no-op at best and a privilege change on hosted projects at worst.
FRAPP_LOCAL_ACL_SQL="
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
"

# Resolve THIS project's Supabase database container.
#
#   frapp_resolve_supabase_db_container <project_root> [include_stopped]
#
#   stdout : the container name, and only on success
#   return : 0 exactly one match · 1 none found · 2 ambiguous (candidates logged)
#
# `--filter name=` is an unanchored regex, not an exact match: a bare `supabase_db_` also
# matches another repo's stack on a machine running two of them, and `head -1` would then
# silently act on the wrong database while reporting success. The CLI names the container
# after the project (the directory name unless supabase/config.toml sets project_id), so try
# the exact name first and only accept a loose match when it is unambiguous.
#
# The anchored pattern is still a regex, so a project directory containing a metacharacter
# (`my.app` matching `myXapp`) could in principle over-match. The string comparison after the
# filter is what makes the match exact regardless.
#
# `include_stopped` selects `docker ps -a`. The ACL repair wants running containers only; the
# Postgres version-mismatch hint specifically wants exited ones, since a container that failed
# to start is the entire subject of that check.
#
# Every command below tolerates its own failure explicitly (`|| true`, `if` blocks rather than
# `&&` lists). local-dev-setup.sh sources this under `set -euo pipefail`, where a bare
# `[ x = y ] && cmd` that evaluates false returns 1 and kills the whole bootstrap.
frapp_resolve_supabase_db_container() {
  local project_root="$1"
  local include_stopped="${2:-false}"
  local expected exact loose match_count match
  local ps_args=()

  expected="supabase_db_$(basename "${project_root}")"
  if [ "${include_stopped}" = "true" ]; then
    ps_args+=(-a)
  fi

  exact=$(docker ps "${ps_args[@]}" --filter "name=^${expected}$" --format '{{.Names}}' 2>/dev/null || true)
  while IFS= read -r match; do
    if [ "${match}" = "${expected}" ]; then
      printf '%s\n' "${expected}"
      return 0
    fi
  done <<<"${exact}"

  loose=$(docker ps "${ps_args[@]}" --filter 'name=supabase_db_' --format '{{.Names}}' 2>/dev/null || true)
  match_count=$(printf '%s\n' "${loose}" | grep -c . || true)

  if [ "${match_count}" -eq 1 ]; then
    printf '%s\n' "${loose}"
    return 0
  fi

  if [ "${match_count}" -gt 1 ]; then
    frapp_acl_log "Several supabase_db_* containers are present and none matches this project"
    frapp_acl_log "($(basename "${project_root}")); refusing to guess which one is meant:"
    printf '%s\n' "${loose}" | sed "s/^/${FRAPP_ACL_LOG_PREFIX}   /" >&2
    return 2
  fi

  return 1
}

# Apply the repair.
#
#   frapp_repair_local_acls <project_root> [db_url_resolver_fn]
#
# `db_url_resolver_fn` is the NAME of a caller-defined function that echoes the local
# database URL (typically from `supabase status -o env`). Passing a name rather than the URL
# keeps the resolution lazy: on a host without psql the CLI round-trip is never paid for, and
# each caller keeps its own Supabase CLI (pinned `cs_supabase` vs. `npx supabase`) without
# this lib having to know which. Omit it to go straight to the container path.
#
# -X is load-bearing, not hygiene. psql applies `-v ON_ERROR_STOP=1` BEFORE reading ~/.psqlrc,
# so an rc file wins: with `\set AUTOCOMMIT off` in it, all four statements run inside an
# implicit transaction that is rolled back at disconnect while psql still exits 0. The repair
# would silently no-op, the caller would report success, and the API would still fail with
# 42501 — the exact failure this function exists to prevent. Verified locally.
frapp_repair_local_acls() {
  local project_root="$1"
  local db_url_resolver="${2:-}"
  local db_url container rc

  # Preferred path: the host psql against the URL the CLI reports, so the port stays in one
  # place (supabase/config.toml) rather than being duplicated here. `command -v` is tested
  # first so a host without psql does not pay for a Supabase CLI round-trip it will discard.
  if [ -n "${db_url_resolver}" ] && command -v psql >/dev/null 2>&1; then
    db_url=$("${db_url_resolver}" || true)
    if [ -n "${db_url}" ]; then
      if printf '%s' "${FRAPP_LOCAL_ACL_SQL}" | psql "${db_url}" -X -v ON_ERROR_STOP=1 -q -f - >&2; then
        return 0
      fi
      frapp_acl_log "WARN: psql ACL repair failed; retrying inside the database container."
    fi
  fi

  # Fallback: psql inside the db container. `supabase start` guarantees that container,
  # whereas a host psql is incidental to whatever machine this is.
  # `&& rc=0 || rc=$?` rather than a bare assignment followed by `rc=$?`: under `set -e` a
  # command substitution that exits non-zero aborts the caller outright, which would turn
  # "no container found" into a silent bootstrap death instead of the message below.
  container=$(frapp_resolve_supabase_db_container "${project_root}" false) && rc=0 || rc=$?
  if [ "${rc}" -ne 0 ]; then
    # rc 2 has already logged the ambiguous candidates; rc 1 needs its own line.
    if [ "${rc}" -eq 1 ]; then
      frapp_acl_log "ERROR: no running supabase_db_* container found for the ACL repair."
    fi
    return 1
  fi

  frapp_acl_log "Repairing via container ${container}."
  printf '%s' "${FRAPP_LOCAL_ACL_SQL}" \
    | docker exec -i "${container}" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q -f - >&2
}
