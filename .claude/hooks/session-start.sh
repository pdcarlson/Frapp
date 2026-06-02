#!/bin/bash
# SessionStart hook: in the cloud sandbox only, kick off the local Docker + Supabase + API
# stack in the background. Work tracking lives in Linear (team Frapp Live, via the native
# Linear MCP) — there is no in-repo backlog to summarize here; /next reads Linear directly.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"

# Nothing to announce unless the cloud-sandbox bringup runs below.
msg=""

# Cloud sandbox: launch the local stack in the background so the session is never blocked
# on the ~60-90s bringup. Gated on the /etc/frapp-cloud-sandbox marker (written by
# scripts/cloud-sandbox-setup.sh) OR FRAPP_CLOUD_SANDBOX=1, so local laptop sessions skip
# it. A /tmp lock prevents relaunching on session resume.
# See docs/internal/environment/CLOUD_SANDBOX.md.
if { [ -f /etc/frapp-cloud-sandbox ] || [ "${FRAPP_CLOUD_SANDBOX:-}" = "1" ]; } && [ -f "$ROOT/scripts/cloud-sandbox-up.sh" ]; then
  LOCK=/tmp/cloud-sandbox-up.lock
  STARTING_MSG=" CLOUD SANDBOX: a local Supabase + API stack is starting in the BACKGROUND. Before using the database or booting the API, wait for ${ROOT}/.cloud-sandbox-up.done (success) or .cloud-sandbox-up.failed (error); live log at /tmp/cloud-sandbox-up.log. It generates apps/api/.env.local; boot the API with 'npm run start:dev -w apps/api'. If it FAILS, STOP and tell the user exactly what to fix in the Claude Code web environment (network policy / missing env var) per docs/internal/environment/CLOUD_SANDBOX.md 'When bringup fails' — do NOT work around it."

  launch_bringup() {
    nohup bash "$ROOT/scripts/cloud-sandbox-up.sh" >/tmp/cloud-sandbox-up.log 2>&1 &
    echo "$!" >"$LOCK/pid" 2>/dev/null || true
    disown || true
  }

  if mkdir "$LOCK" 2>/dev/null; then
    launch_bringup
    msg="${msg}${STARTING_MSG}"
  elif [ -f "$ROOT/.cloud-sandbox-up.done" ] || [ -f "$ROOT/.cloud-sandbox-up.failed" ]; then
    msg="${msg} CLOUD SANDBOX: stack bringup already finished this session — check ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed and /tmp/cloud-sandbox-up.log."
  else
    # The lock exists but no .done/.failed sentinel has been written. Either a
    # prior bringup is still running, or it was killed (e.g. the session was
    # paused/reclaimed) and left a STALE lock that would otherwise block bringup
    # forever with no sentinel for callers to wait on. Reclaim and relaunch when
    # the recorded pid is no longer a live bringup process.
    prev_pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -n "$prev_pid" ] && kill -0 "$prev_pid" 2>/dev/null \
      && ps -p "$prev_pid" -o args= 2>/dev/null | grep -q cloud-sandbox-up; then
      msg="${msg} CLOUD SANDBOX: stack bringup is still running (pid ${prev_pid}). Wait for ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed; live log at /tmp/cloud-sandbox-up.log."
    else
      rm -rf "$LOCK"
      if mkdir "$LOCK" 2>/dev/null; then
        launch_bringup
        msg="${msg} CLOUD SANDBOX: cleared a stale bringup lock (a previous run died with no sentinel) and restarted the stack in the BACKGROUND.${STARTING_MSG}"
      else
        msg="${msg} CLOUD SANDBOX: a concurrent session reclaimed the bringup lock; wait for ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed; live log at /tmp/cloud-sandbox-up.log."
      fi
    fi
  fi
fi

# Emit as SessionStart additionalContext so the agent sees it at session start.
# Only emit when there's something to say (e.g. the cloud-sandbox bringup status).
if [ -n "$msg" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' \
    "$(printf '%s' "${msg# }" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
fi
