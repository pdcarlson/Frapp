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

TMPDIR_PROBE="$(mktemp -d 2>/dev/null)" || exit 0
cleanup() { rm -rf "$TMPDIR_PROBE" 2>/dev/null || true; }
trap cleanup EXIT

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
  printf '%s|%s|%s|%s\n' "$key" "$status" "${code:-000}" "$exit_code" >"$TMPDIR_PROBE/$key"
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
  cs_log "WARN: python3 unavailable; skipping the egress capability manifest."
  exit 0
fi

export FRAPP_EGRESS_MANIFEST="$MANIFEST"

{
  printf '%s' "$PROBES" | sed '/^$/d'
  printf '\036'
  for f in "$TMPDIR_PROBE"/*; do [ -e "$f" ] && cat "$f"; done
} | python3 -c '
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
                "the Claude Code web environment -- see docs/internal/environment/"
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
' 2>/dev/null || {
  cs_log "WARN: could not write the egress capability manifest; continuing."
  exit 0
}

exit 0
