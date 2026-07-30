#!/usr/bin/env bash
# Shared helpers for the cloud-sandbox scripts (setup / per-session bringup).
# Sourced, not executed. No `set -e` here — callers decide their own error policy;
# these helpers signal failure via return codes.

# Timestamped log line to stderr (keeps stdout clean for callers that capture it).
cs_log() {
  printf '[cloud-sandbox] %s\n' "$*" >&2
}

# Pinned Supabase CLI version for the cloud sandbox. Single source of truth; override
# with FRAPP_SUPABASE_CLI_VERSION to test an upgrade.
#
# ⚠️ This is intentionally NOT the version CI uses to apply migrations:
# .github/workflows/deploy-api.yml pins supabase/setup-cli to 2.77.0 for both the
# staging and production migration steps. The skew is not introduced here — before this
# helper existed the scripts ran unpinned `npx supabase`, i.e. whatever "latest" was that
# day (2.110.0 at time of writing), so the same gap existed and drifted silently. Pinning
# makes it an explicit, reviewable constant.
#
# The sandbox cannot simply match 2.77.0: it fails to start here because the realtime
# container aborts with `:listen_error, :eafnosupport` (it tries to bind IPv6, which this
# sandbox does not support). Closing the gap therefore means moving *deploy* forward,
# which needs staging verification and belongs in its own change. Tracked as a follow-up.
CS_SUPABASE_CLI_VERSION="${FRAPP_SUPABASE_CLI_VERSION:-2.110.0}"

# Default `supabase start` arguments, shared by per-session bringup and the setup pre-pull.
# The Deno edge-runtime container sets an rlimit (RLIMIT_NOFILE) the cloud sandbox denies
# ("error setting rlimit type 7: operation not permitted"), and that aborts the WHOLE
# `supabase start` — so every caller must exclude it, not just bringup. The setup pre-pull
# previously omitted it and therefore aborted partway through, never caching the images
# ordered after edge-runtime (pg-meta, studio, supavisor) — defeating its own purpose.
# The API talks to Postgres directly and hot-path logic moved into NestJS (ADR-11/ADR-12),
# so edge functions are not needed here. Override with FRAPP_SUPABASE_START_ARGS.
CS_SUPABASE_START_ARGS="${FRAPP_SUPABASE_START_ARGS:--x edge-runtime}"

# Resolve (installing on first use) and invoke the pinned Supabase CLI.
#
# Mirrors the pinned-tooling pattern already used for gitleaks
# (scripts/install-gitleaks.sh → .cache/gitleaks/): the binary lives in a gitignored
# .cache/supabase-cli/ rather than in the repo's dependency tree. That matters because the
# v2 CLI's platform binary is ~200 MB; as a root devDependency it would be downloaded by
# every `npm ci` in CI and pulled into the API image's dev-deps build stage, for a tool
# only these two sandbox scripts ever call (cf. ADR-15 on CI cost).
#
# Deliberately NOT bare `npx supabase`, which caused the failure this replaces: it
# re-resolves "latest" every session, and the v2 CLI ships its executable as a
# platform-specific optionalDependency. When that optional install is skipped the
# launcher throws "No matching Supabase CLI binary package found for <platform>" and
# aborts the whole bringup — and npx caches the broken tree under ~/.npm/_npx, so it stays
# broken for the rest of the session.
#
# Self-healing by design: the cache is a build artifact, not a checked-in file, so an
# expired sandbox filesystem cache or a failed `npm ci` just triggers a reinstall here
# instead of failing the bringup. The readiness probe runs the binary rather than testing
# for its presence, because the launcher script exists and is executable even when the
# platform binary behind it is missing — the exact case above.
cs_supabase() {
  local root cache bin log have needs_install
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  cache="$root/.cache/supabase-cli"
  bin="$cache/node_modules/.bin/supabase"
  log="$cache/install.log"

  # Probe by RUNNING the binary — the launcher exists and is executable even when the
  # platform binary behind it was skipped, so a presence test would pass a broken tree.
  have="$("$bin" --version 2>/dev/null || true)"
  needs_install=1
  if [ -n "$have" ]; then
    case "$CS_SUPABASE_CLI_VERSION" in
      # A non-exact spec (latest, ^2.110.0, v2.110.0) can't be string-compared against the
      # bare version the CLI prints — comparing anyway made the probe mismatch forever and
      # reinstall before every single call. For those, any working binary is accepted.
      *[!0-9.]*) needs_install=0 ;;
      *) [ "$have" = "$CS_SUPABASE_CLI_VERSION" ] && needs_install=0 ;;
    esac
  fi

  if [ "$needs_install" -eq 1 ]; then
    cs_log "Installing Supabase CLI ${CS_SUPABASE_CLI_VERSION} into .cache/supabase-cli..."
    mkdir -p "$cache"
    [ -f "$cache/package.json" ] \
      || printf '{"name":"frapp-supabase-cli","private":true}\n' >"$cache/package.json"
    # Keep npm's output: it is the only place the real cause appears (a 404 on a typo'd
    # version reads identically to a blocked registry once discarded).
    if ! npm install --prefix "$cache" "supabase@${CS_SUPABASE_CLI_VERSION}" \
      --no-audit --no-fund >"$log" 2>&1; then
      cs_log "ERROR: installing supabase@${CS_SUPABASE_CLI_VERSION} failed — full output in $log:"
      tail -n 5 "$log" 2>/dev/null | sed 's/^/[cloud-sandbox]   /' >&2
      return 127
    fi
    # npm exits 0 even when a platform-specific optionalDependency is skipped — which is
    # exactly the failure this helper exists to prevent — so re-probe instead of trusting
    # the exit code.
    if ! "$bin" --version >/dev/null 2>&1; then
      cs_log "ERROR: supabase installed but its platform binary is missing (@supabase/cli-<platform> skipped) — see $log"
      return 127
    fi
  fi

  "$bin" "$@"
}

# Start the Docker daemon if it is not already responsive, then wait for it.
# Uses sudo only when we are not already root (web-UI setup runs as root; the
# per-session agent shell may not). Returns non-zero if the daemon never comes up.
cs_ensure_docker_daemon() {
  # Probe with a timeout: a wedged docker socket can make `docker info` block
  # indefinitely, which would otherwise hang the whole bringup past its budget
  # (and leave callers waiting on a sentinel that never lands).
  if timeout 10 docker info >/dev/null 2>&1; then
    cs_log "Docker daemon already running."
    return 0
  fi

  local runner=""
  if [ "$(id -u)" -ne 0 ]; then
    runner="sudo"
  fi

  cs_log "Starting Docker daemon (${runner:-root})..."
  $runner dockerd >/tmp/dockerd.log 2>&1 &
  local dockerd_pid=$!

  local tries=0
  until timeout 5 docker info >/dev/null 2>&1; do
    # Fail fast if dockerd died (e.g. missing privileges in the sandbox) rather
    # than waiting out the full window, and surface the daemon log so the
    # failure is actionable instead of a silent timeout.
    if ! kill -0 "$dockerd_pid" 2>/dev/null; then
      cs_log "ERROR: dockerd exited during startup (see /tmp/dockerd.log):"
      tail -n 5 /tmp/dockerd.log 2>/dev/null | sed 's/^/[cloud-sandbox]   /' >&2
      return 1
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      cs_log "ERROR: Docker daemon did not become ready after 60s (see /tmp/dockerd.log)."
      tail -n 5 /tmp/dockerd.log 2>/dev/null | sed 's/^/[cloud-sandbox]   /' >&2
      return 1
    fi
    sleep 1
  done
  cs_log "Docker is ready."
}

# Authenticate to Docker Hub when DOCKERHUB_USERNAME/DOCKERHUB_TOKEN are present.
# Lifts anonymous pull rate limits (supabase start pulls ~10 images). Never fatal:
# a failed/absent login just falls back to anonymous pulls.
cs_docker_login_if_creds() {
  if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
    cs_log "Logging in to Docker Hub as ${DOCKERHUB_USERNAME}..."
    if printf '%s' "$DOCKERHUB_TOKEN" \
      | docker login --username "$DOCKERHUB_USERNAME" --password-stdin >/dev/null 2>&1; then
      cs_log "Docker Hub login succeeded."
    else
      cs_log "WARN: Docker Hub login failed; continuing with anonymous pulls."
    fi
  else
    cs_log "DOCKERHUB_USERNAME/TOKEN not set; using anonymous pulls (may hit rate limits)."
  fi
}
