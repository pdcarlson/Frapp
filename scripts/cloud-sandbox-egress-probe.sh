#!/usr/bin/env bash
# Cloud sandbox EGRESS PROBE — answers "what can this session actually reach?" once, at
# bringup, so no session has to discover it by failing at it.
#
# Run automatically as the FIRST step of scripts/cloud-sandbox-up.sh — before any Docker or
# Supabase work, see the comment at its call site for why — and safe to run by hand at any
# time:
#
#     bash scripts/cloud-sandbox-egress-probe.sh
#
# Writes .cloud-sandbox-capabilities.json at the repo root (gitignored, like the bringup
# sentinels). It also prints the summary on stdout, which is for a human running it by hand:
# bringup discards it (`>/dev/null`) and .claude/hooks/session-start.sh re-derives its own
# summary from the JSON rather than reading this stdout. The manifest is the interface.
#
# NEVER FATAL, and never non-zero. Live egress is optional: a session doing purely local
# work must not be blocked, or even slowed, because staging is down or unlisted. Same
# posture as the image pre-pull in cloud-sandbox-setup.sh. Callers rely on this — the
# bringup invokes it *before* writing .cloud-sandbox-up.done and must still reach it.
#
# ── Why this does not use cs_classify_failure / cs_failure_hint ───────────────────────
# It looks like it should, and it must not. Those are tuned for *container registry*
# failures parsed out of a `supabase start` log: the classifier greps text for
# "not in allowlist", and the `policy` remedy says "Set Network = Full, or Custom +
# public.ecr.aws + *.cloudfront.net". Neither fits here. This probe gets a definitive
# signal from curl's own exit code rather than from prose, and — more importantly — the
# remedy for a blocked *staging* host is to add the staging lines, NOT to set Network =
# Full. Full is the one answer CLOUD_SANDBOX.md now explicitly rejects, because it grants
# production egress. Sharing the wording would hand the reader advice this repo has
# decided against. Only cs_log is shared.
#
# Docs: docs/internal/environment/CLOUD_SANDBOX.md § Live staging egress
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 0
# shellcheck source=scripts/lib/cloud-sandbox-common.sh
. "$ROOT/scripts/lib/cloud-sandbox-common.sh" 2>/dev/null || cs_log() { printf '[cloud-sandbox] %s\n' "$*" >&2; }

MANIFEST="$ROOT/.cloud-sandbox-capabilities.json"
TIMEOUT="${FRAPP_EGRESS_PROBE_TIMEOUT:-8}"

# ── The manifest always exists ────────────────────────────────────────────────────────
# Write a DEGRADED manifest when the probe cannot produce a real one. Every failure path
# below calls this before exiting, so a bringup that reached this script always leaves a
# readable file behind.
#
# Absence was the actual harm in #2205, not the syntax error. Four places -- AGENT_INFRA.md
# (twice), CLOUD_SANDBOX.md, and live-verification/SKILL.md -- tell agents to read this file
# INSTEAD of probing hosts by hand, and they frame its absence as impossible. A session that
# finds nothing therefore has no sanctioned reading for what it is looking at, and the
# likely move is the hand-rolled curl the file exists to prevent. Making the file
# unconditional is what turns that documented contract into a true one.
#
# What it must NOT do is look like a result. "Could not run" is a state this schema already
# has -- `ok: null`, and the "could not determine" summary the builder emits when every
# probe is inconclusive -- so a probe that failed reports in exactly the terms a host that
# could not be reached does. Empty `staging_reachable` here means UNKNOWN, never "blocked":
# the summary and the warning both say so, because a reader who mistakes one for the other
# is the "check that could not run, reported as a result" error the whole manifest exists
# to stop (same rule as .claude/skills/live-verification/SKILL.md § Preflight).
#
# Hand-rolled rather than built in python3, because every caller is a path where python3 is
# missing or has just failed. That is only safe because NOTHING here is interpolated from
# the network, from curl, or from the environment: $1 is one of the fixed literal strings at
# the call sites below. Never pass a traceback, a hostname, or a probe result through it --
# that is exactly the "stray quote silently producing invalid JSON" the builder exists to
# avoid, and this function has no JSON encoder to protect it.
write_unknown_manifest() {
  local reason="$1" now=""
  # printf is a bash BUILTIN and `%(...)T` is its builtin clock; `cat` and `date` are not.
  # That matters because this function's whole job is to work on the paths where the
  # environment is already degraded -- one caller above is `mktemp` failing, and a PATH
  # broken enough to lose mktemp has lost coreutils with it. Depending on an external binary
  # here would mean the fallback fails in precisely the cases it exists for (it did, on the
  # first pass at this). An empty timestamp is survivable; an unwritten manifest is not.
  #
  # TZ=UTC is not decoration: `%(...)T` formats in LOCAL time, so without it the trailing
  # `Z` would be a lie on any host that is not already UTC. The builder above gets this for
  # free from datetime.timezone.utc.
  TZ=UTC printf -v now '%(%Y-%m-%dT%H:%M:%SZ)T' -1 2>/dev/null || now=""

  # One printf per line rather than one big quoted blob: the JSON here is full of double
  # quotes, and a single interpolated string would need every one of them backslashed --
  # which is its own quoting hazard, in a file that already lost four days to one.
  #
  # `summary` names the cause, the warning gives the reading. They deliberately do not
  # restate each other: session-start.sh prints the summary and then every warning, and its
  # own contract is to stay terse enough that the manifest saves more tokens than it costs.
  {
    printf '{\n'
    printf '  "generated_at": "%s",\n' "$now"
    printf '  "probe_ok": false,\n'
    printf '  "summary": "EGRESS: capability UNKNOWN -- the probe could not run (%s); nothing was verified.",\n' "$reason"
    printf '  "staging_reachable": [],\n'
    printf '  "production_blocked_as_expected": [],\n'
    printf '  "warnings": [\n'
    printf '    "Treat every host as UNKNOWN. This is NOT evidence that staging is blocked, NOT evidence that production is unreachable, and the production-is-unreachable assertion did NOT run. Re-run with: bash scripts/cloud-sandbox-egress-probe.sh"\n'
    printf '  ],\n'
    printf '  "hosts": [],\n'
    printf '  "docs": "docs/internal/environment/CLOUD_SANDBOX.md#live-staging-egress",\n'
    printf '  "skill": ".claude/skills/live-verification/SKILL.md"\n'
    printf '}\n'
  } >"$MANIFEST" 2>/dev/null ||
    cs_log "WARN: could not write $MANIFEST (is the path writable?); no capability manifest this session."
}

# ── What we probe ────────────────────────────────────────────────────────────────────
# Format: <key>|<url>|<expectation>|<label>
#   expectation `reachable` — a staging surface the allowlist is supposed to permit
#   expectation `blocked`   — a PRODUCTION host, asserted NEGATIVELY. Prod is never
#                             allowlisted; if one of these answers, the allowlist has
#                             regressed to a wildcard and that is a finding, not a bonus.
#
# The Supabase refs are opaque and neither says which project it is — that is exactly the
# trap that put prod on the allowlist once already. Source of truth is
# `mcp__Supabase__list_projects`: frapp-staging = hnoyzpidbmizhbqaiity,
# frapp-prod = unttyvyfezddlyafcydh. Project URLs are not secret material (see
# docs/internal/ci-cd/AGENT_INFRA.md, "a project URL is not secret material" — SECRET_SCANNING.md
# states no such rule); the anon/service keys are, and are not here.
PROBES="
staging_api|https://api-staging.frapp.live/health|reachable|staging API (Render)
staging_web|https://app.staging.frapp.live|reachable|staging web dashboard
staging_landing|https://staging.frapp.live|reachable|staging landing site
staging_supabase|https://hnoyzpidbmizhbqaiity.supabase.co|reachable|frapp-staging Supabase
prod_api|https://api.frapp.live/health|blocked|PRODUCTION API
prod_web|https://app.frapp.live|blocked|PRODUCTION web
prod_supabase|https://unttyvyfezddlyafcydh.supabase.co|blocked|PRODUCTION Supabase
"

TMPDIR_PROBE="$(mktemp -d 2>/dev/null)" || {
  write_unknown_manifest "no writable temporary directory"
  exit 0
}
cleanup() { rm -rf "$TMPDIR_PROBE" 2>/dev/null || true; }
trap cleanup EXIT

# Probe results get their own subdirectory because the fold below collects them with a
# glob, and the manifest builder is written as a file into $TMPDIR_PROBE itself. Keeping
# the two apart is what stops the builder's own source being globbed back in as if it
# were a probe result.
RESULTS_DIR="$TMPDIR_PROBE/results"
mkdir -p "$RESULTS_DIR" || {
  write_unknown_manifest "no writable temporary directory"
  exit 0
}

# One probe. Writes "<key>|<status>|<http_code>|<curl_exit>" to its own file so the
# parallel fan-out below never interleaves partial lines into a shared one.
probe_one() {
  local key="$1" url="$2" code exit_code status
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$url" 2>/dev/null)"
  exit_code=$?

  # Any HTTP response at all means the connection was permitted — including 4xx/5xx.
  # A staging Supabase root legitimately answers 404, and app hosts answer 302; treating
  # those as failures would report the environment as broken when it is working.
  if [ "$exit_code" -eq 0 ] && [ -n "$code" ] && [ "$code" != "000" ]; then
    status="reachable"
  elif [ "$exit_code" -eq 56 ] || [ "$exit_code" -eq 35 ] || [ "$exit_code" -eq 7 ]; then
    # 56 is what a proxy CONNECT rejection surfaces as ("CONNECT tunnel failed,
    # response 403"). Grouped with the other connect-layer refusals rather than
    # matched alone, because the exact code varies with how the proxy tears down.
    status="blocked"
  elif [ "$exit_code" -eq 6 ]; then
    status="no_dns"
  elif [ "$exit_code" -eq 28 ]; then
    status="timeout"
  else
    status="unknown"
  fi
  printf '%s|%s|%s|%s\n' "$key" "$status" "${code:-000}" "$exit_code" >"$RESULTS_DIR/$key"
}

# Fan out. Seven short-timeout requests serially would add up to ~1 minute in the worst
# case, on the critical path of every session start; in parallel the whole probe costs
# roughly one timeout.
while IFS='|' read -r key url _expect _label; do
  [ -n "$key" ] || continue
  probe_one "$key" "$url" &
done <<<"$(printf '%s' "$PROBES" | sed '/^$/d')"
wait

# ── Fold results into the manifest ───────────────────────────────────────────────────
# Built in python3 rather than by hand: this file is read by a hook and by agents, so a
# stray quote in a label silently producing invalid JSON would break the thing that is
# supposed to be more reliable than guessing. python3 is already a hard dependency of
# .claude/hooks/session-start.sh.
if ! command -v python3 >/dev/null 2>&1; then
  cs_log "WARN: python3 unavailable; writing an UNKNOWN egress capability manifest."
  write_unknown_manifest "python3 unavailable"
  exit 0
fi

export FRAPP_EGRESS_MANIFEST="$MANIFEST"

# The builder is written to a file and run as `python3 "$BUILDER"` rather than inlined as
# `python3 -c '...'`. That is not a style preference. In the inline form the whole Python
# body was a single-quoted bash word, so when #2110 rewrote one warning string to read
# `this session's environment dashboard`, the apostrophe closed the quote and bash parsed
# the remainder of the file as shell. The script was unparseable for four days (#2205) and
# no session got a manifest.
#
# Note what that failure defeated: the guard on this command used to be
# `... || { cs_log "WARN: ..."; }`, and it never fired once. A parse error kills the file
# before any of its commands run, so a guard written INSIDE the construct it guards cannot
# report the construct failing to parse. A quoted heredoc is the structural fix — bash does
# no expansion or quote-tracking inside it, so no prose edit to the Python below can break
# the shell again, and the guard is left to catch only what it can actually catch: a
# builder that ran and failed.
#
# The probe data still arrives on stdin (unchanged), which is why the program lives in a
# file rather than being fed to python3 by a bare heredoc — both cannot use stdin.
BUILDER="$TMPDIR_PROBE/build-manifest.py"
cat >"$BUILDER" <<'PY'
import json, sys, os, datetime

raw = sys.stdin.read()
spec_block, _, result_block = raw.partition("\036")

spec = {}
order = []
for line in spec_block.strip().splitlines():
    parts = line.split("|")
    if len(parts) != 4:
        continue
    key, url, expect, label = parts
    spec[key] = {"url": url, "expect": expect, "label": label}
    order.append(key)

results = {}
for line in result_block.strip().splitlines():
    parts = line.split("|")
    if len(parts) != 4:
        continue
    results[parts[0]] = {"status": parts[1], "http_code": parts[2], "curl_exit": parts[3]}

hosts, warnings = [], []
reachable, blocked_ok = [], []

for key in order:
    s = spec[key]
    r = results.get(key, {"status": "unknown", "http_code": "000", "curl_exit": ""})
    entry = {
        "key": key, "label": s["label"], "url": s["url"],
        "expected": s["expect"], "status": r["status"], "http_code": r["http_code"],
    }
    # "as expected" is deliberately not `status == expect`: a probe that could not run
    # (timeout, no_dns, unknown) is neither a pass nor a fail, and must never be folded
    # into the pass count. Same rule the live-verification skill states for checks
    # generally -- a check that could not run is blocked, never passed.
    if r["status"] == s["expect"]:
        entry["ok"] = True
        (reachable if s["expect"] == "reachable" else blocked_ok).append(s["label"])
    elif r["status"] in ("timeout", "no_dns", "unknown"):
        entry["ok"] = None
        warnings.append("%s: probe inconclusive (%s) -- treat as unknown, not as pass or fail" % (s["label"], r["status"]))
    else:
        entry["ok"] = False
        if s["expect"] == "blocked":
            # The loud one. A prod host answering means the allowlist widened.
            warnings.append(
                "SECURITY: %s is REACHABLE (HTTP %s) and must not be. The allowlist has "
                "likely regressed to a wildcard (*.frapp.live or *.supabase.co). Fix it in "
                "this session's environment dashboard (Cursor Cloud or Claude Code web) -- see docs/internal/environment/"
                "CLOUD_SANDBOX.md § Enumerate, do not wildcard." % (s["label"], r["http_code"])
            )
        else:
            warnings.append(
                "%s is NOT reachable. If this session needs deployed staging, add the "
                "staging lines to the environment Allowed domains (NOT Network = Full, "
                "which grants prod) -- docs/internal/environment/CLOUD_SANDBOX.md "
                "§ Live staging egress. Applies to NEW sessions only." % s["label"]
            )
    hosts.append(entry)

staging_total = sum(1 for k in order if spec[k]["expect"] == "reachable")
has_security = any(w.startswith("SECURITY:") for w in warnings)
inconclusive = sum(1 for h in hosts if h["ok"] is None)

# Three distinct outcomes, never collapsed into two. An inconclusive probe (timeout, DNS
# failure, proxy hiccup) is NOT evidence that a host is unreachable -- saying "NOT
# reachable" there would send a session to work around a block that may not exist, which
# is the same could-not-run-reported-as-a-result error this manifest exists to prevent.
if has_security:
    summary = "EGRESS: production is reachable -- allowlist regression, see warnings"
elif len(reachable) == staging_total:
    summary = "EGRESS: deployed staging reachable (api/web/landing/supabase); production correctly blocked"
elif reachable:
    summary = "EGRESS: staging partially reachable (%d of %d); production correctly blocked" % (len(reachable), staging_total)
elif inconclusive:
    summary = "EGRESS: could not determine -- every probe was inconclusive (network or proxy issue), NOT proof that staging is blocked"
else:
    summary = "EGRESS: deployed staging NOT reachable -- local stack only"

manifest = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    # The one key a consumer can branch on without reading prose. False means the probe
    # could not run at all and every other field is empty -- see write_unknown_manifest in
    # the shell above, which is what produces that case. It never means "staging is blocked".
    "probe_ok": True,
    "summary": summary,
    "staging_reachable": reachable,
    "production_blocked_as_expected": blocked_ok,
    "warnings": warnings,
    "hosts": hosts,
    "docs": "docs/internal/environment/CLOUD_SANDBOX.md#live-staging-egress",
    "skill": ".claude/skills/live-verification/SKILL.md",
}

out = os.environ["FRAPP_EGRESS_MANIFEST"]
with open(out, "w") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")

print(summary)
for w in manifest["warnings"]:
    print("  " + w)
PY

# stderr is CAPTURED and logged, not discarded. The old form ended `2>/dev/null || {
# cs_log "WARN: could not write the egress capability manifest"; }`, which would have
# flattened every distinguishable failure — a traceback, an unwritable manifest path, a
# malformed fold line — into one WARN that names no cause. Now that the parse error is
# fixed and that guard can finally fire, it must say what it caught: a manifest that is
# silently not there is the precise failure mode this probe exists to prevent, and it is
# how #2205 stayed invisible.
if {
  printf '%s' "$PROBES" | sed '/^$/d'
  printf '\036'
  for f in "$RESULTS_DIR"/*; do [ -e "$f" ] && cat "$f"; done
} | python3 "$BUILDER" 2>"$TMPDIR_PROBE/builder.err"; then
  exit 0
fi

cs_log "WARN: the egress capability manifest builder failed; recording capability as UNKNOWN."
# Guarded on readability: this branch is also reached when the pipeline failed because the
# redirect itself could not be created (temp dir pulled out from under us), and an
# unguarded `done < missing-file` would add a bare bash error to a log that is already
# reporting a failure.
if [ -r "$TMPDIR_PROBE/builder.err" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && cs_log "WARN:   $line"
  done <"$TMPDIR_PROBE/builder.err"
fi

# The builder may have failed midway through json.dump and left a truncated file. Overwrite
# it: a half-written manifest is worse than an honest UNKNOWN one, because the hook's reader
# swallows a JSONDecodeError and says nothing at all.
write_unknown_manifest "manifest builder failed"

exit 0
