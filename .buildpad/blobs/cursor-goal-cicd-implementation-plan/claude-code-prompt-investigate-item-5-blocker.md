Run this in Claude Code, local, supervised. This is investigation-only — no query-key migration work yet, and no repository code changes unless a real bug is found (see step 3).

---

**Context:** Wave 1 item 5 (migrate call sites to the chapter-scoped query-key factory) is blocked. `supabase-notification.repository.ts` was one of the 9 repositories PR #1087 deferred from tenant-scope test coverage, and its own coverage-ledger entry says "correct scoping is still undecided" — meaning nobody has confirmed whether notifications *should* be strictly chapter-scoped or whether some notification types are legitimately cross-chapter/global (e.g. system-wide announcements, a user's own notifications regardless of which chapter they're currently viewing).

**Do this:**

1. Read `supabase-notification.repository.ts` and every caller. For each query/write method, determine: does it filter by `chapter_id`? Should it? Walk through the actual notification types in the system (task/event/points/chat/system, etc.) and classify each as chapter-scoped or legitimately cross-chapter.
2. Check how the 18 currently-unscoped query-key call sites (flagged in PR #1083/#1095) actually use this repository — is there a real risk of a user seeing another chapter's notifications, or is the current behavior correct and just untested?
3. If you find an actual cross-tenant leak: fix it directly (same pattern as the `transferPresidency` fix in #1087) rather than just reporting it — this is a security-adjacent finding, not routine debt.
4. If there's no live bug but the scoping model is genuinely ambiguous (e.g. "should a notification follow the user or the chapter they were in when it fired"): do not decide this yourself. Write up the concrete scenarios and the tradeoff, and stop — this is a product decision for Paul.
5. Once scoping is confirmed correct (or fixed), write the tenant-scope characterisation test for this repository using the existing shared harness from #1087, and update the coverage ledger.

**Report back:** the scoping determination per notification type, whether any live bug was found and fixed, the new test, and — if applicable — the specific product question that needs Paul's decision before item 5's query-key migration can safely include this repository.