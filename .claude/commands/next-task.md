---
description: Work an issue — target one by number, or pick the next viable one with me — then complete it and tidy the backlog
argument-hint: "[issue number (optional)]"
---
Project issues: https://github.com/pdcarlson/Frapp/issues

The single work command. Pick up and complete a piece of work, then leave the tracker cleaner than you found it.

**Target:** issue #$ARGUMENTS. If a number was given, work that issue. If no number was given, first scan the open issues, shortlist the ones that are genuinely viable now (dependencies actually shipped — confirm by reading code/merged PRs and the roadmap table in `spec/README.md`, not a status label) plus any that are easy to knock out or important to resolve, and use AskUserQuestion to let me pick. Prefer small, focused issues; batch several only if they comfortably fit your context window; split anything too big and file a follow-up sub-issue for the rest.

Then, for the chosen issue(s):

1. Start in plan mode. Use Explore/Plan sub-agents in parallel to research, keeping the heavy reading out of your own context. Read AGENTS.md and any spec files related to the issue.
2. Verify each chosen issue against current code and specs; research best practices for its scope. Fix only if valid. If already resolved, close it and any duplicates. If scope drifted, edit the issue first. If issue and spec conflict, the spec wins. Flag anything that seems off and use AskUserQuestion for real decisions.
3. Triage the backlog: close resolved/duplicate issues and file fresh, self-contained follow-ups for work you surface but shouldn't do now. Make sure the issue is reflected on the in-repo board ([`docs/internal/board/`](../../docs/internal/board/)) under the right project/work unit or backlog theme.
4. Branch from main as claude/<slug>. Focused commits. Update related spec/docs in the same PR (doc-sync requires it). Update the issue's row on the in-repo board — it's the source of truth (mark the issue ✅ done, and flip the work unit / project status if your work ships it). Verify end-to-end (run tests/app) — never claim a step you didn't run. Run /code-review and address findings before opening the PR.
5. Open a draft PR with `Closes #N`. The issue's open/closed state plus the board row is the status — no GitHub Projects board, ever.

If blocked on a decision that's mine, stop and ask with AskUserQuestion.
