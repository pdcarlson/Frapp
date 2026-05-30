---
description: Read-only progress dashboard across all Frapp projects — reads the in-repo board, cross-checked against open issues
---
Board: [`docs/internal/board/`](../../docs/internal/board/)

Render how Frapp is progressing, project by project. **Read-only: make no commits, branches,
PRs, label changes, or issue edits.**

1. Read [`docs/internal/board/README.md`](../../docs/internal/board/README.md) for the list of
   projects, then each project file for its work units + tracked issues, and
   [`backlog.md`](../../docs/internal/board/backlog.md).
2. For each project, count work units by status (done / in progress / queued) and its open vs
   closed issues. Cross-check against open GitHub issues (`mcp__github__list_issues` /
   `search_issues`) to flag any drift (open issues not on the board, or board issues now closed).
   If the issue payloads are large, do the counting in a sub-agent that returns only the counts.
3. Print a compact dashboard:
   - **Headline:** overall — e.g. `Frapp: 1 project in progress · 5/12 redesign chunks shipped`.
   - **Per project:** `name · status · progress (units) · open issues · blocked-by` (deps from
     the project's dependency notes).
   - **General backlog:** count by theme.
   - **Drift warning** if GitHub and the board disagree → suggest running `/triage`.
4. End with suggested next work: the earliest unblocked work unit's top open `agent-ready` issues
   as candidates for `/next-task`.

Reporting only. To re-sync the board with GitHub, run `/triage`; to do the work, `/next-task`.
