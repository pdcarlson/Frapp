---
description: Pick the next viable project task with me, complete it, and tidy the backlog
---
Project issues: https://github.com/pdcarlson/Frapp/issues

Pick up and complete the next viable piece of work, then leave the tracker cleaner than you found it.

1. Start in plan mode. Use Explore/Plan sub-agents in parallel to survey open issues and the relevant code/specs, keeping the heavy reading out of your own context. Read AGENTS.md and related spec files.
2. Pick with me: shortlist the issues that are genuinely viable now (dependencies actually shipped — confirm by reading code/merged PRs, not the status label) and use AskUserQuestion to let me choose. Prefer small, focused issues; batch several only if they comfortably fit your context window; split anything too big and file a follow-up sub-issue for the rest.
3. Verify each chosen issue against current code and specs; research best practices. Fix only if valid. If already resolved, close it and any duplicates. If scope drifted, edit the issue first. If issue and spec conflict, the spec wins. Flag anything that seems off and use AskUserQuestion for real decisions.
4. Triage the backlog: add stray repo issues to the project, close resolved/duplicates, and file fresh self-contained follow-ups for work you shouldn't do now.
5. Branch from main as claude/<slug>. Focused commits. Update related spec/docs in the same PR (doc-sync requires it). Verify end-to-end (run tests/app) — never claim a step you didn't run. Run /code-review and address findings before opening the PR.
6. Open a draft PR with `Closes #N`. Solo project: the issue's open/closed state is the status — no "In Review" stage, no board shuffle.

If blocked on a decision that's mine, stop and ask with AskUserQuestion.
