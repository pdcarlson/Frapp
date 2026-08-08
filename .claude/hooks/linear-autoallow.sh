#!/bin/bash
# PreToolUse hook: auto-approve the Linear connector tools that Claude Code's web harness
# leaves out of its launch-time --allowed-tools list.
#
# WHY THIS EXISTS. Claude Code on the web launches the CLI with an explicit `--allowed-tools`
# argument built by the remote harness, not by us. It is a SNAPSHOT taken at launch. Read it
# live from the process args (handles both the space and `=` argument forms, and avoids pgrep
# self-matching by excluding this shell's own pid):
#
#     for p in $(pgrep -f 'claude --output-format'); do [ "$p" = "$$" ] && continue; \
#       tr '\0' '\n' < /proc/$p/cmdline | grep -E '^--allowed-tools(=|$)' -A1 \
#       | tr ',' '\n' | grep '^mcp__Linear__' && break; done
#
# As of 2026-08-08 that snapshot carries 45 Linear tools and omits EIGHT:
#
#     save_issue  save_comment  save_document  save_project
#     save_milestone  save_status_update  save_release_note      (seven writes)
#     get_workspace                                              (a read)
#
# The seven writes fit the pattern seen across every connector in the flag — Gmail keeps
# get/list/search but loses create_draft, Calendar loses create_event, Supabase keeps only
# search_docs — consistent with the server-side flag
# tengu_remote_auto_mode_include_destructive_mcp=false in ~/.claude.json.
#
# `get_workspace` does NOT fit that pattern, and it is the more instructive case: it is a pure
# read (all 14 other Linear `get_*` tools are allowed), and it entered the connector's tool
# roster mid-session, AFTER the launch snapshot was taken. So the rule is not "the harness
# withholds writes" — it is "the harness allowlist is frozen at launch, and anything the
# connector gains afterwards falls outside it." Expect new omissions whenever Linear ships a
# tool; re-run the command above rather than assuming this list is still complete.
#
# WHY permissions.allow DID NOT FIX IT. `.claude/settings.json` carries server-level allows
# (`mcp__Linear`, `mcp__linear`) and, from #669, two connector-UUID allows — and save_issue
# kept prompting through all of them, as did the connector's own "always allow" toggle on
# claude.ai (a separate permission plane). What we have NOT established is the mechanism: it
# may be that the launch allowlist is exhaustive and short-circuits permission rules, or that
# project settings are not consulted here at all (this project shows
# hasTrustDialogAccepted=false in ~/.claude.json, and allowedTools=[] never persists because
# the container is ephemeral). Both fit the evidence. Do not treat either as settled, and do
# not conclude from this file that permission rules are irrelevant — they are simply not what
# is deciding this case.
#
# A PreToolUse hook is the lever that does work, because it runs ahead of the permission
# engine. NOTE (2026-08-08): project PreToolUse hooks are verified to fire and hot-reload
# mid-session in a web sandbox, but that a permissionDecision of "allow" overrides a tool's
# absence from the launch snapshot is NOT yet observed end-to-end — the first real save_issue
# call after this lands is the test. If it still prompts, this hook is not the answer and the
# hasTrustDialogAccepted branch above is the next thing to pull on.
#
# SCOPE, stated precisely. The eight tool names above, on a server segment that is exactly
# `Linear`, `linear`, or one of the two Linear connector UUIDs pinned below. The UUIDs are
# pinned rather than shape-matched on purpose: `save_document`, `save_project`, and
# `save_issue` are generic enough that another UUID-registered connector could expose the same
# names, and this repo already talks to one (`bf7c680d-…` is Claude_Code_Remote, not Linear).
# A shape match like [0-9a-f-]{36} would have auto-approved that connector's writes too. If
# the Linear connector re-registers under a new UUID — plausible; the v4 toolbox id in
# particular may rotate — this hook goes quiet and prompts return. That is the safe failure
# direction: read the new id out of the session MCP config and add it here deliberately.
#
# The routines that need this are the Linear-facing skills — /next, linear-curator,
# linear-triage, pr-followups — which call save_issue constantly and stall on a prompt every
# time they run unattended.
#
# ESCAPE HATCH. Set FRAPP_NO_LINEAR_AUTOALLOW=1 to disable and get the prompts back.
#
# FAIL-OPEN BY DESIGN. Every path exits 0. Exit code 2 would BLOCK the tool call, and any
# other non-zero surfaces an error to the user, so the terminal `exit 0` below is load-bearing:
# without it the script inherits jq's status, and jq exits 2 if it cannot write stdout (closed
# fd, full disk) — turning an auto-approve hook into a hard deny. A hook must never wedge a
# session; the worst outcome here should be an extra permission prompt, never a blocked call
# and never a silently approved write.

# No `set -e`: a non-zero status from any probe below should fall through to the normal
# permission flow, not abort the hook with an error the user has to read.
set -uo pipefail

[ "${FRAPP_NO_LINEAR_AUTOALLOW:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

# `timeout` bounds the read: with fd 0 closed, bash can place the command-substitution pipe's
# read end on fd 0, and `cat` then blocks forever on the pipe it is writing to.
payload=$(timeout 5 cat 2>/dev/null) || exit 0
tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
[ -n "$tool" ] || exit 0

LINEAR_SERVER='[Ll]inear|5928a707-2591-54b8-b95d-505c9ff3098f|5b8e7be9-0594-452e-a220-a8864e03b895'
LINEAR_TOOL='save_(issue|comment|document|project|milestone|status_update|release_note)|get_workspace'

if [[ ! "$tool" =~ ^mcp__(${LINEAR_SERVER})__(${LINEAR_TOOL})$ ]]; then
  exit 0
fi

jq -nc --arg tool "$tool" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: ("Linear tool \($tool) is missing from the web harness --allowed-tools snapshot; auto-approved by .claude/hooks/linear-autoallow.sh (unset with FRAPP_NO_LINEAR_AUTOALLOW=1).")
  },
  suppressOutput: true
}'

# Load-bearing — see FAIL-OPEN above. Never inherit jq's exit status.
exit 0
