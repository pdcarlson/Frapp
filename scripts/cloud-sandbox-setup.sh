#!/usr/bin/env bash
# Cloud sandbox SETUP script — target of the Claude Code web UI "Setup script" field:
#
#     bash scripts/cloud-sandbox-setup.sh || true
#
# Runs once as root before the agent starts; its FILESYSTEM is cached (~7 days) but
# running daemons are NOT. So this only does work whose *output is files*: install
# node deps and pre-pull the Supabase Docker images so the per-session bringup
# (scripts/cloud-sandbox-up.sh) is fast. See docs/internal/environment/CLOUD_SANDBOX.md.
#
# Deliberately not `set -e`: a slow or failed image pull must never block session
# start. Non-critical steps fall through with a warning.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"
# shellcheck source=scripts/lib/cloud-sandbox-common.sh
. "$ROOT/scripts/lib/cloud-sandbox-common.sh"

# Drop a marker so .claude/hooks/session-start.sh can auto-detect the cloud sandbox
# without requiring the FRAPP_CLOUD_SANDBOX env var. This setup script only ever runs in
# the configured cloud environment, and the marker is part of the cached filesystem.
# Written first so per-session bringup is gated even if the image pre-pull below fails.
touch /etc/frapp-cloud-sandbox 2>/dev/null || cs_log "WARN: could not write /etc/frapp-cloud-sandbox marker (set FRAPP_CLOUD_SANDBOX=1 instead)."

cs_log "Installing node dependencies..."
npm ci || npm install || cs_log "WARN: dependency install failed; the session may need 'npm install'."

if ! cs_ensure_docker_daemon; then
  cs_log "WARN: Docker unavailable during setup; skipping image pre-pull (per-session bringup will pull instead)."
  exit 0
fi
cs_docker_login_if_creds

# Bring the stack up once purely to pull+cache images, then stop it. Only the pulled
# images persist on disk (and into the environment cache); the containers do not.
cs_log "Pre-pulling Supabase images (one-time; cached for fast per-session startup)..."
cs_supabase start || cs_log "WARN: 'supabase start' failed during pre-pull; images may pull at session time."
cs_supabase stop || true

cs_log "Setup complete."
