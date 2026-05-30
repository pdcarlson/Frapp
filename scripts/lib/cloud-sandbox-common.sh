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
  if docker info >/dev/null 2>&1; then
    cs_log "Docker daemon already running."
    return 0
  fi

  local runner=""
  if [ "$(id -u)" -ne 0 ]; then
    runner="sudo"
  fi

  cs_log "Starting Docker daemon (${runner:-root})..."
  $runner dockerd >/tmp/dockerd.log 2>&1 &

  local tries=0
  until docker info >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      cs_log "ERROR: Docker daemon did not become ready after 60s (see /tmp/dockerd.log)."
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
