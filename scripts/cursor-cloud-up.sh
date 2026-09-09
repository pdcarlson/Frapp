#!/usr/bin/env bash
# Cursor Cloud per-boot bringup. This is the Cursor-owned entrypoint for
# `.cursor/environment.json` `start` (invoked after boot sysctls by
# scripts/cursor-agent-start.sh).
#
# It always runs because Cursor invoked `start`. It does not treat Claude
# SessionStart, CLAUDE_PROJECT_DIR, or /etc/frapp-cloud-sandbox as the reason
# it runs. Shared implementation is scripts/cloud-sandbox-up.sh (Claude
# fallback SessionStart still calls that file directly). Sentinels stay
# `.cloud-sandbox-up.done` / `.cloud-sandbox-up.failed`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[cursor-cloud-up] %s\n' "$*" >&2; }

rm -f "$ROOT/.cursor-cloud-up.done" "$ROOT/.cursor-cloud-up.failed"

log "Bringing up the local stack (Docker + Supabase)..."
# Drop CLAUDE_PROJECT_DIR in the child so the shared script computes ROOT from
# its own location. Cursor start owns this path; a leftover Claude hook env
# var must not redirect the workspace root.
env -u CLAUDE_PROJECT_DIR bash "$ROOT/scripts/cloud-sandbox-up.sh"
rc=$?

if [ -f "$ROOT/.cloud-sandbox-up.done" ]; then
  cp -f "$ROOT/.cloud-sandbox-up.done" "$ROOT/.cursor-cloud-up.done"
fi
if [ -f "$ROOT/.cloud-sandbox-up.failed" ]; then
  cp -f "$ROOT/.cloud-sandbox-up.failed" "$ROOT/.cursor-cloud-up.failed"
fi

exit "$rc"
