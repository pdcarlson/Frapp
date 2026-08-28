Before starting, sync `.buildpad/` on main and confirm it's current — check that the document titled "code quality/duplication audit" is actually present (`rg -l` if the filename doesn't match the title exactly). If it's missing, stop and flag it rather than proceeding from memory or from the master plan alone; this exact gap has bitten the last two phases.

This phase stays supervised. It exists because PR #1083 fixed the *type* safety of all 33 Supabase repositories but not their *behavioral* safety — nothing today catches a wrong `.eq()` column or a dropped tenant filter, which is the actual failure mode that matters (cross-tenant data leakage). Only 7 of 33 repositories have any indirect coverage today, via one cross-tenant e2e spec.

Don't aim for full CRUD coverage across all 33 — that's a multi-week job and not what's needed right now. Scope:

1. **Build one shared test harness/fixture first.** Seed two chapters and at least one user per chapter. The harness should make it trivial to assert "this repository method never returns or mutates a row belonging to a chapter other than the one passed in." Show me this harness and a passing test against one repository before doing the rest.

2. **Apply it to a prioritized subset, not all 33:**
   - Repositories Wave 1 item 5 (query-key call-site migration) will actually touch.
   - Anything security- or money-adjacent: members, invites, chapters, roles, points, dues.
   - Leave the remaining repositories as backlog — list them explicitly in the PR description as not yet covered, don't imply full coverage if it isn't there.

3. **Definition of done per repository in scope: one test that proves a tenant-scope filter is present and enforced** (e.g., querying/mutating with chapter A's ID cannot see or touch chapter B's rows), not exhaustive method coverage. If a repository has an obvious second high-risk path (e.g., a role/permission check baked into a query), add a second test for that specifically — use judgment, don't pad for coverage percentage.

4. Run the full existing test suite after each repository to confirm nothing regresses. Show me each repository's tests passing before moving to the next; don't batch this into one giant diff.

5. In the PR description, list which of the 33 repositories now have tenant-scope tests, which don't, and which specific ones you'd prioritize next if this continues in a future pass.

Do this before or in parallel with Wave 1 item 5 (query-key migration) — the goal is to have this safety net in place before those call sites change, not after.