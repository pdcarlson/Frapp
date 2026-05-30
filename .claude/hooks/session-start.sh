#!/bin/bash
# SessionStart hook: keep the in-repo backlog fresh, and (in the cloud sandbox only)
# kick off the local Docker + Supabase + API stack in the background.
# The backlog at docs/backlog/ is the single source of truth for work status; GitHub issues
# mirror it. A shell hook can't reach the GitHub MCP, so this primes the agent to run /triage
# early (which reconciles GitHub into the backlog) instead of doing the sync itself.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"
BACKLOG="$ROOT/docs/backlog"

# Build a short freshness summary from the backlog (no network).
if [ -d "$BACKLOG" ]; then
  projects=$(find "$BACKLOG/projects" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  todos=$(grep -rl "TODO" "$BACKLOG" 2>/dev/null | wc -l | tr -d ' ')
  msg="Frapp backlog at docs/backlog/ is the SINGLE SOURCE OF TRUTH for work status (GitHub issues mirror it; repo wins on conflict). ${projects} project file(s); ${todos} file(s) carry TODO markers. Before starting tracked work this session, run /triage to reconcile open GitHub issues into the backlog so status is fresh. Use /status for a read-only progress dashboard."
else
  msg="No docs/backlog/ found yet — the in-repo backlog is the intended source of truth for work status."
fi

# Cloud sandbox: launch the local stack in the background so the session is never blocked
# on the ~60-90s bringup. Gated on the /etc/frapp-cloud-sandbox marker (written by
# scripts/cloud-sandbox-setup.sh) OR FRAPP_CLOUD_SANDBOX=1, so local laptop sessions skip
# it. A /tmp lock prevents relaunching on session resume.
# See docs/internal/environment/CLOUD_SANDBOX.md.
if { [ -f /etc/frapp-cloud-sandbox ] || [ "${FRAPP_CLOUD_SANDBOX:-}" = "1" ]; } && [ -f "$ROOT/scripts/cloud-sandbox-up.sh" ]; then
  if mkdir /tmp/cloud-sandbox-up.lock 2>/dev/null; then
    nohup bash "$ROOT/scripts/cloud-sandbox-up.sh" >/tmp/cloud-sandbox-up.log 2>&1 &
    disown || true
    msg="${msg} CLOUD SANDBOX: a local Supabase + API stack is starting in the BACKGROUND. Before using the database or booting the API, wait for ${ROOT}/.cloud-sandbox-up.done (success) or .cloud-sandbox-up.failed (error); live log at /tmp/cloud-sandbox-up.log. It generates apps/api/.env.local; boot the API with 'npm run start:dev -w apps/api'. If it FAILS, STOP and tell the user exactly what to fix in the Claude Code web environment (network policy / missing env var) per docs/internal/environment/CLOUD_SANDBOX.md 'When bringup fails' — do NOT work around it."
  else
    msg="${msg} CLOUD SANDBOX: stack bringup already started this session (lock held). Check ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed and /tmp/cloud-sandbox-up.log."
  fi
fi

# Emit as SessionStart additionalContext so the agent sees it at session start.
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' \
  "$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
