---
description: Pick the next viable work unit from the backlog with me, complete it, and keep the backlog in sync
---
Backlog (source of truth): [`docs/backlog/README.md`](../../docs/backlog/README.md). GitHub issues mirror it.

Pick up and complete the next viable piece of work, then leave the backlog cleaner than you found it.

1. Start in plan mode. Read [`docs/backlog/README.md`](../../docs/backlog/README.md) and the relevant project file. Use Explore/Plan sub-agents in parallel to survey the candidate work units and the related code/specs, keeping heavy reading out of your own context. Read AGENTS.md and the real spec files the unit links to.
2. Pick with me: shortlist the units that are genuinely viable now (dependencies actually shipped — confirm against merged PRs/code, not just the backlog `State`) and use AskUserQuestion to let me choose. Prefer small, focused units; split anything too big and file a follow-up issue for the rest.
3. Verify the chosen unit against current code and the canonical spec; research best practices. Fix only if valid. If already resolved, close the issue and any duplicates. If the issue and spec conflict, the spec wins. Use AskUserQuestion for real decisions.
4. Keep the backlog in sync: update the unit's row (and the project/overall rollup) in `docs/backlog/`, and bring its GitHub issue into line (the repo wins). Add stray issues to the right project or `general.md`; file fresh self-contained follow-ups for work you shouldn't do now.
5. Branch from main as `claude/<slug>`. Focused commits. Update the related real spec/docs in the same PR (doc-sync requires it; put files in their canonical home per `docs/internal/DOCUMENTATION_CONVENTIONS.md` — never drop a stray file to satisfy the gate). Verify end-to-end (run tests/app) — never claim a step you didn't run. Run `/code-review` and address findings before opening the PR.
6. Open a PR with `Closes #N`, then babysit it to merge-ready (per AGENTS.md autonomous PR lifecycle). Solo project: the issue's open/closed state is the status — no "In Review" stage, no board.

If blocked on a decision that's mine, stop and ask with AskUserQuestion.
