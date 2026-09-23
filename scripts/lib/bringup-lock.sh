#!/usr/bin/env bash
# The cloud-sandbox bringup lock, shared by .claude/hooks/session-start.sh (which launches
# bringup in the background) and scripts/cloud-sandbox-up.sh (when someone runs it by hand).
# Sourced, never executed. Defines functions only.
#
# The lock is a directory, `/tmp/cloud-sandbox-up.lock` unless FRAPP_BRINGUP_LOCK says
# otherwise, holding `pid` (the running cloud-sandbox-up.sh) and `boot_id` (the kernel boot it
# ran in). Both writers take it under an flock on `<lock>.guard`, so a session start and a
# hand-run bringup cannot interleave their read-then-act steps (#2547).

# Whether $1 is the pid of a running cloud-sandbox-up.sh. Matches the script's name, not any
# command naming its log or sentinels: a `tail -f /tmp/cloud-sandbox-up.log` is not a bringup.
bringup_alive() {
  [ -n "$1" ] && kill -0 "$1" 2>/dev/null \
    && ps -p "$1" -o args= 2>/dev/null | grep -q 'cloud-sandbox-up\.sh'
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

# Take lock $1 for a bringup started by hand, as pid $3 in boot $2. Returns 1, taking
# nothing, when another bringup from this boot is running; prints its pid first. A lock
# whose bringup is dead, or that another boot left behind, is replaced. Call under the
# guard flock.
bringup_take_lock() {
  local lock="$1" boot="$2" self="$3" holder lock_boot
  if [ -d "$lock" ]; then
    holder="$(cat "$lock/pid" 2>/dev/null || true)"
    lock_boot="$(cat "$lock/boot_id" 2>/dev/null || true)"
    if [ "$holder" != "$self" ] && bringup_alive "$holder" \
      && { [ -z "$lock_boot" ] || [ -z "$boot" ] || [ "$lock_boot" = "$boot" ]; }; then
      echo "$holder"
      return 1
    fi
    rm -rf "$lock"
  fi
  mkdir "$lock" 2>/dev/null || return 1
  bringup_record "$lock" "$self" "$boot"
}
