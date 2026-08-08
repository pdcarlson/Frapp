#!/bin/bash
# PreToolUse hook: auto-approve the Linear connector's issue-writing tools.
#
# WHY THIS EXISTS. Claude Code on the web launches the CLI with an explicit
# `--allowed-tools` list built by the remote harness, not by us. That list carries 45
# Linear connector tools — every read tool, plus writes like save_diff_comment,
# save_release, create_issue_label, delete_comment — but deliberately omits the
# issue-writing family:
#
#     save_issue  save_comment  save_document
#     save_project  save_milestone  save_status_update  save_release_note
#
# The same shape shows up across every connector in that flag (Gmail gets get/list/search
# but not create_draft; Calendar gets list/search but not create_event), which lines up
# with the server-side flag tengu_remote_auto_mode_include_destructive_mcp=false. Verify
# the current list any time with:
#
#     tr '\0' '\n' < /proc/$(pgrep -f 'claude --output-format' | head -1)/cmdline \
#       | grep -A1 '^--allowed-tools$' | tail -1 | tr ',' '\n' | grep '^mcp__Linear__'
#
# Because that allowlist is imposed at launch, `permissions.allow` in
# .claude/settings.json never got a say — which is why "mcp__Linear", "mcp__linear", and
# the two connector-UUID entries added in 204b768 (#669) all failed to stop the prompts,
# and why the connector's own "always allow" toggle on claude.ai (a different permission
# plane entirely) did not help either. A PreToolUse hook returning permissionDecision
# "allow" runs ahead of the permission engine, so it is the one lever we control.
#
# SCOPE. Strictly the seven tool names above, and only on a server segment that is
# "Linear"/"linear" or a UUID — claude.ai surfaces sometimes register connector tools
# under the toolbox UUID instead of the friendly name (see 204b768), and those UUIDs
# change if the connector is reinstalled, so matching the shape beats hardcoding them.
# Anything else falls through untouched to the normal permission flow. This hook only
# ever widens permission for those names; it can never deny a tool call.
#
# The routines that need this are the Linear-facing skills — /next, linear-curator,
# linear-triage, pr-followups — which call save_issue constantly and stall on a prompt
# every time when run unattended.
#
# ESCAPE HATCH. Set FRAPP_NO_LINEAR_AUTOALLOW=1 to disable and get the prompts back.
#
# FAIL-OPEN BY DESIGN. Every unexpected condition (no jq, unreadable payload, unparseable
# tool name) exits 0 with no output, which means "hook has no opinion" and leaves the
# normal permission prompt in place. A hook must never wedge a session, and the failure
# mode here should be an extra prompt, never a silently approved write.

# No `set -e`: a non-zero exit from any probe below should fall through to the normal
# permission flow, not abort the hook with an error the user has to read.
set -uo pipefail

[ "${FRAPP_NO_LINEAR_AUTOALLOW:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

payload=$(cat 2>/dev/null) || exit 0
tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
[ -n "$tool" ] || exit 0

# Server segment: Linear/linear, or a 36-char connector UUID.
# Tool segment: only the writes the harness withholds.
if [[ ! "$tool" =~ ^mcp__([Ll]inear|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})__save_(issue|comment|document|project|milestone|status_update|release_note)$ ]]; then
  exit 0
fi

jq -nc --arg tool "$tool" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: ("Linear write tool \($tool) is omitted from the web harness --allowed-tools list; auto-approved by .claude/hooks/linear-write-autoallow.sh (unset with FRAPP_NO_LINEAR_AUTOALLOW=1).")
  },
  suppressOutput: true
}'
