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

# Is the node toolchain the repo's own gates run through actually usable?
#
# Two signals, deliberately NOT equivalent — see cs_verify_node_deps for why they are
# reported at different severities:
#
#   turbo runnable      Definitional. `check-types`, `lint` and every workspace test are
#                       `turbo run ...`, so without this they cannot start at all. The
#                       error they print is `turbo: not found`, which names neither
#                       dependencies nor the setup script, so an agent reads it as a repo
#                       defect and starts debugging turbo.json.
#   npm ls --depth=0    The HALF-populated case. A `-d node_modules` test passes on a tree
#                       the harness killed mid-`npm ci`, which is the failure mode that
#                       fails latest and reads strangest; npm is the only thing here that
#                       knows what was declared and can therefore see what is absent.
#
# Runs turbo rather than only stat-ing it. `-x` alone already covers the absent and dangling
# cases (it follows the symlink), but not a target that exists and does not work — measured:
# with `node_modules/turbo/bin/turbo` replaced by executable garbage, `-x` still reports the
# bin PRESENT and only the `--version` run catches it. `npm ls` does not cover this either;
# it reads the tree's metadata, not whether anything in it can execute.
#
# `--depth=0` on the npm side is deliberate, and so is its narrowness. Measured on npm 10.9
# against this repo, it catches LESS than "the tree is complete" — know the boundary before
# trusting it:
#
#   root-declared dep missing        exit 1   (removed `prettier` -> caught)
#   workspace-declared dep missing   exit 0   (removed `zod`, declared by packages/validation,
#                                              hoisted to the root -> NOT caught)
#   extraneous packages present      exit 0   (this tree carries 6; they do not flip it)
#
# So it is a real signal for the fully-empty and root-level-gap cases and a partial one for a
# half-populated tree — not a completeness proof. That narrowness is wanted here: this runs on
# every bringup, and a deeper walk would turn ordinary hoisting and optional-dependency
# variation into a verdict, which is the false-positive class that must never gate a session.
# Anything it does miss surfaces later as a plain `Cannot find module`, which is legible in a
# way `turbo: not found` is not — and that legibility is what this whole check is for.
cs_node_deps_ok() {
  local root="${1:-$PWD}" why=""
  [ -x "$root/node_modules/.bin/turbo" ] \
    && "$root/node_modules/.bin/turbo" --version >/dev/null 2>&1 \
    || why="turbo"
  if [ -z "$why" ] && ! (cd "$root" && npm ls --depth=0 >/dev/null 2>&1); then
    why="incomplete"
  fi
  CS_NODE_DEPS_WHY="$why"
  [ -z "$why" ]
}

# Report on the node toolchain. DETECT ONLY — this deliberately never writes to node_modules.
#
# WHY THIS LIVES IN BRINGUP AND NOT IN SETUP. cloud-sandbox-setup.sh installs deps
# non-fatally on purpose (its header says so twice) and its WARN goes to the environment
# setup log in the web UI, which the agent session cannot read. Worse, setup's FILESYSTEM
# is cached ~7 days, so one failed `npm ci` during a cache build is re-served to every
# later session — measured at three consecutive days (#1631). So setup stays non-fatal and
# bringup stops trusting it silently.
#
# WHY IT DOES NOT REPAIR. An earlier draft ran `npm ci` here. That was wrong three ways:
#
#   1. `npm ci` DELETES node_modules before installing. A failed repair therefore turned the
#      deliberately-non-fatal `incomplete` case (turbo runs, one declared dep missing) into
#      the fatal `turbo` case, destroying a working tree on the way — so the severity split
#      below was unreachable in exactly the case it was written for.
#   2. Bringup runs in the BACKGROUND (.claude/hooks/session-start.sh launches it with
#      `nohup ... &`) and the agent is told it only needs to wait before using the DB or API.
#      Gates and `npm install` are sanctioned to run immediately, so a repair here races the
#      live session over one node_modules with no cross-process lock.
#   3. The `|| npm install` fallback rewrites the tracked package-lock.json in the session's
#      checked-out branch. setup.sh gets away with the same pair only because it runs at
#      environment-build time against a throwaway root filesystem.
#
# The session owns its node_modules; bringup only reports on it. #1631's acceptance criterion
# is met either way — "either repairs the install or writes .cloud-sandbox-up.failed" — and
# the sentinel names `npm ci`, so the agent runs it deliberately, in the foreground, once.
cs_verify_node_deps() {
  local root="${1:-$PWD}"

  if cs_node_deps_ok "$root"; then
    cs_log "Node dependencies OK."
    return 0
  fi

  # THE TWO SIGNALS PART COMPANY HERE, and the asymmetry is deliberate.
  #
  # A precondition that can fail a session for every agent in the environment is more
  # dangerous than the bug it guards against, so only the signal that is *definitionally*
  # fatal gets to be fatal. No turbo means no `check-types`, no `lint`, no workspace test —
  # there is no reading of that where the session is fine, so it fails and the sentinel says
  # so. `npm ls` disagreeing while turbo runs is npm's stricter opinion about a tree that may
  # well work; that warns and lets bringup finish, because being wrong in that direction
  # costs one confusing session and being wrong in the other costs all of them.
  if [ "${CS_NODE_DEPS_WHY:-}" = "incomplete" ]; then
    cs_log "WARN: 'npm ls --depth=0' reports a missing declared dependency."
    cs_log "      turbo runs, so the gates can start; a workspace-specific 'Cannot find"
    cs_log "      module' may still trace back to this. Run 'npm ci' if one does."
    return 0
  fi
  return 1
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

# How long to wait for the between-attempt cleanup before giving up on it. See cs_retry.
CS_RETRY_CLEANUP_TIMEOUT="${FRAPP_SANDBOX_CLEANUP_TIMEOUT:-120}"

# Sanitize the three knobs above. Exposed as a function, not run once inline, because a caller may
# legitimately reassign them after sourcing — cloud-sandbox-setup.sh does, to run a tighter budget
# — and an inline guard would be bypassed by exactly the values it exists to catch.
#
# Two traps, both of which reached working code before being caught here:
#
#   Leading zeros. `*[!0-9]*` accepts "08", and `$(( ))` then parses it as OCTAL — so "08" is not
#   8 but an arithmetic error ("value too great for base"), which aborts the enclosing AND-OR list
#   outright. At the call site that means `cs_retry ... || fail ...` never runs its `fail`, and
#   bringup marches on to `db push` against a stack that never started. "030" is quieter and just
#   as wrong: 24 seconds, not 30. `10#` forces base 10.
#
#   Range. A digit-only value can still be absurd, and absurd values wrap: with attempts=61 the
#   shift below overflows int64 to a NEGATIVE delay, which a `-gt 300` cap cannot catch, so
#   `sleep -6917529027641081856` fails and the backoff silently disappears.
#
# Bounds use `case`, not `[ -ge ]`, because `[` on a huge digit string prints "integer expression
# expected" into the session-start log before any of this can help.
cs_normalize_retry_knobs() {
  case "$CS_RETRY_ATTEMPTS" in '' | *[!0-9]* | ???*) CS_RETRY_ATTEMPTS=3 ;; esac
  CS_RETRY_ATTEMPTS=$((10#$CS_RETRY_ATTEMPTS))
  [ "$CS_RETRY_ATTEMPTS" -ge 1 ] || CS_RETRY_ATTEMPTS=1

  case "$CS_RETRY_BASE_DELAY" in '' | *[!0-9]* | ?????*) CS_RETRY_BASE_DELAY=10 ;; esac
  CS_RETRY_BASE_DELAY=$((10#$CS_RETRY_BASE_DELAY))

  case "$CS_RETRY_CLEANUP_TIMEOUT" in '' | *[!0-9]* | ?????*) CS_RETRY_CLEANUP_TIMEOUT=120 ;; esac
  CS_RETRY_CLEANUP_TIMEOUT=$((10#$CS_RETRY_CLEANUP_TIMEOUT))
}
cs_normalize_retry_knobs

# Where a caller's full output ends up, named in human-facing hints. Bringup and the setup
# pre-pull log to entirely different places, and the setup script's log does not exist yet when
# it runs, so this must be the caller's to set.
CS_RETRY_LOG_LOCATION="${CS_RETRY_LOG_LOCATION:-the cloud-sandbox log}"

# Classify a captured failure log, echoing exactly one token on stdout:
#
#   policy        Network policy blocked a container registry. FATAL — an allowlist does not
#                 heal on retry, and the fix is a setting in the Claude Code web environment.
#   ratelimit     Docker Hub refused the pull. FATAL for the same reason (it needs credentials).
#   deterministic A local, repeatable failure (denied ulimit, port in use, dockerd down, poisoned
#                 data volume). FATAL — retrying reruns a ~90s start to reach the same error.
#   transient     Registry/CDN hiccup: 5xx, timeout, reset, truncated transfer. Retryable.
#   unknown       Anything else. ALSO retryable, deliberately — the point of this work is
#                 resilience against a class of network failures nobody can fully enumerate, and
#                 every case that genuinely cannot be retried is named above. Erring the other
#                 way (fail fast on anything unrecognised) would leave the next unfamiliar CDN
#                 error string killing sessions exactly as before.
#
# ORDER MATTERS. A run that hits an allowlist rejection, or dies on a denied ulimit, usually also
# logs a 5xx or a reset as the connection drops, so every fatal class is tested before transient;
# matching transient first would retry an unfixable failure to exhaustion and still fail.
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

  # Every test is a HERESTRING, never `printf ... | grep -q`. That pipeline is silently wrong on
  # a real capture: grep -q exits at the first match, the printf still writing behind it takes
  # SIGPIPE, and because both callers set `-o pipefail` the pipeline reports 141 — so a matching
  # branch is SKIPPED. It only shows above ~64 KiB, which no small fixture reaches and every real
  # `supabase start` log exceeds, so the fail-fast half of this function would have quietly
  # degraded to `unknown` in exactly the situation it exists for.
  #
  # The numeric patterns are anchored to HTTP context rather than matched bare. `\b429\b` looked
  # fine and was not: `.` is a word boundary, so it matches Docker's own pull progress
  # ("Downloading 429.5MB/1.2GB") and Supabase image tags ("v2.429.0: Pulling from
  # supabase/gotrue" — gotrue is at v2.193.0 and climbing). Since ratelimit is fail-fast and is
  # tested before transient, one incidental number turned a retryable CDN outage into an
  # immediate abort telling the user to add Docker Hub credentials that cannot help.
  if grep -Eqi 'not in allowlist|host_not_allowed|host not allowed|denied by policy' <<<"$body"; then
    printf 'policy'
  elif grep -Eqi 'toomanyrequests|too many requests|rate exceeded|pull rate limit|(status|code|http)[^0-9]{0,8}429' <<<"$body"; then
    printf 'ratelimit'
  elif grep -Eqi 'error setting rlimit|port is already allocated|address already in use|cannot connect to the docker daemon|database files are incompatible' <<<"$body"; then
    # Deterministic and local: the sandbox denies an ulimit, a port is taken, dockerd is gone, or
    # a half-initialised data volume survived. Retrying re-runs a ~90s start to reach the same
    # error, so the useful move is to send the reader to CLOUD_SANDBOX.md's symptom table rather
    # than to burn the budget.
    #
    # KEEP THAT TABLE IN STEP WITH THIS LINE. Every pattern below must have a row, because the
    # hint for this class gives exactly one instruction and it is "go read that table" — a
    # pattern with no row leaves the reader at a dangling pointer at the moment they are already
    # blocked. This comment previously asserted the rows existed; four of the five had none
    # (#1632), so the assertion is now a rule for whoever edits the pattern, not a claim.
    printf 'deterministic'
  elif grep -Eqi 'service unavailable|bad gateway|gateway time-?out|(status|code|http)[^0-9]{0,8}50[234]|i/o timeout|tls handshake timeout|connection reset|unexpected eof|broken pipe|context deadline exceeded' <<<"$body"; then
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
# Takes the class and, optionally, where the full output can be read. That second argument is not
# decoration: this function is shared by per-session bringup AND the setup pre-pull, and the two
# run in different worlds. cloud-sandbox-setup.sh executes as root at environment-BUILD time, when
# /tmp/cloud-sandbox-up.log does not exist and "start a new session" is meaningless — so no remedy
# here may assume a session exists. Callers pass their own log location; the default stays vague
# rather than confidently naming a file that may not be there.
cs_failure_hint() {
  local class="${1:-}" where="${2:-the cloud-sandbox log}"
  case "$class" in
    policy)
      printf 'the sandbox network policy blocked a container registry. Set Network = Full, or Custom + public.ecr.aws + *.cloudfront.net, in the Claude Code web environment. Applies to NEW sessions only.'
      ;;
    ratelimit)
      printf 'Docker Hub refused the pull (anonymous rate limit). Add DOCKERHUB_USERNAME and a read-only DOCKERHUB_TOKEN to the Claude Code web environment. Applies to NEW sessions only.'
      ;;
    deterministic)
      printf 'a local, repeatable failure (denied ulimit, port already in use, Docker daemon down, or an incompatible Postgres data volume) — retrying cannot help. Match the exact error in %s against the symptom table in docs/internal/environment/CLOUD_SANDBOX.md ("When bringup fails").' "$where"
      ;;
    transient)
      printf 'the container registry/CDN returned transient errors on every one of %s attempts. This is an upstream outage rather than a config problem — retry later; if it persists, check the Supabase and AWS ECR Public status pages.' "$CS_RETRY_ATTEMPTS"
      ;;
    toolchain)
      printf 'the pinned Supabase CLI could not be installed or run — see .cache/supabase-cli/install.log. Delete .cache/supabase-cli/ to force a clean reinstall.'
      ;;
    dependencies)
      # Distinct from `toolchain`, which is specifically the pinned Supabase CLI. This one is
      # node_modules, and it is the class most likely to be read as something else: the symptom
      # an agent actually sees is `turbo: not found`, which names neither npm nor this script.
      printf 'node_modules/.bin/turbo does not run, so every gate that goes through turbo (check-types, lint, test) cannot start — they fail with "turbo: not found", which does not name dependencies. FIX IT IN THIS SESSION: run `npm ci` in the repo root. Unlike every other class here this one is NOT environment config and does NOT need a new session — bringup deliberately does not install for you, because it runs in the background alongside your own commands. The rest of the stack is already up: Supabase, the migrations and both .env.local files landed before this check ran. Only if `npm ci` cannot reach the registry is this a network-policy problem — and then it needs reporting, because the setup script installs into a filesystem cached ~7 days, so a NEW session inherits the same broken tree until that is fixed.'
      ;;
    *)
      printf 'the failure did not match any known pattern — read the full output in %s.' "$where"
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
# On failure the caller reads two globals. A shell function returns a status OR a value, not
# both, and stdout is spoken for here — write_env_files captures `supabase status` on stdout,
# which is why every helper in this file logs to stderr:
#
#   CS_RETRY_CLASS  policy | ratelimit | deterministic | transient | unknown | toolchain
#   CS_RETRY_HINT   the actionable remedy for that class
#
# The per-attempt capture file is an internal detail and is removed on every return path. It is
# not exposed, because it would only ever duplicate what `>&2` already streamed into the caller's
# own log — and an exported path to a file this function deletes is worse than no path at all.
# Set CS_RETRY_LOG_LOCATION to name that log in human-facing hints.
#
# Returns the last attempt's exit status, and never exits: this file is sourced by scripts that
# deliberately run without `set -e`, so callers own their own error policy.
cs_retry() {
  local label="$1" cleanup="$2"
  shift 2

  local attempt=1 rc=0 delay class cap
  CS_RETRY_CLASS=""
  CS_RETRY_HINT=""

  # An unchecked mktemp here would silently disable half the feature rather than fail: the empty
  # path makes cs_classify_failure hit its unreadable-file guard and answer `unknown` for every
  # attempt, so policy and ratelimit stop being detected at all and get retried to exhaustion —
  # while `tee ''` sprays confusing errors into the log naming the wrong file.
  if ! cap="$(mktemp "${TMPDIR:-/tmp}/cloud-sandbox-retry.XXXXXX" 2>/dev/null)"; then
    CS_RETRY_CLASS="toolchain"
    CS_RETRY_HINT="could not create a temporary file in ${TMPDIR:-/tmp} — the disk may be full or the directory unwritable."
    cs_log "ERROR: ${label} — cannot create a capture file in ${TMPDIR:-/tmp}; refusing to run blind."
    return 1
  fi

  while :; do
    [ "$attempt" -gt 1 ] && cs_log "Retrying ${label} — attempt ${attempt}/${CS_RETRY_ATTEMPTS}."

    # Truncate per attempt so the classification describes the LAST attempt only. Accumulating
    # would let a 503 in attempt 1 keep a deterministic attempt-3 failure looking retryable, and
    # would report the wrong remedy. Nothing is lost: `>&2` still streams every attempt into the
    # caller's own log.
    : >"$cap"
    # PIPESTATUS[0] is the command's status rather than tee's, and is correct whether or not the
    # caller enabled `set -o pipefail` — which this file cannot assume either way.
    "$@" 2>&1 | tee "$cap" >&2
    rc=${PIPESTATUS[0]}

    if [ "$rc" -eq 0 ]; then
      # Clear all three, not just the log. An attempt that failed transiently and then
      # recovered would otherwise leave CS_RETRY_CLASS set on a SUCCESSFUL call, and a caller
      # that reads it — the natural thing to do — would report a failure that did not happen.
      rm -f "$cap"
      CS_RETRY_CLASS=""
      CS_RETRY_HINT=""
      return 0
    fi

    # cs_supabase returns 127 for its OWN install failures (bad version pin, blocked npm
    # registry, skipped platform binary). Those are deterministic, already carry a precise
    # message, and a retry only repeats a failing `npm install`.
    if [ "$rc" -eq 127 ]; then
      CS_RETRY_CLASS="toolchain"
      CS_RETRY_HINT="$(cs_failure_hint toolchain "$CS_RETRY_LOG_LOCATION")"
      cs_log "ERROR: ${label} failed with a toolchain error (exit 127) — not retrying."
      rm -f "$cap"
      return "$rc"
    fi

    class="$(cs_classify_failure "$cap")"
    CS_RETRY_CLASS="$class"
    CS_RETRY_HINT="$(cs_failure_hint "$class" "$CS_RETRY_LOG_LOCATION")"

    case "$class" in
      policy | ratelimit | deterministic)
        cs_log "ERROR: ${label} failed with a ${class} error — not retrying, since retries cannot fix it."
        rm -f "$cap"
        return "$rc"
        ;;
    esac

    if [ "$attempt" -ge "$CS_RETRY_ATTEMPTS" ]; then
      cs_log "ERROR: ${label} failed after ${attempt} attempt(s); last failure classified ${class}."
      rm -f "$cap"
      return "$rc"
    fi

    # Exponential: base, 2×base, 4×base... The exponent is bounded BEFORE the shift, not after.
    # Capping the product alone is not enough: past ~61 attempts `1 << n` overflows int64 and the
    # product comes back NEGATIVE, which sails through a `-gt 300` test and makes `sleep` fail
    # outright — removing the backoff exactly when a long retry budget says it is wanted. 16
    # doublings is already far past the cap for any sane base.
    if [ "$attempt" -gt 16 ]; then
      delay=300
    else
      delay=$((CS_RETRY_BASE_DELAY * (1 << (attempt - 1))))
      [ "$delay" -gt 300 ] && delay=300
    fi
    cs_log "WARN: ${label} failed (${class}); retrying in ${delay}s."

    if [ -n "$cleanup" ]; then
      cs_log "Cleaning up before retry: ${cleanup}"
      # Bounded by hand rather than with `timeout`, which cannot wrap $cleanup: it is a shell
      # FUNCTION (cs_supabase), and timeout execs, which would lose it. The bound matters because
      # `supabase stop` talks to the same Docker socket that cs_ensure_docker_daemon deliberately
      # wraps in `timeout 10` — a wedged socket hangs it forever, and a hung bringup never writes
      # a sentinel, so the session waits on one that can never arrive. The SessionStart hook's
      # stale-lock reclaim does not save us either: it tests liveness, and a hung process is alive.
      #
      # Intentionally unquoted — $cleanup is a caller-supplied command line that must word-split.
      # shellcheck disable=SC2086
      $cleanup >/dev/null 2>&1 &
      local cleanup_pid=$! waited=0
      while kill -0 "$cleanup_pid" 2>/dev/null && [ "$waited" -lt "$CS_RETRY_CLEANUP_TIMEOUT" ]; do
        sleep 1
        waited=$((waited + 1))
      done
      if kill -0 "$cleanup_pid" 2>/dev/null; then
        cs_log "WARN: cleanup did not finish in ${CS_RETRY_CLEANUP_TIMEOUT}s; abandoning it and retrying anyway."
        kill -9 "$cleanup_pid" 2>/dev/null || true
      fi
      wait "$cleanup_pid" 2>/dev/null || true
    fi

    sleep "$delay"
    attempt=$((attempt + 1))
  done
}
