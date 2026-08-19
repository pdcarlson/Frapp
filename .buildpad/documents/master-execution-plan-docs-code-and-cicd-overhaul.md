Guiding rule: Cursor is a one-project tool for mechanical fan-out only. No .cursor/ folder, no Cursor-specific config added to the repo. Everything written into AGENTS.md/skills is Claude-Code-only, zero mention of Cursor. Two scratch files (REFACTOR-PLAN.md, REFACTOR-PROGRESS.md) live at repo root, tool-neutral, deleted when the project wraps.

## Wave 0 — Foundation (Claude Code, supervised, serialized, must fully merge before any fan-out)

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
1. Supabase repository layer: wire the generated Database type properly into the client (TablesInsert/TablesUpdate generics) so the as never casts disappear. Do this by hand, or add real repository tests first — 33 repos have zero tests today, flagged as the single highest-risk item in the whole plan.
2. Build the chapter-scoped query-key factory shell in packages/hooks — Wave 1 call sites migrate to this.
3. Fix the real bugs already found regardless of anything else: /polls and /backwork infinite-spinner (disabled-query pattern never resolves), chat-card poll vote missing domain validation (no open/closed or single-choice check), settings-page sharing one isPending across all 4 tabs.

## Wave 1 — Mechanical fan-out (Cursor cloud agents, parallel, cap 3-5, only after Wave 0 fully merges)

Uses a scratch REFACTOR-PLAN.md at repo root (not under .cursor/) holding the full ranked consolidation queue with file:line detail. Each goal prompt follows this skeleton:

"Read @REFACTOR-PLAN.md, section '[item name]' ONLY. Scope fence: only modify [target package] and the listed importing files. Create REFACTOR-PROGRESS.md listing every target file as an unchecked item; check each off with a one-line note + test result as you finish it; if unsure what remains, re-read this file and continue from the first unchecked item. After each file: run typecheck + scoped test, don't advance until it passes, revert and mark BLOCKED after 3 failed attempts. Definition of done: single shared implementation exists, old duplicates deleted, a repo-wide search for the old pattern returns zero matches outside the new home (paste the command output into the PR), typecheck passes with old exports removed, tests passed before and after, git diff reviewed. Open a draft PR if anything remains — never claim done without the zero-match proof."

One goal per independent item:
1. Consolidate 27 date-formatting functions into @repo/formatting.
2. Consolidate 9 MIME/content-type allowlists + field-limits.ts into @repo/validation.
3. Delete the dead @repo/ui package and its apps/landing dependency entry.
4. Rewrite the 21 chat files importing shim paths to point at @repo/chat-core directly; delete the 6 shim files.
5. Migrate call sites to the chapter-scoped query-key factory built in Wave 0; confirm the 18 previously-ungated keys are fixed.
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

## Cost and process guardrails
- Set a conservative monthly Cursor spend limit (~$50-75) before Wave 1 starts — Cursor has no per-run cap, only a monthly one plus manual cancellation.
- Manually review every Cursor-originated PR before merge — no automated review currently applies to non-Claude pushes.
- Batch review 2x/day, same cadence as the existing cutover process.
- Once the project wraps: delete REFACTOR-PLAN.md and REFACTOR-PROGRESS.md, confirm no .cursor/ folder was ever added.