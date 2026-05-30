---
description: Reconcile open GitHub issues into the backlog — the backlog is source of truth, GitHub is brought into line
---
Sync GitHub issues with the in-repo backlog at [`docs/backlog/`](../../docs/backlog/). **The backlog wins on conflict** — bring GitHub into line, never the reverse.

1. Read the backlog: [`docs/backlog/README.md`](../../docs/backlog/README.md), every `projects/*.md`, and `_meta/general.md`.
2. Gather open GitHub issues. Payloads are large and the paginator is flaky — do the reading in **sub-agents** that return compact `#num — title — state` summaries (and verify counts against the API's total; re-read anything inconsistent). Never invent issue numbers/titles.
3. Reconcile, with the **repo as source of truth**:
   - Issue in backlog but its real state differs (e.g. merged PR but issue still open) → close/relabel/retitle the **GitHub issue** to match the backlog.
   - Open issue not in the backlog → add a row to the correct project or to `general.md`.
   - Backlog row whose issue no longer exists or is a duplicate → fix the backlog row.
   - Keep each project's rollup and the root README counts current.
4. Make the minimal set of GitHub edits needed to align reality (use the GitHub MCP tools). Prefer editing the backlog for organization; edit issues only to correct their state/labels/title to match.
5. Summarize what changed: backlog edits made, GitHub issues brought into line, and anything left UNVERIFIED (leave a `<!-- TODO -->` rather than guessing).

This is the same reconciliation the SessionStart hook primes at the start of each session; run it on demand whenever the backlog and GitHub may have drifted.
