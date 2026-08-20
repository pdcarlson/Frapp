Read `REFACTOR-PLAN.md`, section "Item 9 — subscription.ts client gate" ONLY (from PR #1095). Scope fence: the client-side `subscription.ts` (177 lines) and its 4 importers only.

Note: there is a separate, unrelated `apps/api/src/domain/utils/subscription.ts` (server-side) flagged elsewhere as an orphan with a real bug. Do not touch that file — it's out of scope for this item and will be handled separately.

Move the client-side `subscription.ts` into `@repo/validation` as a third shared client gate alongside the existing `can` and `isModuleEnabled` gates. Update all 4 importers to the new path.

Create/append `REFACTOR-PROGRESS.md` listing the file move and each of the 4 importers as unchecked items; check off with a one-line note + test result.

Definition of done: file lives in `@repo/validation`, exports the same shape `can`/`isModuleEnabled` use, all 4 importers updated, the test that covers this logic moved with it and still passes, typecheck passes, zero remaining imports of the old path (paste the grep). Open a draft PR if anything remains.