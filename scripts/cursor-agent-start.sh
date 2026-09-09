#!/usr/bin/env bash
# Cursor Cloud Agent START phase. Public contract: `.cursor/environment.json`
# `start`. Thin wrapper: apply kernel settings Docker networking needs
# (runtime-only; a build snapshot does not capture them), then run the
# Cursor-owned per-boot entrypoint scripts/cursor-cloud-up.sh.
#
# `start` must start dockerd, bring Supabase up, write env files, then return.
# Dev servers belong in terminals, not here.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[cursor-start] %s\n' "$*" >&2; }

# Kernel settings, re-applied each boot (a snapshot does not preserve them):
#   - bridge-nf-call-iptables=0: without it, same-bridge IPv4 container traffic is dropped
#     by the nested VM's nft DOCKER rules, so logflare/vector time out connecting to
#     Postgres and `supabase start` fails its final health check.
#   - IPv6 enabled: Supabase Realtime connects to Postgres over IPv6 inside the network.
sudo modprobe br_netfilter 2>/dev/null || true
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true
sudo sysctl -w net.ipv6.conf.all.disable_ipv6=0 net.ipv6.conf.default.disable_ipv6=0 net.ipv6.conf.lo.disable_ipv6=0 >/dev/null 2>&1 || true

log "Bringing up the local stack (Docker + Supabase)..."
# `sg docker` so the Supabase CLI can reach the daemon without sudo.
# cursor-cloud-up.sh delegates to cloud-sandbox-up.sh, which starts dockerd
# itself (it reads /etc/docker/daemon.json written during install).
sg docker -c "bash '$ROOT/scripts/cursor-cloud-up.sh'"
rc=$?

if [ -f "$ROOT/.cloud-sandbox-up.failed" ]; then
  log "ERROR: local stack bringup failed — see /tmp/cloud-sandbox-up.log and .cloud-sandbox-up.failed"
  exit 1
fi

log "Local stack ready. Dev servers start in the api/web/landing terminals."
exit "$rc"
