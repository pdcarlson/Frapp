#!/usr/bin/env bash
# Cursor Cloud Agent INSTALL phase. Idempotent. Provisions the Cursor VM to run
# Frapp's Docker-based local stack, installs Node 20 + npm deps, builds the shared
# workspace `dist/` outputs, and pre-pulls the Supabase images so per-session `start`
# is fast. When Cursor "builds" are enabled this runs once and its filesystem becomes
# the boot snapshot; per-boot work belongs in scripts/cursor-agent-start.sh instead.
#
# This is the Cursor counterpart to scripts/cloud-sandbox-setup.sh (the Claude Code web
# sandbox setup). It deliberately does NOT duplicate that script's Supabase logic — it
# sources the same scripts/lib/cloud-sandbox-common.sh helpers (cs_ensure_docker_daemon,
# cs_docker_login_if_creds, cs_supabase, cs_retry) so the pinned CLI + retry behaviour
# stay in one place. See docs/internal/environment/CLOUD_SANDBOX.md for the model.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[cursor-install] %s\n' "$*" >&2; }

# ─── 1. Docker Engine + fuse-overlayfs ────────────────────────────────────────────────
# The Cursor base image ships the `docker` CLI at most, not the daemon. fuse-overlayfs is
# mandatory here: this VM is a nested/unprivileged container, and Docker's default
# containerd/overlayfs snapshotter cannot create overlay whiteouts ("failed to convert
# whiteout file ... operation not permitted") when extracting the Supabase image layers.
if ! command -v dockerd >/dev/null 2>&1; then
  log "Installing Docker Engine + fuse-overlayfs..."
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker.io fuse-overlayfs iptables uidmap
fi

# ─── 2. Docker daemon config ──────────────────────────────────────────────────────────
# Persisted to disk (survives into the build snapshot). Three settings, each load-bearing:
#   - storage-driver fuse-overlayfs (+ containerd-snapshotter off): the whiteout fix above.
#   - ipv6 + ip6tables + fixed-cidr-v6 + default enable_ipv6: Supabase Realtime hardcodes
#     ECTO_IPV6=true and connects to Postgres over IPv6 inside the compose network, so the
#     network must carry IPv6 or `supabase start` hangs in the realtime migrate step.
sudo mkdir -p /etc/docker
printf '%s\n' '{
  "storage-driver": "fuse-overlayfs",
  "features": { "containerd-snapshotter": false },
  "ipv6": true,
  "ip6tables": true,
  "fixed-cidr-v6": "fd00:dead:beef::/48",
  "default-network-opts": { "bridge": { "com.docker.network.enable_ipv6": "true" } }
}' | sudo tee /etc/docker/daemon.json >/dev/null

# Let the agent user drive docker without sudo (fresh boots inherit the group).
sudo groupadd -f docker
sudo usermod -aG docker "$(id -un)" || true

# ─── 3. Node 20 (the repo's pinned runtime) ───────────────────────────────────────────
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "Installing nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 20
nvm alias default 20
NODE20BIN="$(dirname "$(nvm which 20)")"
export PATH="${NODE20BIN}:${PATH}"
log "Using node $(node -v), npm $(npm -v)"

# ─── 4. Dependencies + workspace build ────────────────────────────────────────────────
# npm ci under Node 20 for the correct toolchain, then `npm run build` so the shared
# @repo/* packages produce the `dist/` that apps/api's `start:dev` typechecks against
# (without it, `nest start` reports dozens of TS2307/TS2339 errors from @repo/validation).
log "Installing npm dependencies (npm ci)..."
npm ci
log "Building workspaces (npm run build)..."
npm run build

# ─── 5. Pre-pull the Supabase images ──────────────────────────────────────────────────
# Bring the stack up once purely to pull + cache the ~10 images, then stop it. Only the
# pulled images persist on disk (and into the build snapshot); the containers do not.
# Non-fatal: a failed pre-pull just means per-session `start` pulls at boot instead.
# shellcheck source=scripts/lib/cloud-sandbox-common.sh
. "$ROOT/scripts/lib/cloud-sandbox-common.sh"

# bridge-nf-call-iptables=0 lets same-bridge IPv4 container traffic flow (the nested VM's
# nft DOCKER rules otherwise drop inter-container IPv4, which times out logflare/vector's
# DB connections). Kernel-runtime only; scripts/cursor-agent-start.sh re-applies per boot.
sudo modprobe br_netfilter 2>/dev/null || true
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true

if sg docker -c "$(cat <<EOF
set -uo pipefail
. "$ROOT/scripts/lib/cloud-sandbox-common.sh"
cs_ensure_docker_daemon || exit 0
cs_docker_login_if_creds
# shellcheck disable=SC2086
cs_retry "pre-pull 'supabase start'" "cs_supabase stop" cs_supabase start \$CS_SUPABASE_START_ARGS || true
cs_supabase stop || true
EOF
)"; then
  log "Supabase images pre-pulled."
else
  log "WARN: image pre-pull did not complete; per-session start will pull instead."
fi

log "Install complete."
