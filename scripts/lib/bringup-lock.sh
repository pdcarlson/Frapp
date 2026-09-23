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
# bringup's lock, whose pid is dead. `cloud-sandbox-up.sh --stop` ends a hung one (bringup_stop).

# Whether $1 is the pid of a running cloud-sandbox-up.sh. Matches the script's name, not any
# command naming its log or sentinels: a `tail -f /tmp/cloud-sandbox-up.log` is not a bringup.
bringup_alive() {
  [ -n "$1" ] && kill -0 "$1" 2>/dev/null \
    && ps -p "$1" -o args= 2>/dev/null | grep -q 'cloud-sandbox-up\.sh'
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

# Whether lock $1 belongs to a bringup that is running or starting. Running: its pid is a
# live cloud-sandbox-up.sh. Starting: the lock is young and its pid is not written yet, or is
# a live process that has not exec'd the script yet; the taker writes the pid only after
# launching bringup, and for a moment the launched pid is still a fork of the taker. A
# recorded pid that is dead is neither, however young the lock: that bringup finished or was
# stopped, and its lock is replaced at once.
bringup_lock_live() {
  local pid
  pid="$(cat "$1/pid" 2>/dev/null || true)"
  bringup_alive "$pid" && return 0
  bringup_lock_young "$1" && { [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; }
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

# Stop the bringup holding lock $1, with every process under it, and remove the lock. Call
# under the guard flock.
#   0  stopped (its pid is printed) or none was running (nothing is printed); the lock is gone.
#   1  a bringup is starting (bringup_lock_live, but its pid is not yet a bringup to stop); the
#      lock is kept, since removing it would let a second bringup start beside that one.
# Killing only the script would orphan the command it is blocked in (a hung `supabase start`,
# say): bash runs no trap while it waits on a foreground child, and the next bringup would
# then start beside the orphan. The tree is read before anything is signalled, since children
# re-parent once their parent dies.
bringup_stop() {
  local lock="$1" pid tree p alive i
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  if bringup_alive "$pid"; then
    tree="$(bringup_descendants "$pid") $pid"
    # shellcheck disable=SC2086 # one pid per word
    kill -TERM $tree 2>/dev/null || true
    for i in 1 2 3 4 5 6 7 8 9 10; do
      alive=""
      for p in $tree; do kill -0 "$p" 2>/dev/null && alive=1; done
      [ -z "$alive" ] && break
      sleep 1
    done
    # shellcheck disable=SC2086
    [ -n "$alive" ] && kill -KILL $tree 2>/dev/null
    echo "$pid"
  elif [ -d "$lock" ] && bringup_lock_live "$lock"; then
    return 1
  fi
  rm -rf "$lock" 2>/dev/null || true
}

# Record the bringup holding lock $1: pid $2 and boot id $3 (skipped when empty). Each file is
# written aside and renamed in, so a concurrent reader never sees one created but empty.
bringup_record() {
  local lock="$1" pid="$2" boot="$3"
  { echo "$pid" >"$lock/pid.tmp" && mv -f "$lock/pid.tmp" "$lock/pid"; } 2>/dev/null || true
  if [ -n "$boot" ]; then
    { echo "$boot" >"$lock/boot_id.tmp" && mv -f "$lock/boot_id.tmp" "$lock/boot_id"; } 2>/dev/null || true
  fi
}

# Take lock $1 for a bringup started by hand, as pid $3 in boot $2. Call under the guard flock.
#   0  taken.
#   1  another bringup from this boot is running or starting; its pid, or "starting", is printed.
#   2  the lock could not be removed or created (its owner, or /tmp's permissions).
# A lock that another boot left behind is replaced whatever its pid says: after a restart that
# pid may belong to some unrelated process.
bringup_take_lock() {
  local lock="$1" boot="$2" self="$3" holder lock_boot
  if [ -d "$lock" ]; then
    holder="$(cat "$lock/pid" 2>/dev/null || true)"
    lock_boot="$(cat "$lock/boot_id" 2>/dev/null || true)"
    if [ "$holder" != "$self" ] && { [ -z "$lock_boot" ] || [ -z "$boot" ] || [ "$lock_boot" = "$boot" ]; } \
      && bringup_lock_live "$lock"; then
      if bringup_alive "$holder"; then echo "$holder"; else echo "starting"; fi
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
