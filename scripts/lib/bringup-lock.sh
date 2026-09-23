#!/usr/bin/env bash
# The cloud-sandbox bringup lock, shared by .claude/hooks/session-start.sh (which launches
# bringup in the background) and scripts/cloud-sandbox-up.sh (when someone runs it by hand).
# Sourced, never executed. Defines functions only.
#
# The lock is a directory, `/tmp/cloud-sandbox-up.lock` unless FRAPP_BRINGUP_LOCK says
# otherwise, holding `pid` (the running cloud-sandbox-up.sh) and `boot_id` (the kernel boot it
# ran in). Both writers take it under an flock on `<lock>.guard` and judge it by the same rule,
# bringup_lock_live, so a session start and a hand-run bringup cannot interleave their
# read-then-act steps or disagree about whether a bringup is running (#2547).

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

# Whether lock $1 was taken under 30 seconds ago. Its taker writes the pid only after
# launching bringup, and for a moment after that the pid is a fork that has not exec'd
# cloud-sandbox-up.sh yet, so a lock that young counts as a bringup starting. A negative age
# (a clock stepped back) does not count. A bringup that really died that young is reclaimed
# on the next attempt.
bringup_lock_young() {
  local age
  age="$(bringup_lock_age "$1")"
  [ -n "$age" ] && [ "$age" -ge 0 ] && [ "$age" -lt 30 ]
}

# Whether lock $1 belongs to a bringup that is running or starting: its pid is a live
# cloud-sandbox-up.sh, or it is young enough that the pid may not be one yet.
bringup_lock_live() {
  bringup_alive "$(cat "$1/pid" 2>/dev/null || true)" || bringup_lock_young "$1"
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
    rm -rf "$lock" 2>/dev/null || true
  fi
  mkdir "$lock" 2>/dev/null || return 2
  bringup_record "$lock" "$self" "$boot"
}
