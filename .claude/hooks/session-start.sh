#!/bin/bash
# SessionStart hook: in the cloud sandbox only, kick off the local Docker + Supabase + API
# stack in the background. Work tracking lives in GitHub Issues (via the GitHub MCP) —
# there is no in-repo backlog to summarize here; /next reads the tracker directly.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"

# Nothing to announce unless the cloud-sandbox bringup runs below.
msg=""

# Arm the review gate before anything else (#2488). `.githooks/pre-push` is the only
# pre-PR review gate, and git runs it only once `core.hooksPath` names that directory.
# The one thing that set it was the root `prepare` script, so the gate was OFF in any
# checkout that had not finished an `npm ci` -- which is exactly the state a
# `(dependencies)` bringup sentinel leaves a cloud session in, with a push one
# command away. The hooks need nothing npm installs: pre-push is bash plus git, and
# pre-commit's secret scan imports only node builtins and runs `--soft-missing`.
#
# Every session, not only cloud ones: a laptop clone that has not run `npm install`
# yet is unprotected the same way. A value already naming this directory (an
# absolute path some harnesses write) is left alone; anything else is replaced with
# what `scripts/setup-git-hooks.mjs` writes, as `npm ci` would. Never fatal: a hook
# that aborts here would cost the session every message below it.
if [ -f "$ROOT/.githooks/pre-push" ] && command -v git >/dev/null 2>&1; then
  hooks_path="$(git -C "$ROOT" config --get core.hooksPath 2>/dev/null || true)"
  case "$hooks_path" in
    .githooks | "$ROOT/.githooks") ;;
    *) git -C "$ROOT" config core.hooksPath .githooks 2>/dev/null || true ;;
  esac
fi

# Render the egress capability manifest (scripts/cloud-sandbox-egress-probe.sh) as one
# compact line, plus any warnings. Deliberately terse: the whole point of the manifest is to
# save a session the tokens it would otherwise spend rediscovering the network policy, and a
# verbose block spends what the probe saves. Warnings are the exception — a reachable
# production host is worth the characters.
#
# Silent when the manifest is absent (bringup still running, probe skipped, or a laptop
# session), because a missing capability report is not itself news.
#
# On a FIRST session in a fresh container this is silent, and that is not a bug to chase:
# bringup is launched by this very hook, so no manifest from THIS bringup exists yet (it
# lands about a second later -- longer if a probe has to time out -- and is gitignored, so a
# fresh clone never carries one). STARTING_MSG below names the file and tells the session to
# read it. The summary is for a LATER fire of this hook in the same container -- resume,
# /clear, /compact, a second session -- once the running bringup has written one. The
# caller, not this function, decides whether the manifest on disk is current; see the
# freshness test at the call site.
egress_summary() {
  local manifest="$ROOT/.cloud-sandbox-capabilities.json"
  [ -r "$manifest" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as fh:
        m = json.load(fh)
except Exception:
    # A truncated or malformed manifest must not break session start. Say nothing.
    sys.exit(0)
parts = [" " + m.get("summary", "")]
for w in m.get("warnings", []):
    parts.append(" " + w)
# Gate the nudge on a CLEAN manifest, not on `staging_reachable` being truthy: that key is
# a list of the hosts that answered, so one reachable host out of four made it true. The
# probe emits a warning for every host that missed its expectation (and a SECURITY warning
# when a production host answers), so "no warnings" is the only honest signal that live
# checks are actually available -- and it stops this line contradicting a "NOT reachable"
# warning printed two clauses earlier.
if isinstance(m.get("staging_reachable"), list) and m["staging_reachable"] and not m.get("warnings"):
    parts.append(" Live checks against deployed staging are available — read "
                 ".claude/skills/live-verification/SKILL.md before pointing anything at a "
                 "frapp.live or supabase.co host, and never at production.")
sys.stdout.write("".join(parts))
' "$manifest" 2>/dev/null || return 0
}

# Cloud sandbox: launch the local stack in the background so the session is never blocked
# on the ~60-90s bringup. Gated on the /etc/frapp-cloud-sandbox marker (written by
# scripts/cloud-sandbox-setup.sh) OR FRAPP_CLOUD_SANDBOX=1, so local laptop sessions skip
# it. A /tmp lock prevents relaunching on session resume.
# See docs/internal/environment/CLOUD_SANDBOX.md.
if { [ -f /etc/frapp-cloud-sandbox ] || [ "${FRAPP_CLOUD_SANDBOX:-}" = "1" ]; } && [ -f "$ROOT/scripts/cloud-sandbox-up.sh" ]; then
  # Overridable only so scripts/ci/__tests__/session-start-hook.test.mjs can drive this
  # hook against a scratch lock, log and boot id; nothing else sets them.
  LOCK="${FRAPP_BRINGUP_LOCK:-/tmp/cloud-sandbox-up.lock}"
  BRINGUP_LOG="${FRAPP_BRINGUP_LOG:-/tmp/cloud-sandbox-up.log}"
  BOOT_ID_FILE="${FRAPP_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}"
  STARTING_MSG=" Cloud sandbox: a local Supabase + API stack is starting in the background. Before using the database or booting the API, wait for ${ROOT}/.cloud-sandbox-up.done (success) or .cloud-sandbox-up.failed (error); live log at /tmp/cloud-sandbox-up.log. Bringup writes apps/api/.env.local and apps/web/.env.local and builds the workspace packages, so 'npm run start:dev -w apps/api' boots the API and 'npm run build -w apps/web' works without Infisical. It also writes ${ROOT}/.cloud-sandbox-capabilities.json (which deployed-staging hosts are reachable, which are correctly blocked, and any SECURITY warning); read that instead of probing hosts. If bringup fails, stop and tell the user what to change in the Claude Code web environment (network policy or a missing env var), per docs/internal/environment/CLOUD_SANDBOX.md 'When bringup fails'. That is environment config a session can't fix from inside, and a workaround hides it. The exception is a sentinel reading '(dependencies)': the stack is up and only node_modules is unusable, so run 'npm ci' yourself, then build the workspace packages with 'npx turbo run build --filter=./packages/*'."

  # Which boot this machine is in. A lock, like everything in /tmp here, can outlive a
  # restart -- /tmp is on persistent disk, not tmpfs -- and the processes it describes
  # cannot. Empty where the kernel exposes no boot id (macOS, a stripped container):
  # every check below then falls back to what the hook did before it knew about boots.
  current_boot="$(cat "$BOOT_ID_FILE" 2>/dev/null || true)"

  launch_bringup() {
    nohup bash "$ROOT/scripts/cloud-sandbox-up.sh" >"$BRINGUP_LOG" 2>&1 &
    echo "$!" >"$LOCK/pid" 2>/dev/null || true
    [ -n "$current_boot" ] && { echo "$current_boot" >"$LOCK/boot_id" 2>/dev/null || true; }
    disown || true
  }

  # A lock from an earlier boot is stale whatever sits beside it (#2515). The branches
  # below trust a lock plus a `.done`/`.failed` sentinel as "bringup already finished",
  # and a VM restart leaves both on disk while Docker, Supabase and every process the
  # sentinel vouched for are gone -- one session was told the stack was up while
  # `dockerd` was not running at all. Removing the lock routes this fire through the
  # fresh-launch branch; bringup itself clears the old sentinels and manifest when it
  # starts, so nothing else needs deleting here. A lock with no boot id (written before
  # this check existed) is left to the old rules rather than guessed about.
  restart_msg=""
  if [ -n "$current_boot" ] && [ -f "$LOCK/boot_id" ] \
    && [ "$(cat "$LOCK/boot_id" 2>/dev/null || true)" != "$current_boot" ]; then
    rm -rf "$LOCK"
    restart_msg=" Cloud sandbox: this machine restarted since the last bringup (its lock carries another boot id), so the stack it started is gone; relaunched it."
  fi

  if mkdir "$LOCK" 2>/dev/null; then
    launch_bringup
    msg="${msg}${restart_msg}${STARTING_MSG}"
  elif [ -f "$ROOT/.cloud-sandbox-up.done" ] || [ -f "$ROOT/.cloud-sandbox-up.failed" ]; then
    msg="${msg} Cloud sandbox: stack bringup already finished this session — check ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed and /tmp/cloud-sandbox-up.log."
  else
    # The lock exists but no .done/.failed sentinel has been written. Either a
    # prior bringup is still running, or it was killed (e.g. the session was
    # paused/reclaimed) and left a STALE lock that would otherwise block bringup
    # forever with no sentinel for callers to wait on. Reclaim and relaunch when
    # the recorded pid is no longer a live bringup process.
    prev_pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -n "$prev_pid" ] && kill -0 "$prev_pid" 2>/dev/null \
      && ps -p "$prev_pid" -o args= 2>/dev/null | grep -q cloud-sandbox-up; then
      msg="${msg} Cloud sandbox: stack bringup is still running (pid ${prev_pid}). Wait for ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed; live log at /tmp/cloud-sandbox-up.log."
    else
      rm -rf "$LOCK"
      if mkdir "$LOCK" 2>/dev/null; then
        launch_bringup
        msg="${msg} Cloud sandbox: cleared a stale bringup lock (a previous run died with no sentinel) and restarted the stack in the background.${STARTING_MSG}"
      else
        msg="${msg} Cloud sandbox: a concurrent session reclaimed the bringup lock; wait for ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed; live log at /tmp/cloud-sandbox-up.log."
      fi
    fi
  fi

  # Summarise the manifest, but ONLY when it belongs to the bringup that owns the current
  # lock. It used to hang off the `.done`/`.failed` branch alone, which tied it to the wrong
  # signal: the probe runs FIRST in bringup and the manifest lands in about a second, while
  # `.done` waits on the whole stack (~60-90s with a warm image cache, several minutes when
  # it is cold). Every fire in that window had a current manifest on disk and said nothing.
  #
  # The freshness test is the lock's own mtime, and it is what makes this safe rather than
  # merely broader. `launch_bringup` writes $LOCK/pid immediately, so the lock is stamped at
  # launch and the probe's manifest lands ~1s after it. So:
  #   manifest NEWER than lock -> written by the bringup this lock represents. Report it.
  #   manifest OLDER than lock -> predates it, and the probe that just started is about to
  #                               overwrite it. Stay silent.
  # That resolves every branch correctly without naming any of them: the three that just
  # (re)launched bringup -- fresh start, stale-lock reclaim, concurrent reclaim -- all stamp
  # a lock newer than any manifest on disk and fall silent, while `.done`/`.failed` and
  # "still running" both report. Reporting a pre-relaunch manifest would be worse than
  # silence: a stale "production correctly blocked" would mask a SECURITY warning the new
  # probe is writing right then, and session start is the only place that surfaces it.
  #
  # Assigned via its own `|| summary=""` rather than interpolated straight into msg: under
  # `set -e` the status of `x=$(f)` IS the substitution's, so a non-zero there would abort
  # the hook with EMPTY stdout -- and on the fresh path that costs STARTING_MSG too, leaving
  # a session that never learns to wait for .cloud-sandbox-up.done while a bringup it cannot
  # see runs behind it. egress_summary cannot return non-zero today; this keeps a future
  # edit from making that failure mode the whole message rather than one line.
  if [ -e "$LOCK" ] && [ "$ROOT/.cloud-sandbox-capabilities.json" -nt "$LOCK" ]; then
    summary="$(egress_summary)" || summary=""
    msg="${msg}${summary}"
  fi
fi

# Emit as SessionStart additionalContext so the agent sees it at session start.
# Only emit when there's something to say (e.g. the cloud-sandbox bringup status).
# NOTE: msg starts "" and every contributor above — STARTING_MSG, each branch's own status
# line, and egress_summary's output — is deliberately space-prefixed; ${msg# } strips that
# single leading space from whichever landed first. If you add a branch that sets msg to a
# non-space-prefixed value, drop the `# ` or you'll lose a real first character.
# The python3 guard is load-bearing, not defensive noise. Without it a host that sets
# FRAPP_CLOUD_SANDBOX=1 but has no python3 emits `"additionalContext":}` -- exit 0, and
# invalid JSON. `set -e` does NOT catch that: the failing substitution is an argument to
# printf rather than an assignment, so its status is discarded. Saying nothing is the
# correct degradation; a malformed hook payload is not.
if [ -n "$msg" ] && command -v python3 >/dev/null 2>&1; then
  encoded="$(printf '%s' "${msg# }" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  [ -n "$encoded" ] && printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$encoded"
fi
