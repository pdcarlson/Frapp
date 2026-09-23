#!/usr/bin/env bash
# The cloud-sandbox bringup lock, shared by .claude/hooks/session-start.sh (which launches
# bringup in the background) and scripts/cloud-sandbox-up.sh (when someone runs it by hand).
# Sourced, never executed. Defines functions only.
#
# The lock is a directory, `/tmp/cloud-sandbox-up.lock` unless FRAPP_BRINGUP_LOCK says
# otherwise, holding `pid` (the running cloud-sandbox-up.sh) and `boot_id` (the kernel boot it
# ran in). Both writers take it under an flock on `<lock>.guard` and ask whether a bringup is
# running by the same rule, bringup_lock_live, so a session start and a hand-run bringup cannot
# interleave their read-then-act steps or disagree about that (#2547). The hook also trusts a
# `.done`/`.failed` sentinel from this boot before it asks; a hand run replaces a finished
# bringup's lock, whose pid is dead. `cloud-sandbox-up.sh --stop` ends a hung one (bringup_stop),
# marking the lock with a `stopping` file while it does, and leaving a `survivors` file in a
# kept lock when processes outlive SIGKILL. Either keeps the lock live though its pid is dead
# (bringup_lock_live), so the lock is never removed by hand: `--stop` is the way to clear it.

# Whether $1 is the pid of a running cloud-sandbox-up.sh: bash (or sh) whose first operand is
# the script, as the hook and a hand run start it. Its argv is read whole, from
# /proc/<pid>/cmdline where there is one, so a path with a space still matches; a substring
# test would not do, since bringup_stop kills what this accepts, and `vim
# scripts/cloud-sandbox-up.sh`, `bash -c '...'` or a `tail -f` of the log is not a bringup.
# Another user's bringup counts, and a zombie (whose cmdline is empty) does not.
bringup_alive() {
  [ -n "$1" ] || return 1
  local argv
  if [ -r "/proc/$1/cmdline" ]; then
    argv="$(tr '\0' '\n' <"/proc/$1/cmdline" 2>/dev/null)"
  else
    argv="$(ps -p "$1" -o args= 2>/dev/null | tr ' ' '\n')"
  fi
  printf '%s\n' "$argv" | awk '
    NR == 1 { n = split($0, p, "/"); if (p[n] != "bash" && p[n] != "sh") { r = 1; exit } next }
    /^-/ { if ($0 ~ /^-[^-]*c/) { r = 1; exit } next }
    { n = split($0, p, "/"); r = (p[n] == "cloud-sandbox-up.sh") ? 0 : 1; exit }
    END { exit (r == "" ? 1 : r) }'
}

# The pid of the `--stop` still stopping the bringup behind lock $1, if one is.
bringup_stopping() {
  local stopper
  stopper="$(cat "$1/stopping" 2>/dev/null || true)"
  bringup_alive "$stopper" && echo "$stopper"
}

# When pid $1 started, in clock ticks since boot (field 22 of /proc/<pid>/stat, read after the
# command name, which may hold spaces); nothing if it is not running. Unlike `ps -o lstart`,
# which renders it as local wall-clock time, it survives a clock step and a change of TZ. Where
# there is no /proc, `ps` in UTC stands in.
bringup_started() {
  if [ -r "/proc/$1/stat" ]; then
    sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | awk '{ print $20 }'
  else
    TZ=UTC LC_ALL=C ps -p "$1" -o lstart= 2>/dev/null | tr -s ' ' | sed 's/^ //; s/ $//'
  fi
}

# The processes a stop left behind in lock $1 that are still running, as pids on one line. The
# lock's `survivors` file holds "<pid> <start time>" per line; a pid whose start time no longer
# matches has exited and been reused by something else, and is not one of them.
bringup_survivors() {
  local p started out=""
  [ -f "$1/survivors" ] || return 1
  while read -r p started; do
    [ -n "$p" ] && [ -n "$started" ] && [ "$(bringup_started "$p")" = "$started" ] \
      && bringup_pid_running "$p" && out="$out $p"
  done <"$1/survivors"
  [ -n "$out" ] && echo "${out# }"
}

# Whether pid $1 is a process that has not exited: listed, and not a zombie.
bringup_pid_running() {
  local stat
  stat="$(ps -p "$1" -o stat= 2>/dev/null | tr -d ' ')"
  [ -n "$stat" ] && [ "${stat#Z}" = "$stat" ]
}

# Seconds since lock $1 was last written, or nothing when that cannot be read.
bringup_lock_age() {
  local mtime
  mtime="$(stat -c %Y "$1" 2>/dev/null || true)"
  case "$mtime" in
    '' | *[!0-9]*) ;;
    *) echo $(($(date +%s) - mtime)) ;;
  esac
}

# Whether lock $1 was taken under 30 seconds ago. A negative age (a clock stepped back) does
# not count.
bringup_lock_young() {
  local age
  age="$(bringup_lock_age "$1")"
  [ -n "$age" ] && [ "$age" -ge 0 ] && [ "$age" -lt 30 ]
}

# Whether lock $1 belongs to a bringup that is running, being stopped, stuck, or starting.
# Running: its pid is a live cloud-sandbox-up.sh. Being stopped: a live `--stop` marked it, and
# the old tree may still be dying. Stuck: processes a stop could not kill still run
# (bringup_survivors). Starting: the lock is young and its pid is not written yet, or is a
# live process that has not exec'd the script yet; the taker writes the pid only after
# launching bringup, and for a moment the launched pid is still a fork of the taker. A
# recorded pid that is dead is none of these, however young the lock: that bringup finished or
# was stopped, and its lock is replaced at once.
bringup_lock_live() {
  local pid
  pid="$(cat "$1/pid" 2>/dev/null || true)"
  bringup_alive "$pid" && return 0
  bringup_stopping "$1" >/dev/null && return 0
  bringup_survivors "$1" >/dev/null && return 0
  bringup_lock_young "$1" && { [ -z "$pid" ] || bringup_pid_running "$pid"; }
}

# Take the guard flock on `<lock $1>.guard`, on fd 9, waiting at most 10 seconds; bringup_unguard
# releases it. Where flock is missing, nothing is serialized, as before the guard existed.
bringup_guard() {
  if command -v flock >/dev/null 2>&1 && { exec 9>>"$1.guard"; } 2>/dev/null; then
    flock -w 10 9 2>/dev/null || true
  fi
}

bringup_unguard() {
  exec 9>&-
}

# The pids of every process under $1, deepest first, except the Docker daemon and what runs
# under it: bringup starts `dockerd` as its own background child (cs_ensure_docker_daemon), and
# the daemon is meant to outlive it. Killing it would stop every container on the machine.
bringup_descendants() {
  local child
  for child in $(ps -o pid= --ppid "$1" 2>/dev/null); do
    ps -p "$child" -o args= 2>/dev/null | grep -Eq '(^|[ /])dockerd( |$)' && continue
    bringup_descendants "$child"
    echo "$child"
  done
}

# Stop the bringup holding lock $1, with every process under it. $2 is the caller's pid, $3 the
# current boot id (may be empty), $4 the `.failed` sentinel to write. Takes the guard itself.
#   0  stopped (its pid is printed, or "retried:<pids>" when this retried what an earlier stop
#      left behind) or none was running (nothing printed); the lock is gone.
#   1  a bringup is starting (bringup_lock_live, but its pid is not yet a bringup to stop);
#      nothing is done, since removing its lock would let a second bringup start beside it.
#   2  the lock could not be marked or removed (another user's, or /tmp's permissions);
#      nothing was signalled.
#   3  stopped, but processes outlived SIGKILL (stuck in the kernel, or another user's); the
#      stopped pid is printed, then a line naming them. The lock is KEPT, recording them in its
#      `survivors` file, so bringup_lock_live counts it live until they exit and nothing starts
#      beside them; `.failed` says so. Running `--stop` again retries them.
#   4  stopped (its pid is printed), but the lock could not be removed afterwards.
#   5  another `--stop` is already stopping it; its pid is printed, and nothing is done.
# Killing only the script would orphan the command it is blocked in (a hung `supabase start`,
# say): bash runs no trap while it waits on a foreground child, and the next bringup would then
# start beside the orphan. The tree is read before anything is signalled, since children
# re-parent once their parent dies. Only the decision is made under the guard, not the wait:
# the lock is first marked `stopping` with the caller's pid, which bringup_lock_live counts as
# live, so for as long as the old tree takes to die every writer starts nothing, and a second
# `--stop` refuses rather than killing this one. Before the lock goes, `.failed` records the
# stop, so a session told to wait for a sentinel gets one. A lock from another boot names a pid
# that may since belong to anything, so nothing is killed for it.
bringup_stop() {
  local lock="$1" self="$2" boot="${3:-}" failed="${4:-}" pid lock_boot stopper stuck="" tree="" p alive i survivors=""
  bringup_guard "$lock"
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  lock_boot="$(cat "$lock/boot_id" 2>/dev/null || true)"
  if stopper="$(bringup_stopping "$lock")"; then
    bringup_unguard
    echo "$stopper"
    return 5
  fi
  if [ -n "$lock_boot" ] && [ -n "$boot" ] && [ "$lock_boot" != "$boot" ]; then
    :
  elif bringup_alive "$pid"; then
    tree="$(bringup_descendants "$pid") $pid"
  elif stuck="$(bringup_survivors "$lock")"; then
    tree="$stuck"
  elif [ -d "$lock" ] && bringup_lock_live "$lock"; then
    bringup_unguard
    return 1
  fi
  if [ -z "$tree" ]; then
    rm -rf "$lock" 2>/dev/null || true
    bringup_unguard
    if [ -e "$lock" ] || [ -L "$lock" ]; then return 2; fi
    return 0
  fi
  { echo "$self" >"$lock/stopping.tmp" && mv -f "$lock/stopping.tmp" "$lock/stopping"; } 2>/dev/null || true
  if [ "$(cat "$lock/stopping" 2>/dev/null || true)" != "$self" ]; then
    bringup_unguard
    return 2
  fi
  bringup_unguard

  # The first line names what is being stopped: the bringup's pid, or, on a retry of what an
  # earlier stop left behind, those processes.
  if [ -n "$stuck" ]; then echo "retried:$stuck"; else echo "$pid"; fi
  # shellcheck disable=SC2086 # one pid per word
  kill -TERM $tree 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    alive=""
    for p in $tree; do bringup_pid_running "$p" && alive=1; done
    [ -z "$alive" ] && break
    # Ten seconds for TERM, then KILL, then five more for it to land.
    # shellcheck disable=SC2086
    [ "$i" -eq 10 ] && kill -KILL $tree 2>/dev/null
    sleep 1
  done
  for p in $tree; do bringup_pid_running "$p" && survivors="$survivors $p"; done

  bringup_guard "$lock"
  if [ -n "$failed" ]; then
    if [ -n "$survivors" ]; then
      printf '%s — bringup pid %s was stopped by cloud-sandbox-up.sh --stop, but processes%s outlived SIGKILL. Its lock is kept so nothing starts beside them; once they are gone, run bash scripts/cloud-sandbox-up.sh, or run --stop again to retry them.\n' \
        "$(date -u +%FT%TZ)" "$pid" "$survivors" >"$failed" 2>/dev/null || true
    else
      printf '%s — bringup pid %s was stopped by cloud-sandbox-up.sh --stop. Run bash scripts/cloud-sandbox-up.sh to start it again.\n' \
        "$(date -u +%FT%TZ)" "$pid" >"$failed" 2>/dev/null || true
    fi
  fi
  # Only a lock this call marked: one another writer holds instead is theirs.
  if [ "$(cat "$lock/stopping" 2>/dev/null || true)" = "$self" ]; then
    if [ -n "$survivors" ]; then
      for p in $survivors; do printf '%s %s\n' "$p" "$(bringup_started "$p")"; done >"$lock/survivors.tmp" 2>/dev/null \
        && mv -f "$lock/survivors.tmp" "$lock/survivors" 2>/dev/null
      rm -f "$lock/stopping" 2>/dev/null || true
    else
      rm -rf "$lock" 2>/dev/null || true
    fi
  fi
  bringup_unguard
  if [ -n "$survivors" ]; then
    echo "survivors:$survivors"
    return 3
  fi
  if [ "$(cat "$lock/stopping" 2>/dev/null || true)" = "$self" ]; then return 4; fi
  return 0
}

# Record the bringup holding lock $1: pid $2 and boot id $3 (skipped when empty). Each file is
# written aside and renamed in, so a concurrent reader never sees one created but empty.
bringup_record() {
  local lock="$1" pid="$2" boot="${3:-}"
  { echo "$pid" >"$lock/pid.tmp" && mv -f "$lock/pid.tmp" "$lock/pid"; } 2>/dev/null || true
  if [ -n "$boot" ]; then
    { echo "$boot" >"$lock/boot_id.tmp" && mv -f "$lock/boot_id.tmp" "$lock/boot_id"; } 2>/dev/null || true
  fi
}

# Take lock $1 for a bringup started by hand, as pid $3 in boot $2. Call under the guard flock.
#   0  taken.
#   1  another bringup from this boot is running, being stopped, stuck or starting; its pid,
#      "stopping:<the --stop's pid>", "survivors:<pids>", or "starting" is printed.
#   2  the lock could not be removed or created (its owner, or /tmp's permissions).
# A lock that another boot left behind is replaced whatever its pid says: after a restart that
# pid may belong to some unrelated process.
bringup_take_lock() {
  local lock="$1" boot="$2" self="$3" holder lock_boot stopper stuck
  if [ -d "$lock" ]; then
    holder="$(cat "$lock/pid" 2>/dev/null || true)"
    lock_boot="$(cat "$lock/boot_id" 2>/dev/null || true)"
    if [ "$holder" != "$self" ] && { [ -z "$lock_boot" ] || [ -z "$boot" ] || [ "$lock_boot" = "$boot" ]; } \
      && bringup_lock_live "$lock"; then
      if stopper="$(bringup_stopping "$lock")"; then
        echo "stopping:$stopper"
      elif bringup_alive "$holder"; then
        echo "$holder"
      elif stuck="$(bringup_survivors "$lock")"; then
        echo "survivors:$stuck"
      else
        echo "starting"
      fi
      return 1
    fi
  fi
  # Anything else at the path goes: a dead lock, one from another boot, or a stray file.
  if [ -e "$lock" ] || [ -L "$lock" ]; then
    rm -rf "$lock" 2>/dev/null || true
  fi
  mkdir "$lock" 2>/dev/null || return 2
  bringup_record "$lock" "$self" "$boot"
}
