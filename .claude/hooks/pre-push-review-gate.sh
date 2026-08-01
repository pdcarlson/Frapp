#!/bin/bash
# PreToolUse hook: gate `git push` on a local /diff-review pass for the current branch
# HEAD, run in the same chat session. This is Frapp's SINGLE pre-PR review gate — it
# replaces the removed CI Claude review (ADR-14 reversal): review now happens locally,
# in-chat, right before the branch leaves the machine.
#
# Which skill: /diff-review (.claude/skills/diff-review/SKILL.md) is the one an AGENT can
# ALWAYS run. The bundled /code-review is richer and should be preferred WHEN AVAILABLE,
# but it is only conditionally model-invocable: its disableModelInvocation flag is waived
# only when the current turn contains a non-meta user message carrying the bare token
# "/code-review". Absent that — and in every sub-agent — the Skill tool refuses it. A hook
# cannot supply the token either (hook additionalContext renders as isMeta, which the
# scan skips). Full rule: docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md.
#
# Enforcement contract: the gate keys on EVIDENCE, not attempts. /diff-review writes
# .cache/diff-review/<HEAD_SHA> (gitignored) when it finishes reporting and acting on
# findings; this hook allows the push only when that marker exists for the current HEAD.
# Retrying a denied push does NOT satisfy it.
#
# This replaced a deny-once-then-allow sentinel, which guaranteed nothing once the review
# became agent-invocable: two consecutive pushes cleared it with no review in between.
# That was survivable only while the required skill was human-only, because the human
# keystroke was the real enforcement.
#
# Livelock guard: a hook must never wedge a session permanently, so after 4 blocked
# attempts for the same HEAD the push is allowed through with a loud stderr warning that
# the diff is UNREVIEWED. FRAPP_SKIP_REVIEW_GATE=1 is the documented deliberate bypass
# (also the path after a human runs /code-review, which does not write the marker).
#
# A new HEAD (e.g. after committing fixes) invalidates the marker, so the review always
# covers the code being pushed. When the marker is present the hook steps aside silently
# (exit 0) and the normal permission flow applies — it does not force-approve the push.
#
# The `git push` match is a word-boundary heuristic (a free-form shell command can only be
# matched heuristically): it skips `git pushdeploy` and `--dry-run`, but an exotic command
# that merely quotes "git push" may still trip it once. That's acceptable for a local
# convenience gate — the worst case is one extra review prompt.
#
# This is a Claude Code tool-level hook and is INDEPENDENT of git's own hooks: it does
# not run git mutations, does not touch `--no-verify`, and does not interfere with the
# git-level .githooks/pre-commit gitleaks scan.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"

# ── Read the hook payload from stdin and extract command + transcript_path in a single
#    JSON parse (newlines in the command are flattened to spaces for matching). ─────────
payload="$(cat)"

json_escape() {
  # Always yields valid JSON (a quoted string), even if python3 is unavailable.
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null \
    || printf '""'
}

# Parse must FAIL CLOSED. This previously ended in `|| printf '\t'`, so an unparseable payload
# — or simply a machine without python3 — yielded an empty command, matched no push, and exited
# 0. That silently disabled the only pre-PR review gate for the entire session, with no
# diagnostic: the one failure mode a gate must not have. `sys.exit(1)` on a bad parse, and a
# missing interpreter exits 127, so both land in the branch below.
if ! fields="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
cmd = (d.get("tool_input", {}) or {}).get("command", "") or ""
tp = d.get("transcript_path", "") or ""
sys.stdout.write(cmd.replace("\t", " ").replace("\r", "\n").replace("\n", ";") + "\t" + tp)
' 2>/dev/null)"; then
  # Deny only when the raw payload plausibly concerns a push — otherwise an unparseable payload
  # would block every unrelated Bash call and wedge the session. The reason string is a literal
  # because json_escape itself needs python3, which is exactly what may be missing here.
  if [ -n "${FRAPP_SKIP_REVIEW_GATE:-}" ] || ! printf '%s' "$payload" | grep -q 'push'; then
    exit 0
  fi
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Review gate: the hook payload could not be parsed (is python3 available?), so this push cannot be verified as reviewed. The gate fails closed rather than letting an unreviewed push through. Fix the interpreter, or set FRAPP_SKIP_REVIEW_GATE=1 to override."}}'
  exit 0
fi
command="${fields%%$'\t'*}"
transcript_path="${fields#*$'\t'}"

# Gate only real `git push` invocations. Three things matter here:
#   1. `git` must be in COMMAND POSITION — start of the string, or right after a shell
#      separator. Matching a bare word boundary meant any command merely *mentioning* the
#      phrase (`grep "git push" f`, `bash test.sh` echoing it) was gated. That was tolerable
#      when the gate burned a one-shot sentinel; now that a denial is a hard block, a false
#      positive stops unrelated read-only work.
#   2. Only git's own GLOBAL OPTIONS may sit between `git` and the subcommand — `-C <dir>`
#      above all, the idiom this very hook uses at the rev-parse below. An earlier version
#      allowed arbitrary text here, which matched any git command containing a later
#      `push` token: `git commit -m "wire up push notifications"` was blocked, and every
#      such false positive burned the livelock budget until a real unreviewed push was
#      auto-allowed. Options only, so a subcommand that isn't `push` can never match.
#   3. Word boundary after `push`, so `git pushdeploy` / `git push-all` don't match.
# Newlines were normalised to ";" above, so multi-line commands are separated, not merged.
# Tradeoff: an env-prefixed invocation (`env FOO=1 git push`) is not matched. Accepted —
# a missed push costs one unreviewed branch; over-matching burns the budget and then
# auto-allows a real one, which is strictly worse.
push_re='(^|[;&|(){}][[:space:]]*)[[:space:]]*git([[:space:]]+-[^[:space:];&|]*([[:space:]]+[^-][^[:space:];&|]*)?)*[[:space:]]+push([^[:alnum:]_-]|$)'
if ! [[ "$command" =~ $push_re ]]; then
  exit 0
fi
# A dry-run publishes nothing and must not consume the gate — but only exempt a command
# that is *just* a dry run. An unanchored substring match previously let a compound
# command (`git push --dry-run … && git push …`) exempt its real push too, and that path
# exits without recording anything, so the real push went completely ungated.
# Any shell operator means we cannot reason about what else runs: gate it.
case "$command" in
  *'&&'* | *';'* | *'|'*) : ;;      # compound — never exempt
  *--dry-run*) exit 0 ;;
esac

# ── Content key = branch HEAD SHA, so a new HEAD re-gates ────────────────────────────
# No `|| echo nohead` fallback: a constant key would collapse every branch and commit onto
# one marker that no new commit ever invalidates — a permanent, gitignored, repo-wide
# bypass. If HEAD is unknowable we cannot key evidence to anything, so fail CLOSED and say
# why. FRAPP_SKIP_REVIEW_GATE remains the escape.
if ! head_sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" || [ -z "$head_sha" ]; then
  if [ -n "${FRAPP_SKIP_REVIEW_GATE:-}" ]; then
    exit 0
  fi
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "$(json_escape "Review gate: cannot resolve HEAD in $ROOT, so the review marker cannot be checked. Set FRAPP_SKIP_REVIEW_GATE=1 to override.")"
  exit 0
fi

# ── Evidence that a review actually ran: /diff-review writes this on completion ──────
# Keyed on HEAD, so committing fixes invalidates it and the new HEAD must be reviewed.
review_marker="$ROOT/.cache/diff-review/${head_sha}"
if [ -f "$review_marker" ]; then
  exit 0
fi

# ── Emergency bypass (documented in AI_CODE_REVIEW_RUNBOOK.md) ───────────────────────
if [ -n "${FRAPP_SKIP_REVIEW_GATE:-}" ]; then
  exit 0
fi

# ── Resolve a session-scoped attempt counter ────────────────────────────────────────
if [ -n "$transcript_path" ]; then
  sentinel_dir="$(dirname "$transcript_path")/.frapp-push-gate"
else
  sentinel_dir="${TMPDIR:-/tmp}/frapp-push-gate-$(id -u)"
fi
sentinel_file="${sentinel_dir}/${head_sha}"

# Livelock guard. The gate wants real evidence of review, but a hook must never wedge a
# session permanently: if the review genuinely cannot run (skill missing, tooling broken),
# the Nth attempt is allowed through with a loud warning rather than denying forever.
# Deliberately higher than 2 so a reflexive immediate retry — the old behaviour, which
# satisfied this gate with zero review — no longer gets through.
attempts=0
[ -f "$sentinel_file" ] && attempts="$(cat "$sentinel_file" 2>/dev/null || echo 0)"
case "$attempts" in ''|*[!0-9]*) attempts=0 ;; esac
if [ "$attempts" -ge 4 ]; then
  printf 'pre-push-review-gate: WARNING — allowing push of %s after %s blocked attempts with no /diff-review marker. This diff is UNREVIEWED.\n' \
    "$head_sha" "$attempts" >&2
  exit 0
fi
# If the counter cannot be persisted the livelock guard can never fire, which turns this
# gate into a permanent wedge. Fall back to a temp dir; if even that fails, allow through
# with a warning rather than blocking forever — a stuck session is worse than one logged
# unreviewed push, and FRAPP_SKIP_REVIEW_GATE is not discoverable mid-block.
if ! { mkdir -p "$sentinel_dir" 2>/dev/null \
  && printf '%s' "$((attempts + 1))" >"$sentinel_file" 2>/dev/null; }; then
  sentinel_dir="${TMPDIR:-/tmp}/frapp-push-gate-$(id -u)"
  sentinel_file="${sentinel_dir}/${head_sha}"
  if ! { mkdir -p "$sentinel_dir" 2>/dev/null \
    && printf '%s' "$((attempts + 1))" >"$sentinel_file" 2>/dev/null; }; then
    printf 'pre-push-review-gate: WARNING — cannot persist the attempt counter, so the livelock guard is inoperative. Allowing push of %s. This diff is UNREVIEWED.\n' \
      "$head_sha" >&2
    exit 0
  fi
fi

# ── No review evidence for this HEAD: DENY with guidance ────────────────────────────
reason="Local review gate: run /diff-review before pushing this branch."
context="This push was blocked by the local pre-push review gate (Frapp's single pre-PR review gate; the CI Claude review has been removed). Run a review in THIS chat session, then address its findings (fix them, or file a tracked follow-up with a reason). PREFER the bundled /code-review: try Skill(skill: \"code-review\") FIRST — it is richer (per-model-tuned effort, and a workflow-backed verifier pass at high/xhigh/max). It succeeds whenever this turn's prompt happens to contain the bare token /code-review; if it is refused with 'disable-model-invocation', that condition simply is not met — that is expected, not an error, and NOT a reason to stop and wait for a human. Fall back immediately to the project's own /diff-review skill, which an agent can always invoke. NOTE: /code-review does NOT write the marker below, so after using it set FRAPP_SKIP_REVIEW_GATE=1 on the push or write the marker by hand; /diff-review writes it automatically. Review sub-agents run on the current session model. RETRYING THIS PUSH WILL NOT SATISFY THE GATE: it is keyed on evidence, not attempts — the marker is .cache/diff-review/<HEAD_SHA>, and only that (or FRAPP_SKIP_REVIEW_GATE=1) allows the push. Committing fixes changes HEAD and invalidates the marker by design, so the review always covers exactly what you push."

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s,"additionalContext":%s}}\n' \
  "$(json_escape "$reason")" \
  "$(json_escape "$context")"
exit 0
