#!/usr/bin/env bash
# Local development bootstrap (WSL / Ubuntu primary).
# Does not start dockerd -- use Docker Desktop (WSL integration) or `sudo service docker start` with docker.io.
#
# Flags:
#   --quick                  Skip check-types and check:migration-safety
#   --reset-supabase         Run `npx supabase stop` before start (fixes stuck/exited Frapp Supabase containers)
#   --reset-supabase-data    Same as stop with --no-backup (WIPES local DB volumes). Requires confirmation
#                            (TTY: y/N prompt) or FRAPP_CONFIRM_SUPABASE_DATA_WIPE=1 in non-interactive shells.
#
# Does NOT stop arbitrary Docker containers -- only this repo's Supabase CLI stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=false
RESET_SUPABASE=false
RESET_SUPABASE_DATA=false

for arg in "$@"; do
  case "$arg" in
    --quick)
      QUICK=true
      ;;
    --reset-supabase)
      RESET_SUPABASE=true
      ;;
    --reset-supabase-data)
      RESET_SUPABASE=true
      RESET_SUPABASE_DATA=true
      ;;
    -h | --help)
      cat <<'EOF'
Usage: bash scripts/local-dev-setup.sh [options]

  --quick                   Skip check-types and check:migration-safety
  --reset-supabase          Run supabase stop before start (this project only; keeps volumes)
  --reset-supabase-data     Stop with --no-backup (wipes local DB). TTY confirmation or
                            FRAPP_CONFIRM_SUPABASE_DATA_WIPE=1 for non-interactive use.

Does not stop unrelated Docker containers. For stuck containers, try --reset-supabase.
For Postgres "incompatible data directory" / older major on disk vs config.toml, use --reset-supabase-data.
EOF
      exit 0
      ;;
    *)
      printf '%s\n' "[local-dev-setup] Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

log() {
  printf '%s %s\n' "[local-dev-setup]" "$*"
}

log_err() {
  printf '%s %s\n' "[local-dev-setup]" "$*" >&2
}

confirm_data_wipe() {
  if [[ -n "${FRAPP_CONFIRM_SUPABASE_DATA_WIPE:-}" ]]; then
    return 0
  fi
  if [[ -t 0 ]] && [[ -t 1 ]]; then
    read -r -p "[local-dev-setup] DELETE all local Supabase data volumes for this project? [y/N] " -r reply
    echo ""
    [[ "${reply}" == "y" || "${reply}" == "Y" ]]
  else
    log_err "Refusing --reset-supabase-data without a TTY. Set FRAPP_CONFIRM_SUPABASE_DATA_WIPE=1 or run interactively."
    return 1
  fi
}

supabase_stop_for_reset() {
  if [[ "${RESET_SUPABASE_DATA}" == "true" ]]; then
    log_err "WARNING: Stopping Supabase with --no-backup removes local Postgres data for this project."
    if ! confirm_data_wipe; then
      exit 1
    fi
    log "Stopping Supabase and removing data volumes (--no-backup)..."
    npx supabase stop --no-backup || true
  else
    log "Stopping Supabase stack for this project (volumes preserved)..."
    npx supabase stop || true
  fi
}

# If the local supabase_db_* container logged PG major-version / data-dir errors, nudge toward --reset-supabase-data.
maybe_hint_postgres_volume_mismatch() {
  if ! docker info >/dev/null 2>&1; then
    return 0
  fi
  local cname log_tail
  cname="$(docker ps -a --filter "name=supabase_db_" --format '{{.Names}}' 2>/dev/null | head -n1)" || true
  [[ -n "${cname}" ]] || return 0
  log_tail="$(docker logs "${cname}" 2>&1 | tail -n 100)" || true
  if printf '%s\n' "${log_tail}" | grep -qE 'incompatible with server|initialized by PostgreSQL version'; then
    log_err "Detected Postgres data directory / engine major-version mismatch in ${cname} logs."
    log_err "A volume-preserving stop/restart will not fix this. Run: bash scripts/local-dev-setup.sh --reset-supabase-data"
    echo "" >&2
  fi
}

print_supabase_start_failure_hints() {
  log_err "Common causes:"
  log_err "  - Stuck or exited containers: bash scripts/local-dev-setup.sh --reset-supabase (keeps volumes)"
  log_err "  - Local data from an older Postgres major than supabase/config.toml: bash scripts/local-dev-setup.sh --reset-supabase-data"
  log_err "    (same idea as: npx supabase stop --no-backup; see https://supabase.com/docs/reference/cli/supabase-stop )"
}

run_supabase_start_with_optional_retry() {
  if npx supabase start; then
    return 0
  fi

  log_err "npx supabase start failed."
  maybe_hint_postgres_volume_mismatch || true
  print_supabase_start_failure_hints
  echo "" >&2
  if [[ -t 0 ]] && [[ -t 1 ]]; then
    read -r -p "[local-dev-setup] Stop stack and retry start? (keeps volumes: fixes stuck/exited containers, NOT Postgres major-version mismatch) [y/N] " reply
    echo ""
    if [[ "${reply}" == "y" || "${reply}" == "Y" ]]; then
      npx supabase stop || true
      npx supabase start
    else
      log_err "Run manually: npx supabase stop && npx supabase start"
      log_err "Or: bash scripts/local-dev-setup.sh --reset-supabase"
      log_err "If logs show incompatible Postgres data: bash scripts/local-dev-setup.sh --reset-supabase-data"
      return 1
    fi
  else
    log_err "Non-interactive shell:"
    log_err "  Stuck containers: bash scripts/local-dev-setup.sh --reset-supabase"
    log_err "  Incompatible local Postgres data: bash scripts/local-dev-setup.sh --reset-supabase-data"
    return 1
  fi
}

log "Checking Docker (daemon must be running)..."
if ! docker info >/dev/null 2>&1; then
  log_err "ERROR: Docker daemon is not reachable from this shell."
  echo "" >&2
  log_err "docker info output (often shows cannot connect to pipe/socket or docker.sock):"
  docker info 2>&1 | tail -n 20 >&2 || true
  echo "" >&2
  echo "  Windows: Start Docker Desktop and wait until it is fully started (Engine running)." >&2
  echo "  If you see 'dockerDesktopLinuxEngine' / npipe errors: Docker Desktop is not running or the Linux engine failed to start." >&2
  echo "  Git Bash: ensure docker.exe is on PATH (same as PowerShell)." >&2
  echo "  WSL + Docker Desktop: Settings -> Resources -> WSL integration -> enable your distro." >&2
  echo "  WSL + docker.io: sudo service docker start (and add your user to the docker group)." >&2
  echo "" >&2
  exit 1
fi
log "Docker OK."

echo "Installing npm dependencies..."
npm install

if [[ "${RESET_SUPABASE}" == "true" ]]; then
  supabase_stop_for_reset
fi

echo "Starting Supabase (first run may take ~90s)..."
if ! run_supabase_start_with_optional_retry; then
  exit 1
fi

echo "Applying local migrations..."
npx supabase db push --local

if [[ "${QUICK}" == "false" ]]; then
  echo "Running typecheck and migration safety check..."
  npm run check-types
  npm run check:migration-safety
else
  echo "Skipping check-types and check:migration-safety (--quick)."
fi

echo ""
echo "Local stack is ready."
echo ""
echo "Next (repo root) — start API + web + landing + docs in one terminal:"
echo "  npm run dev:stack"
echo ""
echo "First time on this machine: npx infisical login"
echo "Populate Infisical 'local' env (Supabase keys, etc.): docs/internal/SECRETS_MANAGEMENT.md"
echo ""
echo "Separate terminals, no Infisical, mobile, URLs: docs/internal/LOCAL_DEV.md"
echo ""
echo "Supabase Studio: http://127.0.0.1:54323"
echo ""
