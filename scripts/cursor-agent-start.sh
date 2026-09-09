#!/usr/bin/env bash
# Cursor Cloud Agent START phase. Runs on every boot. Applies the kernel settings the
# Docker networking needs (these are runtime-only and are NOT captured by the build
# snapshot), then delegates to the repo's canonical per-session bringup
# (scripts/cloud-sandbox-up.sh): start dockerd, `supabase start`, `db push --local`,
# write apps/api/.env.local + apps/web/.env.local, repair Postgres ACLs, seed, verify deps.
#
# It must tolerate restarts and return. cloud-sandbox-up.sh is idempotent and returns after
# writing .cloud-sandbox-up.done (success) or .cloud-sandbox-up.failed (error); this script
# propagates that outcome as its exit status.
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
# `sg docker` so the Supabase CLI can reach the daemon without sudo; cloud-sandbox-up.sh
# starts dockerd itself (it reads /etc/docker/daemon.json written during install).
sg docker -c "bash '$ROOT/scripts/cloud-sandbox-up.sh'"
rc=$?

if [ -f "$ROOT/.cloud-sandbox-up.failed" ]; then
  log "ERROR: local stack bringup failed — see /tmp/cloud-sandbox-up.log and .cloud-sandbox-up.failed"
  exit 1
fi

log "Local stack ready. Dev servers start in the api/web/landing terminals."
exit "$rc"
