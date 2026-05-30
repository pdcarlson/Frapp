#!/bin/bash
# SessionStart hook: keep the in-repo backlog fresh.
# The backlog at docs/backlog/ is the single source of truth for work status; GitHub issues
# mirror it. A shell hook can't reach the GitHub MCP, so this primes the agent to run /triage
# early (which reconciles GitHub into the backlog) instead of doing the sync itself. Read-only.
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

# Emit as SessionStart additionalContext so the agent sees it at session start.
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' \
  "$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
