#!/bin/bash
# SessionStart hook: in the cloud sandbox only, kick off the local Docker + Supabase + API
# stack in the background. Work tracking lives in GitHub Issues (via the GitHub MCP) —
# there is no in-repo backlog to summarize here; /next reads the tracker directly.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"

# Nothing to announce unless the cloud-sandbox bringup runs below.
msg=""

# The cloud sandbox: the /etc/frapp-cloud-sandbox marker (written by
# scripts/cloud-sandbox-setup.sh) or FRAPP_CLOUD_SANDBOX=1. Laptop sessions skip everything
# below that depends on it.
CLOUD_MARKER="${FRAPP_CLOUD_MARKER:-/etc/frapp-cloud-sandbox}"
in_cloud=""
if [ -f "$CLOUD_MARKER" ] || [ "${FRAPP_CLOUD_SANDBOX:-}" = "1" ]; then
  in_cloud=1
fi

# Arm the review gate before anything else (#2488). `.githooks/pre-push` is the only
# pre-PR review gate, and git runs it only once `core.hooksPath` names that directory.
# The one thing that set it was the root `prepare` script, so the gate was OFF in any
# checkout that had not finished an `npm ci` -- which is exactly the state a
# `(dependencies)` bringup sentinel leaves a cloud session in, with a push one
# command away. The hooks need nothing npm installs: pre-push is bash plus git, and
# pre-commit's secret scan imports only node builtins and runs `--soft-missing`.
#
# Cloud sessions only. A laptop keeps the rule SECRET_SCANNING.md documents: `npm install`
# sets the path and `git config --unset core.hooksPath` undoes it, and rewriting it at every
# session start would override a developer who opted out or chains a hooks directory of
# their own. A cloud container is ephemeral and holds nobody's own hooks.
#
# It runs the installer `npm ci` runs, scripts/setup-git-hooks.mjs, rather than a copy of
# it: one implementation, which also restores the hooks' exec bit, and needs only node
# builtins. Plain `git config` is the fallback where node or the script is missing. Never
# fatal: a hook that aborts here would cost the session every message below it.
if [ -n "$in_cloud" ] && [ -f "$ROOT/.githooks/pre-push" ]; then
  if command -v node >/dev/null 2>&1 && [ -f "$ROOT/scripts/setup-git-hooks.mjs" ]; then
    (cd "$ROOT" && node scripts/setup-git-hooks.mjs) >/dev/null 2>&1 || true
  else
    git -C "$ROOT" config core.hooksPath .githooks >/dev/null 2>&1 || true
  fi
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
# on the ~60-90s bringup. Gated on `in_cloud` above, so local laptop sessions skip it. A
# /tmp lock prevents relaunching on session resume.
# See docs/internal/environment/CLOUD_SANDBOX.md.
if [ -n "$in_cloud" ] && [ -f "$ROOT/scripts/cloud-sandbox-up.sh" ]; then
  # Overridable only so scripts/ci/__tests__/session-start-hook.test.mjs can drive this
  # hook against a scratch lock, log, boot id and /proc/stat, as FRAPP_CLOUD_MARKER is
  # above; nothing else sets them.
  LOCK="${FRAPP_BRINGUP_LOCK:-/tmp/cloud-sandbox-up.lock}"
  BRINGUP_LOG="${FRAPP_BRINGUP_LOG:-/tmp/cloud-sandbox-up.log}"
  BOOT_ID_FILE="${FRAPP_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}"
  PROC_STAT="${FRAPP_PROC_STAT:-/proc/stat}"
  STARTING_MSG=" Cloud sandbox: a local Supabase + API stack is starting in the background. Before using the database or booting the API, wait for ${ROOT}/.cloud-sandbox-up.done (success) or .cloud-sandbox-up.failed (error); live log at /tmp/cloud-sandbox-up.log. Bringup writes apps/api/.env.local and apps/web/.env.local and builds the workspace packages, so 'npm run start:dev -w apps/api' boots the API and 'npm run build -w apps/web' works without Infisical. It also writes ${ROOT}/.cloud-sandbox-capabilities.json (which deployed-staging hosts are reachable, which are correctly blocked, and any SECURITY warning); read that instead of probing hosts. If bringup fails, stop and tell the user what to change in the Claude Code web environment (network policy or a missing env var), per docs/internal/environment/CLOUD_SANDBOX.md 'When bringup fails'. That is environment config a session can't fix from inside, and a workaround hides it. The exception is a sentinel reading '(dependencies)': the stack is up and only node_modules is unusable, so run 'npm ci' yourself, then build the workspace packages with 'npx turbo run build --filter=\"./packages/*\"'."

  # Which boot this machine is in. A lock, like everything in /tmp here, can outlive a
  # restart -- /tmp is on persistent disk, not tmpfs -- and the processes it describes
  # cannot. Empty where the kernel exposes no boot id (macOS, a stripped container):
  # every check below then falls back to what the hook did before it knew about boots.
  current_boot="$(cat "$BOOT_ID_FILE" 2>/dev/null || true)"

  launch_bringup() {
    nohup bash "$ROOT/scripts/cloud-sandbox-up.sh" >"$BRINGUP_LOG" 2>&1 &
    echo "$!" >"$LOCK/pid" 2>/dev/null || true
    # Written aside and renamed in, so a concurrent fire never reads a created-but-empty file.
    if [ -n "$current_boot" ]; then
      { echo "$current_boot" >"$LOCK/boot_id.tmp" && mv -f "$LOCK/boot_id.tmp" "$LOCK/boot_id"; } 2>/dev/null || true
    fi
    disown || true
  }

  # A lock from an earlier boot is stale whatever sits beside it (#2515). The branches
  # below trust a lock plus a `.done`/`.failed` sentinel as "bringup already finished",
  # and a VM restart leaves both on disk while Docker, Supabase and every process the
  # sentinel vouched for are gone -- one session was told the stack was up while
  # `dockerd` was not running at all.
  #
  # The boot id `launch_bringup` records is the exact test. A lock written before it did
  # (by an older copy of this hook) has none, so for that lock alone the kernel's boot time
  # (`btime` in /proc/stat) stands in: a lock last written before this boot began is from
  # an earlier one. Nothing ever writes a boot id into an old lock, so without this such a
  # machine would keep the bug until its lock went away.
  #
  # The btime test alone is skipped while the lock's own bringup is still alive. The kernel
  # derives btime from the wall clock, so a clock stepped forward since the lock was written
  # (a sync, a resumed VM) can call a same-boot lock stale, and tearing down a lock whose
  # bringup is running would start a second one racing it; a live bringup is proof of this
  # boot. With that check, what a step can still cost is one needless re-run of the
  # idempotent bringup behind a finished lock, once per machine (the relaunch records a boot
  # id). The boot id test is exact and never consults a pid: after a restart the old pid may
  # belong to some unrelated process by now. An empty boot id file (a write that failed) is
  # no evidence either way, so it takes the btime path too.
  #
  # "Alive" means the recorded pid runs cloud-sandbox-up.sh itself, not merely a command that
  # names its log or sentinels (a `tail -f /tmp/cloud-sandbox-up.log` would otherwise pass).
  bringup_alive() {
    [ -n "$1" ] && kill -0 "$1" 2>/dev/null \
      && ps -p "$1" -o args= 2>/dev/null | grep -q 'cloud-sandbox-up\.sh'
  }
  stale_boot=""
  if [ -n "$current_boot" ] && [ -d "$LOCK" ]; then
    lock_boot="$(cat "$LOCK/boot_id" 2>/dev/null || true)"
    if [ -n "$lock_boot" ]; then
      if [ "$lock_boot" != "$current_boot" ]; then
        stale_boot="its lock carries another boot id"
      fi
    elif ! bringup_alive "$(cat "$LOCK/pid" 2>/dev/null || true)"; then
      boot_time="$(awk '/^btime /{print $2; exit}' "$PROC_STAT" 2>/dev/null || true)"
      lock_time="$(stat -c %Y "$LOCK" 2>/dev/null || true)"
      case "$boot_time$lock_time" in
        '' | *[!0-9]*) ;;
        *) if [ -n "$boot_time" ] && [ -n "$lock_time" ] && [ "$lock_time" -lt "$boot_time" ]; then
             stale_boot="its lock predates this boot"
           fi ;;
      esac
    fi
  fi

  # Removing the lock routes this fire through the fresh-launch branch. The sentinels go
  # too, here rather than left to bringup's own `rm -f`: bringup reaches that line only
  # after sourcing its libraries, and a second fire of this hook inside that window (a
  # concurrent session, a resume) would otherwise find the new lock plus the OLD `.done`
  # and report a stack that is not running. The manifest can stay: the new lock is newer
  # than it, so the summary below ignores it until the new probe replaces it.
  restart_msg=""
  if [ -n "$stale_boot" ]; then
    rm -rf "$LOCK"
    rm -f "$ROOT/.cloud-sandbox-up.done" "$ROOT/.cloud-sandbox-up.failed"
    restart_msg=" Cloud sandbox: this machine restarted since the last bringup (${stale_boot}), so the stack it started is gone; relaunched it."
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
    #
    # Except for a lock only seconds old. `mkdir` takes the lock before
    # launch_bringup has written a pid, and for a moment after that the pid is a
    # fork that has not yet exec'd cloud-sandbox-up.sh. A concurrent fire in that
    # window would see no live bringup and start a second one racing the first.
    # A bringup that really died that young is reclaimed by the next fire.
    prev_pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
    lock_age=""
    lock_mtime="$(stat -c %Y "$LOCK" 2>/dev/null || true)"
    case "$lock_mtime" in
      '' | *[!0-9]*) ;;
      *) lock_age=$(($(date +%s) - lock_mtime)) ;;
    esac
    if bringup_alive "$prev_pid"; then
      msg="${msg} Cloud sandbox: stack bringup is still running (pid ${prev_pid}). Wait for ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed; live log at /tmp/cloud-sandbox-up.log."
    elif [ -n "$lock_age" ] && [ "$lock_age" -lt 30 ]; then
      msg="${msg} Cloud sandbox: stack bringup is starting (another session start took the lock ${lock_age}s ago). Wait for ${ROOT}/.cloud-sandbox-up.done / .cloud-sandbox-up.failed; live log at /tmp/cloud-sandbox-up.log."
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
