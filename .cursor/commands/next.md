---
description: >-
  Claim the next viable unit of tracker work — one GitHub issue, or a small coherent batch —
  as In Progress before touching it, complete it, and keep the tracker in sync
argument-hint: "[123 ...] [--plan-only N]"
---

# /next

Follow [`.claude/commands/next.md`](../../.claude/commands/next.md) **exactly**. That file is the procedure source of truth. Do not duplicate it here, and do not copy `.claude/skills` into `.cursor/skills` — Cursor Cloud already loads `.claude/skills`.

Cursor Cloud (this harness):

- **Issues:** GitHub MCP only (`issue_write`, `issue_read`, `list_issues`, `search_issues`, `add_issue_comment`, `sub_issue_write`). Never `gh` or raw REST for tracker work.
- **PR babysit:** `subscribe_github_pr` + `subscribe_github_ci`. After a PR exists, subscribe and wait for those events.
- **`subscribe_timer`** is a conversation timer. It is **not** Claude's `send_later`. Do not ban it by analogy. The `send_later` ban is Claude-specific (it still prompts the owner).
- **Review gate:** [`.cursor/hooks.json`](../hooks.json) `beforeShellExecution` (`failClosed: true`) around [`.claude/hooks/pre-push-review-gate.sh`](../../.claude/hooks/pre-push-review-gate.sh). Evidence marker: `.cache/diff-review/<HEAD_SHA>` from `/diff-review`.
- **PRs:** prefer the harness PR tool when present; GitHub MCP `create_pull_request` remains valid. Never `gh`.
