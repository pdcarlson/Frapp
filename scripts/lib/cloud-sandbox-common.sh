#!/usr/bin/env bash
# Shared helpers for the cloud-sandbox scripts (setup / per-session bringup).
# Sourced, not executed. No `set -e` here — callers decide their own error policy;
# these helpers signal failure via return codes.

# Timestamped log line to stderr (keeps stdout clean for callers that capture it).
cs_log() {
  printf '[cloud-sandbox] %s\n' "$*" >&2
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
