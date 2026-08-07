#!/bin/bash
# PreToolUse hook: gate `git push` on a local /diff-review pass for the current branch
# HEAD, run in the same chat session. This is Frapp's SINGLE pre-PR review gate — it
# replaces the removed CI Claude review (ADR-14 reversal): review now happens locally,
# in-chat, right before the branch leaves the machine.
#
# Which skill: /diff-review (.claude/skills/diff-review/SKILL.md) is the one an AGENT can
# ALWAYS run. The bundled /code-review is richer and should be preferred WHEN AVAILABLE,
# but it is only conditionally model-invocable: its disableModelInvocation flag is waived
# only when the current turn contains a non-meta user message carrying the token
# "/code-review" WHITESPACE-DELIMITED ON BOTH SIDES (regex `(?<!\S)/code-review(?=$|\s)`).
# That is stricter than "mentioned in prose": backticks, quotes, **bold**, and a trailing
# "." or "," all defeat it, and backticking commands is this repo's house style — so in
# practice the waiver almost never holds. Absent it — and in every sub-agent — the Skill
# tool refuses. A hook cannot supply the token either (hook additionalContext renders as
# isMeta, which the scan skips). Full rule: docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md.
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

# ── Read the hook payload from stdin and extract command + transcript_path + cwd in a
#    single JSON parse (newlines in the command are flattened to spaces for matching).
#    The gate root is resolved AFTER parsing, from the payload's cwd — see below. ───────
payload="$(cat)"

json_escape() {
  # Always yields valid JSON (a quoted string), even with no interpreter available.
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null \
    && return 0
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)+"\n"))' 2>/dev/null \
    && return 0
  printf '""'
}

# Parse must FAIL CLOSED. This previously ended in `|| printf '\t'`, so an unparseable payload —
# or simply a machine without python3 — yielded an empty command, matched no push, and exited 0.
# That silently disabled the only pre-PR review gate for the entire session with no diagnostic:
# the one failure mode a gate must not have.
#
# Two interpreters are tried before giving up. node is the meaningful one: this is a Node
# monorepo, so a machine that can run the project can parse the payload. Falling back to the
# blunt heuristic below therefore takes BOTH interpreters being absent, which is close to
# hypothetical — worth handling, not worth optimising.
parse_payload() {
  printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
cmd = (d.get("tool_input", {}) or {}).get("command", "") or ""
tp = d.get("transcript_path", "") or ""
cwd = d.get("cwd", "") or ""
sys.stdout.write(cmd.replace("\t", " ").replace("\r", "\n").replace("\n", ";") + "\t" + tp + "\t" + cwd)
' 2>/dev/null && return 0
  printf '%s' "$payload" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let d;
  try { d = JSON.parse(s); } catch { process.exit(1); }
  const cmd = ((d.tool_input || {}).command || "");
  const tp = d.transcript_path || "";
  const cwd = d.cwd || "";
  process.stdout.write(cmd.replace(/\t/g, " ").replace(/\r/g, "\n").replace(/\n/g, ";") + "\t" + tp + "\t" + cwd);
});
' 2>/dev/null && return 0
  return 1
}

parse_failed=0
if fields="$(parse_payload)"; then
  command="${fields%%$'\t'*}"
  rest="${fields#*$'\t'}"
  transcript_path="${rest%%$'\t'*}"
  command_cwd="${rest#*$'\t'}"
else
  # No interpreter and/or a malformed payload. Deny, but ONLY for payloads that plausibly
  # concern a push, and — critically — fall through into the normal marker / bypass / livelock
  # machinery below rather than exiting here. An earlier revision of this branch returned
  # immediately, which meant a machine without python3 denied every push forever with no
  # working escape: a permanent session wedge, which this hook's contract forbids outright.
  # Only grep exit status 1 means a clean "no match". `! grep -q` would also swallow status 2
  # (I/O or regex error) and 127 (grep absent), silently allowing a real push in exactly the
  # broken-tooling environment this branch exists to handle — the same fail-open shape as the
  # bug above. Treat anything that is not a definite no-match as a reason to gate.
  #
  # The pattern is deliberately the bare word, not something shaped like `git…push`: this is a
  # RAW JSON payload, so the command's own quotes are present as `"` bytes and any character
  # class excluding them refuses to cross `git -C "$HOME/repo" push` — which released real
  # pushes completely ungated, precisely inverting this branch's purpose. Over-matching here is
  # cheap (a false deny self-heals via the livelock guard below); under-matching is not.
  set +e
  printf '%s' "$payload" | grep -q 'push'
  grep_rc=$?
  set -e
  if [ "$grep_rc" -eq 1 ]; then
    exit 0
  fi
  parse_failed=1
  command="git push"   # synthetic: routes this payload down the push path below
  transcript_path=""
  command_cwd=""
fi

# ── Resolve the gate root from the repo the push actually targets ──────────────────────
# CLAUDE_PROJECT_DIR stays pinned to the original project directory even when the push
# runs inside a git worktree (EnterWorktree makes that reachable). Keying HEAD and the
# marker off it there meant a genuinely completed /diff-review never satisfied the gate:
# the hook read the MAIN worktree's HEAD while the skill wrote the marker at the pushing
# worktree's root, so every push was denied until the livelock guard released it labelled
# UNREVIEWED — silent non-enforcement, the opposite of this gate's contract (FRA-319).
# Precedence, highest wins, each falling through when it doesn't resolve to a repo:
#   1. The `git -C <dir> push` target — the repo being pushed regardless of cwd. Without
#      this, a stale marker in the cwd's repo would ALLOW an unreviewed `-C` push of a
#      different worktree (fail-open), and a reviewed `-C` push would be denied.
#   2. The payload's cwd — the plain `git push` case, worktree or main checkout alike.
#   3. CLAUDE_PROJECT_DIR, then the hook's own toplevel — the pre-cwd behavior, kept for
#      parse failures and older harnesses.
# Known limit, same direction as push_re's documented tradeoffs: a quoted `-C` path with
# spaces and a `cd <dir> && git push` compound both key to the payload cwd (documented in
# AI_CODE_REVIEW_RUNBOOK.md).
# The -C extraction requires `push` after the dir WITHIN the same shell statement, so
# `git -C /a fetch; git push` never borrows /a for the second statement's push.
cdir_re='git[[:space:]]+(-[^[:space:];&|]*[[:space:]]+([^-;&|][^[:space:];&|]*[[:space:]]+)?)*-C[[:space:]]+([^[:space:];&|]+)[[:space:]]+([^;&|]*[[:space:]])?push([^[:alnum:]_-]|$)'
push_c_dir=""
if [[ "$command" =~ $cdir_re ]]; then
  push_c_dir="${BASH_REMATCH[3]}"
fi
ROOT=""
if [ -n "$push_c_dir" ]; then
  ROOT="$(git -C "$push_c_dir" rev-parse --show-toplevel 2>/dev/null || true)"
fi
if [ -z "$ROOT" ] && [ -n "${command_cwd:-}" ]; then
  ROOT="$(git -C "$command_cwd" rev-parse --show-toplevel 2>/dev/null || true)"
fi
if [ -z "$ROOT" ]; then
  ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"
fi

# The deliberate bypass may arrive two ways, and both must work. The hook's own environment
# carries it when the session exports it; but an agent told to "set FRAPP_SKIP_REVIEW_GATE=1 on
# the push" naturally writes it as a command prefix, which the hook does NOT inherit — it only
# ever sees the command text. Checking both is what makes the documented escape actually work.
# Previously only the env form was read, and `FRAPP_SKIP_REVIEW_GATE=1 git push` appeared to
# work solely because push_re declines to match an env-prefixed command — the sanctioned bypass
# depending on a documented matcher gap, while `export FRAPP_SKIP_REVIEW_GATE=1 && git push`
# was denied.
# The assignment must be in COMMAND POSITION (start of string, or after a shell separator),
# optionally behind `export`. A bare substring test was strictly worse than the bug it replaced:
# this repo documents the flag by name in CONTRIBUTING.md and the runbook, so
#   git commit -m "docs: explain FRAPP_SKIP_REVIEW_GATE=1 escape hatch" && git push
#   grep -rn FRAPP_SKIP_REVIEW_GATE=1 docs/ && git push
#   git push origin main   # FRAPP_SKIP_REVIEW_GATE=1 would skip review
# each silently disabled the only pre-PR review gate — with no warning, unlike a livelock release.
# NB: the pattern lives in a variable — an unquoted `;` / `&` / `|` inside [[ =~ ]] is a syntax
# error, same reason push_re below is a variable.
skip_re='(^|[;&|(){}][[:space:]]*)[[:space:]]*(export[[:space:]]+)?FRAPP_SKIP_REVIEW_GATE=[^[:space:];&|]+'
skip_gate=0
if [ -n "${FRAPP_SKIP_REVIEW_GATE:-}" ] || [[ "$command" =~ $skip_re ]]; then
  skip_gate=1
fi

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
# Tradeoff: an env-prefixed invocation (`env FOO=1 git push`) is not matched, and neither is a
# global option whose value contains a space inside quotes (`git -C "/a/b c" push`) or a push
# inside a compound statement (`if true; then git push; fi`). All accepted, all the same
# direction — a missed push costs one unreviewed branch; over-matching burns the livelock budget
# and then auto-allows a real one, which is strictly worse.
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
  # `-n` is git's documented short form of --dry-run. Matching it too keeps a no-op command from
  # burning livelock budget, which would otherwise count toward auto-allowing a real push.
  # Matched as a whole word so `--no-verify` (space, dash, dash) cannot trip it.
  *--dry-run* | *' -n '* | *' -n') exit 0 ;;
esac

# ── Content key = branch HEAD SHA, so a new HEAD re-gates ────────────────────────────
# No `|| echo nohead` fallback: a constant key would collapse every branch and commit onto
# one marker that no new commit ever invalidates — a permanent, gitignored, repo-wide
# bypass. If HEAD is unknowable we cannot key evidence to anything, so fail CLOSED and say
# why. FRAPP_SKIP_REVIEW_GATE remains the escape.
no_head=0
if ! head_sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" || [ -z "$head_sha" ]; then
  # Deny, but fall through to the livelock counter rather than returning here. Returning was a
  # permanent wedge — the same shape removed from the parse-failure branch above — and with no
  # interpreter json_escape degrades to `""`, so the deny carried an empty reason: no diagnostic
  # and no discoverable escape. `nohead` is a counter key ONLY; the marker check is skipped
  # entirely below, so unlike a constant *marker* key it can never satisfy the gate.
  no_head=1
  head_sha="nohead"
fi

# ── Evidence that a review actually ran: /diff-review writes this on completion ──────
# Keyed on HEAD, so committing fixes invalidates it and the new HEAD must be reviewed.
if [ "$no_head" -eq 0 ]; then
  review_marker="$ROOT/.cache/diff-review/${head_sha}"
  if [ -f "$review_marker" ]; then
    exit 0
  fi
fi

# ── Emergency bypass (documented in AI_CODE_REVIEW_RUNBOOK.md) ───────────────────────
if [ "$skip_gate" -eq 1 ]; then
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
if [ "$parse_failed" -eq 1 ] || [ "$no_head" -eq 1 ]; then
  # Pre-escaped literals: on the parse-failure path there may be no interpreter, so json_escape
  # degrades to `""` and would emit a deny with no reason at all. The livelock counter above
  # applies to both branches, so neither can wedge the session.
  #
  # Note the escape advertised here is the ENVIRONMENT form only. On the parse-failure path the
  # real command text was never recovered — `command` is the synthetic "git push" — so the
  # command-prefix form the normal deny suggests cannot possibly be detected here.
  if [ "$parse_failed" -eq 1 ]; then
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Review gate: the hook payload could not be parsed — it was malformed, or neither python3 nor node was available to read it — so this push cannot be verified as reviewed. The gate fails closed rather than allow an unreviewed push. On this path the command text is unavailable, so a FRAPP_SKIP_REVIEW_GATE=1 command prefix will NOT be seen: export it into the session environment instead. This deny counts toward the 4-attempt livelock release, so it cannot wedge the session."}}'
  else
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Review gate: cannot resolve HEAD (is this an empty repository, or an orphan branch with no commits?), so the review marker cannot be keyed to anything and the push cannot be verified as reviewed. Commit something, or set FRAPP_SKIP_REVIEW_GATE=1. This deny counts toward the 4-attempt livelock release, so it cannot wedge the session."}}'
  fi
  exit 0
fi

reason="Local review gate: review this diff before pushing (see additionalContext for how)."
context="This push was blocked by the local pre-push review gate (Frapp's single pre-PR review gate; the CI Claude review has been removed). Run a review in THIS chat session, then address every finding (fix it, or file a tracked Triage follow-up with a reason). WHICH REVIEW: try Skill(skill: \"code-review\") first — it is the richer harness. It succeeds only when this turn's prompt carries the token /code-review whitespace-delimited on BOTH sides; backticks, quotes, bold, or a trailing '.' or ',' all defeat it, so a prompt that merely reads as asking for it usually does NOT qualify. Expect refusal by default: if it returns 'disable-model-invocation' that condition is not met, which is EXPECTED and NOT an error, and NOT a reason to stop and wait for a human. Note it can never succeed under /next, whose slash-command expansion hides the token. Fall back immediately to the project's own /diff-review skill, which an agent can always invoke. RECORDING EVIDENCE: /diff-review writes the marker itself as its last step. /code-review does NOT — if you used it, record the evidence yourself with: mkdir -p \"\$(git rev-parse --show-toplevel)/.cache/diff-review\" && touch \"\$(git rev-parse --show-toplevel)/.cache/diff-review/\$(git rev-parse HEAD)\" — do NOT reach for FRAPP_SKIP_REVIEW_GATE to get around a review you actually did, because that leaves a push indistinguishable from one that skipped review entirely; it is for emergencies only. RETRYING THIS PUSH WILL NOT SATISFY THE GATE: it is keyed on evidence, not attempts — only the marker .cache/diff-review/<HEAD_SHA> allows the push. Committing fixes changes HEAD and invalidates the marker by design, so the review always covers exactly what you push."

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s,"additionalContext":%s}}\n' \
  "$(json_escape "$reason")" \
  "$(json_escape "$context")"
exit 0
