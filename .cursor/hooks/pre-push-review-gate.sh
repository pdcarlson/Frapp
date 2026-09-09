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
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INNER="$ROOT/.claude/hooks/pre-push-review-gate.sh"

payload="$(cat)"

emit() {
  # Args: permission, user_message, agent_message
  local perm="$1"
  local user_msg="$2"
  local agent_msg="$3"
  if python3 -c 'import json,sys; print(json.dumps({"permission":sys.argv[1],"user_message":sys.argv[2],"agent_message":sys.argv[3]}))' \
    "$perm" "$user_msg" "$agent_msg" 2>/dev/null; then
    return 0
  fi
  if node -e 'const [p,u,a]=process.argv.slice(1); process.stdout.write(JSON.stringify({permission:p,user_message:u,agent_message:a})+"\n")' \
    "$perm" "$user_msg" "$agent_msg" 2>/dev/null; then
    return 0
  fi
  # No interpreter: still valid JSON. Fail closed.
  printf '%s\n' '{"permission":"deny","user_message":"Review gate adapter could not serialize JSON.","agent_message":"Fail-closed: neither python3 nor node was available to emit Cursor hook JSON."}'
}

payload_looks_like_push() {
  # grep 1 = definite no-match (allow). Anything else (0, 2, 127) gates — same
  # fail-closed shape as the inner hook's parse-failure path.
  printf '%s' "$payload" | grep -q 'push'
  local rc=$?
  [ "$rc" -ne 1 ]
}

parse_cursor() {
  printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
cmd = d.get("command") or ""
cwd = d.get("cwd") or ""
sys.stdout.write(cmd.replace("\t", " ").replace("\r", "\n").replace("\n", ";") + "\t" + cwd)
' 2>/dev/null && return 0
  printf '%s' "$payload" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let d;
  try { d = JSON.parse(s); } catch { process.exit(1); }
  const cmd = d.command || "";
  const cwd = d.cwd || "";
  process.stdout.write(cmd.replace(/\t/g, " ").replace(/\r/g, "\n").replace(/\n/g, ";") + "\t" + cwd);
});
' 2>/dev/null && return 0
  return 1
}

if ! fields="$(parse_cursor)"; then
  if payload_looks_like_push; then
    emit "deny" \
      "Review gate: Cursor hook payload could not be parsed; fail-closed on a push-like command." \
      "The beforeShellExecution payload was not valid Cursor JSON ({command,cwd,sandbox}) and contained \"push\". Matching Claude's parse-failure path: deny rather than allow an unreviewed push. Export FRAPP_SKIP_REVIEW_GATE=1 only for emergencies."
    exit 0
  fi
  emit "allow" "" "Review gate adapter: payload unparsed and no push token; allowing."
  exit 0
fi

command="${fields%%$'\t'*}"
command_cwd="${fields#*$'\t'}"

build_claude_payload() {
  python3 -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.argv[1]},"transcript_path":"","cwd":sys.argv[2]}))' \
    "$command" "$command_cwd" 2>/dev/null && return 0
  node -e 'const [c,w]=process.argv.slice(1); process.stdout.write(JSON.stringify({tool_input:{command:c},transcript_path:"",cwd:w})+"\n")' \
    "$command" "$command_cwd" 2>/dev/null && return 0
  return 1
}

if ! claude_payload="$(build_claude_payload)"; then
  emit "deny" \
    "Review gate adapter could not encode the inner payload." \
    "Neither python3 nor node could JSON-encode the Claude PreToolUse payload. Fail-closed."
  exit 0
fi

if [ ! -f "$INNER" ]; then
  emit "deny" \
    "Review gate inner hook missing." \
    "Expected ${INNER}. The Cursor adapter does not reimplement the gate. Fail-closed."
  exit 0
fi

err_file="$(mktemp "${TMPDIR:-/tmp}/cursor-review-gate.XXXXXX")"
inner_out="$(printf '%s' "$claude_payload" | bash "$INNER" 2>"$err_file" || true)"
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

# Empty / non-deny inner stdout: allow. Surface livelock UNREVIEWED on stderr
# as agent_message so a Cursor session still sees the warning.
agent_note=""
if printf '%s' "$inner_err" | grep -q 'UNREVIEWED'; then
  agent_note="$inner_err"
fi
emit "allow" "" "$agent_note"
exit 0
