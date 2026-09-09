#!/usr/bin/env bash
# Cursor Cloud Agent terminal launcher for the app dev servers (api / web / landing).
#
# WHY THIS EXISTS. The three dev-server terminals must not start before the START phase
# (scripts/cursor-cloud-up.sh) has brought the stack up and written apps/api/.env.local:
# a terminal that races bringup starts the API before SUPABASE_URL exists and it dies on
# `Missing required environment variables`. Cursor launches `terminals` after `start`
# returns, so in the normal case the success sentinel is already present and this waits
# zero seconds; the loop is the guard for a restart or a slow/backgrounded bringup.
#
# It waits for the START-written sentinel, fails fast (does not silently launch a doomed
# server) if bringup reported failure, then execs the given command under the repo's
# pinned Node 20 (scripts/cursor-node20.sh — Cursor's base image fronts Node 22, which
# breaks `nest start`). Usage:
#
#   bash scripts/cursor-cloud-terminal.sh npm run start:dev -w apps/api
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DONE="$ROOT/.cloud-sandbox-up.done"
FAILED="$ROOT/.cloud-sandbox-up.failed"

echo "[cursor-cloud-terminal] waiting for stack readiness sentinel before: $*" >&2
while [ ! -f "$DONE" ] && [ ! -f "$FAILED" ]; do
  sleep 2
done

# .done wins if both are somehow present (e.g. a prior run's .done not yet cleared):
# a ready stack is a ready stack. Only a .failed with no .done is a hard stop.
if [ -f "$FAILED" ] && [ ! -f "$DONE" ]; then
  echo "[cursor-cloud-terminal] stack bringup failed — not starting: $*" >&2
  cat "$FAILED" >&2
  exit 1
fi

echo "[cursor-cloud-terminal] stack ready; starting: $*" >&2
exec bash "$ROOT/scripts/cursor-node20.sh" "$@"
