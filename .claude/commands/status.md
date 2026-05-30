---
description: Read-only launch-progress dashboard — chunk status from the roadmap, cross-checked against open issues
---
Project issues: https://github.com/pdcarlson/Frapp/issues

Render a live picture of how close the chat-first redesign is to launch. **Read-only: make no commits, branches, PRs, label changes, or issue edits.**

1. Read the roadmap status table in [`spec/README.md`](../../spec/README.md#roadmap) — it is the source of truth for each chunk's title and status (`shipped` / `in review` / `queued`). Read the chunk dependency graph in [`spec/redesign-context.md`](../../spec/redesign-context.md) so you can show what blocks each unfinished chunk.
2. For each chunk 01–12, count the **open** issues that belong to it. Use `mcp__github__list_issues` / `mcp__github__search_issues` on `pdcarlson/frapp`. Match by the `chunk-NN` label if it exists; otherwise fall back to title text — chunk issues are titled like `Chunk 06`, `[Chunk 06]`, or `[Chunk 10h]`. Do the counting inside a sub-agent if the issue payloads are large, and have it return only the per-chunk counts (the issues endpoint returns very large responses).
3. Print a compact dashboard, one row per chunk: `# · title · status · open issues · blocked-by (unsatisfied deps, if any)`. Lead with a headline — `N/12 chunks shipped` — and the total open-issue count.
4. End with suggested next work: for the earliest chunk that isn't shipped, list its top few open `agent-ready` issues (number + title) as candidates for `/next-task`.

Keep it scannable. This command only reports — to actually do the work, hand off to `/next-task`.
