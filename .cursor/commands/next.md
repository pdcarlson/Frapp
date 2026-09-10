---
description: >-
  Claim the next viable unit of tracker work — one GitHub issue, or a small coherent batch —
  as In Progress before touching it, complete it, and keep the tracker in sync
argument-hint: "[123 ...] [--plan-only N]"
---

# /next

Follow [`.claude/commands/next.md`](../../.claude/commands/next.md) **exactly**. That file is the procedure source of truth. Do not duplicate it here.

Skills live under `.claude/skills/` (Cursor Cloud loads that tree; Claude Code uses it natively). Keep one skill tree — do not copy into `.cursor/skills/`.

Babysit, tracker, and PR tools: follow [`AGENTS.md`](../../AGENTS.md) — use this harness's GitHub MCP and PR/CI subscription tools. Do not freeze a catalog here. Review gate: `/diff-review` (fail-closed project hooks; not Bugbot).
