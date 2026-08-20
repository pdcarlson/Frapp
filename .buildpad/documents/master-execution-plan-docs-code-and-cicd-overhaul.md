Guiding rule: Cursor is a one-project tool for mechanical fan-out only. No .cursor/ folder, no Cursor-specific config added to the repo. Everything written into AGENTS.md/skills is Claude-Code-only, zero mention of Cursor. Two scratch files (REFACTOR-PLAN.md, REFACTOR-PROGRESS.md) live at repo root, tool-neutral, deleted when the project wraps.

## Wave 0 — Foundation (Claude Code, supervised, serialized, must fully merge before any fan-out)

**Status: COMPLETE (Aug 19-20).** A landed via PR #1080/#1081, B via PR #1082, C via PR #1083, all merged to main. Before starting Wave 1, read the "Wave 0 close-out" section below — one risk item (repo test coverage) was deliberately deferred, not fixed, and should be addressed first.

### A. CI/CD gate fixes (do first — these literally block everything else)
1. Fix the docs-spec-sync gate — it currently has zero exemption besides dependabot and will permanently block every pure-code consolidation PR. Add a label-based or explicit "no doc change needed" override.
2. Decide the review policy — main requires no human approval and the only review gate (pre-push hook) is Claude-Code-only. Minimum: personally review every PR before merge regardless of origin. Consider temporarily requiring 1 approval on main for the duration of this project.
3. Promote web-tests to a required check before Wave 1 touches packages/hooks (query-key migration lands there).
4. Add the 4 new quality gates with correct rollout posture:
   - dependency-cruiser boundary linting — hard gate immediately, baseline via --ignore-known.
   - SDK-drift check (regenerate + git diff --exit-code, plus oasdiff for breaking changes) — hard gate immediately, no existing-failure problem to grandfather.
   - ESLint response-schema rule (@darraghor/eslint-plugin-nestjs-typed) — "warn" now, flip to "error" after Wave 2's backfill clears the backlog.
   - jscpd duplicate-detection — advisory repo-wide duplication-percentage threshold set just above current level, ratchet down as consolidations land (jscpd has no clone-level baseline, this is the workaround).
5. Fix coverage tooling (minimatch/test-exclude collision, missing @vitest/coverage-v8) — not a hard blocker, but needed to sanity-check the refactor's real impact.
6. Optional/lower priority: a real merge queue (merge_group trigger) if concurrency ever exceeds what the existing pr-base-sync sweep handles.

### B. Docs & agentic framework rewrite (Claude Code only — no Cursor mentions anywhere in these files)
1. Rewrite AGENTS.md: cut the ~12 "would do anyway" lines and the ~35 lines of incident narration (collapse to short rules or delete), move the 62-line issue-filing section into a skill. Target under ~200 lines.
2. Establish ADR discipline: one-off incidents/decisions go into an immutable, append-only ADR log (supersede, never edit). A rule only graduates into AGENTS.md if it's recurring, still-true, and not something the agent would derive on its own.
3. Encode spec-vs-code precedence explicitly, and delete the contradicting statements in README.md / spec/behavior/README.md: spec = intended behavior, code = current behavior, disagreement is a tracked bug to file, not silent agent discretion.
4. Fix spec/product/positioning.md — delete/rewrite the stale "Modern Ivy" section, point to spec/ui/brand-identity.md instead of duplicating values.
5. Resolve spec/behavior/meetings.md — either commit it to the roadmap (informed by the separate AI-recap research: typed-minutes-first, not recording-first, conflicts with this spec's current design) or explicitly quarantine it and fix ai.md's corpus list, which currently cites it as the first indexed item.
6. De-duplicate the 5x-copied routine-ownership boilerplate (issue-curator/pr-followups/issue-triage/diff-review) into one shared reference file the routine skills point to.
7. Add check-our-docs to the skills table — it exists and works, just isn't listed.
8. Write the two missing high-value skills the archetype analysis flagged: Signet-surface-cutover checklist, realtime-resilience rules (same bug fixed twice, two weeks apart, because the diagnosis was never captured).
9. Move must-always-happen rules from prose into hooks where feasible.
10. Resolve the next.md (641 lines) vs GITHUB_PM.md split-brain its own frontmatter admits to; consider converting next.md into a skill.
11. Sweep the 21 dead permission entries in .claude/settings.json, the stale Linear references (keep the legitimate ADR ones), the stale "chunk" references, and the "4 apps, 7 packages" count (actually 13) in README.md/AGENTS.md.

### C. Code foundation work kept supervised (per the CI/CD audit — not safe to hand to an autonomous agent)
**DONE via PR #1083 (Aug 20).**
1. Supabase repository layer: done the type-wiring way, not the test-first way. All 33 repositories plus service-layer writes now use `TablesInsert`/`TablesUpdate` generics with `FrappSupabaseClient` injected at every `SUPABASE_CLIENT` site — zero `as never` casts remain. A compile-only regression check (`no-as-never.spec.ts`, `database.types.insert-check.ts`) guards against them coming back. **This did not add behavioral tests to the repositories** — that half of the original either/or was not taken. See Wave 0D below.
2. Chapter-scoped query-key factory (`createChapterQueryKeys` in packages/hooks) built and verified against `taskKeys`/`notificationKeys`, `chapterId: string` required. Call-site migration deliberately not done — that's Wave 1 item 5.
3. All three real bugs fixed and tested: /polls and /backwork disabled-query spinner (now distinguishes paused/loading/denied-empty), chat-card poll vote validation (brought up to polls-page parity, 12+5 tests), settings-page per-tab pending state (was actually already fixed on main pre-PR; this PR added the locking tests).

**Flagged by the PR itself, carried forward as debt:**
- `Insert`/`Update` types are `Partial` of the row (all keys optional) — enough to kill `as never` and catch a wrong-type value like `{ title: 123 }`, but weaker than what `supabase gen types` would produce (which would make required columns actually required on insert). The PR explicitly says leave `database.types.ts` hand-maintained, don't overwrite it. **Accepted as-is for now** — see "Known accepted debt" below.
- Query-key factory has a real gotcha for Wave 1: `list(chapterId)` includes an `undefined` filters slot and is **not the same tuple** as `lists(chapterId)` (the invalidation prefix). Wave 1 item 5's prompt must say explicitly: mount queries on `list`, invalidate with `lists`.
- The canvas document titled "Claude Code prompt: code quality/duplication audit" was referenced by the Phase 3 prompt but was not actually present in `.buildpad/` on main — second time this exact gap has happened. See "Process fix" section below.

## Wave 0D — Supabase repository baseline tests (Claude Code, supervised — do before Wave 1 item 5 touches these files)

**STATUS: DONE (PR #1087, merged).** 24 of 33 repositories now have tenant-scope specs via one shared harness; remaining 9 are recorded backlog with reasons, enforced by a coverage-ledger spec that fails CI if a repo has neither a test nor a logged reason. Harness was adversarially reviewed twice and had 8 real holes fixed (an `.or()` disjunct wrongly counting as scoped, an RPC check comparing argument values instead of argument identity, a write-check that was silently off for exactly the 3 indirectly-scoped tables). Verified by injecting 3 real tenant bugs (dropped filter, wrong column, lost filter in a bulk write) — all 3 caught. No active cross-tenant leak found.

**New findings that need action, not just filing (no GitHub MCP again — same recurring gap):**
- `RbacService.transferPresidency` doesn't re-check `currentMember.chapter_id` after `findById` — this reads like a real cross-tenant risk on a sensitive action, worth fixing directly rather than just filing. Recommend doing this now, not backlogging.
- 5 more items (orphan repo methods with no callers, inconsistent `findByCode`/`findByName` argument order that already caused test-writing mistakes, `study_sessions` filtering on `id` alone despite having `chapter_id`, `scheduled-jobs.repository.ts` sitting outside the coverage ledger's directory scan) — listed in PR #1087, need filing as real issues once a session has GitHub MCP.

This is the one piece of Wave 0 that was flagged repeatedly (CI/CD audit, code-quality audit, PR #1083's own "debt spotted") as the single highest-risk item in the whole plan, and it's still open: 33 repositories, 0 have direct behavioral tests, only 7 have any indirect coverage via one cross-tenant e2e spec. TypeScript now catches a wrong *type*, but nothing catches a wrong `.eq()` column or a dropped tenant filter — the actual failure mode that matters (cross-tenant data leakage), and the one thing type-wiring in PR #1083 could not fix.

Don't try to reach full behavioral coverage on all 33 in one pass — that's a multi-week job competing with the beta deadline. Scope it down:
1. One shared test harness/fixture (seed two chapters, two users, assert repo methods never return or mutate rows outside the caller's `chapterId`) — build this once.
2. Apply it first to the repositories Wave 1 item 5 will actually touch when it migrates query-key call sites, plus anything security/dues/points-adjacent (members, invites, chapters, points, dues, roles). Treat the rest as backlog, not this pass.
3. Definition of done per repository: one test proving a tenant-scope filter is present and enforced, not full CRUD coverage.
4. Do this before or in parallel with Wave 1 item 5, not after — the whole point is to have a safety net in place before hooks call sites (and therefore real user traffic patterns) start changing.

## Wave 1 — Mechanical fan-out (Cursor cloud agents, parallel, cap 3-5, only after Wave 0 fully merges)

Uses a scratch REFACTOR-PLAN.md at repo root (not under .cursor/) holding the full ranked consolidation queue with file:line detail. Each goal prompt follows this skeleton:

"Read @REFACTOR-PLAN.md, section '[item name]' ONLY. Scope fence: only modify [target package] and the listed importing files. Create REFACTOR-PROGRESS.md listing every target file as an unchecked item; check each off with a one-line note + test result as you finish it; if unsure what remains, re-read this file and continue from the first unchecked item. After each file: run typecheck + scoped test, don't advance until it passes, revert and mark BLOCKED after 3 failed attempts. Definition of done: single shared implementation exists, old duplicates deleted, a repo-wide search for the old pattern returns zero matches outside the new home (paste the command output into the PR), typecheck passes with old exports removed, tests passed before and after, git diff reviewed. Open a draft PR if anything remains — never claim done without the zero-match proof."

One goal per independent item:
1. Consolidate 27 date-formatting functions into @repo/formatting.
2. Consolidate 9 MIME/content-type allowlists + field-limits.ts into @repo/validation.
3. Delete the dead @repo/ui package and its apps/landing dependency entry.
4. Rewrite the 21 chat files importing shim paths to point at @repo/chat-core directly; delete the 6 shim files.
5. Migrate call sites to the chapter-scoped query-key factory built in Wave 0; confirm the 18 previously-ungated keys are fixed. Gotcha flagged by PR #1083: `list(chapterId)` (includes an `undefined` filters slot) and `lists(chapterId)` (the invalidation prefix) are not the same tuple — mount queries on `list`, invalidate with `lists`. State this explicitly in the goal prompt; don't rely on the agent inferring it from the factory code.
6. Consolidate the 8 getErrorMessage implementations into the shared apps/web/lib/utils.ts version; promote mobile's api-error.ts into @repo/api-sdk.
7. Merge the AnalyticsProvider duplicate (web/mobile) into @repo/hooks; delete the stale fork-justifying comment.
8. Move web's 5 stranded hooks (use-org-config, use-custom-roles, use-custom-fields, use-subscription-write-state, use-chapter-theme) into @repo/hooks; wire mobile's module-gating to the shared one.
9. Move subscription.ts (177 loc) into @repo/validation as the third shared client gate alongside can/isModuleEnabled.

## Wave 2 — Batched backfill (Cursor cloud agents, sequential batches)
1. Backfill API response DTOs, ~10 routes per goal, starting with the ~30 highest-traffic routes (/v1/events, /v1/tasks, /v1/chapters/current, /v1/chapters/{id}/config, /v1/points/*, /v1/documents/*, /v1/notifications). Each goal's DoD requires a clean SDK regeneration for its batch (no content?: never left).
2. Once all batches land: flip the ESLint response-schema rule from "warn" to "error"; ratchet the jscpd threshold down to reflect the reduced duplication.

## Explicitly NOT autonomous — stays supervised regardless of wave
- Any judgment call on docs tone/structure, or which incidents graduate to durable rules.
- The Supabase repository work beyond the type-wiring fix (zero test coverage today).
- Anything touching a visually-tested surface — Playwright baselines are pinned to CI's Chromium; an agent "fixing" a failure by regenerating locally silently corrupts the fixture. If a goal ever nears one, tell it explicitly never to regenerate snapshots.

## Known accepted debt (not blocking, revisit later if ever)
- `Insert`/`Update` Supabase types are `Partial` of the row rather than matching what `supabase gen types` would generate (which would make required columns actually required, not optional, on insert). PR #1083 made this call deliberately and flagged `database.types.ts` as intentionally hand-maintained, not to be overwritten. Leave it — the practical gap (catching a wrong-type value) is closed; the remaining gap (catching a missing-required-value) is a smaller, cheaper-to-live-with risk. Only worth revisiting if we ever wire up real Supabase CLI type generation for another reason.

## Process fix: Buildpad → `.buildpad/` sync gap (recurring, second time)
Both PR #1082 and PR #1083's prompts told the agent to read a specific canvas document by title from `.buildpad/` on main. It wasn't there — the canvas has it, but the periodic manual git-sync of the Buildpad canvas into the repo missed it before the prompt ran. This is a process gap, not a one-off: it will keep happening as long as sync is manual and prompts assume it's current.

Fix going forward: before kicking off any Cursor/Claude Code prompt that references a specific canvas document by title, sync `.buildpad/` first and confirm that document is actually present on main (`rg -l "title text"` or `ls`), not just committed to Buildpad at some point. If it's missing, either sync it before running the prompt, or paste the relevant content directly into the prompt instead of pointing at a title. No GitHub MCP was available in the session that hit this, so the debt couldn't be filed as an issue automatically — worth filing #1083's "debt spotted" items as real GitHub issues by hand next session that has MCP access, so they don't just live in a PR description.

## Cost and process guardrails
- Set a conservative monthly Cursor spend limit (~$50-75) before Wave 1 starts — Cursor has no per-run cap, only a monthly one plus manual cancellation.
- Manually review every Cursor-originated PR before merge — no automated review currently applies to non-Claude pushes.
- Batch review 2x/day, same cadence as the existing cutover process.
- Once the project wraps: delete REFACTOR-PLAN.md and REFACTOR-PROGRESS.md, confirm no .cursor/ folder was ever added.