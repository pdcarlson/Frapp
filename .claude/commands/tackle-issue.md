---
description: Verify, fix, and close a specific issue — or find an easy/important one to knock out
argument-hint: "[issue number (optional)]"
---
Target: issue #$ARGUMENTS. If no number was given, first scan the open issues at https://github.com/pdcarlson/Frapp/issues, shortlist the easy-to-knock-out or important-to-resolve ones, and use AskUserQuestion to let me pick.

Then, for the target issue:

1. Start in plan mode. Use Explore sub-agents to research, keeping the heavy reading out of your own context. Read AGENTS.md and any spec files related to the issue.
2. Verify the issue against current code and specs. Research best practices for its scope and target in the context of this project. Fix it only if valid. If it's already resolved, close it and any duplicate issues. If scope has drifted, edit the issue first; if it conflicts with the spec, the spec wins. Flag anything that doesn't make sense or seem right, and use AskUserQuestion for any real decision. Create fresh, self-contained follow-up issues for anything you surface but shouldn't fix now.
3. Branch from main as claude/<slug>. Focused commits. Update related spec/docs in the same PR (doc-sync requires it for non-doc changes). Verify end-to-end (run tests/app) — never claim a step you didn't run. Run /code-review and address findings before opening the PR.
4. Open a draft PR whose body closes the issue with `Closes #<issue>`. Solo project: the issue's open/closed state is the status — no "In Review" stage, no board shuffle.

If blocked on a decision that's mine, stop and ask with AskUserQuestion.
