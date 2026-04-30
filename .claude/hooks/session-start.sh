#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web (cloud sandbox).
#
# Bails out on local laptops (no CLAUDE_CODE_REMOTE) so it never slows
# down day-to-day terminal sessions. In the cloud sandbox it installs
# dependencies, builds shared packages, and exports a few env aliases
# so older skills/scripts that still reference legacy env var names
# keep working.
#
# Docker and Supabase are intentionally NOT started here — they remain
# on-demand (see .claude/skills/testing/SKILL.md).

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "[session-start] Installing dependencies (npm ci)…"
npm ci --no-audit --no-fund

echo "[session-start] Building shared packages…"
npx turbo run build --filter='./packages/*'

# Export env aliases so the rest of the session inherits them.
# CLAUDE_ENV_FILE is sourced by the harness after the hook completes.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    # Map GITHUB_PAT (canonical) → GITHUB_TOKEN for `gh` CLI.
    # Tolerate older VMs that still expose GITHUB_PERSONAL_ACCESS_TOKEN.
    echo "GITHUB_TOKEN=${GITHUB_PAT:-${GITHUB_PERSONAL_ACCESS_TOKEN:-}}"
    echo "TURBO_TELEMETRY_DISABLED=1"
  } >> "$CLAUDE_ENV_FILE"
fi

echo "[session-start] Done."
