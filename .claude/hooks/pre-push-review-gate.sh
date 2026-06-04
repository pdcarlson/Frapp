#!/bin/bash
# PreToolUse hook: gate `git push` on a local /code-review pass for the current branch
# HEAD, run in the same chat session. This is Frapp's SINGLE pre-PR review gate — it
# replaces the removed CI Claude review (ADR-14 reversal): review now happens locally,
# in-chat, right before the branch leaves the machine.
#
# Loop-safety contract: a PreToolUse hook cannot observe whether /code-review actually
# ran (it only sees Bash tool calls) and cannot invoke a skill itself. So it uses a
# deny-once-then-allow sentinel keyed on the branch HEAD SHA and scoped to the session
# via transcript_path. The FIRST push attempt for a given HEAD is DENIED with
# additionalContext telling Claude to run /code-review; the sentinel is written *after*
# the deny is emitted, so the NEXT push of the same HEAD proceeds. A new HEAD (e.g. after
# committing fixes) re-gates, so the review covers the code being pushed. Once a HEAD is
# gated, the hook steps aside silently (exit 0) and the normal permission flow applies —
# it does not force-approve the push.
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
fields="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
cmd = (d.get("tool_input", {}) or {}).get("command", "") or ""
tp = d.get("transcript_path", "") or ""
sys.stdout.write(cmd.replace("\t", " ").replace("\n", " ") + "\t" + tp)
' 2>/dev/null || printf '\t')"
command="${fields%%$'\t'*}"
transcript_path="${fields#*$'\t'}"

json_escape() {
  # Always yields valid JSON (a quoted string), even if python3 is unavailable.
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null \
    || printf '""'
}

# Gate only real `git push` invocations (word-boundary match so `git pushdeploy` /
# `git push-all` don't match). Anything else: stay silent (no JSON output = no-op).
push_re='(^|[^[:alnum:]_])git[[:space:]]+push([^[:alnum:]_-]|$)'
if ! [[ "$command" =~ $push_re ]]; then
  exit 0
fi
# A dry-run publishes nothing and must not consume the one-shot gate.
case "$command" in
  *--dry-run*) exit 0 ;;
esac

# ── Content key = branch HEAD SHA, so a new HEAD re-gates ────────────────────────────
head_sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo nohead)"

# ── Resolve a session-scoped sentinel directory ─────────────────────────────────────
if [ -n "$transcript_path" ]; then
  sentinel_dir="$(dirname "$transcript_path")/.frapp-push-gate"
else
  sentinel_dir="${TMPDIR:-/tmp}/frapp-push-gate-$(id -u)"
fi
sentinel_file="${sentinel_dir}/${head_sha}"

# ── Already gated this HEAD this session → step aside silently (normal flow applies) ─
if [ -f "$sentinel_file" ]; then
  exit 0
fi

# ── First attempt for this HEAD: DENY with guidance, then record that we've prompted ─
reason="Local review gate: run /code-review before pushing this branch."
context="This push was blocked by the local pre-push review gate (Frapp's single pre-PR review gate; the CI Claude review has been removed). Before pushing, run the built-in /code-review skill in THIS chat session on the current diff, then address its findings (fix them, or file a tracked follow-up with a reason). Its review sub-agents run on the current session model (Opus) — CLAUDE_CODE_SUBAGENT_MODEL is no longer pinned. After /code-review has run and findings are handled, re-issue the same git push command; it will proceed (the gate allows the next push of this HEAD). If you commit fixes after the review, the new HEAD re-gates so the review always covers what you push."

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s,"additionalContext":%s}}\n' \
  "$(json_escape "$reason")" \
  "$(json_escape "$context")"

# Written only after the deny is emitted, so a failed emit re-prompts rather than
# silently allowing an unreviewed push.
mkdir -p "$sentinel_dir" 2>/dev/null || true
: >"$sentinel_file" 2>/dev/null || true
exit 0
