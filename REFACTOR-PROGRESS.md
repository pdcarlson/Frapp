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
- [x] 4. Chat shim imports → `@repo/chat-core`; delete the 6 shim files
  Done. 23 importers rewritten to `@repo/chat-core/<subpath>`; 6 shims deleted.
  After: web chat tests 116/116, chat-core 30/30, tsc no new errors. Both DoD
  greps empty. See file-level list below.
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
- [x] `apps/web/components/chat/chat-shell.tsx` — `dispatch`+`types` → `@repo/chat-core/{dispatch,types}`; tsc no new errors; vitest 4 files / 18 tests passed
- [x] `apps/web/components/chat/reaction-bar.tsx` — `actionTypeFromEmoji`/`emojiFromActionType`/`ReactionState` → `@repo/chat-core/types`; tsc no new errors; vitest `message-item.test.tsx` 5 passed
- [x] `apps/web/components/chat/reconnect-pill.tsx` — `ConnectionStatus` → `@repo/chat-core/realtime-manager`; tsc no new errors; vitest `reconnect-pill.test.tsx` 5 passed
- [x] `apps/web/lib/realtime/supabase-realtime.ts` — `isTopicOccupied`/`releaseTopic` → `@repo/chat-core/topic-registry`; tsc no new errors; vitest `lib/realtime` 2 files / 20 tests passed

### Importers — relative (2; invisible to `@/`-only grep)

- [x] `apps/web/lib/chat/use-chat-channel.ts` — five relative shim imports → `@repo/chat-core/{types,cache,realtime-manager,chat-client,dispatch}`; preserved `react as reactAction` / `unreact as unreactAction`; tsc no new errors; vitest `lib/chat`+`components/chat` 7 files / 96 tests + chat-core 30/30
- [x] `apps/web/lib/chat/chat-provider.tsx` — relative shims + barrel `browserNetworkState` → `@repo/chat-core/{realtime-manager,chat-client,types,adapters}`; tsc no new errors; vitest `lib/chat`+`components/chat`+`lib/realtime` 9 files / 116 tests passed

### Shims to delete (6) — only after all importers pass

- [x] `apps/web/lib/chat/types.ts` — deleted; `test ! -e` true; after tsc no new errors; web chat 116/116
- [x] `apps/web/lib/chat/cache.ts` — deleted; `test ! -e` true; after tsc no new errors; web chat 116/116
- [x] `apps/web/lib/chat/realtime-manager.ts` — deleted; `test ! -e` true; after tsc no new errors; web chat 116/116
- [x] `apps/web/lib/chat/dispatch.ts` — deleted; `test ! -e` true; after tsc no new errors; web chat 116/116
- [x] `apps/web/lib/chat/chat-client.ts` — deleted; `test ! -e` true; after tsc no new errors; web chat 116/116
- [x] `apps/web/lib/realtime/topic-registry.ts` — deleted; `test ! -e` true; after tsc no new errors; web chat 116/116 + `lib/realtime` 20/20

`apps/web/lib/chat/` retains exactly: `chat-provider.tsx`, `offline-queue.ts`, `parsers.test.ts`, `use-chat-channel.ts`.

### Zero-match proof (both styles)

Commands run from repo root after shim deletion. `rg` exit 1 = no matches.

**Pass 1 — alias**

```
$ rg -n '@/lib/chat/(types|cache|realtime-manager|dispatch|chat-client)|@/lib/realtime/topic-registry' apps/web
(no matches; rg exit 1)
```

**Pass 2 — relative**

```
$ rg -n 'from "\./(types|cache|realtime-manager|dispatch|chat-client)"' apps/web/lib/chat
(no matches; rg exit 1)
```

Extra (not in the plan, to catch the prior-draft miss):

```
$ rg -n "from '\\./(types|cache|realtime-manager|dispatch|chat-client)'" apps/web/lib/chat
(no matches; rg exit 1)
```

Remaining `@/lib/chat/` imports are glue only (`use-chat-channel`, `chat-provider`). The only `topic-registry` import under `apps/web` is `@repo/chat-core/topic-registry` from `supabase-realtime.ts`.

- [x] Alias grep empty
- [x] Relative grep empty
- [x] Six shim files gone (`test ! -e`)
- [x] After typecheck + tests with shims removed — tsc no new errors; `vitest run components/chat lib/chat lib/realtime` 9 files / 116 tests; full `apps/web` vitest **54 files / 474 tests**; `@repo/chat-core` 5 files / 30 tests; `npm run lint -w apps/web` clean; `npm run check-types -w @repo/chat-core` clean. Logs: `/opt/cursor/artifacts/after_shim_delete_web_chat_tests.log`, `/opt/cursor/artifacts/after_shim_delete_web_full_tests.log`, `/opt/cursor/artifacts/after_shim_delete_chat_core_tests.log`, `/opt/cursor/artifacts/zero_match_grep_proof.log`

CI follow-up (not an importer): `doc-paths` failed on two citations of deleted shims.
Retargeted `.claude/skills/realtime-resilience/SKILL.md` and
`docs/internal/security/SECURITY_FIXES.md` to the chat-core paths.

**BLOCKED files:** none.
