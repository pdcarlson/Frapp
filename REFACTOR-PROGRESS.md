# REFACTOR-PROGRESS.md

Scaffold only. One line per [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md) item. Each Wave 1 goal checks off
its own line with a one-line note and its test result.

**Execution state only — not a tracker.** Real work items, deferred findings, and blockers go to
GitHub Issues with the `triage` label, per `AGENTS.md` ("Never track work in a scratch file") and
[`.claude/skills/file-follow-up/SKILL.md`](.claude/skills/file-follow-up/SKILL.md). This file is
deleted when the project wraps, so nothing durable may live only here.

- [ ] 1. Date-formatting functions → `@repo/formatting`
- [ ] 2. MIME/content-type allowlists + `field-limits.ts` → `@repo/validation`
- [ ] 3. Delete the dead `@repo/ui` package and its dependency entries
- [ ] 4. Chat shim imports → `@repo/chat-core`; delete the 6 shim files
- [ ] 5. Query-key call sites → `createChapterQueryKeys`
- [x] 6. `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk` — one helper, 8 dupes deleted, 4 mobile importers rewired. Before: web 54/474, mobile 50/587. After: web 55/477 (3 new `utils.test.ts` cases), mobile 50/587. `check-types` pass. `check:dep-cruiser` pass. PR #1098.
- [ ] 7. `AnalyticsProvider` (web/mobile) → `@repo/hooks`
- [ ] 8. 5 stranded web hooks → `@repo/hooks`; wire mobile's module-gating
- [x] 9. `apps/web/lib/subscription.ts` → `@repo/validation`
  - [x] File move: `apps/web/lib/subscription.ts` → `packages/validation/src/subscription.ts` (barrel re-export from `src/index.ts`) — named exports match `can` / `isModuleEnabled`. `npm run test -w @repo/validation -- src/subscription.spec.ts`: 9 passed.
  - [x] Importer: `apps/web/lib/hooks/use-subscription-write-state.ts` — `@/lib/subscription` → `@repo/validation`. `npm run check-types`: 20/20 packages.
  - [x] Importer: `apps/web/components/shared/subscription-gate.tsx` — types now from `@repo/validation`. `npm run test -w apps/web -- subscription-gate`: 20 passed.
  - [x] Importer: `apps/web/components/shared/subscription-gate.test.tsx` — `SubscriptionWriteClass` now from `@repo/validation`. Same suite: 20 passed.
  - [x] Importer: `apps/web/lib/subscription.test.ts` (moves with the file → `packages/validation/src/subscription.spec.ts`) — suite unchanged except a move comment. `npm run test -w @repo/validation -- src/subscription.spec.ts`: 9 passed. Full package: 95 passed / 7 files.

## Item 6 inventory

Baseline (before edits): `npm run test -w apps/web` → 54 files / 474 passed; `npm run test -w apps/mobile` → 50 files / 587 passed.
After: web 55 / 477; mobile 50 / 587. `npm run check-types` 20/20. `npm run check:dep-cruiser` 7 baselined / 0 new.

### Implementations (9)

- [x] Canonical — `apps/web/lib/utils.ts` `getErrorMessage(error, fallback)` — unchanged body; pinned by `utils.test.ts` (plain-object / Error / fallback). After: 3 new tests passed.
- [x] Dupe, `instanceof Error` — `apps/web/components/points-adjustment-dialog.tsx` — deleted; imports `@/lib/utils`. After: `points-adjustment-dialog.test.tsx` still green in the 477.
- [x] Dupe, `instanceof Error` — `apps/web/components/events/event-editor-dialog.tsx` — deleted; imports `@/lib/utils`. After: `event-editor-dialog.test.tsx` green.
- [x] Dupe, `instanceof Error` — `apps/web/components/events/event-detail-sheet.tsx` — deleted; imports `@/lib/utils`. After: `event-detail-sheet.test.tsx` green.
- [x] Dupe, `instanceof Error` — `apps/web/components/members/member-detail-sheet.tsx` — deleted; added to existing `asArray` import. After: `member-detail-sheet.test.tsx` green.
- [x] Dupe, `instanceof Error` — `apps/web/components/members/invite-member-dialog.tsx` — deleted; imports `@/lib/utils`. After: `invite-member-dialog.test.tsx` green.
- [x] Dupe, already `"message" in` — `apps/web/app/sign-up/page.tsx` — deleted; fallback passed as argument (`Please try again.`).
- [x] Dupe, already `"message" in` — `apps/web/app/sign-in/page.tsx` — deleted; both toasts pass `Please try again.`
- [x] Dupe, already `"message" in` (no return type) — `apps/web/app/join/page.tsx` — deleted; fallback passed as argument.

### Call sites that change (11; 7 change user-visible copy)

- [x] `points-adjustment-dialog.tsx` adjust-points toast — **copy change** — now `getErrorMessage(error, "Something went wrong. Please retry.")`. After: web 477.
- [x] `event-editor-dialog.tsx` create/update toast — **copy change** — same fallback. After: web 477.
- [x] `event-detail-sheet.tsx` delete toast — **copy change** — same fallback. After: web 477.
- [x] `member-detail-sheet.tsx` update-roles toast — **copy change** — same fallback. After: web 477.
- [x] `member-detail-sheet.tsx` remove-member toast — **copy change** — same fallback. After: web 477.
- [x] `invite-member-dialog.tsx` generate-invite toast — **copy change** — same fallback. After: web 477.
- [x] `invite-member-dialog.tsx` revoke-invite toast — **copy change** — same fallback. After: web 477.
- [x] `sign-up/page.tsx` create-account toast — fallback is now an argument (`Please try again.`); behavior unchanged.
- [x] `sign-in/page.tsx` password-sign-in toast — fallback is now an argument; behavior unchanged.
- [x] `sign-in/page.tsx` magic-link toast — fallback is now an argument; behavior unchanged.
- [x] `join/page.tsx` redeem-invite toast — fallback is now an argument; behavior unchanged.

### Call sites already on the canonical helper (51; no change)

- [x] `tasks-board.tsx` (5) — already `@/lib/utils`; no edit. After: web 477.
- [x] `study-page.tsx` (4) — already `@/lib/utils`; no edit. After: web 477.
- [x] `settings-roles-tab.tsx` (3) — already `@/lib/utils`; no edit. After: web 477.
- [x] `settings-page.tsx` (5) — already `@/lib/utils`; no edit. After: web 477.
- [x] `chapter-wizard.tsx` (2) — already `@/lib/utils`; no edit. After: web 477.
- [x] `geofences-admin-page.tsx` (4) — already `@/lib/utils`; no edit. After: web 477.
- [x] `documents-page.tsx` (3) — already `@/lib/utils`; no edit. After: web 477.
- [x] `chat/renderers/task-card.tsx` (1) — already `@/lib/utils`; no edit. After: web 477.
- [x] `service-page.tsx` (5) — already `@/lib/utils`; no edit. After: web 477.
- [x] `roles-page.tsx` (4) — already `@/lib/utils`; no edit. After: web 477.
- [x] `profile-panel.tsx` (3) — already `@/lib/utils`; no edit. After: web 477.
- [x] `polls-page.tsx` (2) — already `@/lib/utils`; no edit. After: web 477.
- [x] `settings-fields-tab.tsx` (3) — already `@/lib/utils`; no edit. After: web 477.
- [x] `chat/renderers/event-card.tsx` (1) — already `@/lib/utils`; no edit. After: web 477.
- [x] `subscription-checkout-card.tsx` (2) — already `@/lib/utils`; no edit. After: web 477.
- [x] `invoice-admin-card.tsx` (2) — already `@/lib/utils`; no edit. After: web 477.
- [x] `backwork-page.tsx` (2) — already `@/lib/utils`; no edit. After: web 477.

### Mobile `api-error.ts` → `@repo/api-sdk`

- [x] Promote `apps/mobile/lib/api-error.ts` to `packages/api-sdk/src/api-error.ts` (no test harness) — git recorded as a rename; `statusOf`/`serverMessageOf`/`codeOf` unchanged. After: mobile 587; `check-types -w @repo/api-sdk` pass.
- [x] Export from `packages/api-sdk/src/index.ts` (`.` only; no subpath) — `export * from './api-error'`. After: api-sdk lint + check-types pass.
- [x] Rewire `apps/mobile/lib/study/errors.ts` — `from "@repo/api-sdk"`. After: `errors.spec.ts` still covers `statusOf`/`serverMessageOf` via re-export (587).
- [x] Rewire `apps/mobile/lib/dues/pay-errors.ts` — `from "@repo/api-sdk"`. After: `pay-errors.spec.ts` green (587).
- [x] Rewire `apps/mobile/app/(tabs)/study.tsx` — `from "@repo/api-sdk"`. After: mobile check-types pass.
- [x] Rewire `apps/mobile/app/(tabs)/check-in.tsx` — `from "@repo/api-sdk"`. After: mobile check-types pass.
- [x] Delete `apps/mobile/lib/api-error.ts` — `ls` → No such file. Grep for `from "…api-error"` only hits the sdk barrel.
