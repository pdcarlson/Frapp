#!/usr/bin/env bash
# Cursor Cloud Agent per-boot START entrypoint. This is what .cursor/environment.json
# `start` invokes, so Cursor owns per-boot bringup — it is not a wrapper around any other
# harness's session hook. It runs on every boot: applies the kernel settings the nested
# Docker networking needs (runtime-only — a build snapshot does NOT preserve them), then
# brings the local stack up and returns after readiness.
#
# The stack bringup itself is the repo's shared implementation (scripts/cloud-sandbox-up.sh):
# start dockerd, `supabase start -x edge-runtime`, `db push --local`, write
# apps/api/.env.local + apps/web/.env.local from `supabase status`, repair Postgres ACLs,
# seed, verify deps. That script is shared with the laptop/fallback paths so the ACL
# ordering, retry classification, env-file key validation and sentinel semantics live in
# one place and cannot drift. Keeping it as the implementation here means this entrypoint
# is a thin, Cursor-owned boot shim rather than a second copy of that logic.
#
# It must tolerate restarts and return. cloud-sandbox-up.sh is idempotent and returns after
# writing .cloud-sandbox-up.done (success) or .cloud-sandbox-up.failed (error) at the repo
# root (both gitignored); this script propagates that outcome as its exit status. Agents,
# docs, and the terminal launcher (scripts/cursor-cloud-terminal.sh) already wait on those
# sentinel names, so this phase keeps them.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[cursor-cloud-up] %s\n' "$*" >&2; }

# Kernel settings, re-applied each boot (a snapshot does not preserve them):
#   - bridge-nf-call-iptables=0: without it, same-bridge IPv4 container traffic is dropped
#     by the nested VM's nft DOCKER rules, so logflare/vector time out connecting to
#     Postgres and `supabase start` fails its final health check.
#   - IPv6 enabled: Supabase Realtime connects to Postgres over IPv6 inside the network
#     (ECTO_IPV6=true), so the container network must carry IPv6.
sudo modprobe br_netfilter 2>/dev/null || true
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true
sudo sysctl -w net.ipv6.conf.all.disable_ipv6=0 net.ipv6.conf.default.disable_ipv6=0 net.ipv6.conf.lo.disable_ipv6=0 >/dev/null 2>&1 || true

log "Bringing up the local stack (Docker + Supabase)..."
# `sg docker` so the Supabase CLI can reach the daemon without sudo; cloud-sandbox-up.sh
# starts dockerd itself (it reads /etc/docker/daemon.json written during install). `sg`
# runs its argument with /bin/sh, so the bash-only bringup stays in its own script.
sg docker -c "bash '$ROOT/scripts/cloud-sandbox-up.sh'"
rc=$?

if [ -f "$ROOT/.cloud-sandbox-up.failed" ]; then
  log "ERROR: local stack bringup failed — see /tmp/cloud-sandbox-up.log and .cloud-sandbox-up.failed"
  exit 1
fi

log "Local stack ready. Dev servers start in the api/web/landing terminals once .cloud-sandbox-up.done is present."
exit "$rc"
