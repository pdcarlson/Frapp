#!/usr/bin/env bash
# Wait for Cursor Cloud / cloud-sandbox bringup sentinels, then exec remaining
# args under Node 20. Used by `.cursor/environment.json` terminals so they do
# not race `start` (the API dies on missing SUPABASE_URL if .env.local is not
# written yet).
#
# Usage: bash scripts/cursor-wait-sandbox.sh <command> [args...]
#
# Success: `.cloud-sandbox-up.done` (or alias `.cursor-cloud-up.done`) exists.
# Failure: `.cloud-sandbox-up.failed` exists — print the body and exit 1.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CURSOR_WAIT_SANDBOX_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DONE="$ROOT/.cloud-sandbox-up.done"
FAILED="$ROOT/.cloud-sandbox-up.failed"
ALIAS_DONE="$ROOT/.cursor-cloud-up.done"
INTERVAL="${CURSOR_WAIT_SANDBOX_INTERVAL:-2}"

log() { printf '[cursor-wait-sandbox] %s\n' "$*" >&2; }

deadline=0
if [ -n "${CURSOR_WAIT_SANDBOX_TIMEOUT_SECONDS:-}" ]; then
  deadline=$(( $(date +%s) + CURSOR_WAIT_SANDBOX_TIMEOUT_SECONDS ))
fi

while [ ! -f "$DONE" ] && [ ! -f "$ALIAS_DONE" ] && [ ! -f "$FAILED" ]; do
  if [ "$deadline" -gt 0 ] && [ "$(date +%s)" -ge "$deadline" ]; then
    log "timed out waiting for .cloud-sandbox-up.done / .cloud-sandbox-up.failed"
    exit 2
  fi
  sleep "$INTERVAL"
done

if [ -f "$FAILED" ]; then
  log "stack bringup failed"
  cat "$FAILED" >&2 || true
  exit 1
fi

if [ "$#" -eq 0 ]; then
  exit 0
fi

exec bash "$SCRIPT_DIR/cursor-node20.sh" "$@"
