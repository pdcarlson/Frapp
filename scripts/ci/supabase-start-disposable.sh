#!/usr/bin/env bash
# Start the disposable Supabase stack a CI job applies migrations to (#2609).
#
# Two jobs start one: migration-drift-gate.yml's `migration-replay` (a required
# check on every PR that touches supabase/migrations/) and _deploy.yml's
# production rehearsal. Both call this script, so they start the same stack.
# The exclusion list is part of what a rehearsal rehearses, and a second copy of
# it would be a different rehearsal.
#
# Only what the migrations need a real server for. Studio, imgproxy, the edge
# runtime, the log pipeline and the pooler contribute nothing to an apply and
# cost image pulls on every run.
#
# ghcr.io rate-limits image pulls (`toomanyrequests`). Once the CLI's own pull
# retries run out, `start` fails: it failed `migration-replay` three runs in a
# row (#2609). So this retries, but only when that is the error `start` exits
# with, judged from the last lines of its output: the CLI also prints rate
# limits it recovered from, and grepping the whole log would retry unrelated
# failures. A clean stop runs between attempts. Whole images already pulled
# stay cached, so each attempt pulls only what the last one didn't finish. Any
# other failure fails at once.
#
# SUPABASE_START_RETRY_DELAY is the backoff unit in seconds (60 by default, so
# 60/120/180 s between the four attempts). Only the tests change it.

set -uo pipefail

attempts=4
unit="${SUPABASE_START_RETRY_DELAY:-60}"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

for attempt in $(seq 1 "$attempts"); do
  if supabase start -x studio,imgproxy,edge-runtime,logflare,vector,pooler,mailpit 2>&1 | tee "$log"; then
    exit 0
  fi
  # A herestring, not `tail | grep -q`: under pipefail, grep -q exiting on
  # its match can SIGPIPE a tail still writing and read as "no match"
  # (scripts/lib/cloud-sandbox-common.sh bans the pipe for the same reason).
  if ! grep -q 'toomanyrequests' <<<"$(tail -n 3 "$log")"; then
    echo "::error::supabase start failed (attempt ${attempt}/${attempts}), not on a registry rate limit; not retrying."
    exit 1
  fi
  if [ "$attempt" -eq "$attempts" ]; then
    echo "::error::ghcr.io still rate-limited image pulls after ${attempts} attempts; giving up."
    exit 1
  fi
  delay=$((attempt * unit))
  echo "::warning::ghcr.io rate-limited an image pull (attempt ${attempt}/${attempts}); retrying in ${delay}s."
  supabase stop --no-backup || true
  sleep "$delay"
done
