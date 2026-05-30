---
description: Read-only progress dashboard — per-project and overall Frapp status from the backlog
---
Report current progress by **reading the backlog** at [`docs/backlog/`](../../docs/backlog/). This is read-only: do not edit files, issues, or open PRs.

1. Read [`docs/backlog/README.md`](../../docs/backlog/README.md) and every file in `docs/backlog/projects/` plus `docs/backlog/_meta/general.md`.
2. For each project, compute a rollup from its work-units table: total units, shipped/closed vs open, and anything marked blocked or with unmet dependencies.
3. Produce a concise dashboard:
   - **Per project:** name · status · `done / total` · current focus or blocker · next unblocked unit.
   - **Overall Frapp:** total open vs shipped across projects + the un-projected `general.md` count; call out anything blocked.
   - **Drift:** flag rows whose backlog `State` disagrees with reality (e.g. an issue marked open but its PR is merged) and suggest running `/triage`.
4. Keep it scannable (tables/short bullets). Do not fabricate numbers — if the backlog is incomplete or stale, say so and point at the relevant TODO markers.
