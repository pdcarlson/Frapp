# PR review Aug 20 (later): Batch 2/3 follow-ups all merged + 4 dependabot bumps

**CORRECTION (Aug 20, PR #1127): the React Compiler cleanup is NOT fully on `main`.** Previously reported as fully closed — wrong. #1127's own description reveals a real footgun: #1120 and #1123 were squash-merged into stacked *feature* branches, not `main` — GitHub marked them "Merged" but the commits never reached `origin/main`, and CI never ran on them because `pull_request.branches` is scoped to `[main, production]` only. #1127 recovered the auth piece (cherry-picked onto real `main`). **Realtime (#1124) and forms/set-state-in-effect (#1125) are still stranded** on orphaned branches (`cursor/realtime-compiler-lint-on-main-611b`, `cursor/forms-compiler-lint-on-main-611b`), never opened as clean `main`-targeted PRs.

**Actual current state on `main` (verify, don't trust this without re-checking):** chat (#1119/#1122) and now auth (#1127) compiler fixes are in. `preserve-manual-memoization`, `use-memo`, `set-state-in-effect`, `refs` allowlisting (all from #1124/#1125) — **status unconfirmed, likely still NOT enabled on main.**

**TOOLING DECISION:** Cursor is retired (see MCP-outage note) after this discovery plus the chronic MCP outage. Claude Code is now cleaning this up — see the big consolidated cleanup prompt in this blob, which supersedes the smaller individual prompts below (some of those are now subsumed).

---

Earlier wave 2 summary, superseded in part by the correction above: #1118 (scheduled-jobs test) landed cleanly. #1126 (`useAnalytics` deletion) landed cleanly. #1121 (env-docs runbook) landed cleanly, human-only blockers unchanged. Small debt spotted and not yet confirmed fixed: `supabase-task.repository.spec.ts` invalid `TaskStatus` seed, `spec/behavior/events.md` POST-vs-GET spec/code mismatch, issue #342 stale-text comment, two unfiled issues from #1121 (mobile tutorial-replay spec gap, #937 hygiene comment) — drafts saved in this blob's documents.