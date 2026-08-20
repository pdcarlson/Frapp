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
- [ ] 6. `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk`
- [ ] 7. `AnalyticsProvider` (web/mobile) → `@repo/hooks`
- [ ] 8. 5 stranded web hooks → `@repo/hooks`; wire mobile's module-gating
- [ ] 9. `apps/web/lib/subscription.ts` → `@repo/validation`

## Item 6 inventory

Baseline (before edits): `npm run test -w apps/web` → 54 files / 474 passed; `npm run test -w apps/mobile` → 50 files / 587 passed.

### Implementations (9)

- [ ] Canonical — `apps/web/lib/utils.ts` `getErrorMessage(error, fallback)` (reads `"message" in` a plain object)
- [ ] Dupe, `instanceof Error` — `apps/web/components/points-adjustment-dialog.tsx`
- [ ] Dupe, `instanceof Error` — `apps/web/components/events/event-editor-dialog.tsx`
- [ ] Dupe, `instanceof Error` — `apps/web/components/events/event-detail-sheet.tsx`
- [ ] Dupe, `instanceof Error` — `apps/web/components/members/member-detail-sheet.tsx`
- [ ] Dupe, `instanceof Error` — `apps/web/components/members/invite-member-dialog.tsx`
- [ ] Dupe, already `"message" in` — `apps/web/app/sign-up/page.tsx`
- [ ] Dupe, already `"message" in` — `apps/web/app/sign-in/page.tsx`
- [ ] Dupe, already `"message" in` (no return type) — `apps/web/app/join/page.tsx`

### Call sites that change (11; 7 change user-visible copy)

- [ ] `points-adjustment-dialog.tsx` adjust-points toast — **copy change** (was `instanceof Error`)
- [ ] `event-editor-dialog.tsx` create/update toast — **copy change** (was `instanceof Error`)
- [ ] `event-detail-sheet.tsx` delete toast — **copy change** (was `instanceof Error`)
- [ ] `member-detail-sheet.tsx` update-roles toast — **copy change** (was `instanceof Error`)
- [ ] `member-detail-sheet.tsx` remove-member toast — **copy change** (was `instanceof Error`)
- [ ] `invite-member-dialog.tsx` generate-invite toast — **copy change** (was `instanceof Error`)
- [ ] `invite-member-dialog.tsx` revoke-invite toast — **copy change** (was `instanceof Error`)
- [ ] `sign-up/page.tsx` create-account toast — fallback becomes an argument (behavior unchanged)
- [ ] `sign-in/page.tsx` password-sign-in toast — fallback becomes an argument (behavior unchanged)
- [ ] `sign-in/page.tsx` magic-link toast — fallback becomes an argument (behavior unchanged)
- [ ] `join/page.tsx` redeem-invite toast — fallback becomes an argument (behavior unchanged)

### Call sites already on the canonical helper (51; no change)

- [ ] `tasks-board.tsx` (5)
- [ ] `study-page.tsx` (4)
- [ ] `settings-roles-tab.tsx` (3)
- [ ] `settings-page.tsx` (5)
- [ ] `chapter-wizard.tsx` (2)
- [ ] `geofences-admin-page.tsx` (4)
- [ ] `documents-page.tsx` (3)
- [ ] `chat/renderers/task-card.tsx` (1)
- [ ] `service-page.tsx` (5)
- [ ] `roles-page.tsx` (4)
- [ ] `profile-panel.tsx` (3)
- [ ] `polls-page.tsx` (2)
- [ ] `settings-fields-tab.tsx` (3)
- [ ] `chat/renderers/event-card.tsx` (1)
- [ ] `subscription-checkout-card.tsx` (2)
- [ ] `invoice-admin-card.tsx` (2)
- [ ] `backwork-page.tsx` (2)

### Mobile `api-error.ts` → `@repo/api-sdk`

- [ ] Promote `apps/mobile/lib/api-error.ts` to `packages/api-sdk/src/api-error.ts` (no test harness)
- [ ] Export from `packages/api-sdk/src/index.ts` (`.` only; no subpath)
- [ ] Rewire `apps/mobile/lib/study/errors.ts`
- [ ] Rewire `apps/mobile/lib/dues/pay-errors.ts`
- [ ] Rewire `apps/mobile/app/(tabs)/study.tsx`
- [ ] Rewire `apps/mobile/app/(tabs)/check-in.tsx`
- [ ] Delete `apps/mobile/lib/api-error.ts`
