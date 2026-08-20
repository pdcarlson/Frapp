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
  See **Item 4 file list** below (23 importers + 6 shims). Plan count is 23
  files, not the prompt's "21": 21 `@/` alias importers + 2 relative importers
  (`use-chat-channel.ts`, `chat-provider.tsx`) that an alias-only grep misses.
- [ ] 5. Query-key call sites → `createChapterQueryKeys`
- [ ] 6. `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk`
- [ ] 7. `AnalyticsProvider` (web/mobile) → `@repo/hooks`
- [ ] 8. 5 stranded web hooks → `@repo/hooks`; wire mobile's module-gating
- [ ] 9. `apps/web/lib/subscription.ts` → `@repo/validation`

---

## Item 4 — file-level cutover (Wave 1 / PR #1095)

Verified against current tree on `cursor/chat-shim-imports-item4-632c` (from
`origin/main` at `8a742997`). Import style: `@repo/chat-core/<subpath>` to match
mobile and `spec/ui/mobile/patterns.md` ("Import `@repo/chat-core` by subpath").
Tracking issue: #1076 (five `lib/chat` shims); Item 4 also deletes the sixth
shim `lib/realtime/topic-registry.ts`.

### Baseline (before rewrites)

- [x] Baseline `@repo/chat-core` tests — **30/30 passed** (`vitest run`, 5 files). Log: `/opt/cursor/artifacts/baseline_chat_core_tests.log`
- [x] Baseline web chat tests — **116/116 passed** (`vitest run components/chat lib/chat lib/realtime`, 9 files). Log: `/opt/cursor/artifacts/baseline_web_chat_tests.log`
- [x] Baseline `apps/web` typecheck — `next typegen && tsc --noEmit` exits 2 with **16 pre-existing** `error TS` in `packages/chapter-theme/src/vendor/generate-radix-colors.ts` (that package disables `noUncheckedIndexedAccess` for the vendor file; web's Next tsconfig re-typechecks the `import` condition source). **Zero errors under `apps/web/`**. Per-file gate: tsc may still exit 2; pass iff no new `error TS` outside that vendor file. Log: `/opt/cursor/artifacts/baseline_web_typecheck.log`

### Importers — alias `@/` (21)

- [x] `apps/web/components/chat/thread-panel.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/message-item.test.tsx`  Test Files  1 passed (1);      Tests  5 passed (5);
- [x] `apps/web/components/chat/renderers/text-renderer.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/task-card.test.tsx`  Test Files  1 passed (1);      Tests  16 passed (16);
- [x] `apps/web/components/chat/renderers/task-card.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/task-card.test.tsx`  Test Files  1 passed (1);      Tests  16 passed (16);
- [x] `apps/web/components/chat/renderers/task-card.test.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/task-card.test.tsx`  Test Files  1 passed (1);      Tests  16 passed (16);
- [x] `apps/web/components/chat/renderers/system-audit-card.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/task-card.test.tsx`  Test Files  1 passed (1);      Tests  16 passed (16);
- [x] `apps/web/components/chat/renderers/poll-card.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/task-card.test.tsx`  Test Files  1 passed (1);      Tests  16 passed (16);
- [x] `apps/web/components/chat/renderers/points-card.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/task-card.test.tsx`  Test Files  1 passed (1);      Tests  16 passed (16);
- [x] `apps/web/components/chat/renderers/loading-card.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/task-card.test.tsx`  Test Files  1 passed (1);      Tests  16 passed (16);
- [x] `apps/web/components/chat/renderers/index.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/task-card.test.tsx`  Test Files  1 passed (1);      Tests  16 passed (16);
- [x] `apps/web/components/chat/renderers/event-card.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/event-card.test.tsx`  Test Files  1 passed (1);      Tests  14 passed (14);
- [x] `apps/web/components/chat/renderers/event-card.test.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/event-card.test.tsx`  Test Files  1 passed (1);      Tests  14 passed (14);
- [x] `apps/web/components/chat/renderers/coming-soon-card.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/event-card.test.tsx`  Test Files  1 passed (1);      Tests  14 passed (14);
- [x] `apps/web/components/chat/renderers/announcement-card.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/renderers/event-card.test.tsx`  Test Files  1 passed (1);      Tests  14 passed (14);
- [x] `apps/web/components/chat/pins-popover.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/message-item.test.tsx`  Test Files  1 passed (1);      Tests  5 passed (5);
- [x] `apps/web/components/chat/message-timeline.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/message-item.test.tsx`  Test Files  1 passed (1);      Tests  5 passed (5);
- [x] `apps/web/components/chat/message-item.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/message-item.test.tsx`  Test Files  1 passed (1);      Tests  5 passed (5);
- [x] `apps/web/components/chat/message-item.test.tsx` — import → `@repo/chat-core/types`; tsc no new errors; vitest `components/chat/message-item.test.tsx`  Test Files  1 passed (1);      Tests  5 passed (5);
- [ ] `apps/web/components/chat/chat-shell.tsx`
- [ ] `apps/web/components/chat/reaction-bar.tsx`
- [ ] `apps/web/components/chat/reconnect-pill.tsx`
- [ ] `apps/web/lib/realtime/supabase-realtime.ts`

### Importers — relative (2; invisible to `@/`-only grep)

- [ ] `apps/web/lib/chat/use-chat-channel.ts`
- [ ] `apps/web/lib/chat/chat-provider.tsx`

### Shims to delete (6) — only after all importers pass

- [ ] `apps/web/lib/chat/types.ts`
- [ ] `apps/web/lib/chat/cache.ts`
- [ ] `apps/web/lib/chat/realtime-manager.ts`
- [ ] `apps/web/lib/chat/dispatch.ts`
- [ ] `apps/web/lib/chat/chat-client.ts`
- [ ] `apps/web/lib/realtime/topic-registry.ts`

### Zero-match proof (both styles)

- [ ] Alias grep empty
- [ ] Relative grep empty
- [ ] Six shim files gone (`test ! -e`)
- [ ] After typecheck + tests with shims removed
