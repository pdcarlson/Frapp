Before starting, sync `.buildpad/` and confirm it's current, then read the document titled "Master execution plan: docs, code, and CI/CD overhaul" under `.buildpad/` for full context. Do not proceed if that document isn't actually present — flag it instead of working from memory.

This is a planning-only pass, not execution. Wave 0 is fully merged. The next phase (Wave 1) is 9 independent mechanical consolidations that will each run as a separate, isolated Cursor cloud agent goal later. Before any of those fire, build one shared plan file so each goal has exact scope instead of re-discovering it:

1. Create `REFACTOR-PLAN.md` at repo root (not under `.cursor/`) with one section per item below. For each: exact file:line locations of every instance to be consolidated, the proposed shared home (package/file), and every call site that will need to change. Verify counts against the actual codebase now — the numbers below are from an earlier audit and may have drifted:
   - 27 date-formatting functions → consolidate into `@repo/formatting`
   - 9 MIME/content-type allowlists + `field-limits.ts` → consolidate into `@repo/validation`
   - Dead `@repo/ui` package and its `apps/landing` dependency entry → delete
   - 21 chat files importing shim paths → point at `@repo/chat-core` directly, delete the 6 shim files
   - Query-key call sites → migrate onto the chapter-scoped factory built in Wave 0 (`createChapterQueryKeys` in `packages/hooks`). Note the tuple gotcha: `list(chapterId)` (has an `undefined` filters slot) and `lists(chapterId)` (invalidation prefix) are not the same tuple — queries mount on `list`, invalidation calls use `lists`. Cross-reference this against the 24 repositories with tenant-scope tests from PR #1087 and flag any call site touching one of the other 9 (no test coverage yet) as higher-risk in the plan.
   - 8 `getErrorMessage` implementations → consolidate into the `apps/web/lib/utils.ts` version, promote mobile's `api-error.ts` into `@repo/api-sdk`
   - `AnalyticsProvider` duplicate (web/mobile) → merge into `@repo/hooks`, delete the stale fork-justifying comment
   - 5 stranded web hooks (`use-org-config`, `use-custom-roles`, `use-custom-fields`, `use-subscription-write-state`, `use-chapter-theme`) → move into `@repo/hooks`, wire mobile's module-gating to the shared one
   - `subscription.ts` (177 loc) → move into `@repo/validation` as a third shared client gate alongside `can`/`isModuleEnabled`

2. Create `REFACTOR-PROGRESS.md` as an empty scaffold — one unchecked line per item above, nothing else yet.

3. For each item, flag anything that turns out NOT cleanly disjoint from another item on this list (shared files, overlapping call sites) so we don't fire two parallel goals that touch the same file.

4. Stop here. Do not consolidate anything yet. Report back: the finished plan, any item whose real scope is bigger/smaller than the audit assumed, and your recommendation for which 3-5 items are safest to run as the first parallel batch given review bandwidth is the actual constraint, not agent capacity.