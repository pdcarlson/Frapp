Use this as the Cursor `/goal` (or Claude Code) prompt for Wave 1 Batch 2, item 2 from `REFACTOR-PLAN.md`. Run this only after Batch 1 (items 3, 4, 6, 9 — all merged as of PRs #1096-#1099) and sequence it after item 9 specifically, since both touch `packages/validation/src/index.ts`.

---

**Task: Wave 1 Item 2 from REFACTOR-PLAN.md — consolidate MIME/content-type allowlists and `field-limits.ts` into `@repo/validation`, and fix the live GIF upload bug.**

Read the full "Item 2" section of `REFACTOR-PLAN.md` on `main` before starting — it has the exact file:line inventory, the confirmed live bug, and the scope fence. Do not re-derive this from scratch; the plan has already done the audit.

**The live bug you are fixing:** `image/gif` uploads succeed on the Documents page and are silently rejected on the structurally identical Backwork page — client-side, before the API is even called. The Backwork API service and its storage bucket both already accept GIFs; only the Backwork web page's allowlist omits it. This is a real drift bug, not just duplication, and needs a regression test that would have caught it.

**Scope:**
- `packages/validation/src/**` — new shared MIME/extension allowlist module(s), following the existing single-entry-point convention (no subpath exports; add `export { … } from "./<name>"` to `src/index.ts`).
- The 6 API service files with inline allowlists (`user.service.ts`, `chapter.service.ts`, `service-entry.service.ts`, `chapter-document.service.ts`, `backwork.service.ts`, `chat.service.ts`) and their companion extension sets.
- `apps/api/src/domain/constants/field-limits.ts` and its 9 DTO importers.
- The three web upload pages (`documents-page.tsx`, `backwork-page.tsx`, `service-page.tsx`) and `apps/web/components/chat/composer.tsx` (currently has no `accept` attribute at all and forwards raw `file.type` unrestricted — fold this into scope).
- `apps/mobile/lib/tasks/limits.ts` (hand-copies `POINTS_MAX` instead of importing).
- The three `supabase/migrations/*.sql` files — comment cross-references only. **Do not alter shipped migration DDL.** If a bucket policy genuinely needs to change, add a new migration rather than editing an existing one.

**Fix while you're in these files (already identified, not new discretion):**
1. The GIF drift bug (add it consistently, with a regression test).
2. `packages/validation/src/index.ts`'s `SendChatMessageSchema` hardcodes `.max(10_000)` instead of importing `CHAT_MESSAGE_CONTENT_MAX_LENGTH` from `field-limits.ts`.
3. `backwork-page.tsx` locally redefines `SEMESTERS`, `ASSIGNMENT_TYPES`, `DOCUMENT_VARIANTS` — byte-identical to constants already in `packages/validation/src/index.ts`. The file is already open for the MIME fix; consolidate these too.
4. Legacy Office MIME types (`.doc`/`.xls`/`.ppt`) are allowed server-side and by all buckets, but absent from every web client's map/accept. Decide: add to client, or drop from server. Don't leave it silently mismatched.
5. No client-side `file.size` check exists anywhere — 25MB is copy-only today. Add a shared check alongside the new shared limits.

**Definition of done (floor requirements from REFACTOR-PLAN.md apply):**
- Single shared implementation; old duplicates deleted, not re-exported.
- Repo-wide grep proof for the old inline patterns returns zero matches outside the new home — paste command + output into the PR.
- `npm run check-types`, `npm run check:dep-cruiser` pass.
- Scoped tests pass before and after (`apps/api`, `apps/web`, `apps/mobile` as touched).
- Update `spec/behavior/chapter-docs.md` (the upload allowlist is documented behavior) and `spec/architecture/README.md`'s `@repo/validation` catalog row.
- File any new out-of-scope debt as `triage`-labeled GitHub issues via GitHub MCP per `.claude/skills/file-follow-up/SKILL.md`. **If GitHub MCP is unavailable in this session, stop and say so explicitly in the PR body rather than silently degrading to a debt list — that pattern has now repeated 6 times across prior PRs (#1083, #1087, #1096-#1099) and needs to stop being silent.**

**Collision note:** hard collision with item 9 (already merged, PR #1097) on `packages/validation/src/index.ts` — you're building on top of that, not colliding with an open PR. Soft collision with item 1 (not yet run) on `documents-page.tsx`. Disjoint from items 3, 4, 6, 9's other files (all already merged).
