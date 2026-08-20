# REFACTOR-PROGRESS.md

Scaffold only. One line per [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md) item. Each Wave 1 goal checks off
its own line with a one-line note and its test result.

**Execution state only — not a tracker.** Real work items, deferred findings, and blockers go to
GitHub Issues with the `triage` label, per `AGENTS.md` ("Never track work in a scratch file") and
[`.claude/skills/file-follow-up/SKILL.md`](.claude/skills/file-follow-up/SKILL.md). This file is
deleted when the project wraps, so nothing durable may live only here.

- [ ] 1. Date-formatting functions → `@repo/formatting`
- [ ] 2. MIME/content-type allowlists + `field-limits.ts` → `@repo/validation`
- [x] 3. Delete the dead unused shared UI workspace and its dependency entries — directory gone; live primitives are `apps/web/components/ui/`; landing is inline Tailwind. Tests: docs-sync + structure + doc-paths pass; `npm run check-types` 19/19; `npm run build -w apps/web` and `apps/landing` succeed; live-file search for the deleted workspace token is empty
- [x] 4. Chat shim imports → `@repo/chat-core`; delete the 6 shim files
  Done. 23 importers rewritten to `@repo/chat-core/<subpath>`; 6 shims deleted.
  After: web chat tests 116/116, chat-core 30/30, tsc no new errors. Both DoD
  greps empty. See file-level list below.
- [ ] 5. Query-key call sites → `createChapterQueryKeys`
- [ ] 6. `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk`
- [ ] 7. `AnalyticsProvider` (web/mobile) → `@repo/hooks`
- [ ] 8. 5 stranded web hooks → `@repo/hooks`; wire mobile's module-gating
- [x] 9. `apps/web/lib/subscription.ts` → `@repo/validation`
  - [x] File move: `apps/web/lib/subscription.ts` → `packages/validation/src/subscription.ts` (barrel re-export from `src/index.ts`) — named exports match `can` / `isModuleEnabled`. `npm run test -w @repo/validation -- src/subscription.spec.ts`: 9 passed.
  - [x] Importer: `apps/web/lib/hooks/use-subscription-write-state.ts` — `@/lib/subscription` → `@repo/validation`. `npm run check-types`: 20/20 packages.
  - [x] Importer: `apps/web/components/shared/subscription-gate.tsx` — types now from `@repo/validation`. `npm run test -w apps/web -- subscription-gate`: 20 passed.
  - [x] Importer: `apps/web/components/shared/subscription-gate.test.tsx` — `SubscriptionWriteClass` now from `@repo/validation`. Same suite: 20 passed.
  - [x] Importer: `apps/web/lib/subscription.test.ts` (moves with the file → `packages/validation/src/subscription.spec.ts`) — suite unchanged except a move comment. `npm run test -w @repo/validation -- src/subscription.spec.ts`: 9 passed. Full package: 95 passed / 7 files.

## Item 3 — file-level execution

Live primitives now live at `apps/web/components/ui/` (shadcn/Radix). Landing uses inline Tailwind.
This section avoids the deleted workspace's npm name so a repo-wide search for that token can go to
zero in live files. Historical mentions remain in [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md) (out of
scope to rewrite) and `.buildpad/` (never hand-edit).

### Code, config, and CI

- [x] `packages/ui/` — deleted (11 files: components, tests, package/tsconfig/eslint/vitest/README)
- [x] `apps/web/package.json` — removed unused shared UI workspace dependency
- [x] `apps/landing/package.json` — removed unused shared UI workspace dependency
- [x] `apps/web/next.config.js` — dropped unused workspace from `transpilePackages` (kept `@repo/theme`)
- [x] `apps/landing/next.config.js` — same
- [x] `apps/web/tailwind.config.ts` — removed `../../packages/ui/src/**` content glob
- [x] `apps/landing/tailwind.config.ts` — same
- [x] `.github/workflows/ci.yml` — removed the `npm run test -w packages/ui` step; hooks + chat-core remain
- [x] `.dockerignore` — removed the `packages/ui` exclusion
- [x] `package-lock.json` — dropped workspace dep, `node_modules` link, and `packages/ui` lock entry (npm install wanted to reshuffle unrelated `peer` flags; kept a surgical removal instead)
- [x] `scripts/configure-branch-protection.mjs` — comment only; `CI_CHECKS` already names `web-tests`, not a UI-package step
- [x] `apps/web/lib/providers/api-base-url.test.ts` — comment now lists hooks + chat-core (fence exception)

### Docs, spec, and skills (11 refs)

- [x] `spec/architecture/README.md` — deleted catalog row + tree `ui/` line; 13→12; ADR-15 2026-08-20 amendment (historical 2026-08-19 text left in place)
- [x] `spec/ui/design-system/README.md` — ownership matrix + promote-to rule now point at `apps/web/components/ui/`
- [x] `spec/environments/README.md` — `web-tests` row no longer names the deleted workspace
- [x] `docs/internal/ci-cd/AGENT_INFRA.md` — CI job description; ESLint-10 blocker now names React workspace lint
- [x] `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md` — `web-tests` row updated
- [x] `docs/hooks/README.md` — CI alongside-note now `packages/chat-core`; also corrected stale "does not block" (ADR-15 made `web-tests` required)
- [x] `.claude/skills/ui-development/SKILL.md` — primitives section retargeted to `@/components/ui/button` (and Card)
- [x] `.claude/skills/testing/SKILL.md` — dropped deleted-package test command; CI parity names hooks + chat-core
- [x] `.claude/skills/signet-cutover/SKILL.md` — do-not-extend now names `apps/web/components/ui` + `@repo/theme`
- [x] `CONTRIBUTING.md` — `web-tests` required-check row updated
- [x] `AGENTS.md` — shared-package count 13 → 12

### Extra-but-necessary (not in the Item 3 tables; required for a correct tree)

- [x] `README.md` — removed `ui/` from the tree; 13→12 shared workspaces
- [x] `scripts/ci/__tests__/check-doc-paths.test.mjs` — fixtures now cite `packages/hooks` instead of the deleted tree
- [x] `scripts/ci/__tests__/check-api-contract-drift.test.mjs` — negative-path fixture now `packages/theme/src/globals.css`

### Item 3 verification

- docs-sync (`check-docs-impact.mjs` vs `origin/main`): passed
- docs-structure: passed
- doc-paths: passed (1417 citations / 133 files)
- `npm run test:ci-scripts`: 383 pass / 0 fail
- `npm run check-types`: 19/19 tasks, unused UI workspace not in turbo scope
- `npm run build -w apps/web`: compiled + prerendered 27 routes (stand-in `NEXT_PUBLIC_SUPABASE_*` from `apps/web/playwright.config.ts`, per ENV_REFERENCE build-time note)
- `npm run build -w apps/landing`: compiled + prerendered
- `rg` for the deleted workspace npm name, excluding the historical plan + `.buildpad/`: zero matches

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
