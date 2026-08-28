Use this as a separate Cursor `/goal` (or Claude Code) session, run **in parallel** with the Batch 2 / item 2 goal. Verified file-disjoint from item 2's scope (item 2 touches service files and web upload pages; this touches repository files, skill docs, and a security-fixes log) — safe to run at the same time.

---

**Task: research and resolve the accumulated debt from PRs #1096-#1099 and issues #1088-#1092. Research first, confirm each item is still accurate against current `main`, then fix.**

Do not assume any of the following are still true — code has moved since these were written. For each item: locate the current file/line, confirm the problem still exists as described, then act. If something has already been fixed or no longer applies, say so and move on; don't force a change.

### Bucket A — unfiled debt from PRs #1096, #1097, #1098, #1099 (read each PR body on GitHub for full context first)

These are small, low-risk corrections — fix directly rather than filing issues and waiting, since none require a judgment call:

1. `packages/chat-core/src/topic-registry.ts` — file header comment still describes the web path as a re-export shim. That shim was deleted in #1099. Update the comment to reflect that web imports this module directly.
2. `.claude/skills/realtime-resilience/SKILL.md` — still says `apps/web/lib/realtime/topic-registry.ts` re-exports chat-core. That file is deleted. Update the skill to point at `@repo/chat-core/topic-registry` directly.
3. `apps/api` — `chat.service.ts` and `chat.service.spec.ts` have comments citing `apps/web/lib/chat/dispatch.ts`, which was deleted in #1099. Update the comments to cite the real current location (`@repo/chat-core/dispatch`).
4. `docs/internal/security/SECURITY_FIXES.md` — historically cites `apps/web/lib/chat/realtime-manager.ts`, also deleted in #1099. Retarget the citation.
5. `apps/web/lib/chat/offline-queue.ts` — still type-imports from the bare `@repo/chat-core` barrel instead of a subpath, inconsistent with every other file in that directory after #1099's cutover. Rewrite to the matching subpath import. Confirm this doesn't break anything with a scoped test run.
6. `packages/api-sdk` has no test harness — the hand-written `api-error.ts` module promoted in #1098 is currently untested (only indirectly exercised via `apps/mobile/lib/study/errors.spec.ts` re-exports). Add a minimal `vitest.config.ts` + a small spec file covering `statusOf` / `serverMessageOf` / `codeOf`. **Do not add a `test` script to `package-lock.json` or `.github/workflows/ci.yml` without checking these aren't mid-edit by another running goal first** — check git log / open PRs before touching shared config files.

For each of the six: after fixing, run `node scripts/check-doc-paths.mjs` and `node scripts/check-docs-impact.mjs --base origin/main --head HEAD` to confirm the citation fixes actually resolve cleanly.

### Bucket B — already-filed, still-open issues #1088 through #1092

Read each issue body on GitHub first (they have full context, including exact file:line and the mutation-testing evidence from PR #1087). Resolve what's safely resolvable in one PR; if any turns out to need a design decision rather than a mechanical fix, stop and describe the decision needed instead of guessing:

- **#1088** — five orphan Supabase repository methods with no production callers (`findByStripeCustomerId`, a `study_sessions.findById`, three `attendance` repository methods). Decide per method: delete it, or leave a comment explaining why it's kept as public surface. Don't delete blindly — confirm zero callers with a fresh grep first.
- **#1089** — inconsistent `(chapterId, …)` argument order across repository lookup methods (some put chapterId first, `findByName` on the document-folder repository puts it last). Normalize the order repo-wide and update call sites. This is the kind of transposed-argument footgun the tenant-scope harness exists to catch — run the harness after your change, not just `tsc`.
- **#1090** — `study_sessions.findById` / `update` filter on `id` alone despite the table carrying `chapter_id`. Add the defence-in-depth `chapterId` filter.
- **#1091** — `RbacService.transferPresidency` doesn't compare `currentMember.chapter_id` after `findById`. Add the explicit comparison, matching the pattern used elsewhere in that file.
- **#1092** — the tenant-scope coverage ledger only scans one directory, so `apps/api/src/modules/scheduled-jobs/scheduled-jobs.repository.ts` and `chat-notification-preference.repository.ts` are invisible to it. Widen the ledger's scan path and confirm both repositories now show up (either covered or explicitly backlogged).

### Guardrails

- Stay off any file in Batch 2 / item 2's scope: `packages/validation/src/**`, `user.service.ts`, `chapter.service.ts`, `service-entry.service.ts`, `chapter-document.service.ts`, `backwork.service.ts`, `chat.service.ts` (note: bucket A item 3 touches `chat.service.ts` **comments only** — coordinate/rebase if item 2 is mid-flight on that file, don't blind-overwrite).
- Split into multiple small PRs rather than one giant one — bucket A (docs/comments) and bucket B (actual code fixes) are different review weights and shouldn't be bundled.
- If GitHub MCP is unavailable in this session, say so explicitly and stop rather than silently degrading — this exact gap has now repeated 6+ times across prior PRs and needs to stop being silent.
- Standard floor requirements apply: `npm run check-types`, `npm run check:dep-cruiser`, scoped tests before/after, docs-sync gate satisfied for anything under `docs/`/`spec/`.
