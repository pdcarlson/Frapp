#!/usr/bin/env bash
# Cursor Cloud beforeShellExecution adapter for Frapp's pre-push review gate.
#
# Cursor's beforeShellExecution defaults FAIL-OPEN on crash, timeout, or invalid
# JSON (https://cursor.com/docs/agent/hooks). This adapter always prints valid
# Cursor JSON and exits 0. `.cursor/hooks.json` sets failClosed: true so a crash
# *before* we emit JSON still blocks the command — the Claude gate's closed
# posture, as closely as Cursor hooks allow.
#
# Decision logic is NOT duplicated here. The matcher, marker, bypass, livelock,
# and parse-failure rules live in .claude/hooks/pre-push-review-gate.sh. This
# file only translates Cursor stdin {command,cwd,sandbox} into that hook's
# PreToolUse payload and Claude deny JSON into Cursor {permission,...}.
#
# Claude allow = empty stdout. Under failClosed, empty stdout is invalid JSON
# and would DENY every non-push command. So this wrapper never emits empty
# stdout: allow is {"permission":"allow",...}.
#
# Encoding uses env vars, not `node -e` argv: Node's argv after `-e` is not
# portable across binaries (some include `-e`/`[eval]`, some strip them).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INNER="${FRAPP_REVIEW_GATE_INNER:-$ROOT/.claude/hooks/pre-push-review-gate.sh}"

payload="$(cat)"

emit() {
  # Args: permission, user_message, agent_message
  local perm="$1"
  local user_msg="$2"
  local agent_msg="$3"
  if FRAPP_HOOK_PERM="$perm" FRAPP_HOOK_USER="$user_msg" FRAPP_HOOK_AGENT="$agent_msg" \
    python3 -c 'import json,os; print(json.dumps({"permission":os.environ.get("FRAPP_HOOK_PERM","deny"),"user_message":os.environ.get("FRAPP_HOOK_USER",""),"agent_message":os.environ.get("FRAPP_HOOK_AGENT","")}))' \
    2>/dev/null; then
    return 0
  fi
  if FRAPP_HOOK_PERM="$perm" FRAPP_HOOK_USER="$user_msg" FRAPP_HOOK_AGENT="$agent_msg" \
    node -e 'const e=process.env; process.stdout.write(JSON.stringify({permission:e.FRAPP_HOOK_PERM||"deny",user_message:e.FRAPP_HOOK_USER||"",agent_message:e.FRAPP_HOOK_AGENT||""})+"\n")' \
    2>/dev/null; then
    return 0
  fi
  # No interpreter: still valid JSON. Fail closed.
  printf '%s\n' '{"permission":"deny","user_message":"Review gate adapter could not serialize JSON.","agent_message":"Fail-closed: neither python3 nor node was available to emit Cursor hook JSON."}'
}

text_looks_like_push() {
  # grep 1 = definite no-match (allow). Anything else (0, 2, 127) gates — same
  # fail-closed shape as the inner hook's parse-failure path.
  printf '%s' "$1" | grep -q 'push'
  local rc=$?
  [ "$rc" -ne 1 ]
}

payload_looks_like_push() {
  text_looks_like_push "$payload"
}

session_skip() {
  [ "${FRAPP_SKIP_REVIEW_GATE:-}" = "1" ]
}

# Parse must yield a JSON object. A JSON string/array is valid JSON but is not
# Cursor's {command,cwd,sandbox} shape — treating it as success with an empty
# command fails open (node's `d.command || ""` on `"git push"` is "").
parse_cursor() {
  printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    sys.exit(1)
cmd = d.get("command")
cwd = d.get("cwd")
if cmd is None:
    cmd = ""
elif not isinstance(cmd, str):
    sys.exit(1)
else:
    cmd = cmd.strip()
if cwd is None:
    cwd = ""
elif not isinstance(cwd, str):
    sys.exit(1)
sys.stdout.write(cmd.replace("\t", " ").replace("\r", "\n").replace("\n", ";") + "\t" + cwd)
' 2>/dev/null && return 0
  printf '%s' "$payload" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let d;
  try { d = JSON.parse(s); } catch { process.exit(1); }
  if (!d || typeof d !== "object" || Array.isArray(d)) process.exit(1);
  if (d.command != null && typeof d.command !== "string") process.exit(1);
  if (d.cwd != null && typeof d.cwd !== "string") process.exit(1);
  const cmd = (typeof d.command === "string" ? d.command : "").trim();
  const cwd = typeof d.cwd === "string" ? d.cwd : "";
  process.stdout.write(cmd.replace(/\t/g, " ").replace(/\r/g, "\n").replace(/\n/g, ";") + "\t" + cwd);
});
' 2>/dev/null && return 0
  return 1
}

fail_closed_push() {
  local user_msg="$1"
  local agent_msg="$2"
  if session_skip; then
    emit "allow" "" "Review gate skipped via FRAPP_SKIP_REVIEW_GATE=1 (session environment)."
    exit 0
  fi
  emit "deny" "$user_msg" "$agent_msg"
  exit 0
}

if ! fields="$(parse_cursor)"; then
  if payload_looks_like_push; then
    fail_closed_push \
      "Review gate: Cursor hook payload could not be parsed; fail-closed on a push-like command." \
      "The beforeShellExecution payload was not valid Cursor JSON ({command,cwd,sandbox}) and contained \"push\". Matching Claude's parse-failure path: deny rather than allow an unreviewed push. Export FRAPP_SKIP_REVIEW_GATE=1 only for emergencies."
  fi
  emit "allow" "" "Review gate adapter: payload unparsed and no push token; allowing."
  exit 0
fi

command="${fields%%$'\t'*}"
command_cwd="${fields#*$'\t'}"

# Strip in parse_cursor first (python str.strip / JS trim) so CR/LF/NBSP-only
# commands become empty *before* newline flattening turns them into ";".
# Bash trim here is the fallback if an interpreter skipped strip.
command="${command#"${command%%[![:space:]]*}"}"
command="${command%"${command##*[![:space:]]}"}"
# Newline flattening maps CR/LF to ";". A command that is only separators is
# still empty for the inner matcher.
_collapsed="${command//;}"
_collapsed="${_collapsed#"${_collapsed%%[![:space:]]*}"}"
_collapsed="${_collapsed%"${_collapsed##*[![:space:]]}"}"
if [ -z "$_collapsed" ]; then
  command=""
fi
unset _collapsed

# Successful parse with an empty command still fails closed when the raw payload
# contains "push" — otherwise {"command":null,"note":"git push"} or a schema that
# stores the shell line under another key would reach INNER as "" and allow.
if [ -z "$command" ] && payload_looks_like_push; then
  fail_closed_push \
    "Review gate: Cursor payload had no command string; fail-closed on a push-like body." \
    "The beforeShellExecution JSON parsed but command was empty/missing while the raw payload contained \"push\". Deny rather than forward an empty command to the inner matcher."
fi

build_claude_payload() {
  FRAPP_HOOK_CMD="$command" FRAPP_HOOK_CWD="$command_cwd" python3 -c '
import json, os
print(json.dumps({"tool_input":{"command":os.environ.get("FRAPP_HOOK_CMD","")},"transcript_path":"","cwd":os.environ.get("FRAPP_HOOK_CWD","")}))
' 2>/dev/null && return 0
  FRAPP_HOOK_CMD="$command" FRAPP_HOOK_CWD="$command_cwd" node -e '
const e=process.env;
process.stdout.write(JSON.stringify({tool_input:{command:e.FRAPP_HOOK_CMD||""},transcript_path:"",cwd:e.FRAPP_HOOK_CWD||""})+"\n");
' 2>/dev/null && return 0
  return 1
}

if ! claude_payload="$(build_claude_payload)"; then
  fail_closed_push \
    "Review gate adapter could not encode the inner payload." \
    "Neither python3 nor node could JSON-encode the Claude PreToolUse payload. Fail-closed."
fi

if [ ! -f "$INNER" ]; then
  if text_looks_like_push "$command" || { [ -z "$command" ] && payload_looks_like_push; }; then
    fail_closed_push \
      "Review gate inner hook missing." \
      "Expected ${INNER}. The Cursor adapter does not reimplement the gate. Fail-closed."
  fi
  emit "allow" "" "Review gate inner hook missing; command is not push-like; allowing."
  exit 0
fi

err_file="$(mktemp "${TMPDIR:-/tmp}/cursor-review-gate.XXXXXX")"
inner_rc=0
inner_out="$(printf '%s' "$claude_payload" | bash "$INNER" 2>"$err_file")" || inner_rc=$?
inner_err="$(cat "$err_file" 2>/dev/null || true)"
rm -f "$err_file"

# Bash command substitution cannot store NUL, so the inner deny JSON is
# translated by a helper that prints Cursor JSON directly.
emit_deny_from_inner() {
  printf '%s' "$inner_out" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    sys.exit(1)
o = d.get("hookSpecificOutput") or {}
if o.get("permissionDecision") != "deny":
    sys.exit(1)
reason = o.get("permissionDecisionReason") or "Local review gate: review this diff before pushing."
ctx = o.get("additionalContext") or ""
agent = reason if not ctx else reason + "\n\n" + ctx
print(json.dumps({"permission": "deny", "user_message": reason, "agent_message": agent}))
' 2>/dev/null && return 0
  printf '%s' "$inner_out" | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  let d; try { d=JSON.parse(s); } catch { process.exit(1); }
  const o=d.hookSpecificOutput||{};
  if (o.permissionDecision!=="deny") process.exit(1);
  const reason=o.permissionDecisionReason||"Local review gate: review this diff before pushing.";
  const ctx=o.additionalContext||"";
  const agent=ctx? reason+"\n\n"+ctx : reason;
  process.stdout.write(JSON.stringify({permission:"deny",user_message:reason,agent_message:agent})+"\n");
});
' 2>/dev/null && return 0
  return 1
}

if emit_deny_from_inner; then
  exit 0
fi

# Inner crash / untranslatable stdout on a push-like command: deny. Claude allow
# is empty stdout with exit 0. Swallowing a non-zero inner exit used to emit
# Cursor allow and bypass failClosed. Unparseable inner stdout on a push is the
# same hole (deny JSON plus a log line would otherwise fall through to allow).
if text_looks_like_push "$command"; then
  if [ "$inner_rc" -ne 0 ] || [ -n "$inner_out" ]; then
    fail_closed_push \
      "Review gate inner hook failed; fail-closed on a push-like command." \
      "The Cursor adapter invoked the inner review gate and it exited ${inner_rc} without a translatable deny JSON. Unreviewed push is not allowed. Export FRAPP_SKIP_REVIEW_GATE=1 only for emergencies."
  fi
fi

# Empty / non-deny inner stdout: allow. Surface livelock UNREVIEWED on stderr
# as agent_message so a Cursor session still sees the warning.
agent_note=""
if printf '%s' "$inner_err" | grep -q 'UNREVIEWED'; then
  agent_note="$inner_err"
fi
emit "allow" "" "$agent_note"
exit 0
