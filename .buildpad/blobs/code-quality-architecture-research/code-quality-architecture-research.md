# Code quality & architecture research

Goal: audit the actual codebase for duplication/inconsistency, then research best practices for reusability/consistency/maintainability in a TypeScript monorepo built primarily by AI agents.

**Wave 0 Phase 3 — DONE (Aug 20, PR #1083, merged).** Typed all 33 Supabase repositories + service-layer writes with `TablesInsert`/`TablesUpdate` (zero `as never` left), injected `FrappSupabaseClient` at every `SUPABASE_CLIENT` site, built the chapter-scoped query-key factory shell (`createChapterQueryKeys`, call sites not migrated yet), and fixed all 3 known live bugs (disabled-query spinners, chat-card poll vote validation, per-tab settings pending state). No generic base repository, as directed.

**Debt carried forward, see master execution plan doc for the full write-up and the new Wave 0D:**
1. **Still the top risk**: the type-wiring fix did not add behavioral tests. 33 repositories, 0 direct tests, 7 with indirect coverage. Nothing catches a wrong `.eq()` column or a dropped tenant filter yet. This needs a dedicated supervised pass (Wave 0D, see master plan) before Wave 1 migrates query-key call sites into these same files.
2. `Insert`/`Update` stayed `Partial` of the row (weaker than generated Supabase types would be) — accepted deliberately, low priority, see master plan's "known accepted debt."
3. Query-key factory has a real tuple gotcha (`list` vs `lists`) that Wave 1's prompt must state explicitly, not leave implicit.
4. The audit document this phase's prompt pointed at wasn't actually in `.buildpad/` on main — second time this exact gap has happened. Process fix logged in the master plan doc.

---

**Research findings (Aug 19):** the core insight ties directly to the docs research — the same "discover divergence, document it, never merge it" pattern shows up in code, and the fix is the same move: replace prose that narrates a problem with a mechanism that fails until it's fixed.

Concrete, ranked recommendations:
1. Turn on an ESLint rule (@darraghor/eslint-plugin-nestjs-typed) that fails lint on any API route missing a response schema — stops the root-cause 88%-untyped problem from growing, no rewrite needed. Backfill existing routes with NestJS's Swagger CLI plugin. Add CI gates: regenerate the SDK and fail if it diffs from committed, plus a spec-diff gate (oasdiff) for breaking changes.
2. Fix the live mobile cache bug at the type level: make chapterId a mandatory first argument in a shared query-key factory (packages exist for this, e.g. query-key-factory) so a key missing the tenant scope is a type error, not a silent stale-data bug.
3. Fix the `as never` Supabase casts by properly wiring the generated Database type into the client (TablesInsert/TablesUpdate generics) — this is a known Supabase footgun with a documented fix, not a sign a generic base-repository class is needed. Research pushed back on the audit's base-class idea: a generic repository is not a standard Supabase pattern and is a well-known anti-pattern past simple CRUD — do a thin base only for the truly identical findById/create/update/delete shape, leave entity-specific queries alone.
4. Real fix for "documented but never merged": a duplicate-detection ratchet (jscpd wired into CI, or imbue-ai/ratchets for a true grandfather-existing/fail-on-new baseline) plus architectural boundary linting (dependency-cruiser, which has a built-in --ignore-known baseline) so banned patterns fail CI instead of getting noticed in a comment.
5. Agent-specific fix, most directly relevant to us: jscpd ships an official agent skill + MCP tools built for exactly this — an agent runs duplicate-check, refactors, re-runs the check to confirm the clone is gone, before considering a task done. This is the mechanism to adopt: make "duplication check passes" part of an agent's definition-of-done, not a courtesy comment.
6. Shared permission/gate logic: CASL is the standard isomorphic pattern (one ability definition, server enforces, client serializes/unpacks the same rules) — fixes the "mobile has no subscription gate" gap by import instead of reimplementation.
7. DRY vs WET line: unify only things that are the same *fact* that must change together (date formatting, MIME allowlists both qualify, and MIME already proved it by drifting into a real bug). Don't force an abstraction — Sandi Metz's rule: "duplication is far cheaper than the wrong abstraction," and the tell is needing new parameters/conditionals in shared code to fit a new caller.

Suggested sequence: response-schema ESLint gate first (stops the bleeding) → query-key factory + Supabase type wiring (kills two live bugs) → jscpd/dependency-cruiser ratchets + agent definition-of-done skill (stops the pattern recurring for good) → CASL shared gate + thin repository base (consolidation) → ts-rest migration only if wanted later, not required.

**Audit findings (Aug 19):** architecture is sound, discipline is high — but the codebase has the exact same failure pattern as the docs audit: a divergence gets discovered, carefully documented in a comment explaining why two copies exist, and left in place. The comment becomes the deliverable instead of the merge.

Root cause with the biggest blast radius: 142 of 162 API routes (88%) declare no response schema, so the generated SDK types those routes as `never`. That single gap cascades into 168 `Record` casts, 122 `unknown` params, 83 `as never` casts (mostly at the Supabase write boundary), a whole mobile "narrow.ts" convention that exists only to work around it, and at least 3 duplicated `Chapter` type definitions. Fixing this unlocks most of the rest.

Concrete duplication found: 27 near-identical date-formatting functions across 5 names; 9 copies of MIME/content-type allowlists across 3 layers, already out of sync (a .gif uploads on one page, silently rejected on the structurally identical page next to it); 8 duplicate `getErrorMessage` implementations, 5 of which use `instanceof Error` and silently swallow real server error messages; a dead `@repo/ui` package with zero importers anywhere, sitting alongside the real UI components elsewhere; 6 leftover chat migration shim files that say "delete in the cleanup PR" (never landed); 18 of 55 cache query keys not chapter-scoped, a live correctness bug on mobile (can serve stale data from the previous chapter after switching); mobile has no subscription/billing gate at all (the other two client-side gates — permissions, modules — are shared, this one lives web-only); 33 hand-written Supabase repositories with no base class, ~900-1,200 removable lines.

Good pattern already in the codebase worth generalizing: chat-core's shared interface + per-platform adapter (web injects Dexie, mobile injects AsyncStorage, zero duplicated logic) — audit calls this "the shape every cross-surface concern should take."

---

Spec-vs-code precedence, decided: spec = source of truth for intended behavior, code = source of truth for current behavior. Disagreement between them is a tracked bug, not something the agent silently resolves. Default on conflict: flag/investigate which one is actually correct, don't guess.

Naming: parked indefinitely, not a current priority.