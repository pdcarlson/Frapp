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

# Silence the Supabase CLI's telemetry. Exported at source time so it covers both the CLI
# invocation in cs_supabase and the `npm install` that fetches it.
#
# This is a diagnostics fix, not a privacy one. The CLI posts to PostHog on startup; a
# restrictive sandbox network policy rejects that call with `403 Host not in allowlist` —
# the SAME wording a genuinely fatal image-registry rejection produces. That line sat at the
# top of the failed bringup log this work came from and sent the first reader chasing a
# network-policy problem that did not exist. Silencing it at the source is cheaper than
# teaching every future reader to discount it (cs_classify_failure below also filters it
# out, for CLI versions that ignore these vars).
#
# Set here rather than in .claude/settings.json because cloud-sandbox-setup.sh runs as root
# BEFORE the agent process exists, so a harness-level env block would never reach the
# pre-pull — the very step whose log is hardest to read after the fact.
export SUPABASE_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1

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
  # Key the cache on the REQUESTED SPEC, not the printed version. Comparing the spec to the
  # printed version only works for exact pins: a non-exact spec (latest, ^2.110.0) never
  # equals "2.112.0", so string-comparing reinstalled before every call, while treating
  # non-exact as "accept anything cached" silently ignored the upgrade the override exists
  # to test — and swallowed typos like 2.110.O whenever any cache existed. Recording the
  # spec handles both: a working binary installed for this exact spec string is reused, and
  # changing the spec at all forces a reinstall.
  needs_install=1
  if [ -n "$have" ] \
    && [ "$(cat "$cache/.spec" 2>/dev/null || true)" = "$CS_SUPABASE_CLI_VERSION" ]; then
    needs_install=0
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
    # Record the spec only after the binary is proven to run, so a half-installed tree is
    # never cached as satisfying the spec.
    printf '%s' "$CS_SUPABASE_CLI_VERSION" >"$cache/.spec" 2>/dev/null || true
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

# ─── Transient-failure retry ────────────────────────────────────────────────────────────
#
# `supabase start` pulls ~10 images from AWS ECR Public via CloudFront. The CLI retries an
# individual blob fetch twice internally (4s, 8s), which a CDN hiccup can simply outlast —
# and when it does, the whole bringup dies, taking the session's database and API with it.
# These helpers add an OUTER retry around that one network-bound step.
#
# Retrying indiscriminately would be worse than not retrying: a blocked allowlist or an
# exhausted Docker Hub quota is not going to resolve itself, and burning three ~90s attempts
# on one only delays a failure the user must fix in the web UI anyway. So the retry is gated
# on classification, and the classifier's fatal verdicts carry the remedy with them.

# Outer retry budget. Three attempts at a 10s base gives ~10s + ~20s of backoff on top of the
# stop/start cycles themselves — comfortably longer than the ~12s the CLI's own retries cover,
# which is what the original incident outlasted. A base delay of 0 disables the wait entirely
# (what the test suite uses to drive the loop without sleeping).
CS_RETRY_ATTEMPTS="${FRAPP_SANDBOX_START_RETRIES:-3}"
CS_RETRY_BASE_DELAY="${FRAPP_SANDBOX_RETRY_BASE_DELAY:-10}"

# Both knobs feed `$(( ))`, which ABORTS the shell on a non-integer. Left unguarded, a typo in
# an environment variable meant for tuning would become a way to break bringup outright, so
# fall back to the defaults rather than trusting the environment.
case "$CS_RETRY_ATTEMPTS" in '' | *[!0-9]*) CS_RETRY_ATTEMPTS=3 ;; esac
[ "$CS_RETRY_ATTEMPTS" -ge 1 ] || CS_RETRY_ATTEMPTS=1
case "$CS_RETRY_BASE_DELAY" in '' | *[!0-9]*) CS_RETRY_BASE_DELAY=10 ;; esac

# Classify a captured failure log, echoing exactly one token on stdout:
#
#   policy     Network policy blocked a container registry. FATAL — an allowlist does not
#              heal on retry, and the fix is a setting in the Claude Code web environment.
#   ratelimit  Docker Hub refused the pull. FATAL for the same reason (it needs credentials).
#   transient  Registry/CDN hiccup: 5xx, timeout, reset, truncated transfer. Retryable.
#   unknown    Anything else. ALSO retryable, deliberately — the point of this work is
#              resilience against a class of network failures nobody can fully enumerate, and
#              the two cases that genuinely cannot be retried are both named above. Erring the
#              other way (fail fast on anything unrecognised) would leave the next unfamiliar
#              CDN error string killing sessions exactly as before.
#
# ORDER MATTERS. A run that hits an allowlist rejection usually also logs a 5xx or a reset as
# the connection dies, so policy and ratelimit are tested first; matching transient first would
# retry a fatal misconfiguration three times over and still fail.
#
# Telemetry lines are stripped BEFORE the policy test. The CLI's blocked PostHog call produces
# the identical `403 Host not in allowlist` wording as a blocked image pull but is harmless —
# it was the red herring in this issue's original diagnosis. Matching it would abort bringup on
# noise, the exact inversion of what this function is for. `export DO_NOT_TRACK=1` above should
# stop the call being made at all; this filter is what keeps a CLI version that ignores the env
# var from resurrecting the false positive.
cs_classify_failure() {
  local cap="${1:-}" body
  [ -n "$cap" ] && [ -r "$cap" ] || { printf 'unknown'; return 0; }

  body="$(grep -Evi 'posthog|telemetry|do_not_track' "$cap" 2>/dev/null || true)"

  if printf '%s' "$body" | grep -Eqi 'not in allowlist|host_not_allowed|403 forbidden|error 403'; then
    printf 'policy'
  elif printf '%s' "$body" | grep -Eqi 'toomanyrequests|rate exceeded|pull rate limit|\b429\b'; then
    printf 'ratelimit'
  elif printf '%s' "$body" | grep -Eqi 'service unavailable|bad gateway|gateway time-?out|\b50[234]\b|i/o timeout|tls handshake timeout|connection reset|unexpected eof|broken pipe|context deadline exceeded'; then
    printf 'transient'
  else
    printf 'unknown'
  fi
}

# One-sentence remedy for a classification token. Kept next to the classifier so a new class
# cannot be added without an answer to "so what do I do about it?".
#
# This string matters more than its length suggests: cloud-sandbox-up.sh passes it to fail(),
# which writes it verbatim into .cloud-sandbox-up.failed. That sentinel is the ENTIRE
# machine-readable failure surface — it is what a polling agent reads instead of the log.
cs_failure_hint() {
  case "${1:-}" in
    policy)
      printf 'the sandbox network policy blocked a container registry. Set Network = Full, or Custom + public.ecr.aws + *.cloudfront.net, in the Claude Code web environment. Applies to NEW sessions only.'
      ;;
    ratelimit)
      printf 'Docker Hub refused the pull (anonymous rate limit). Add DOCKERHUB_USERNAME and a read-only DOCKERHUB_TOKEN to the Claude Code web environment. Applies to NEW sessions only.'
      ;;
    transient)
      printf 'the container registry/CDN returned transient errors on every one of %s attempts. This is an upstream outage rather than a config problem — start a new session to retry; if it persists, check the Supabase and AWS ECR Public status pages.' "$CS_RETRY_ATTEMPTS"
      ;;
    toolchain)
      printf 'the pinned Supabase CLI could not be installed or run — see .cache/supabase-cli/install.log. Delete .cache/supabase-cli/ to force a clean reinstall.'
      ;;
    *)
      printf 'the failure did not match any known pattern — read the full output in /tmp/cloud-sandbox-up.log.'
      ;;
  esac
}

# Run a command, retrying while its output looks like a transient network failure.
#
#     cs_retry <label> <cleanup-command-or-empty> <cmd> [args...]
#
# <label> names the step in log lines. <cleanup-command-or-empty> runs between attempts and is
# word-split on purpose, so "cs_supabase stop" works; pass "" for none. That cleanup is not
# optional in practice for `supabase start`: a failed start leaves half-created containers
# behind, and starting again over them fails for a different reason than the one being retried,
# turning one legible error into two illegible ones.
#
# On failure the caller reads three globals. A shell function returns a status OR a value, not
# both, and stdout is spoken for here — write_env_local captures `supabase status` on stdout,
# which is why every helper in this file logs to stderr:
#
#   CS_RETRY_CLASS  policy | ratelimit | transient | unknown | toolchain
#   CS_RETRY_HINT   the actionable remedy for that class
#   CS_RETRY_LOG    path to the last attempt's captured output ("" if the command succeeded)
#
# Returns the last attempt's exit status, and never exits: this file is sourced by scripts that
# deliberately run without `set -e`, so callers own their own error policy.
cs_retry() {
  local label="$1" cleanup="$2"
  shift 2

  local attempt=1 rc=0 delay class
  CS_RETRY_CLASS=""
  CS_RETRY_HINT=""
  CS_RETRY_LOG="$(mktemp "${TMPDIR:-/tmp}/cloud-sandbox-retry.XXXXXX")"

  while :; do
    [ "$attempt" -gt 1 ] && cs_log "Retrying ${label} — attempt ${attempt}/${CS_RETRY_ATTEMPTS}."

    # Truncate per attempt so the classification describes the LAST attempt only. Accumulating
    # would let a 503 in attempt 1 keep a deterministic attempt-3 failure looking retryable, and
    # would report the wrong remedy. Nothing is lost: `>&2` still streams every attempt into the
    # caller's own log.
    : >"$CS_RETRY_LOG"
    # PIPESTATUS[0] is the command's status rather than tee's, and is correct whether or not the
    # caller enabled `set -o pipefail` — which this file cannot assume either way.
    "$@" 2>&1 | tee "$CS_RETRY_LOG" >&2
    rc=${PIPESTATUS[0]}

    if [ "$rc" -eq 0 ]; then
      # Clear all three, not just the log. An attempt that failed transiently and then
      # recovered would otherwise leave CS_RETRY_CLASS set on a SUCCESSFUL call, and a caller
      # that reads it — the natural thing to do — would report a failure that did not happen.
      rm -f "$CS_RETRY_LOG"
      CS_RETRY_LOG=""
      CS_RETRY_CLASS=""
      CS_RETRY_HINT=""
      return 0
    fi

    # cs_supabase returns 127 for its OWN install failures (bad version pin, blocked npm
    # registry, skipped platform binary). Those are deterministic, already carry a precise
    # message, and a retry only repeats a failing `npm install`.
    if [ "$rc" -eq 127 ]; then
      CS_RETRY_CLASS="toolchain"
      CS_RETRY_HINT="$(cs_failure_hint toolchain)"
      cs_log "ERROR: ${label} failed with a toolchain error (exit 127) — not retrying."
      return "$rc"
    fi

    class="$(cs_classify_failure "$CS_RETRY_LOG")"
    CS_RETRY_CLASS="$class"
    CS_RETRY_HINT="$(cs_failure_hint "$class")"

    case "$class" in
      policy | ratelimit)
        cs_log "ERROR: ${label} failed with a ${class} error — not retrying, since retries cannot fix it."
        return "$rc"
        ;;
    esac

    if [ "$attempt" -ge "$CS_RETRY_ATTEMPTS" ]; then
      cs_log "ERROR: ${label} failed after ${attempt} attempt(s); last failure classified ${class}."
      return "$rc"
    fi

    # Exponential: base, 2×base, 4×base... Capped because the delay is attacker-free but not
    # typo-free — FRAPP_SANDBOX_START_RETRIES=40 would otherwise compute a delay measured in
    # centuries and hang the session on a single sleep.
    delay=$((CS_RETRY_BASE_DELAY * (1 << (attempt - 1))))
    [ "$delay" -gt 300 ] && delay=300
    cs_log "WARN: ${label} failed (${class}); retrying in ${delay}s."

    if [ -n "$cleanup" ]; then
      cs_log "Cleaning up before retry: ${cleanup}"
      # Intentionally unquoted — $cleanup is a caller-supplied command line that must word-split.
      # shellcheck disable=SC2086
      $cleanup >/dev/null 2>&1 || true
    fi

    sleep "$delay"
    attempt=$((attempt + 1))
  done
}
