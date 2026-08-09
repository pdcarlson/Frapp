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
#
# Portability: no bash arrays and no `"${arr[@]}"` expansion anywhere below. Expanding an
# empty array under `set -u` is an unbound-variable error before bash 4.4, and that error is
# fatal inside a command substitution regardless of any `|| true` around it — which would
# turn "resolve a container" into an unexplained bootstrap abort on a stock macOS bash 3.2.

# Log prefix, looked up at CALL time (not at source time), so callers may set it before or
# after sourcing. Keep it free of `/` and `&` — it is only ever printed, never used as a
# sed replacement, but it does end up in printf format arguments' data positions.
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
# "tidied" into symmetry with the table grants. Ten migrations under supabase/migrations/
# (confirm_task_completion, approve_service_entry, check_in_event, transfer_presidency,
# active_chapter_jwt_claim, apply_invoice_payment, anonymize_user, chat_message_actions RLS,
# stripe_webhook_events, role_gated_required_permissions) revoke EXECUTE from `public` and
# `anon` — eight of them from `authenticated` as well — and then re-grant it only to named
# roles: `service_role` in nine, `supabase_auth_admin` in one, and `authenticated` in the two
# that deliberately allow a direct client call. A blanket
# `GRANT EXECUTE ON ALL FUNCTIONS … TO anon, authenticated, service_role` would undo every one
# of those revokes at once. (Enumerated by grep against supabase/migrations/; re-check if you
# edit this.) Functions are also not affected by the defect in the first place: they fall back
# to PostgreSQL's PUBLIC EXECUTE default, so there is nothing here to repair.
#
# Local stack only. Hosted Supabase projects ship correct default grants, which is why this
# lives in bootstrap tooling and NOT in supabase/migrations/ — as a migration it would be a
# no-op at best and a privilege change on hosted projects at worst.
#
# SINGLE-quoted on purpose. Under double quotes bash expands `$`, backticks and `\` at source
# time, and this file is explicitly the place the repair gets extended — the moment someone
# adds the idiomatic guarded form (`do $$ begin … end $$;`), bash substitutes its own PID for
# each `$$` and psql sees `do 12345 begin … end 12345;`. That surfaces only as "ACL repair
# failed", with nothing hinting the SQL was rewritten before it was sent.
FRAPP_LOCAL_ACL_SQL='
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
'

# `docker ps`, optionally including stopped containers, never failing the caller.
#
#   _frapp_docker_ps <include_stopped> <docker ps args...>
#
# Exists so the -a toggle does not need an array (see the portability note at the top).
#
# `include_stopped` accepts the common truthy spellings rather than only the literal `true`.
# CLOUD_SANDBOX.md invites sourcing this lib and calling it by hand, and a caller passing `1`
# or `yes` and silently getting running-only is precisely the confidently-wrong-answer failure
# this file exists to avoid. Anything unrecognised still means false, which is the safe default.
_frapp_docker_ps() {
  local include_stopped="$1"
  shift
  case "${include_stopped}" in
    true | TRUE | 1 | yes | YES | -a) docker ps -a "$@" 2>/dev/null || true ;;
    *) docker ps "$@" 2>/dev/null || true ;;
  esac
}

# This project's Supabase container name, as the CLI would name it.
#
# The CLI uses `project_id` from supabase/config.toml when set, and the directory basename
# otherwise. Reading config.toml is not a nicety: LOCAL_DEV.md tells a developer to set
# `project_id` precisely to escape the two-stacks ambiguity below, and a resolver that only
# ever computed the basename would make that advice permanently break resolution instead of
# fixing it. Accepts either quote style; falls back to the basename when unset or unreadable.
frapp_supabase_db_container_name() {
  local project_root="$1"
  local cfg="${project_root}/supabase/config.toml"
  local name=""

  if [ -r "${cfg}" ]; then
    name=$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*["'"'"']\([^"'"'"']*\)["'"'"'].*/\1/p' "${cfg}" | head -n1)
  fi
  [ -n "${name}" ] || name=$(basename "${project_root}")

  printf '%s' "supabase_db_${name}"
}

# Resolve THIS project's Supabase database container.
#
#   frapp_resolve_supabase_db_container <project_root> [include_stopped]
#
#   stdout : the container name, and only on an exact match for THIS project
#   return : 0 exact match · 1 not found · 2 not found, but other stacks are present (logged)
#
# `--filter name=` is an unanchored regex, not an exact match: a bare `supabase_db_` also
# matches another repo's stack on a machine running two of them, and `head -1` would then
# hand back the wrong container. The anchored pattern is still a regex, so a project name
# containing a metacharacter (`my.app` matching `myXapp`) could over-match; the string
# comparison after the filter is what makes the match exact regardless.
#
# It NEVER falls back to "some other supabase_db_* container is running, use that one". An
# earlier revision did, when exactly one candidate existed, and both callers turn that into
# damage: the repair would run GRANT / ALTER DEFAULT PRIVILEGES inside an unrelated project's
# database and report success while this project stayed broken, and the version-mismatch hint
# would read a foreign container's logs and recommend --reset-supabase-data — wiping THIS
# project's healthy volumes. Both are the wrong-container class of bug this resolver exists to
# prevent, so a near-miss now fails loudly (rc 2, candidates logged as context) rather than
# guessing. The candidates are logged, never returned.
#
# `include_stopped` selects `docker ps -a`. The ACL repair wants running containers only; the
# Postgres version-mismatch hint specifically wants exited ones, since a container that failed
# to start is the entire subject of that check.
frapp_resolve_supabase_db_container() {
  local project_root="$1"
  local include_stopped="${2:-false}"
  local expected exact loose candidate

  expected=$(frapp_supabase_db_container_name "${project_root}")

  exact=$(_frapp_docker_ps "${include_stopped}" --filter "name=^${expected}$" --format '{{.Names}}')
  if printf '%s\n' "${exact}" | grep -Fxq -- "${expected}"; then
    printf '%s\n' "${expected}"
    return 0
  fi

  loose=$(_frapp_docker_ps "${include_stopped}" --filter 'name=supabase_db_' --format '{{.Names}}')
  if [ -z "${loose}" ]; then
    return 1
  fi

  # Wording stays neutral between the two callers: one is about to repair ACLs, the other is
  # only deciding whether to offer a hint, and a repair-flavoured message printed under a
  # failed `supabase start` reads as a second, unrelated error.
  frapp_acl_log "No container named ${expected} for this project; not substituting another"
  frapp_acl_log "project's stack. Present instead:"
  printf '%s\n' "${loose}" | while IFS= read -r candidate; do
    if [ -n "${candidate}" ]; then
      frapp_acl_log "  ${candidate}"
    fi
  done
  return 2
}

# Apply the repair.
#
#   frapp_repair_local_acls <project_root> [supabase_cli_command...]
#
# The CLI command (`cs_supabase`, or `npx supabase`) is passed as trailing words rather than
# a resolved URL so the `status -o env` round-trip stays lazy — a host without psql never pays
# for a call it would discard — while the parse itself lives here once instead of being copied
# into both bootstrap scripts. Omit it to go straight to the container path.
#
# -X is load-bearing, not hygiene. psql applies `-v ON_ERROR_STOP=1` BEFORE reading ~/.psqlrc,
# so an rc file wins: with `\set AUTOCOMMIT off` in it, all four statements run inside an
# implicit transaction that is rolled back at disconnect while psql still exits 0. The repair
# would silently no-op, the caller would report success, and the API would still fail with
# 42501 — the exact failure this function exists to prevent. Verified locally.
frapp_repair_local_acls() {
  local project_root="$1"
  shift
  local db_url container rc

  # Preferred path: the host psql against the URL the CLI reports, so the port stays in one
  # place (supabase/config.toml) rather than being duplicated here. `command -v` is tested
  # first so a host without psql does not pay for a Supabase CLI round-trip it will discard.
  if [ "$#" -gt 0 ] && command -v psql >/dev/null 2>&1; then
    db_url=$("$@" status -o env 2>/dev/null | sed -n 's/^DB_URL=//p' | tr -d '"' || true)

    # "Local stack only" is otherwise enforced by comments alone, and the blast radius of
    # getting it wrong is a permanent ALTER DEFAULT PRIVILEGES on a hosted project granting
    # anon/authenticated DML across the whole public schema. `supabase status` can only ever
    # report the local stack today, so this rejects nothing that works now — it is here so a
    # later edit (say, falling back to $DATABASE_URL when status comes back empty) cannot
    # quietly turn a bootstrap helper into a production privilege change.
    case "${db_url}" in
      *@127.0.0.1:* | *@localhost:* | *@\[::1\]:* | *@0.0.0.0:*) ;;
      "") ;;
      *)
        frapp_acl_log "WARN: refusing to repair ACLs over a non-loopback database URL."
        frapp_acl_log "      This repair is for local stacks only; falling back to the container path."
        db_url=""
        ;;
    esac

    if [ -n "${db_url}" ]; then
      if printf '%s' "${FRAPP_LOCAL_ACL_SQL}" | psql "${db_url}" -X -v ON_ERROR_STOP=1 -q -f - >&2; then
        return 0
      fi
      frapp_acl_log "WARN: psql ACL repair failed; retrying inside the database container."
    fi
  fi

  # Fallback: psql inside the db container. `supabase start` guarantees that container,
  # whereas a host psql is incidental to whatever machine this is.
  #
  # `&& rc=0 || rc=$?` rather than a bare assignment followed by `rc=$?`: under `set -e` a
  # command substitution that exits non-zero aborts the caller outright, which would turn
  # "no container found" into a silent bootstrap death instead of the message below.
  container=$(frapp_resolve_supabase_db_container "${project_root}" false) && rc=0 || rc=$?
  if [ "${rc}" -ne 0 ]; then
    # rc 2 has already logged the candidates it refused; rc 1 needs its own line.
    if [ "${rc}" -eq 1 ]; then
      frapp_acl_log "ERROR: no running supabase_db_* container found for the ACL repair."
    fi
    return 1
  fi

  frapp_acl_log "Repairing via container ${container}."
  printf '%s' "${FRAPP_LOCAL_ACL_SQL}" \
    | docker exec -i "${container}" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q -f - >&2
}
