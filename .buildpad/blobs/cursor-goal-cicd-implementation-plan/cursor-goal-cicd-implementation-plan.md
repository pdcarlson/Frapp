# Cursor /goal + CI/CD implementation plan

**Batch 2 — DONE (Aug 20, PR #1105, merged).** MIME/content-type allowlists and `field-limits.ts` consolidated into `@repo/validation`, exactly as scoped below. Fixed the live bug this item existed for: `.gif` now works consistently on Documents, Backwork, and chat. Also same-day: **#1106** closed the five tenant-scope follow-ups from #1087 (#1088-#1092), and **#1104** finished the #1099 shim-cleanup follow-ups + added the missing `@repo/api-sdk` test harness — this closes out the "~7 follow-up items sitting only in PR bodies" gap noted just below. Full detail and next prompts in the new "PR review Aug 20" blob.

**Small debt spotted in that batch, not yet fixed** (prompt in the PR-review blob): dedup `POINTS_REASON_MAX_LENGTH`, harden `releaseDispatch` with a `chapter_id` filter, thaw `apps/mobile/package.json` to declare `@repo/org-archetypes` for real. Plus one real product decision pending (not an agent call): `spec/behavior/branding.md` vs code on chapter-logo MIME/size.

**Next up per REFACTOR-PLAN.md's own sequencing, revised:**
- Small debt cleanup above (no open questions except the branding.md call, which is explicitly out of scope for that prompt).
- **Batch 3 — items 1a (date formatting) and 7 (analytics provider), run in parallel, NOT with item 8.** Still blocked on two decisions — see the PR-review blob for the exact questions. Do not let an agent decide these silently.
- **Then item 8 alone** — most entangled item on the list. Reduced scope recommended: only the 3 portable hooks.
- **Batch 4 — item 5 (query-key factory migration), supervised, split 5a/5b/5c.** Still blocked on the `supabase-notification.repository.ts` tenant-scoping decision noted below.

---