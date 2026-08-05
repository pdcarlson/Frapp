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
# Same start args as per-session bringup — without the edge-runtime exclusion this aborts
# partway and never caches the images ordered after it, which is the whole point of the pre-pull.
#
# Retried for the same reason bringup is, and with more to gain: a transient failure here
# leaves the cache cold, which then exposes EVERY later session to the live CDN. Still
# strictly non-fatal (see the no-`set -e` note above) — a pre-pull that cannot succeed must
# degrade to pulling at session time, never block session start.
#
# TIGHTER BUDGET THAN BRINGUP, on purpose. This script has a ~5-minute wall-clock budget
# (docs/internal/environment/CLOUD_SANDBOX.md), most of which `npm ci` and the first cold pull
# already spend. Bringup's 3 attempts plus 30s of backoff can overrun it, and overrunning is
# expensive in a way a failed session is not: the harness kills the script mid-pull, so the
# `stop` below never runs and half-created containers get baked into the CACHED filesystem that
# every later session inherits. Two attempts buy most of the resilience for a third of the risk.
CS_RETRY_ATTEMPTS="${FRAPP_SANDBOX_START_RETRIES:-2}"
CS_RETRY_BASE_DELAY="${FRAPP_SANDBOX_RETRY_BASE_DELAY:-5}"
CS_RETRY_LOG_LOCATION="the environment setup log in the Claude Code web UI"

# Belt to that braces: if the harness does time us out, still tear the stack down so the cached
# filesystem keeps only the pulled images, which are the entire point of this script.
trap 'cs_log "Interrupted — stopping Supabase so the cached filesystem stays clean."; cs_supabase stop >/dev/null 2>&1 || true' TERM INT

# shellcheck disable=SC2086
cs_retry "pre-pull 'supabase start'" "cs_supabase stop" cs_supabase start $CS_SUPABASE_START_ARGS \
  || cs_log "WARN: pre-pull failed (${CS_RETRY_CLASS:-unknown}) — ${CS_RETRY_HINT:-see the output above}; images will pull at session time instead."
trap - TERM INT
cs_supabase stop || true

cs_log "Setup complete."
