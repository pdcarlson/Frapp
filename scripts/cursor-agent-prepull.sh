#!/usr/bin/env bash
# Pre-pull the Supabase Docker images (Cursor Cloud Agent install helper).
#
# Split into its own file because scripts/cursor-agent-install.sh invokes it via
# `sg docker -c "bash scripts/cursor-agent-prepull.sh"` — `sg` runs its `-c` argument
# with /bin/sh (dash), which cannot `set -o pipefail` or run the bash-only helpers in
# scripts/lib/cloud-sandbox-common.sh, so the docker-group shell must re-enter bash here.
#
# Brings the stack up once purely to pull + cache the images, then stops it. Non-fatal by
# design (the caller treats a non-zero exit as "images will pull at session start instead").
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/lib/cloud-sandbox-common.sh
. "$ROOT/scripts/lib/cloud-sandbox-common.sh"

cs_ensure_docker_daemon || exit 0
cs_docker_login_if_creds

# Same start args as per-session bringup (edge-runtime excluded). Retried like bringup so a
# transient CDN hiccup does not leave the cache cold.
# shellcheck disable=SC2086
cs_retry "pre-pull 'supabase start'" "cs_supabase stop" cs_supabase start $CS_SUPABASE_START_ARGS || true
cs_supabase stop || true
