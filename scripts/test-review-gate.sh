#!/bin/bash
# Regression harness for .claude/hooks/pre-push-review-gate.sh
ROOT="$(git rev-parse --show-toplevel)"
HOOK="$ROOT/.claude/hooks/pre-push-review-gate.sh"

SHA="$(git -C "$ROOT" rev-parse HEAD)"
MARKER="$ROOT/.cache/diff-review/$SHA"
pass=0; fail=0

# Isolate the attempt counter per case so the livelock guard never interferes.
run() { # run <name> <expect: allow|deny> <payload> [env...]
  local name="$1" expect="$2" payload="$3"; shift 3
  local td; td="$(mktemp -d)"
  local out
  out="$(cd "$ROOT" && env "$@" TMPDIR="$td" CLAUDE_PROJECT_DIR="$ROOT" bash "$HOOK" <<<"$payload" 2>/dev/null)"
  local got="allow"
  [[ "$out" == *'"deny"'* ]] && got="deny"
  if [ "$got" = "$expect" ]; then pass=$((pass+1)); printf 'ok   %-58s %s\n' "$name" "$got"
  else fail=$((fail+1)); printf 'FAIL %-58s got=%s want=%s\n' "$name" "$got" "$expect"; fi
  rm -rf "$td"
}

p() { printf '{"tool_input":{"command":%s},"transcript_path":""}' "$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"; }

rm -f "$MARKER"
echo "--- no marker present ---"
run "plain git push"                       deny  "$(p 'git push')"
run "git push -u origin br"                deny  "$(p 'git push -u origin br')"
run "git -C /repo push"                    deny  "$(p 'git -C /repo push')"
run "cd x && git push"                     deny  "$(p 'cd x && git push')"
run "multiline cd/push"                    deny  "$(p 'cd x
git push')"
run "dry-run then real push (compound)"    deny  "$(p 'git push --dry-run && git push origin main')"
run "ls (not a push)"                      allow "$(p 'ls -la')"
run "git commit -m wire up push notifs"    allow "$(p 'git commit -m "wire up push notifications"')"
run "grep \"git push\" file"                 allow "$(p 'grep "git push" file')"
run "git pushdeploy"                       allow "$(p 'git pushdeploy')"
run "git push --dry-run (alone)"           allow "$(p 'git push --dry-run')"
run "FRAPP_SKIP_REVIEW_GATE=1 + push"      allow "$(p 'git push')" FRAPP_SKIP_REVIEW_GATE=1

echo "--- marker present for HEAD ---"
mkdir -p "$(dirname "$MARKER")" && touch "$MARKER"
run "git push with valid marker"           allow "$(p 'git push')"
rm -f "$MARKER"

echo "--- NEW: unparseable payload / missing python3 (fail-closed) ---"
run "malformed JSON mentioning push"       deny  'not json at all: git push'
run "malformed JSON, no push mention"      allow 'not json at all: ls -la'
run "malformed JSON + SKIP env"            allow 'not json at all: git push' FRAPP_SKIP_REVIEW_GATE=1

# Simulate python3 being absent entirely.
STUB="$(mktemp -d)"; for b in bash cat grep printf mkdir dirname id git sed rm; do
  src="$(command -v $b 2>/dev/null)"; [ -n "$src" ] && ln -sf "$src" "$STUB/$b"
done
np() { cd "$ROOT" && env -i PATH="$STUB" TMPDIR="$1" CLAUDE_PROJECT_DIR="$ROOT" bash "$HOOK" 2>/dev/null; }
td="$(mktemp -d)"
out="$(printf '{"tool_input":{"command":"git push"},"transcript_path":""}' | np "$td")"
if [[ "$out" == *'"deny"'* ]]; then pass=$((pass+1)); echo "ok   no-python3 + git push                                    deny"
else fail=$((fail+1)); echo "FAIL no-python3 + git push                                  got=allow want=deny"; fi
out="$(printf '{"tool_input":{"command":"ls -la"},"transcript_path":""}' | np "$td")"
if [[ "$out" != *'"deny"'* ]]; then pass=$((pass+1)); echo "ok   no-python3 + ls                                          allow"
else fail=$((fail+1)); echo "FAIL no-python3 + ls                                        got=deny want=allow"; fi
rm -rf "$td" "$STUB"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
