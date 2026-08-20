Run this in Cursor as a new background agent / goal, cut from latest `main`. Three small, disjoint, no-decision-required items.

---

**Context:** Spotted during review of #1112 and #1117 (both merged). GitHub MCP has been unreliable in recent sessions (`serverStatus: error`) and several follow-ups went undocumented as issues. Check MCP availability at the start of this session; if it works, file issues for anything you don't finish before ending the session (search first, don't duplicate). If it's still down, say so explicitly rather than silently skipping the filing step.

**Do these three, independently:**

1. **Add a dedicated characterisation test for `findIncompleteTasksDueBetween`.** In the scheduled-jobs repository, this query is currently only covered by a sweep-comment, unlike its siblings for events and invoices which each have a real characterisation test. Add one that matches the pattern used for the events/invoices equivalents (same file, same style). This has been carried over as noted debt twice now (#1106, then #1112) without being fixed — fix it this time.

2. **Decide the fate of `useAnalytics`.** This hook has zero production callers — enforcement of the analytics opt-out gate happens directly inside `AnalyticsProvider.track` on both web and mobile (landed in #1117), not through this hook. Check every remaining reference. If nothing legitimately needs the hook as a public API, delete it and its tests. If there's a reason to keep it (e.g. planned use, or some call site you find that isn't obvious from a grep), leave it and report exactly why instead of silently deleting or silently leaving it — this is dead-code hygiene, not a design call.

3. **Fix the stale text on issue #342.** The suggested-fix language on "Add chapter logo upload controls to web Settings" (#342) still says logo uploads should be validated as PNG/JPG/WebP under 2MB. #1113 corrected the spec to match code: logos now follow the shared `image` upload kind (GIF included, 25MB cap via `MAX_UPLOAD_BYTES`). Post a comment on #342 correcting the suggested-fix text to say implementers should call `inspectUploadFile("image", file)` and use `MAX_UPLOAD_LABEL`, not a private MIME/size list. Do not build the actual upload UI in this pass — that's a separate, larger prompt (see this blob).

**Explicitly out of scope for this pass:** do not touch the React Compiler lint rules (separate prompt, larger scope) and do not build the logo upload screen itself (separate prompt).

**Test plan to report back:** full check-types, the scoped test suite for scheduled-jobs, a repo-wide grep confirming no other `useAnalytics` references were missed, and confirmation the #342 comment was posted (or an explicit note that MCP was down and it wasn't).