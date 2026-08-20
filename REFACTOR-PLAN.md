# REFACTOR-PLAN.md — Wave 1 mechanical consolidations

Scratch file. Tool-neutral. Delete when the consolidation project wraps, together with
`REFACTOR-PROGRESS.md`. Not a spec, not a doc — the canonical homes are `spec/` and `docs/`
(see [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md)).

**Verified against `main` at `767a491e` on 2026-08-20.** Every `file:line` below was read at that
commit. Line numbers drift as soon as anything merges — re-grep the symbol, don't trust the number
blindly. Counts marked **claimed** come from the Aug 19 code-quality audit and were re-counted here;
where they disagree, the number in this file is the one that was verified.

## How a Wave 1 goal uses this file

Each item below is one isolated agent goal. A goal reads **only its own section** and treats the
"Scope fence" line as hard: files outside it are off-limits even when they look related. The
definition of done is per-item, but every item shares this floor:

1. Single shared implementation exists; old duplicates deleted (not deprecated, not re-exported).
2. A repo-wide search for the old pattern returns zero matches outside the new home — paste the
   command and its output into the PR.
3. `npm run check-types` passes with the old exports removed.
4. Scoped tests pass before and after. `npm run test -w apps/api` for API-side changes;
   the relevant workspace's `vitest run` otherwise.
5. `npm run check:dep-cruiser` passes (required gate).
6. The PR updates at least one file under `docs/` or `spec/` — the docs-sync gate is required under
   `enforce_admins: true` and root-level files do **not** satisfy it. If the change genuinely has no
   docs impact, the `no-doc-change-needed` label is the sanctioned waiver.
7. Never regenerate Playwright snapshots. Baselines are pinned to CI's Chromium; regenerating
   locally silently corrupts the fixture.

## Summary

| # | Item | Claimed | Verified | Mechanical? | Risk | Batch |
|---|------|---------|----------|-------------|------|-------|
| 1 | Date formatting → `@repo/formatting` | 27 fns | **48 fns, 9 clusters** | No | High | 3 |
| 2 | MIME allowlists + `field-limits.ts` → `@repo/validation` | 9 lists | **9 app-layer + 7 storage + 8 ext sets** | No (fixes a live bug) | Medium | 2 |
| 3 | Delete dead `@repo/ui` | pkg + landing dep | **pkg + web *and* landing + 4 configs + CI step** | Yes | Low | **1** |
| 4 | Chat shims → `@repo/chat-core` | 21 files, 6 shims | **6 shims exact; 23 importer files** | Yes | Low | **1** |
| 5 | Query keys → `createChapterQueryKeys` | — | **18 unscoped of 60; 0 factory adoption** | No | **Highest** | 4 (supervised) |
| 6 | `getErrorMessage` → `apps/web/lib/utils.ts` | 8 impls | **9 (1 canonical + 8 dupes)** | Mostly | Medium | **1** |
| 7 | `AnalyticsProvider` → `@repo/hooks` | dup + stale comment | **confirmed, but 0 production callers** | No | Medium | 3 |
| 8 | 5 stranded web hooks → `@repo/hooks` | 5 hooks | **3 portable, 2 blocked** | No | Medium | 3 |
| 9 | `subscription.ts` → `@repo/validation` | 177 loc | **177 loc exactly** | Yes | Low | **1** |

Recommended first parallel batch: **3, 4, 6, 9** — see [Batching](#batching-and-collisions).

## Batching and collisions

The nine items are **not** cleanly disjoint. Nine parallel agents would collide on 15 files. The
table below is the authoritative collision list; anything not in it was checked and found disjoint.

### Hard collisions — never run these pairs in the same batch

| Files | Items | Why |
|-------|-------|-----|
| `apps/web/lib/hooks/use-subscription-write-state.ts` | **8 ↔ 9** | Item 8 moves the hook to `@repo/hooks`; item 9 moves `@/lib/subscription` (which it imports at `:5-11`) to `@repo/validation`. Both rewrite the same import block. |
| `apps/web/lib/providers/analytics-provider.tsx` | **7 ↔ 8** | Item 7 merges the provider into `@repo/hooks`; item 8 moves `useOrgConfig`, which the provider imports at `:6` and calls at `:31`. The merged provider's opt-out path depends on where `useOrgConfig` ends up. |
| `apps/web/components/chat/chat-shell.tsx` | **4 ↔ 8** | Shim imports at `:29`, `:36`; `useOrgConfig` at `:26`, `:95`. |
| `apps/web/lib/chat/chat-provider.tsx` | **4 ↔ 8** | Shim imports at `:21-24`; `useChapterTheme` at `:16`, `:34`. |
| `apps/web/lib/chat/use-chat-channel.ts` | **4 ↔ 5** | Imports all five `apps/web/lib/chat` shims at `:17-42`; mounts a query on `chatMessagesKey(channelId)` at `:117`. |
| `apps/web/lib/hooks/use-org-config.ts`, `use-custom-roles.ts`, `use-custom-fields.ts` | **5 ↔ 8** | All three carry query keys (`:59`/`:152`, `:33`, `:28`) *and* are on item 8's move list. |
| `packages/hooks/src/index.ts`, `packages/hooks/package.json` | **7 ↔ 8** | Both add barrel exports and both may add `@repo/validation` as a dependency. |
| `packages/validation/src/index.ts` | **2 ↔ 9** | Both append a barrel re-export line. Trivial textual conflict, but a conflict. |

### Soft collisions — same file, different regions; sequence or accept a small conflict

| Files | Items | Why |
|-------|-------|-----|
| `apps/web/components/members/member-detail-sheet.tsx` | 1 ↔ 6 ↔ 8 | `formatDate:39`, local `getErrorMessage:78`, `useCustomRoles:173`. |
| `apps/web/components/members/invite-member-dialog.tsx` | 1 ↔ 6 | `formatDate:44`, local `getErrorMessage:52`. |
| `apps/web/components/events/event-detail-sheet.tsx` | 1 ↔ 6 | `formatDateTime:40`, local `getErrorMessage:33`. |
| `apps/web/components/chat/renderers/task-card.tsx` | 1 ↔ 4 | `formatDate:127`, shim import `:12`. |
| `apps/web/components/chat/renderers/event-card.tsx` | 1 ↔ 4 | `formatRange:73`, shim import `:6`. |
| `apps/web/components/chat/message-item.tsx` | 1 ↔ 4 | `formatClock:19`, shim import `:16`. |
| `apps/web/components/chat/pins-popover.tsx` | 1 ↔ 4 | `formatClock:12`, shim import `:10`. |
| `apps/web/components/service/service-page.tsx` | 1 ↔ 2 | `formatDuration:90`, proof MIME map `:55-62`. |
| `apps/web/components/documents/documents-page.tsx` | 1 ↔ 2 | inline `toLocaleDateString:529`, MIME sets `:60-86`. |

### Checked and genuinely disjoint

- **Item 3** touches only package manifests, two `next.config.js`, two `tailwind.config.ts`,
  `.github/workflows/ci.yml`, and `package-lock.json`. No source file. No overlap with anything.
- **Item 6 ↔ item 2**: the eight files carrying a *local* `getErrorMessage` contain no MIME
  allowlist. The MIME-carrying pages (`documents-page`, `backwork-page`, `service-page`) already
  import the canonical `getErrorMessage` from `@/lib/utils`, so item 6 never opens them.
- **Item 6 ↔ item 4**: none of the eight local-`getErrorMessage` files imports a chat shim.
- **Item 9 ↔ the `useSubscriptionGate` consumers**: the ~20 components calling `useSubscriptionGate`
  import it from `@/components/shared/subscription-gate`, not from `@/lib/subscription`. Item 9's
  blast radius is four files, not twenty-four. This one looks like a collision and is not.

### Recommended first batch: 3, 4, 6, 9

Mutually disjoint — verified above, not assumed. Combined they are ~40 files of near-mechanical
change with one deliberate behavior improvement (item 6). Rationale, and why the others wait, is in
[the closing recommendation](#recommended-sequencing).

---

## Item 1 — Date-formatting functions → `@repo/formatting`

**Scope verdict: substantially BIGGER than claimed, and not mechanical.** The audit said "27
near-identical date-formatting functions across 5 names". Reality: **48 formatting function
definitions**, of which only **18** carry one of the five canonical names. More importantly they are
not near-identical — they fall into nine clusters with genuinely different output, and three of the
clusters exist precisely because the copy differs per surface.

**This item should not run as a single blind mechanical goal.** Recommendation below.

### Shared home

`packages/formatting/` — **does not exist and must be created.** Follow `packages/validation` as the
template (pure TypeScript, no React):

- `package.json`: `"name": "@repo/formatting"`, `"exports": { ".": { "types": "./dist/index.d.ts", "require": "./dist/index.js", "import": "./src/index.ts", "default": "./dist/index.js" } }`
- `tsconfig.json` extends `@repo/typescript-config/base.json`, `outDir: dist`
- `eslint.config.mjs` uses `@repo/eslint-config/base`
- `vitest.config.ts` + `"test": "vitest run"`
- Barrel: `packages/formatting/src/index.ts`
- Add the workspace to `apps/web/package.json` and `apps/mobile/package.json` dependencies, and to
  `transpilePackages` in `apps/web/next.config.js` if web imports it.
- Add a test step to `.github/workflows/ci.yml` mirroring the existing per-package steps.

### What is genuinely the same fact (safe to consolidate)

| Cluster | Members | Note |
|---------|---------|------|
| **C1 — exact duplicate** | `apps/web/components/chat/pins-popover.tsx:12` and `apps/web/components/chat/message-item.tsx:19` (`formatClock`) | Byte-identical. The single safest consolidation in this item. |
| **C2 — web locale datetime** | `polls-page.tsx:72`, `events-page.tsx:38`, `event-detail-sheet.tsx:40`, `attendance-panel.tsx:84`, `invite-member-dialog.tsx:44`, `dashboard-notification-drawer.tsx:48`, `points/page.tsx:46`, `points-audit-card.tsx:50`, `study-page.tsx:101` | Same `toLocaleString()` output, same `"—"` fallback. Differ only in the input guard (`unknown` vs `string` vs `string \| null \| undefined`). Unify on the widest guard. `dashboard-notification-drawer.tsx:48` is **misnamed `formatTime`** and returns a full datetime. |
| **C3 — web locale date-only** | `tasks-board.tsx:139`, `member-detail-sheet.tsx:39`, `billing/page.tsx:47` | Same `toLocaleDateString()` default output, same `"—"` fallback. |
| **C4 — stopwatch from seconds** | `apps/web/components/study/study-page.tsx:92` and `apps/mobile/lib/study/format.ts:14` (`formatTimer`) | Same `H:MM:SS` / `MM:SS`. Mobile clamps negatives; web does not. Mobile's is already exported and tested (`format.spec.ts:12-25`) — promote **that** one. |

### What must NOT be merged (documented so a later agent doesn't "finish the job")

| Group | Members | Why not |
|-------|---------|---------|
| Bare-date timezone split | `chat/renderers/task-card.tsx:127` parses `YYYY-MM-DD` at **local midnight**; `mobile/lib/more/service-hours.ts:50`, `mobile/lib/dues/invoices.ts:136` parse at **UTC noon** | Merging changes which calendar day renders near a timezone boundary. Pick one deliberately or leave both. |
| Minute durations | `web/components/service/service-page.tsx:90` (no rounding) vs `mobile/lib/more/service-hours.ts:41` (rounds, clamps negatives) | Same output shape, different arithmetic. |
| Study-hour decimals | `mobile/lib/study/format.ts:26` `formatHoursLabel`, `:33` `formatHoursValue`, `mobile/lib/more/profile.ts:73` `formatHours` | Study-credit display, not elapsed time. Different fact. |
| Relative / contextual copy | `mobile/lib/events/format.ts:54,85`; `mobile/lib/tasks/format.ts:81,109`; `mobile/components/chat/up-next-strip.tsx:124,161`; `mobile/lib/more/notifications.ts:105` | Three deliberately different registers: sentence case (`"Tonight · 6:00 PM"`), lowercase pulse fragments (`"tmrw 6:00 PM"`, `"due today"`), and task copy (`"Overdue by 3 days"`). All are covered by tests asserting the exact string. Merging changes visible copy. |
| Non-`Date` inputs | `mobile/app/(tabs)/preferences.tsx:94` (`"HH:MM"` string), `mobile/lib/more/profile.ts:80` (`formatGraduationYear`, integer) | Not date formatting. |
| **Server-side — out of scope entirely** | `apps/api/src/application/services/event.service.ts:361` (ICS `20260820T180000Z` wire format), `:287-291` (inline UTC chat fallback), `notification.service.ts:215-233` (quiet-hours hour extraction, not display) | Wire formats and server logic. A client display package is the wrong home. |

### Library situation

No date library anywhere — no `dayjs`, `date-fns`, `luxon`, or `moment` in any `package.json`. All 48
use native `Intl` / `toLocale*`. Keep it that way; adding one is a separate decision, not part of a
consolidation.

### Dead code

None. Every one of the 48 has at least one caller.

### Recommendation

Split this item into two goals and drop the "27" framing:

- **1a (safe, mechanical):** create `@repo/formatting`, land clusters C1–C4 only (15 definitions,
  ~19 call sites). Explicitly forbid touching anything in the "must NOT be merged" table.
- **1b (deferred, needs a decision):** the bare-date timezone split and the minute-duration rounding
  difference. These are two small correctness decisions, not consolidation work. File them.

### Collisions

Soft, with items 2, 4, and 6 — see the [collision tables](#batching-and-collisions). Nine of the
call-site files are shared. Run item 1 in a batch where none of 2, 4, or 6 is live.

---

## Item 2 — MIME/content-type allowlists + `field-limits.ts` → `@repo/validation`

**Scope verdict: the "9" is right for the application layer, but the real surface is larger, and the
drift bug is REAL and reproducible.**

### The live bug (confirmed)

`image/gif` uploads succeed on the Documents page and fail on the structurally identical Backwork
page — client-side, before the API is even called:

- `apps/web/components/documents/documents-page.tsx:60-72` allowlist **includes** `gif`; MIME map
  `:74-86` includes `gif: "image/gif"`; `accept` attribute `:390` includes `.gif`.
- `apps/web/components/backwork/backwork-page.tsx:73-84` allowlist **omits** `gif`; MIME map `:86-97`
  omits it; `accept` attribute `:462` omits `.gif`.
- Meanwhile `apps/api/src/application/services/backwork.service.ts:36-50` **allows** `image/gif`, and
  so does the `backwork` storage bucket
  (`supabase/migrations/20260808204500_declare_dashboard_created_buckets.sql:127-140`).

So the server and the bucket both accept a GIF the Backwork UI refuses to send. The rejection copy is
`backwork-page.tsx:301-304` ("File type not allowed").

### Full inventory

**Layer A — API service allowlists (6, all inline `Set`s, none exported):**

| File:line | Constant | Contents |
|-----------|----------|----------|
| `apps/api/src/application/services/user.service.ts:21-26` | `ALLOWED_CONTENT_TYPES` | jpeg, png, gif, webp |
| `apps/api/src/application/services/chapter.service.ts:38-43` | `ALLOWED_LOGO_CONTENT_TYPES` | jpeg, png, gif, webp |
| `apps/api/src/application/services/service-entry.service.ts:31-37` | `ALLOWED_PROOF_CONTENT_TYPES` | + pdf |
| `apps/api/src/application/services/chapter-document.service.ts:26-40` | `ALLOWED_CONTENT_TYPES` | 14 types (office + text) |
| `apps/api/src/application/services/backwork.service.ts:36-50` | `ALLOWED_CONTENT_TYPES` | identical to chapter-document |
| `apps/api/src/application/services/chat.service.ts:68-82` | `ALLOWED_CONTENT_TYPES` | identical to chapter-document |

**Layer A′ — companion extension sets (6, same files):** `user.service.ts:28`,
`chapter.service.ts:44` (no leading dot — inconsistent with the other five),
`service-entry.service.ts:39-46`, `chapter-document.service.ts:42-57`, `backwork.service.ts:52-67`,
`chat.service.ts:84-99`.

**Layer B — web (3 MIME maps + 2 extension sets + 4 file inputs):**
`documents-page.tsx:60-72` / `:74-86` / `accept :390`; `backwork-page.tsx:73-84` / `:86-97` /
`accept :462`; `service-page.tsx:55-62` (`PROOF_CONTENT_TYPE_BY_EXTENSION`) / `accept :494`.
`apps/web/components/chat/composer.tsx:356-361` is a file input with **no `accept` attribute at all**
and forwards raw `file.type` at `:242` — unrestricted client-side.

**Layer C — Supabase bucket policies (7):**
`supabase/migrations/20260808204500_declare_dashboard_created_buckets.sql:92` (branding), `:99`
(profiles), `:106-119` (documents), `:127-140` (backwork), `:148-161` (chat);
`supabase/migrations/20260803231500_service_proof_bucket.sql:38` (service);
`supabase/migrations/20260805133000_reports_bucket.sql:38` (reports, pdf only).

**Mobile:** no allowlists — upload UI is not built
(`apps/mobile/components/chat/chat-composer.tsx:9-10`, `apps/mobile/app/(tabs)/documents.tsx:41-43`).

### Additional drift beyond the gif bug

`application/msword`, `application/vnd.ms-excel`, and `application/vnd.ms-powerpoint` (`.doc`,
`.xls`, `.ppt`) are allowed by all three API document services and all three storage buckets, but by
**no** web client map or `accept` attribute. Legacy Office files are silently unsendable from the UI.

### `field-limits.ts`

`apps/api/src/domain/constants/field-limits.ts` — 8 exports: `ROLE_NAME_MAX_LENGTH:19` (100),
`ROLE_KEY_MAX_LENGTH:22` (64), `POINTS_ADJUSTMENT_MAX:55` (100_000),
`POINTS_REASON_MAX_LENGTH:64` (500), `INVOICE_AMOUNT_MAX_CENTS:71` (99_999_999),
`INVOICE_TITLE_MAX_LENGTH:74` (255), `INVOICE_DESCRIPTION_MAX_LENGTH:77` (2_000),
`CHAT_MESSAGE_CONTENT_MAX_LENGTH:80` (10_000).

Importers (all API DTOs): `task.dto.ts:13`, `study.dto.ts:15`, `service-entry.dto.ts:11`,
`rbac.dto.ts:13`, `points.dto.ts:21-24`, `financial-invoice.dto.ts:14-17`, `event.dto.ts:17`,
`custom-role.dto.ts:13-15`, `chat.dto.ts:15`.

Two known duplications to fix while here:
- `packages/validation/src/index.ts:433` hardcodes `.max(10_000)` in `SendChatMessageSchema` instead
  of importing `CHAT_MESSAGE_CONTENT_MAX_LENGTH`.
- `apps/mobile/lib/tasks/limits.ts:14` has a **comment** pointing at `field-limits.ts:55` and a
  hand-copied `POINTS_MAX = 100_000` at `:16`.

### File-size limits

There is no `MAX_FILE_SIZE` constant in application code at all. Enforcement is entirely the Supabase
bucket `file_size_limit` (26214400 = 25 MB, consistent across `supabase/config.toml:41` and all seven
buckets). Web shows "25 MB" as copy only (`service-page.tsx:252,501`, `documents-page.tsx:334`) and
never checks `file.size`. Adding a shared client-side size check is a reasonable extra in this item.

### `@repo/validation` conventions

Single entry point, no subpath exports. `packages/validation/package.json:7-14` maps `"."` to
`./src/index.ts` for `import` and `./dist/index.js` otherwise. Adding a module means: create
`packages/validation/src/<name>.ts`, add `export { … } from "./<name>"` to `src/index.ts`. Dependency
is `zod` only (`package.json:22-24`) — no React, no framework. Already depended on by `apps/api`,
`apps/web`, `apps/mobile`.

Note `packages/validation/src/index.ts:184-187` — `RequestUploadUrlSchema` accepts
`content_type: z.string().min(1)` with **no MIME validation**. That schema is the natural place to
enforce the shared allowlist.

### Definition of done

Beyond the shared floor: the comparison matrix collapses to one source per concern; the three
Supabase bucket policies that mirror API sets keep mirroring them (they are SQL and cannot import
TypeScript — add a comment cross-referencing the shared constant, as
`20260808204500_declare_dashboard_created_buckets.sql:30-34` already does); and the gif drift is
fixed with a test that would have caught it.

### Collisions

`packages/validation/src/index.ts` with item 9 (both append one barrel line). Soft collision with
item 1 on `service-page.tsx` and `documents-page.tsx`. Disjoint from items 3, 4, 6.

---

## Item 3 — Delete the dead `@repo/ui` package

**Scope verdict: BIGGER than claimed, but still the smallest item on the list.** The audit said "dead
package and its `apps/landing` dependency entry". `apps/web` declares it too, and there are four
config references and a CI step.

**Confirmed dead:** zero `from "@repo/ui"` imports anywhere in the repo — all apps, all packages, all
scripts, all configs. Verified with a repo-wide search at `767a491e`.

### Everything to delete or edit

| Path | Line | Action |
|------|------|--------|
| `packages/ui/` (11 files, 252 lines) | — | Delete the directory |
| `apps/web/package.json` | 40 | Remove `"@repo/ui": "*"` |
| `apps/landing/package.json` | 18 | Remove `"@repo/ui": "*"` |
| `apps/web/next.config.js` | 5 | Drop `"@repo/ui"` from `transpilePackages` (keep `@repo/theme`) |
| `apps/landing/next.config.js` | 3 | Same |
| `apps/web/tailwind.config.ts` | 8 | Remove the `../../packages/ui/src/**` content glob |
| `apps/landing/tailwind.config.ts` | 8 | Same |
| `.github/workflows/ci.yml` | 301 | Remove `run: npm run test -w packages/ui` (and its enclosing step) |
| `.dockerignore` | 20 | Remove the `packages/ui` exclusion |
| `package-lock.json` | 127, 224, 8223-8225, 28948-28969 | Regenerate via `npm install`, don't hand-edit |
| `scripts/configure-branch-protection.mjs` | 54 | Check whether the required-check list names the ui test |
| `CONTRIBUTING.md` | 59 | Update the package list |

`packages/ui` contents for the record: `button.tsx` (41), `card.tsx` (56), `code.tsx` (16),
`utils.ts` (3, a `joinClassNames` helper), `button.test.tsx` (49, 6 Vitest cases), `test/setup.ts`,
plus package/tsconfig/eslint/vitest config and a README.

### What is not lost

The live components are `apps/web/components/ui/` — 25 shadcn/Radix files including a real
`button.tsx` built on `@radix-ui/react-slot` + `class-variance-authority`. `apps/landing` uses inline
Tailwind. Nothing imports the package being deleted, so nothing changes at runtime.

### Gotchas

- Deleting removes 6 tests from the `web-tests` CI job. There is no coverage threshold
  (`docs/internal/ci-cd/QUALITY_GATES.md:267-268`), so nothing fails — but if `web-tests` is a
  required check, confirm the job still exists and passes with the step gone.
- `.dependency-cruiser.cjs` and `.dependency-cruiser-known-violations.json` contain **no** references
  to `packages/ui`. No baseline edit needed.
- `turbo.json` enumerates no packages. Nothing to change there.
- The root `workspaces` glob is `["apps/*", "packages/*"]` — no explicit entry to remove.

### Scope fence

Package manifests, the two Next configs, the two Tailwind configs, `ci.yml`, `.dockerignore`,
`CONTRIBUTING.md`, `package-lock.json`, and `packages/ui/` itself. **No application source file.**

### Collisions

None. Fully disjoint from all eight other items.

---

## Item 4 — Chat shim imports → `@repo/chat-core`, delete the 6 shims

**Scope verdict: shim count EXACT (6). Importer count is 23 files, not 21** — the "21" matches the
count of `@/lib/chat/*` import *statements* under `apps/web/components/`, which misses the two
internal bridge files and `supabase-realtime.ts`.

All six are pure `export *` passthroughs with no added logic. All are `apps/web`-only; `apps/mobile`
already imports `@repo/chat-core` subpaths directly and needs no cleanup.

### The 6 shims

| File | Lines | Re-exports |
|------|-------|-----------|
| `apps/web/lib/chat/types.ts` | 3 | `@repo/chat-core/types` |
| `apps/web/lib/chat/cache.ts` | 3 | `@repo/chat-core/cache` |
| `apps/web/lib/chat/realtime-manager.ts` | 5 | `@repo/chat-core/realtime-manager` |
| `apps/web/lib/chat/dispatch.ts` | 5 | `@repo/chat-core/dispatch` |
| `apps/web/lib/chat/chat-client.ts` | 5 | `@repo/chat-core/chat-client` |
| `apps/web/lib/realtime/topic-registry.ts` | 7 | `@repo/chat-core/topic-registry` |

Each carries the verbatim marker `// Re-export shim (#937 S3) — delete in the cleanup PR once
importers point at @repo/chat-core.` (the `topic-registry` one is worded slightly differently and
also references #817).

### Importers

**19 component files import `@/lib/chat/types`** (all for `ChatMessage` unless noted):
`thread-panel.tsx:7`, `renderers/text-renderer.tsx:3`, `renderers/task-card.tsx:12`,
`renderers/task-card.test.tsx:5`, `renderers/system-audit-card.tsx:4`, `renderers/poll-card.tsx:5`,
`renderers/points-card.tsx:5`, `renderers/loading-card.tsx:4`, `renderers/index.tsx:3`,
`renderers/event-card.tsx:6`, `renderers/event-card.test.tsx:5`, `renderers/coming-soon-card.tsx:4`,
`renderers/announcement-card.tsx:4`, `pins-popover.tsx:10`, `message-timeline.tsx:11`,
`message-item.tsx:16`, `message-item.test.tsx:4`, `chat-shell.tsx:36`, and
`reaction-bar.tsx:12-16` (which imports `actionTypeFromEmoji`, `emojiFromActionType`,
`ReactionState` — the only non-`ChatMessage` component importer).

**Other shims:**
- `realtime-manager`: `components/chat/reconnect-pill.tsx:4` (`ConnectionStatus`),
  `lib/chat/use-chat-channel.ts:30`, `lib/chat/chat-provider.tsx:21`
- `dispatch`: `components/chat/chat-shell.tsx:29` (`ResolveMember`), `lib/chat/use-chat-channel.ts:42`
- `chat-client`: `lib/chat/use-chat-channel.ts:31-40` (9 symbols), `lib/chat/chat-provider.tsx:22`
- `cache`: `lib/chat/use-chat-channel.ts:24-28` (4 symbols)
- `topic-registry`: `lib/realtime/supabase-realtime.ts:5` (`isTopicOccupied`, `releaseTopic`)

### Do NOT delete these — they are real implementations, not shims

`apps/web/lib/chat/use-chat-channel.ts` (337 lines), `apps/web/lib/chat/chat-provider.tsx` (87),
`apps/web/lib/chat/offline-queue.ts` (180, the Dexie `OutboxStore`), `apps/web/lib/chat/parsers.test.ts` (336).

### Verified safe

- Every symbol reached through a shim **is** exported from `packages/chat-core/src/index.ts`
  (which is 8 `export *` lines). No barrel additions needed.
- No shim renames anything. `actionTypeFromEmoji` is an alias declared inside chat-core itself
  (`types.ts:26`, aliasing `reactionActionType` at `:21`) and is exported under the name importers
  already use — a rewrite is name-for-name.
- `use-chat-channel.ts:34-37` aliases `react as reactAction` / `unreact as unreactAction` at the
  **import site**, not in a shim. Preserve those local aliases when rewriting that file.
- Both apps already declare the dependency: `apps/web/package.json:35`,
  `apps/mobile/package.json:22`.
- No tsconfig change needed. The shims resolve via the generic `"@/*": ["./*"]` mapping
  (`apps/web/tsconfig.json:5-7`) — there is no dedicated `@/lib/chat/*` path entry to remove.
- Three test files import through a shim and must be rewritten too:
  `renderers/task-card.test.tsx:5`, `renderers/event-card.test.tsx:5`, `message-item.test.tsx:4`.

### Definition of done

Zero-match proof: `rg -n '@/lib/chat/(types|cache|realtime-manager|dispatch|chat-client)|@/lib/realtime/topic-registry' apps/web` returns nothing, and the six files are gone.

### Collisions

Hard with item 8 on `chat-shell.tsx` and `chat-provider.tsx`; hard with item 5 on
`use-chat-channel.ts`. Soft with item 1 on four renderer/component files. Safe alongside items 3, 6, 9.

---

## Item 5 — Query-key call sites → `createChapterQueryKeys`

**Scope verdict: the factory has ZERO production adoption today, and this is the highest-risk item on
the list. It should not run as an unsupervised parallel goal.**

`createChapterQueryKeys` (`packages/hooks/src/chapter-query-keys.ts:19`) is referenced only by its own
spec (`chapter-query-keys.spec.ts:8,9`) and by two API test comments. Every hook still hand-rolls its
key.

### The tuple gotcha — state this verbatim in the goal prompt

From `packages/hooks/src/chapter-query-keys.ts:28-35`:

- `lists(chapterId)` → `[scope, chapterId, "list"]` — **invalidation prefix only, never mount a query on it**
- `list(chapterId, filters?)` → `[scope, chapterId, "list", filters]` — **always** carries the filters
  slot, even when `filters` is `undefined`, so it is a *different tuple* from `lists(chapterId)`

**Mount queries on `list`. Invalidate with `lists`.** Mounting on `lists` and invalidating with
`lists` appears to work in a smoke test and then silently fails to match once any caller passes
filters. `chapterId` is a required `string` by design — a hook with no chapter yet must leave the
query `enabled: false` rather than build a key with `null`.

### Current state: 60 mounted read keys, 18 not chapter-scoped

The audit's "18 of 55" holds up on the numerator; the denominator is 60 at this commit.

**Unscoped mounted keys (18):**

| File:line | Key | Genuinely global? |
|-----------|-----|-------------------|
| `packages/hooks/src/use-chat.ts:9` | `["channels"]` | No — chapter-scoped data |
| `packages/hooks/src/use-chat.ts:40` | `["channels","unread"]` | No |
| `packages/hooks/src/use-chat.ts:55` | `["channels", id]` | No |
| `packages/hooks/src/use-chat.ts:74` | `["channels", channelId, "messages", options]` | No |
| `packages/hooks/src/use-chat.ts:90` | `["channels", channelId, "pins"]` | No |
| `packages/hooks/src/use-chat.ts:106` | `["messages", messageId, "reactions"]` | No |
| `packages/hooks/src/use-chat.ts:123` | `["channels","categories"]` | No |
| `packages/hooks/src/use-backwork.ts:35` | `["backwork", id]` | No |
| `packages/hooks/src/use-backwork.ts:51` | `["backwork","departments"]` | No |
| `packages/hooks/src/use-backwork.ts:64` | `["backwork","professors"]` | No |
| `packages/hooks/src/use-attendance.ts:9` | `["attendance", eventId]` | No |
| `packages/hooks/src/use-attendance.ts:75` | `["attendance", eventId, "check-in-token"]` | No |
| `packages/hooks/src/use-documents.ts:57` | `["documents", id]` | No |
| `packages/hooks/src/use-service-entries.ts:43` | `["service-entries", id]` | No |
| `packages/hooks/src/use-semesters.ts:9` | `["semesters"]` | No |
| `packages/hooks/src/use-polls.ts:55` | `["polls", messageId]` | No — **and see the collision below** |
| `apps/web/lib/chat/use-chat-channel.ts:117` | `chatMessagesKey(channelId)` | No |
| `apps/mobile/lib/chat/use-chat-channel.ts:110` | `chatMessagesKey(channelId)` | No |

**Correctly global — do not "fix" these:** `["user","me"]` (`use-user.ts:9`), `userSettingsKey`
(`use-notifications.ts:30`, `GET /v1/settings` is user-scoped), `chapterQueryKey("accessible")`
(`use-chapters.ts:33`, the list of chapters you can access), `["chapter-directory","search",…]`
(`use-chapter-directory.ts:34`, public directory), `["sentry-identity"]`
(`apps/web/lib/providers/sentry-identity-provider.tsx:52`).

### Two real defects to fix, not just re-key

1. **Prefix collision in `use-polls.ts`.** `:28` mounts `["polls", chapterId, options]` and `:55`
   mounts `["polls", messageId]`. Both are two/three-element tuples starting `"polls"`, so
   `invalidateQueries({ queryKey: ["polls"] })` at `:92`, `:120`, `:142` clears both, and a
   `messageId` that ever equalled a `chapterId` would alias. The factory's `list`/`detail`
   discriminator fixes this by construction.
2. **Unscoped invalidations blast across chapters.** `use-study.ts:84,116,133` invalidate
   `["geofences"]` and `:154,188,210,226` invalidate `["study-sessions"]` while the queries mount on
   `["geofences", chapterId]` / `["study-sessions", chapterId]`. Same in `use-service-entries.ts:73,128,145`
   (`["service-entries"]`), `use-documents.ts:122,139` (`["documents"]`), `use-backwork.ts:121,138`
   (`["backwork"]`), `use-tasks.ts:496` (`["points"]`), `use-polls.ts:93` (`["channels"]`).

### `notificationKeys` needs special handling

`packages/hooks/src/use-notifications.ts:14-27` is one of the two factories the Wave 0 helper was
modelled on, but it does **not** match the helper's shape and cannot be swapped mechanically:

- `list(chapterId: string | null, limit?)` accepts **`null`** — the exact thing
  `createChapterQueryKeys` forbids. Callers must move to `enabled: false` instead.
- Its tuple is `["notifications", chapterId, limit]`, not `[scope, chapterId, "list", filters]`.
- `all: ["notifications"]` currently also matches `preferencesRoot: ["notifications","preferences"]`
  and `preferences(chapterId)`. Under the factory, `lists(chapterId)` would **stop** matching the
  preferences entries. The comment at `:19-23` says the broad preferences invalidation is deliberate.
  Preserve that behavior explicitly or the notification preferences UI goes stale on chapter switch.

`taskKeys` (`use-tasks.ts:29`) is the clean model and should migrate first as the reference diff.

### Higher-risk call sites — repositories with no tenant-scope test

PR #1087 covered **24 of 33** repositories. The nine deferred ones are listed with reasons in
`apps/api/src/infrastructure/supabase/repositories/tenant-scope-coverage.spec.ts:28-47`. Four of them
sit directly behind query keys this item will move:

| Query key | Route | Backing repository | Ledger reason | Risk |
|-----------|-------|--------------------|---------------|------|
| `use-notifications.ts:162` `notificationKeys.list` | `GET /v1/notifications` (`notification.controller.ts:56`) | `supabase-notification.repository.ts` | *"carries `chapter_id` but no read filters by it — `findByUser` filters by `user_id`, `findById` by id alone; needs a scoping decision before a test can pin behaviour"* | **Highest.** No test, and the ledger says the correct behavior is undecided. Do not re-key this without making that decision first. |
| `use-chat.ts:40` `["channels","unread"]` | `GET /v1/channels/unread` (`chat.controller.ts:76`) | `supabase-read-receipt.repository.ts` | *"read receipts are channel-scoped; the unread-count RPC does take `p_chapter_id`. Backlog."* | High |
| `use-chat.ts:106` `["messages", messageId, "reactions"]` | `GET /v1/channels/messages/{messageId}/reactions` | `supabase-message-reaction.repository.ts` | *"reactions are message-scoped like `poll_votes`; covered indirectly by the chat-channel boundary. Backlog."* | High |
| chat card actions (via `chat-client.actOnCard`) | chat action routes | `supabase-chat-message-action.repository.ts` | *"message actions are message-scoped like `poll_votes`. Backlog."* | High |

Two more uncovered repositories sit behind query keys that are **correctly** unscoped and are not a
concern: `supabase-user.repository.ts` (`["user","me"]` — identity is global) and
`supabase-user-settings.repository.ts` (`userSettingsKey` — per-user). The remaining three
(`push-token`, `stripe-webhook-event`, `activation-milestone`) have no query-key call site at all.

Everything else this item touches — tasks, events, members, invites, chapters, roles, points, dues,
invoices, documents, backwork, service entries, study, semesters, polls, attendance, chat channels
and messages — **is** covered by a tenant-scope spec from PR #1087.

Also note `apps/api/src/modules/scheduled-jobs/scheduled-jobs.repository.ts` sits outside the coverage
ledger's directory scan entirely (the ledger only walks
`apps/api/src/infrastructure/supabase/repositories/`). It has no query-key call site, so it is not a
risk for this item, but it is a real hole in the ledger.

### Recommendation

Run this **supervised and split**, after the first batch merges:

- **5a:** `taskKeys` → factory (reference diff, already tenant-tested).
- **5b:** the plainly chapter-scoped families with covered repositories (events, members, invites,
  roles, points, invoices, documents, backwork, service entries, study, semesters, polls).
- **5c:** chat + notifications. Blocked on a scoping decision for
  `supabase-notification.repository.ts` and ideally on tenant-scope specs for the three chat
  backlog repositories.

### Collisions

Hard with item 8 (`use-org-config.ts`, `use-custom-roles.ts`, `use-custom-fields.ts` all carry keys
and are all on item 8's move list) and item 4 (`use-chat-channel.ts`).

---

## Item 6 — `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk`

**Scope verdict: 9 implementations, not 8** — one canonical plus eight duplicates. The "5 use
`instanceof Error`" claim is exactly right.

### The canonical one

`apps/web/lib/utils.ts:20` — `export function getErrorMessage(error: unknown, fallback: string): string`.
Reads `"message" in error` on a plain object, so it **does** surface openapi-fetch error bodies.

`apps/web/lib/utils.ts` is 27 lines and also exports `cn:4` (clsx + tailwind-merge), `asArray:8`, and
`initials:13`. It contains **no** date helpers and **no** MIME lists, so it is not a collision hub.

### The 8 duplicates

| File:line | Uses `instanceof Error`? | Fallback |
|-----------|--------------------------|----------|
| `apps/web/components/points-adjustment-dialog.tsx:44` | **Yes** | `"Something went wrong. Please retry."` |
| `apps/web/components/events/event-editor-dialog.tsx:29` | **Yes** | same |
| `apps/web/components/events/event-detail-sheet.tsx:33` | **Yes** | same |
| `apps/web/components/members/member-detail-sheet.tsx:78` | **Yes** | same |
| `apps/web/components/members/invite-member-dialog.tsx:52` | **Yes** | same |
| `apps/web/app/sign-up/page.tsx:17` | No | `"Something went wrong. Please try again."` |
| `apps/web/app/sign-in/page.tsx:16` | No | same |
| `apps/web/app/join/page.tsx:17` | No (and no explicit return type) | same |

### This is a behavior change, not a pure refactor

The five `instanceof Error` copies **cannot** read openapi-fetch's thrown body (a plain object with
`message`/`statusCode`), so today they always show the generic fallback and swallow the real server
message. Consolidating onto the canonical version makes real server messages appear in 11 call sites
that currently show `"Something went wrong. Please retry."`. That is the point of the fix, but it is
user-visible copy and needs a reviewer to look at it, not just a green typecheck.

The three non-`instanceof` copies (`sign-up`, `sign-in`, `join`) are behaviorally identical to the
canonical one; only their hardcoded fallback differs, which becomes the second argument.

### Call sites

51 already call the canonical `@/lib/utils` version. 11 call a local duplicate and must be updated
with an explicit fallback argument: `points-adjustment-dialog.tsx:149`, `event-editor-dialog.tsx:244`,
`event-detail-sheet.tsx:122`, `member-detail-sheet.tsx:280,303`, `invite-member-dialog.tsx:202,235`,
`sign-up/page.tsx:68`, `sign-in/page.tsx:56,92`, `join/page.tsx:93`.

### Mobile `api-error.ts` → `@repo/api-sdk`

`apps/mobile/lib/api-error.ts` (54 lines) exports `statusOf:22`, `serverMessageOf:37`, `codeOf:49`.
No `instanceof Error`; reads `statusCode`/`status`, joins string arrays, extracts structured API
codes like `chapter.module.disabled`. It is the better implementation and deserves to be shared.

Importers to rewire: `apps/mobile/lib/study/errors.ts:14`, `apps/mobile/lib/dues/pay-errors.ts:21`,
`apps/mobile/app/(tabs)/study.tsx:35`, `apps/mobile/app/(tabs)/check-in.tsx:21`.

**Codegen safety — verified.** `packages/api-sdk`'s generate script is
`openapi-typescript ../../apps/api/openapi.json -o ./src/types.ts`. It overwrites **only**
`src/types.ts` (which carries the "Do not make direct changes" header). `src/client.ts` and
`src/index.ts` are hand-written and survive regeneration. So a new hand-written
`packages/api-sdk/src/api-error.ts` is safe **provided it is a new file and is exported from
`src/index.ts`** (currently `export * from './types'; export * from './client';`). Do **not** put
this logic in `types.ts`.

Dependents already in place: `apps/web:33`, `apps/mobile:21`, `packages/hooks:16`,
`packages/chat-core:23`. `apps/api` does not depend on the SDK.

### Out of scope but worth filing

`payIntentErrorCopy` is duplicated between `apps/web/components/billing/pay-invoice-dialog.tsx:41`
and `apps/mobile/lib/dues/pay-errors.ts:23`. Same fact, two copies. Not on the Wave 1 list — file it.

### Collisions

Soft with item 1 on three files (`member-detail-sheet.tsx`, `invite-member-dialog.tsx`,
`event-detail-sheet.tsx`). Verified disjoint from items 2, 3, 4, 9.

---

## Item 7 — `AnalyticsProvider` (web/mobile) → `@repo/hooks`

**Scope verdict: the duplicate and the stale comment are both real, but the item is smaller and less
urgent than it looks — `useAnalytics` has ZERO production call sites.** Both providers are mounted and
neither is ever consumed. Consolidating an unused abstraction is defensible cleanup, but it should not
outrank items with live consumers.

### The two copies

`apps/web/lib/providers/analytics-provider.tsx` (69 lines) and `apps/mobile/lib/analytics-provider.tsx`
(73 lines).

**Identical:** the `TrackFn` signature (web `:20`, mobile `:28`), the context +
`useMemo`/`useCallback` structure (web `:22-57`, mobile `:30-62`), the
`client.POST("/v1/analytics/events", …)` call (web `:36-43`, mobile `:41-47`), the fire-and-forget
`.catch(() => {})` (web `:44-46`, mobile `:49-51`), the no-op `useAnalytics` outside a provider
(web `:66-68`, mobile `:70-72`), and both import `useFrappClient`/`useActiveChapterId` from
`@repo/hooks` and `AnalyticsProperties` from `@repo/validation`.

**Genuinely different — this is the part that needs a design decision:**

- Web checks a client-side opt-out: `const optedOut = useOrgConfig().data?.analytics_opt_out === true`
  (`:31`), early-returns at `:35`, and imports `useOrgConfig` at `:6`.
- Web sends `chapter_id` **optionally**: `...(chapterId ? { chapter_id: chapterId } : {})` (`:40`).
- Mobile **hard-gates on chapter**: `if (!chapterId) return;` (`:38-40`) and always sends
  `chapter_id` (`:45`). It has no `useOrgConfig` equivalent.

A shared hook therefore needs the opt-out injected rather than imported —
`packages/chat-core/src/adapters.ts:18-134` is the repo's reference pattern for that (interface +
browser default + platform injection at wiring time).

### The stale comment

`apps/mobile/lib/analytics-provider.tsx:18-26`, verbatim:

> NOTE: the mobile client has no active-chapter context yet (it is still the preview shell — real
> member flows land in #253, and `frapp-client.tsx` hardcodes `getChapterId: () => null`). Until then
> mobile events carry no `chapter_id` …

**It is stale.** `apps/mobile/lib/frapp-client.tsx:50-68` now passes a real `chapterId` from
`useAuthSession()` and uses `getChapterId: () => chapterIdRef.current`. Mobile screens already call
`useActiveChapterId()` (e.g. `apps/mobile/app/(tabs)/tasks.tsx:73`). Delete the comment, and re-decide
whether the hard chapter gate at `:38-40` is still the behavior you want now that a chapter exists.

### Files a consolidation touches

`apps/web/lib/providers/analytics-provider.tsx`, `apps/web/lib/providers/analytics-provider.test.tsx`
(mocks `use-org-config` at `:16-17`), `apps/web/app/providers.tsx:7,19-21`,
`apps/mobile/lib/analytics-provider.tsx`, `apps/mobile/app/_layout.tsx:18,85,91`, plus a new module in
`packages/hooks/src/` and one barrel line in `packages/hooks/src/index.ts`.

### Not overlapping

`packages/validation/src/analytics.ts` already shares the crypto/hashing/payload-hygiene layer
(`hashUserIdForAnalytics:182`, `assertContentFreeProperties:376`, `ACTIVATION_MILESTONES:286`, …).
The providers only consume the `AnalyticsProperties` type from it. No overlap to resolve.

Neither client reads a PostHog key — analytics is API-mediated
(`apps/api/src/modules/analytics/analytics.module.ts:34,38` holds `POSTHOG_API_KEY`/`POSTHOG_HOST`).

### Collisions

Hard with item 8 on `analytics-provider.tsx` and on `packages/hooks/src/index.ts` /
`packages/hooks/package.json`.

---

## Item 8 — 5 stranded web hooks → `@repo/hooks`

**Scope verdict: MIXED — 3 of the 5 are straightforward, 2 are blocked on web-only dependencies. And
the mobile module-gating half is a design decision, not a wiring change.**

| Hook | Path | Lines | Portable? | Blocker |
|------|------|-------|-----------|---------|
| `use-org-config` | `apps/web/lib/hooks/use-org-config.ts` | 194 | **Yes** | Only `"use client"`. Needs `@repo/validation` added to `packages/hooks`. |
| `use-custom-roles` | `apps/web/lib/hooks/use-custom-roles.ts` | 114 | **Yes** | None |
| `use-custom-fields` | `apps/web/lib/hooks/use-custom-fields.ts` | 109 | **Yes** | None |
| `use-subscription-write-state` | `apps/web/lib/hooks/use-subscription-write-state.ts` | 111 | **No** | Imports `useChapterStore` from `@/lib/stores/chapter-store` (Zustand + `persist` → **`localStorage`**) at `:4`, and `@/lib/subscription` at `:5-11` (item 9's target). |
| `use-chapter-theme` | `apps/web/lib/hooks/use-chapter-theme.ts` | 41 | **No** | Writes CSS custom properties to `document.documentElement` at `:21-22`, `:31`, `:37`. Browser-only. Also imports `useChapterStore`. |

### Exports and call sites

- **`use-org-config`** exports `OrgWorkflow:21`, `OrgDues:33`, `OrgConfig:35`, `useOrgConfig:54`,
  `usePendingConfigKeys:124`, `usePatchOrgConfig:148`. Callers:
  `apps/web/lib/providers/analytics-provider.tsx:31`, `app/(dashboard)/members/page.tsx:93`,
  `components/settings/settings-page.tsx:139,146,149`, `components/service/service-page.tsx:124`,
  `components/layout/dashboard-shell.tsx:219`, `components/layout/dashboard-command-menu.tsx:214`,
  `components/chat/chat-shell.tsx:95`. Type-only: `settings-workflows-tab.tsx:16`,
  `settings-dues-tab.tsx:24`. Test mocks: `analytics-provider.test.tsx:16-17`,
  `dashboard-command-menu.test.tsx:17-18`, `settings-rollover-gating.test.tsx:34-42`,
  `service-page.test.tsx:65-66`. Direct test: `apps/web/lib/hooks/use-org-config.test.tsx`.
- **`use-custom-roles`** exports `useCustomRoles:28`, `useCreateCustomRole:46`,
  `useUpdateCustomRole:67`, `useDeleteCustomRole:95`. Callers:
  `components/settings/settings-roles-tab.tsx:144,266,267,268,269`,
  `components/members/member-detail-sheet.tsx:173`.
- **`use-custom-fields`** exports `useCustomFields:23`, `useCreateCustomField:41`,
  `useUpdateCustomField:62`, `useDeleteCustomField:90`. Callers:
  `components/settings/settings-fields-tab.tsx:85,142,143,267`.
- **`use-subscription-write-state`** exports `ChapterSubscription:13`, `useChapterSubscription:34`,
  `UseSubscriptionWriteStateResult:59`, `useSubscriptionWriteState:92`. Direct callers:
  `components/shared/subscription-gate.tsx:82`, `components/billing/subscription-checkout-card.tsx:68`,
  `app/(dashboard)/billing/page.tsx:70`.
- **`use-chapter-theme`** exports `useChapterTheme:16`. Exactly one caller:
  `apps/web/lib/chat/chat-provider.tsx:34`.

### `packages/hooks` conventions

`packages/hooks/package.json:5-7` exports `"." → ./src/index.ts` (single barrel, no subpaths).
Dependencies today: `react` 19.2.3, `@tanstack/react-query`, `@repo/api-sdk` — **no `@repo/validation`**,
which three of the five hooks need. Adding a hook = new file + one `export * from "./use-x"` line in
`src/index.ts`. Hooks get their client from `useFrappClient()` / `useActiveChapterId()`
(`packages/hooks/src/use-frapp-client.tsx:15-47`). No platform-specific code exists in the package
today.

No name collisions: there is no existing `useOrgConfig`, `useCustomRoles`, `useCustomFields`,
`useSubscriptionWriteState`, or `useChapterTheme` in `@repo/hooks`. Note `useRoles`
(`packages/hooks/src/use-roles.ts:6`) hits `/v1/roles` while `useCustomRoles` hits `/v1/custom-roles` —
similar names, different endpoints, not a duplicate.

### The mobile module-gating half is not mechanical

Web and mobile read `enabled_modules` from **different endpoints**:

- Web: `useOrgConfig()` → `GET /v1/chapters/{id}/config` (merged archetype config), then attaches an
  `isModuleEnabled` predicate at `use-org-config.ts:69-75`.
- Mobile: reads `enabled_modules` straight off `useCurrentChapter()` → `GET /v1/chapters/current`, and
  calls the shared `isModuleEnabled` directly — `apps/mobile/app/(tabs)/study.tsx:577-585`
  (`"hours"`), `apps/mobile/app/(tabs)/preferences.tsx:349-355` (`"geofences"`).

The pure predicate is **already shared**: `isModuleEnabled` at `packages/validation/src/index.ts:399-404`
(also used server-side at `apps/api/src/interface/guards/chapter.guard.ts:275,292`). So "wire mobile's
module-gating to the shared one" is really the question *should mobile start calling the config
endpoint?* — an extra network call in exchange for merged archetype defaults and vocabulary. Decide
that before the goal runs; do not let an agent decide it silently.

### `use-chapter-theme` probably belongs somewhere else

`packages/chapter-theme` is pure palette derivation (`derivePalette()`, `ChapterPalette`, WCAG checks
at `index.ts:173`) with no React and no DOM. `packages/theme` holds design tokens and
`resolveChapterAccentColor`. The web hook is a **DOM side-effect applier** — it writes CSS variables to
`:root`. Mobile has its own `useChapterBranding` (`apps/mobile/lib/chapter-branding.ts:42`) and will
never consume the web hook. Moving it to `@repo/hooks` as-is would put a `document`-touching effect in
a package that has no platform-specific code today. Recommend: **drop it from this item** and leave it
in `apps/web`, or split it into a shared data hook plus a web-only applier.

### Recommendation

Reduce the item to **three hooks** (`use-org-config`, `use-custom-roles`, `use-custom-fields`), which
are genuinely portable. Handle `use-subscription-write-state` only after item 9 lands (and swap its
`useChapterStore` dependency for `useActiveChapterId`). Drop `use-chapter-theme` or re-scope it.

### Collisions

Hard with item 9 (`use-subscription-write-state.ts`), item 7 (`analytics-provider.tsx`,
`packages/hooks/src/index.ts`), item 4 (`chat-shell.tsx`, `chat-provider.tsx`), and item 5 (all three
portable hooks carry query keys).

---

## Item 9 — `apps/web/lib/subscription.ts` → `@repo/validation`

**Scope verdict: EXACTLY as claimed — 177 lines, verified — and it is the cleanest move on the list.**
The file's only import is a *type*, and that type already comes from the destination package.

### The file

`apps/web/lib/subscription.ts`, 177 lines. Its sole import is line 1:
`import type { CurrentChapterPayload } from "@repo/validation"`. No `next/*`, no `react-dom`, no
browser APIs, no `apps/web`-local types. Fully portable.

Exports:

| Line | Symbol | Kind |
|------|--------|------|
| 25 | `SubscriptionStatus` | type alias off `CurrentChapterPayload["subscription_status"]` |
| 42 | `isSubscriptionStatus` | type guard; unknown wire values fail **open** (deploy-skew tolerant) |
| 51-55 | `SubscriptionBlockCode` | union of server block codes |
| 68 | `SubscriptionWriteClass` | `"paid" \| "free-tier" \| "grace-blocked"` |
| 70-83 | `SubscriptionWriteState` | discriminated union with `code`, `reason`, `recoverable` |
| 90 | `SUBSCRIPTION_GRACE_PERIOD_MS` | `3 * 24 * 60 * 60 * 1000` |
| 97 | `isWithinSubscriptionGrace` | fails open on a missing/bad timestamp |
| 149 | `subscriptionWriteState` | the gate itself |

It gates only on `subscription_status`, `past_due_since`, and `writeClass` — no plan tiers, no seat
counts, no trial state.

### Follow the `permissions.ts` pattern exactly

The two sibling gates it should sit beside:

- **`can`** — `packages/validation/src/permissions.ts:25` (plus `canAll:39`, `canAny:53`,
  `WILDCARD_PERMISSION:17`), re-exported from the barrel at `packages/validation/src/index.ts:886`.
  Web wraps it in a component at `apps/web/components/shared/can.tsx:6`.
- **`isModuleEnabled`** — inline at `packages/validation/src/index.ts:399-404`.

So: create `packages/validation/src/subscription.ts` (a **separate file**, mirroring `permissions.ts`
— do not inline 177 lines into `index.ts`), add one re-export line to `src/index.ts`, and move
`apps/web/lib/subscription.test.ts` (116 lines) into the package's Vitest suite.
`packages/validation` depends on `zod` only (`package.json:22-24`), so the gate fits.

### The four importers to update

1. `apps/web/lib/hooks/use-subscription-write-state.ts:5-11` — **also item 8's target; see collisions**
2. `apps/web/components/shared/subscription-gate.tsx:8-11`
3. `apps/web/components/shared/subscription-gate.test.tsx:12`
4. `apps/web/lib/subscription.test.ts:2-6` (moves with the file)

**Not importers, despite appearances:** the ~20 components calling `useSubscriptionGate` import it
from `@/components/shared/subscription-gate`, not from `@/lib/subscription`. They do not change.

### Mobile has no subscription gate — confirmed

Zero hits for `subscriptionWriteState`, `isSubscriptionStatus`, `SubscriptionWriteClass`,
`subscription_status`, or `past_due_since` anywhere in `apps/mobile`. Mobile billing is member-dues
only, and `apps/mobile/app/(tabs)/dues.tsx:59-60` explicitly distinguishes member dues from the
chapter's own subscription. Moving the gate into `@repo/validation` makes a mobile gate *possible*;
building one is not part of this item.

Note there is also a server-side `apps/api/src/domain/utils/subscription.ts`. Different file, server
domain, **out of scope** — do not merge them without checking whether they agree.

### Collisions

Hard with item 8 on `use-subscription-write-state.ts`. Soft with item 2 on
`packages/validation/src/index.ts` (one barrel line each).

---

## Recommended sequencing

Review bandwidth is the constraint, so batch by *review cost*, not agent capacity.

**Batch 1 — run in parallel now: items 3, 4, 6, 9.** Verified mutually disjoint. Roughly 40 files.
Three are near-zero behavior change; item 6 carries one deliberate, easily-reviewed improvement.

- **3** is the cheapest possible review: deletions plus config edits, zero source imports.
- **4** is pure import rewriting against six proven-passthrough shims, with a one-command zero-match proof.
- **9** is one file move, four importers, and a test that moves with it.
- **6** is 8 deletions and 11 call-site updates. Budget the review time here — it changes user-visible
  error copy in 11 places (for the better).

**Batch 2 — item 2.** Fixes a real user-facing bug. Spans three layers including SQL, so review it on
its own. Sequence after 9 if you want to avoid the one-line `packages/validation/src/index.ts` conflict.

**Batch 3 — items 1a, 7, 8 (reduced).** Each needs a decision made *before* the goal fires: which date
clusters merge (1a), how the analytics opt-out gets injected (7), whether mobile switches to the config
endpoint (8). Run at most two at once, and never 7 and 8 together.

**Batch 4 — item 5, supervised, split into 5a/5b/5c.** Highest risk, touches tenant scoping, and 5c is
blocked on a scoping decision for `supabase-notification.repository.ts`.

## Debt spotted

| Item | Debt | Action |
|------|------|--------|
| 2 | `image/gif` accepted by Documents, rejected by Backwork client-side, while the Backwork API and bucket both allow it | Fix in item 2 with a regression test |
| 2 | Legacy Office MIME types (`.doc`/`.xls`/`.ppt`) allowed server-side, absent from every web client map | Decide: add to client or drop from server |
| 2 | `apps/web/components/chat/composer.tsx:356-361` file input has no `accept` and forwards raw `file.type` | Fold into item 2 |
| 2 | `packages/validation/src/index.ts:433` hardcodes `.max(10_000)` instead of importing `CHAT_MESSAGE_CONTENT_MAX_LENGTH` | Fix in item 2 |
| 2 | `apps/mobile/lib/tasks/limits.ts:16` hand-copies `POINTS_MAX` with a comment pointing at `field-limits.ts:55` | Fix in item 2 |
| 2 | No client-side `file.size` check anywhere; 25 MB is copy only | Add with the shared limits |
| 5 | `use-polls.ts:28` and `:55` share a `"polls"` prefix with different tuple shapes | Fixed by the factory |
| 5 | Seven hooks invalidate an unscoped prefix while mounting a scoped key | Fix during migration |
| 5 | `notificationKeys.list` accepts `chapterId: string \| null` | Must become `enabled: false` |
| 5 | `supabase-notification.repository.ts` has no tenant read filter and no test; the ledger says the correct behavior is undecided | Needs a decision — file it |
| 5 | `apps/api/src/modules/scheduled-jobs/scheduled-jobs.repository.ts` sits outside the coverage ledger's directory scan | Widen the scan — file it |
| 6 | `payIntentErrorCopy` duplicated: `apps/web/components/billing/pay-invoice-dialog.tsx:41` and `apps/mobile/lib/dues/pay-errors.ts:23` | Not on the Wave 1 list — file it |
| 7 | `useAnalytics` has zero production call sites in either app | Question whether item 7 is worth doing now |
| 7 | `apps/mobile/lib/analytics-provider.tsx:18-26` comment is factually stale | Delete in item 7 |
| 2 | `apps/web/components/backwork/backwork-page.tsx:99,100,112` locally redefines `SEMESTERS`/`ASSIGNMENT_TYPES`/`DOCUMENT_VARIANTS`, byte-identical to `packages/validation/src/index.ts:165,166,178` | Not on the Wave 1 list — file it |
