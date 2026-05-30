---
description: Sync open GitHub issues into the in-repo project board (docs/internal/board/) — the board is the source of truth
---
Board: [`docs/internal/board/`](../../docs/internal/board/) · Issues: https://github.com/pdcarlson/Frapp/issues

Reconcile the in-repo project board with GitHub issues. **The board is the source of truth;
GitHub issues are a reflection of it.** Never touch the GitHub Projects (v2) board.

1. Read the board: [`docs/internal/board/README.md`](../../docs/internal/board/README.md), each
   project file, and [`backlog.md`](../../docs/internal/board/backlog.md). Note every issue
   number already tracked and where.
2. Pull all open GitHub issues (`mcp__github__list_issues` / `search_issues`, paginate fully).
   Do the heavy reading in a sub-agent that returns only `#number — title — labels — parent` so
   the large payloads stay out of your context.
3. Classify each open issue into exactly one home:
   - A **project** — e.g. chat-redesign via `[Chunk NN]` title or `chunk-NN` label, or an issue
     whose parent epic belongs to a project. Place it under the right work unit.
   - The **general backlog**, under the best theme (Analytics, Billing, Agent-Infra, CI/Testing,
     Security, Data-lifecycle, Docs, Dues, Events, Points, Members, …). Create a theme if needed.
   - Use `AskUserQuestion` for genuinely ambiguous ones rather than guessing.
4. Reconcile and write the board markdown to match reality:
   - **New** issues (open on GitHub, missing from the board) → add them.
   - **Closed** issues still listed → mark ✅ done (keep them for auditability until the project
     is archived).
   - **Drift** (board and GitHub disagree on membership/title/status) → the board is canonical.
     Bring the GitHub issue into line: fix its labels/title via `mcp__github__issue_write` so it
     mirrors the board. Don't silently rewrite the board to match GitHub.
   - Refresh each project's work-unit status and the Projects table / progress counts in
     `README.md`.
5. Commit the board changes on a branch with a clear message (e.g. `chore(board): triage NN issues`).
   Summarize what moved, what's new, what closed, and any GitHub issues you updated to match.

Read-only against everything except the board files and (when fixing drift) the GitHub issues
themselves. Never create/modify a GitHub Projects board.
