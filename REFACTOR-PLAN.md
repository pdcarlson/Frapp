# REFACTOR-PLAN.md — Wave 1 mechanical consolidations

Scratch file. Tool-neutral. Delete when the consolidation project wraps, together with
`REFACTOR-PROGRESS.md` and the section that authorizes them in
[`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).
This is a scope inventory, not a spec — `spec/` remains the source of truth for intended behavior.

**Verified against `main` at `767a491e` on 2026-08-20**, then re-verified by an adversarial review pass
that corrected 20+ claims in the first draft. Every `file:line` below was read at that commit. Line
numbers drift as soon as anything merges — re-grep the symbol, don't trust the number blindly. Counts
marked **claimed** come from the Aug 19 code-quality audit and were re-counted here; where they
disagree, the number in this file is the verified one.

## How a Wave 1 goal uses this file

Each item below is one isolated agent goal. A goal reads **only its own section**, and every section
carries a **Scope fence** (hard: files outside it are off-limits even when they look related), a
**Docs/spec to update** list, and a **Definition of done**. Every item also shares this floor:

1. Single shared implementation exists; old duplicates deleted (not deprecated, not re-exported).
2. A repo-wide search for the old pattern returns zero matches outside the new home — paste the
   command and its output into the PR. Use the exact command in your section's Definition of done;
   a hand-rolled pattern that only matches one import style produces a vacuously green proof.
3. `npm run check-types` passes with the old exports removed.
4. Scoped tests pass before and after: `npm run test -w apps/api` for API-side changes, the relevant
   workspace's `vitest run` otherwise.
5. `npm run check:dep-cruiser` passes (required gate).
6. The PR updates the **named** files in your section's "Docs/spec to update". The docs-sync gate is
   required under `enforce_admins: true`, and `scripts/check-docs-impact.mjs:11` only counts paths
   under `docs/` or `spec/` — root files like `CONTRIBUTING.md`, `AGENTS.md`, and this plan do **not**
   satisfy it. Do not reach for the `no-doc-change-needed` label: every item here has a real doc to
   update, so waiving would be the wrong act.
7. **Follow-ups go to GitHub Issues, never into this file or `REFACTOR-PROGRESS.md`.** Anything you
   find that is out of scope gets a `triage`-labeled GitHub issue via the GitHub MCP, per
   [`.claude/skills/file-follow-up/SKILL.md`](.claude/skills/file-follow-up/SKILL.md), and you record
   the issue number in your PR body. `AGENTS.md` is explicit that work is never tracked in a scratch
   file; `REFACTOR-PROGRESS.md` holds per-goal execution state only.
8. **Do not regenerate Playwright visual snapshots as a way to make a test pass.** If
   `web-visual-regression` fails, treat it as a real signal and report it. The documented refresh
   procedure ([`docs/internal/environment/LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md)
   § visual regression, and [`.claude/skills/testing/SKILL.md`](.claude/skills/testing/SKILL.md))
   requires matching CI's Chromium revision, not just `CI=true`; getting that wrong silently corrupts
   the committed baseline. None of these items should move a pixel except item 6, which changes error
   copy — if that trips a baseline, stop and report rather than refreshing.

## Summary

| # | Item | Claimed | Verified | Mechanical? | Risk | Batch |
|---|------|---------|----------|-------------|------|-------|
| 1 | Date formatting → `@repo/formatting` | 27 fns | **48 fns, 9 clusters** | No | High | 3 |
| 2 | MIME allowlists + `field-limits.ts` → `@repo/validation` | 9 lists | **9 app-layer + 7 storage + 8 ext sets** | No (fixes a live bug) | Medium | 2 |
| 3 | Delete dead `@repo/ui` | pkg + landing dep | **pkg + web *and* landing + 4 configs + CI step + 11 doc/skill refs** | Yes | Low | **1** |
| 4 | Chat shims → `@repo/chat-core` | 21 files, 6 shims | **6 shims exact; 23 importer files** | Yes | Low | **1** |
| 5 | Query keys → `createChapterQueryKeys` | — | **18 unscoped of 60; 0 factory adoption** | No | **Highest** | 4 (supervised) |
| 6 | `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk` | 8 impls | **9 (1 canonical + 8 dupes)** | Mostly | Medium | **1** |
| 7 | `AnalyticsProvider` → `@repo/hooks` | dup + stale comment | **confirmed, but 0 production callers** | No | Medium | 3 |
| 8 | 5 stranded web hooks → `@repo/hooks` | 5 hooks | **3 portable, 2 blocked** | No | Medium | 3 |
| 9 | `subscription.ts` → `@repo/validation` | 177 loc | **177 loc exactly** | Yes | Low | **1** |

Recommended first parallel batch: **3, 4, 6, 9** — see [Batching](#batching-and-collisions).

## Batching and collisions

The nine items are **not** cleanly disjoint. Nine parallel agents would collide on ~20 files. This
section is authoritative; the per-item "Collisions" subsections restate it and must not contradict it.

### Hard collisions — never run these pairs in the same batch

| Files | Items | Why |
|-------|-------|-----|
| `apps/web/lib/hooks/use-subscription-write-state.ts`, `apps/web/components/shared/subscription-gate.tsx` | **8 ↔ 9** | Item 8 moves the hook to `@repo/hooks`; item 9 moves `@/lib/subscription` (imported at `use-subscription-write-state.ts:5-11` and `subscription-gate.tsx:11`) to `@repo/validation`. `subscription-gate.tsx:82` also calls the hook item 8 is moving. |
| `apps/web/lib/providers/analytics-provider.tsx`, `apps/web/lib/providers/analytics-provider.test.tsx` | **7 ↔ 8** | Item 7 merges the provider into `@repo/hooks`; item 8 moves `useOrgConfig`, which the provider imports at `:6` and calls at `:31` and the test mocks at `:16-17`. |
| `apps/web/components/chat/chat-shell.tsx` | **4 ↔ 8** | Shim imports at `:29`, `:36`; `useOrgConfig` at `:26`, `:95`. |
| `apps/web/lib/chat/chat-provider.tsx` | **4 ↔ 8** | Shim imports at `:21`, `:22`, `:24` (note `:23` is `./offline-queue`, a real implementation); `useChapterTheme` at `:16`, `:34`. |
| `apps/web/lib/chat/use-chat-channel.ts` | **4 ↔ 5** | Imports all five `lib/chat` shims at `:17-42`; mounts a query on `chatMessagesKey(channelId)` at `:117`. |
| `apps/web/lib/hooks/use-org-config.ts`, `use-custom-roles.ts`, `use-custom-fields.ts` | **5 ↔ 8** | All three carry query keys (`:59`/`:152`, `:33`, `:28`) *and* are on item 8's move list. |
| `apps/web/components/members/member-detail-sheet.tsx` | **1 ↔ 6 ↔ 8** | `formatDate:39` (cluster C3, inside 1a's scope), local `getErrorMessage:78`, `useCustomRoles:173`. Its test at `member-detail-sheet.test.tsx:30` also mocks the hook. |
| `apps/mobile/app/(tabs)/study.tsx` | **6 ↔ 8** | `import { statusOf } from "@/lib/api-error"` at `:35` (item 6 rewires it); `isModuleEnabled(enabledModules, "hours")` at `:577-585` (item 8's mobile half). |
| `apps/web/app/(dashboard)/billing/page.tsx` | **1 ↔ 8** | `formatDate:47` (cluster C3); `useChapterSubscription` at `:25`, `:70`. |
| `apps/web/app/(dashboard)/members/page.tsx` | **1 ↔ 8** | `formatJoined:65`; `useOrgConfig` at `:26`, `:93`. |
| `apps/web/components/layout/dashboard-command-menu.tsx` | **1 ↔ 8** | inline `toLocaleString()` at `:140`; `useOrgConfig` at `:31`, `:214`. |
| `apps/web/components/service/service-page.tsx` | **1 ↔ 2 ↔ 8** | `formatDuration:90`; proof MIME map `:55-62`; `useOrgConfig` at `:48`, `:124`. The only file in three items' scope. |
| `packages/hooks/src/index.ts`, `packages/hooks/package.json` | **7 ↔ 8** | Both add barrel exports; both add `@repo/validation` as a dependency (`packages/hooks/package.json:15-19` has none today). |
| `packages/validation/src/index.ts` | **2 ↔ 9** | Both append a barrel re-export line. |
| `apps/web/package.json`, `apps/web/next.config.js`, `.github/workflows/ci.yml`, `package-lock.json` | **1 ↔ 3** | Item 3 removes `@repo/ui` from `apps/web/package.json:40`, from `transpilePackages` at `next.config.js:5`, and deletes the CI step at `ci.yml:301`. Item 1 creates `@repo/formatting`, which **adds** a dependency to the same manifest, adds to the same `transpilePackages` line, and adds a CI step. Both regenerate the lockfile. |
| `spec/architecture/README.md` (package catalog, `:112-125`) | **1 ↔ 2 ↔ 3 ↔ 6 ↔ 7 ↔ 8 ↔ 9** | Floor requirement 6 sends most items to the same alphabetized table: item 3 deletes the `@repo/ui` row at `:123`, item 1 adds a `@repo/formatting` row, items 2 and 9 change `@repo/validation` at `:124`, items 7 and 8 change `@repo/hooks` at `:119`, item 6 changes `@repo/api-sdk` at `:112`. **Different rows, one file** — a textual conflict, not a semantic one, but sequence or expect to resolve it. |

### Soft collisions — same file, different regions

| Files | Items | Why |
|-------|-------|-----|
| `apps/web/components/members/invite-member-dialog.tsx` | 1 ↔ 6 | `formatDate:44`, local `getErrorMessage:52`. |
| `apps/web/components/events/event-detail-sheet.tsx` | 1 ↔ 6 | `formatDateTime:40`, local `getErrorMessage:33`. |
| `apps/web/components/chat/renderers/task-card.tsx` | 1 ↔ 4 | `formatDate:127`, shim import `:12`. |
| `apps/web/components/chat/renderers/event-card.tsx` | 1 ↔ 4 | `formatRange:73`, shim import `:6`. |
| `apps/web/components/chat/message-item.tsx` | 1 ↔ 4 | `formatClock:19`, shim import `:16`. |
| `apps/web/components/chat/pins-popover.tsx` | 1 ↔ 4 | `formatClock:12`, shim import `:10`. |
| `apps/web/components/documents/documents-page.tsx` | 1 ↔ 2 | inline `toLocaleDateString:529`, MIME sets `:60-86`. |

### Checked and genuinely disjoint

- **Item 6 ↔ item 2**: none of the eight files carrying a *local* `getErrorMessage` contains a MIME
  allowlist. The MIME-carrying pages already import the canonical helper from `@/lib/utils`, so item 6
  never opens them.
- **Item 6 ↔ item 4**: none of the eight local-`getErrorMessage` files imports a chat shim.
- **Item 9 ↔ the `useSubscriptionGate` consumers**: exactly four files import `@/lib/subscription`
  (listed in item 9). The 22 components calling `useSubscriptionGate` import it from
  `@/components/shared/subscription-gate` and do not change. This one looks like a 24-file collision
  and is a 4-file change.
- **Batch 1 pairwise (3↔4, 3↔6, 3↔9, 4↔6, 4↔9, 6↔9)**: all six verified disjoint on source files,
  subject to the one constraint in the batch-1 note below.

### Recommended first batch: 3, 4, 6, 9

Verified mutually disjoint on source. Two constraints that make it stay true:

1. **Item 6 must not add a test harness or CI step to `packages/api-sdk`.** That package has no `test`
   script (`packages/api-sdk/package.json:9-13`), no `vitest.config.ts`, and no CI job. Adding one
   would touch `package-lock.json` and `.github/workflows/ci.yml`, both of which item 3 edits. Move
   `api-error.ts` and export it; leave harness work to a follow-up issue.
2. **All four touch `spec/architecture/README.md`** via floor requirement 6, on four different rows.
   Land them in any order but expect to rebase that one file.

## Item 1 — Date-formatting functions → `@repo/formatting`

**Scope verdict: substantially BIGGER than claimed, and not mechanical.** The audit said "27
near-identical date-formatting functions across 5 names". Reality: **48 formatting function
definitions**, of which only **18** carry one of the five canonical names. They are not
near-identical — they fall into nine clusters with genuinely different output, and three clusters
exist precisely because the rendered copy differs per surface.

**Counting rule** (so the number is reproducible): a definition counts when its return value is a
human-readable date, time, datetime, duration, or relative-time string. Row mappers (`toRow`),
currency (`formatAmount`), wire formats (`toIcsTimestamp`), and non-temporal formatters
(`formatGraduationYear`) are excluded from the 48. The **five canonical names** are `formatDate` (10),
`formatTime` (2), `formatDateTime` (1), `formatDuration` (3), `formatTimestamp` (2) = 18.

**Do not run this as a single blind mechanical goal.** See Recommendation.

### Shared home

`packages/formatting/` — **does not exist and must be created.** Follow `packages/validation` as the
template (pure TypeScript, no React):

- `package.json`: `"name": "@repo/formatting"`, `"exports": { ".": { "types": "./dist/index.d.ts", "require": "./dist/index.js", "import": "./src/index.ts", "default": "./dist/index.js" } }`
- `tsconfig.json` extends `@repo/typescript-config/base.json`, `outDir: dist`
- `eslint.config.mjs` uses `@repo/eslint-config/base`; `vitest.config.ts` + `"test": "vitest run"`
- Barrel at `packages/formatting/src/index.ts`
- Add to `apps/web/package.json` and `apps/mobile/package.json` dependencies, to `transpilePackages`
  in `apps/web/next.config.js`, and add a test step to `.github/workflows/ci.yml`. **All four of those
  are files item 3 also edits — see the hard-collision table.**

### Safe to consolidate

| Cluster | Members | Note |
|---------|---------|------|
| **C1 — exact duplicate (2)** | `apps/web/components/chat/pins-popover.tsx:12` and `apps/web/components/chat/message-item.tsx:19` (`formatClock`) | Byte-identical, 11 lines each. The single safest consolidation in this item. |
| **C2 — web locale datetime (9)** | `polls-page.tsx:72`, `events-page.tsx:38`, `event-detail-sheet.tsx:40`, `attendance-panel.tsx:84`, `invite-member-dialog.tsx:44`, `dashboard-notification-drawer.tsx:48`, `points/page.tsx:46`, `points-audit-card.tsx:50`, `study-page.tsx:101` | Same `toLocaleString()` output, same `"—"` fallback. Differ only in the input guard (`unknown` vs `string` vs `string \| null \| undefined`) — unify on the widest. `dashboard-notification-drawer.tsx:48` is **misnamed `formatTime`** and returns a full datetime. |
| **C3 — web locale date-only (3)** | `tasks-board.tsx:139`, `member-detail-sheet.tsx:39`, `billing/page.tsx:47` | Same `toLocaleDateString()` default output, same `"—"` fallback. |

**C1 + C2 + C3 = 14 definitions.** That is goal 1a's whole scope.

### Explicitly NOT safe — including one the first draft got wrong

| Group | Members | Why not |
|-------|---------|---------|
| **Stopwatch — do not merge without a decision** | `apps/web/components/study/study-page.tsx:92` (`formatDuration`) vs `apps/mobile/lib/study/format.ts:14` (`formatTimer`) | These are **not** interchangeable. Web pads minutes: `` `${pad(minutes)}:${pad(seconds)}` `` at `study-page.tsx:98` → `04:12`. Mobile does not: `` `${minutes}:${pad(seconds)}` `` at `format.ts:22` → `4:12`. Mobile's test enshrines the difference deliberately — `apps/mobile/lib/study/format.spec.ts:15-18`, "drops the hour segment below an hour rather than padding a meaningless zero". Web's is a live on-screen timer (`study-page.tsx:491`), so promoting mobile's silently changes visible web output. Mobile also clamps negatives; web does not. |
| Bare-date timezone split | `chat/renderers/task-card.tsx:131` parses `YYYY-MM-DD` at **local midnight** (`` `${value}T00:00:00` ``); `mobile/lib/more/service-hours.ts:54` and `mobile/lib/dues/invoices.ts:137` parse at **UTC noon** (`` `${value}T12:00:00Z` ``) | Merging changes which calendar day renders near a timezone boundary. |
| Minute durations | `web/components/service/service-page.tsx:90` (no rounding) vs `mobile/lib/more/service-hours.ts:42` (`Math.max(0, Math.round(minutes))`) | Same output shape, different arithmetic. |
| Study-hour decimals | `mobile/lib/study/format.ts:26`, `:33`, `mobile/lib/more/profile.ts:73` | Study-credit display, not elapsed time. Different fact. |
| Relative / contextual copy | `mobile/lib/events/format.ts:54,85`; `mobile/lib/tasks/format.ts:81,109`; `mobile/components/chat/up-next-strip.tsx:124,161`; `mobile/lib/more/notifications.ts:105` | Three deliberately different registers: sentence case (`"Tonight · 6:00 PM"`), lowercase pulse fragments (`"tmrw 6:00 PM"`), task copy (`"Overdue by 3 days"`). All covered by tests asserting the exact string. |
| Non-`Date` inputs | `mobile/app/(tabs)/preferences.tsx:94` (`"HH:MM"` string), `mobile/lib/more/profile.ts:80` (integer year) | Not date formatting. |
| **Server-side — out of scope** | `apps/api/src/application/services/event.service.ts:361` (ICS `20260820T180000Z`), `:287-291` (inline UTC chat fallback), `notification.service.ts:215-233` (quiet-hours hour extraction) | Wire formats and server logic. |

### Library situation

No date library anywhere — no `dayjs`, `date-fns`, `luxon`, or `moment` in any `package.json`. All 48
use native `Intl` / `toLocale*`. Adding one is a separate decision, not part of a consolidation.

### Dead code

None. Every one of the 48 has at least one caller.

### Recommendation

Split and drop the "27" framing:

- **1a (safe):** create `@repo/formatting`, land clusters C1–C3 only — **14 definitions, ~19 call
  sites**. Forbid touching anything in the "NOT safe" table.
- **1b (deferred, needs decisions):** the stopwatch padding difference, the bare-date timezone split,
  and the minute-duration rounding. Three small correctness decisions, not consolidation work. File
  them as GitHub issues per floor requirement 7.

### Scope fence (goal 1a)

`packages/formatting/**` (new), the 14 definition sites and their ~19 call sites listed under C1–C3,
`apps/web/package.json`, `apps/mobile/package.json`, `apps/web/next.config.js`,
`.github/workflows/ci.yml`, `package-lock.json`. **No mobile formatter file. No `apps/api` file.**

### Docs/spec to update

`spec/architecture/README.md` — add a `@repo/formatting` row to the shared-package catalog
(`:112-125`, alphabetized).

### Collisions

**Hard** with item 3 (`apps/web/package.json`, `apps/web/next.config.js`, `.github/workflows/ci.yml`,
`package-lock.json`) and item 8 (`member-detail-sheet.tsx`, `billing/page.tsx`, `members/page.tsx`,
`dashboard-command-menu.tsx`, `service-page.tsx`). **Soft** with items 2, 4, 6. Run item 1 only in a
batch where none of 2, 3, 4, 6, 8 is live.

## Item 2 — MIME/content-type allowlists + `field-limits.ts` → `@repo/validation`

**Scope verdict: the "9" is right for the application layer, the real surface is larger, and the drift
bug is REAL and reproducible.**

### The live bug (confirmed on all four legs)

`image/gif` uploads succeed on the Documents page and fail on the structurally identical Backwork
page — client-side, before the API is called:

- `apps/web/components/documents/documents-page.tsx:60-72` allowlist **includes** `gif`; MIME map
  `:74-86` includes `gif: "image/gif"`; `accept` at `:390` includes `.gif`.
- `apps/web/components/backwork/backwork-page.tsx:73-84` allowlist **omits** `gif`; MIME map `:86-97`
  omits it; `accept` at `:462` omits it. The string "gif" appears nowhere in that file.
- `apps/api/src/application/services/backwork.service.ts:39` **allows** `image/gif`.
- The `backwork` bucket allows it at
  `supabase/migrations/20260808204500_declare_dashboard_created_buckets.sql:132`.

Server and bucket both accept a GIF the Backwork UI refuses to send. Rejection copy:
`backwork-page.tsx:301-304` ("File type not allowed").

### Full inventory

**Layer A — API service allowlists (6, inline `Set`s, none exported):**

| File:line | Constant | Contents |
|-----------|----------|----------|
| `apps/api/src/application/services/user.service.ts:21-26` | `ALLOWED_CONTENT_TYPES` | jpeg, png, gif, webp |
| `apps/api/src/application/services/chapter.service.ts:38-43` | `ALLOWED_LOGO_CONTENT_TYPES` | jpeg, png, gif, webp |
| `apps/api/src/application/services/service-entry.service.ts:31-37` | `ALLOWED_PROOF_CONTENT_TYPES` | + pdf (5) |
| `apps/api/src/application/services/chapter-document.service.ts:26-40` | `ALLOWED_CONTENT_TYPES` | **13** types (office + text) |
| `apps/api/src/application/services/backwork.service.ts:36-50` | `ALLOWED_CONTENT_TYPES` | identical to chapter-document |
| `apps/api/src/application/services/chat.service.ts:68-82` | `ALLOWED_CONTENT_TYPES` | identical to chapter-document |

**Layer A′ — companion extension sets (6, same files):** `user.service.ts:28`,
`chapter.service.ts:44` (**no leading dot** — inconsistent with the other five),
`service-entry.service.ts:39-46`, `chapter-document.service.ts:42-57` (14 entries),
`backwork.service.ts:52-67`, `chat.service.ts:84-99`.

**Layer B — web (3 MIME maps + 2 extension sets + file inputs):** `documents-page.tsx:60-72` /
`:74-86` / `accept :390`; `backwork-page.tsx:73-84` / `:86-97` / `accept :462`;
`service-page.tsx:55-62` (`PROOF_CONTENT_TYPE_BY_EXTENSION`) / `accept :494`.
`apps/web/components/chat/composer.tsx:356-361` is a file input with **no `accept` attribute** that
forwards raw `file.type` at `:242` — unrestricted client-side.

**Layer C — Supabase bucket policies (7):**
`20260808204500_declare_dashboard_created_buckets.sql:92` (branding), `:99` (profiles), `:106-119`
(documents), `:127-140` (backwork), `:148-161` (chat);
`20260803231500_service_proof_bucket.sql:38` (service);
`20260805133000_reports_bucket.sql:38` (reports, pdf only).

**Mobile:** none — upload UI is not built (`apps/mobile/components/chat/chat-composer.tsx:9-10`,
`apps/mobile/app/(tabs)/documents.tsx:41-43`).

### Additional drift beyond the gif bug

`application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint` (`.doc`, `.xls`,
`.ppt`) are allowed by all three API document services and all three buckets, but by **no** web client
map or `accept` attribute. Legacy Office files are silently unsendable from the UI.

### `field-limits.ts`

`apps/api/src/domain/constants/field-limits.ts` — 8 exports: `ROLE_NAME_MAX_LENGTH:19` (100),
`ROLE_KEY_MAX_LENGTH:22` (64), `POINTS_ADJUSTMENT_MAX:55` (100_000),
`POINTS_REASON_MAX_LENGTH:64` (500), `INVOICE_AMOUNT_MAX_CENTS:71` (99_999_999),
`INVOICE_TITLE_MAX_LENGTH:74` (255), `INVOICE_DESCRIPTION_MAX_LENGTH:77` (2_000),
`CHAT_MESSAGE_CONTENT_MAX_LENGTH:80` (10_000).

Importers (all API DTOs): `task.dto.ts:13`, `study.dto.ts:15`, `service-entry.dto.ts:11`,
`rbac.dto.ts:13`, `points.dto.ts:21-24`, `financial-invoice.dto.ts:14-17`, `event.dto.ts:17`,
`custom-role.dto.ts:13-15`, `chat.dto.ts:15`.

Three duplications to fix while here:

- `packages/validation/src/index.ts:433` hardcodes `.max(10_000)` in `SendChatMessageSchema` instead of
  importing `CHAT_MESSAGE_CONTENT_MAX_LENGTH`.
- `apps/mobile/lib/tasks/limits.ts:16` hand-copies `POINTS_MAX = 100_000` with a comment at `:14`
  pointing at `field-limits.ts:55`.
- `apps/web/components/backwork/backwork-page.tsx:99`, `:100`, `:112` locally redefine `SEMESTERS`,
  `ASSIGNMENT_TYPES`, `DOCUMENT_VARIANTS` — byte-identical to `packages/validation/src/index.ts:165`,
  `:166`, `:178`. The file is already open for the MIME fix.

### File-size limits

No `MAX_FILE_SIZE` constant exists in application code. Enforcement is entirely the Supabase bucket
`file_size_limit` (26214400 = 25 MB, consistent across `supabase/config.toml:41` and all seven
buckets). Web shows "25 MB" as copy only (`service-page.tsx:252,501`, `documents-page.tsx:334`) and
never checks `file.size`. A shared client-side size check is a reasonable addition here.

### `@repo/validation` conventions

Single entry point, no subpath exports. `packages/validation/package.json:7-14` maps `"."` to
`./src/index.ts` for `import` and `./dist/index.js` otherwise. Adding a module: create
`packages/validation/src/<name>.ts`, add `export { … } from "./<name>"` to `src/index.ts`. Dependency
is `zod` only (`package.json:22-24`). Already depended on by `apps/api`, `apps/web`, `apps/mobile`.

`packages/validation/src/index.ts:184-187` — `RequestUploadUrlSchema` accepts
`content_type: z.string().min(1)` with **no MIME validation**. That schema is the natural enforcement
point for the shared allowlist.

### Scope fence

`packages/validation/src/**`, the six API services and their DTOs listed above,
`apps/api/src/domain/constants/field-limits.ts`, the three web upload pages,
`apps/web/components/chat/composer.tsx`, `apps/mobile/lib/tasks/limits.ts`, and the three
`supabase/migrations/*.sql` files (comment cross-references only — **do not alter shipped migrations'
DDL**; add a new migration if a bucket policy must change).

### Docs/spec to update

`spec/behavior/chapter-docs.md` (the upload allowlist is behavior it describes) and
`spec/architecture/README.md:124` (the `@repo/validation` catalog row).

### Definition of done

Beyond the floor: the comparison matrix collapses to one source per concern; the SQL bucket policies
keep mirroring the shared constant with a cross-reference comment (as
`20260808204500_declare_dashboard_created_buckets.sql:30-34` already does); and the gif drift is fixed
with a regression test that would have caught it.

### Collisions

**Hard** with item 9 on `packages/validation/src/index.ts` and with items 1/8 on `service-page.tsx`.
**Soft** with item 1 on `documents-page.tsx`. Disjoint from items 3, 4, 6.

## Item 3 — Delete the dead `@repo/ui` package

**Scope verdict: BIGGER than claimed, but still the smallest item.** The audit said "dead package and
its `apps/landing` dependency entry". `apps/web` declares it too, there are four config references, a
CI step, and **eleven doc/skill references that still describe the package as live** — including two
skills that instruct future agents to import from it.

**Confirmed dead:** zero `from "@repo/ui"` imports anywhere in the repo — all apps, all packages, all
scripts, all configs.

### Code, config, and CI

| Path | Line | Action |
|------|------|--------|
| `packages/ui/` (11 files, 252 lines) | — | Delete the directory |
| `apps/web/package.json` | 40 | Remove `"@repo/ui": "*"` |
| `apps/landing/package.json` | 18 | Remove `"@repo/ui": "*"` |
| `apps/web/next.config.js` | 5 | Drop `"@repo/ui"` from `transpilePackages` (keep `@repo/theme`) |
| `apps/landing/next.config.js` | 3 | Same |
| `apps/web/tailwind.config.ts` | 8 | Remove the `../../packages/ui/src/**` content glob |
| `apps/landing/tailwind.config.ts` | 8 | Same |
| `.github/workflows/ci.yml` | 301 | Remove `run: npm run test -w packages/ui` and its enclosing step |
| `.dockerignore` | 20 | Remove the `packages/ui` exclusion |
| `package-lock.json` | 127, 224, 8223-8225, 28948-28969 | Regenerate via `npm install`; do not hand-edit |
| `scripts/configure-branch-protection.mjs` | 54 | Check whether `CI_CHECKS` names the ui test step |

### Docs, spec, and skills — all still describe the package as live

| Path | Line(s) | What it says |
|------|---------|--------------|
| `spec/architecture/README.md` | 123 | Catalog row: "Shared UI components (buttons, cards, inputs). Used by web + landing." — **false today** |
| `spec/architecture/README.md` | 692 | ADR amendment naming `packages/ui` as one of three suites `web-tests` uniquely covers |
| `spec/ui/design-system/README.md` | 60, 69 | "Shared primitives | `packages/ui`" and "promote it to `packages/ui`" — actively directs new work into a deleted package |
| `spec/environments/README.md` | 170 | `web-tests` row naming `packages/ui` |
| `docs/internal/ci-cd/AGENT_INFRA.md` | 51, 266 | CI job description; `@repo/ui`'s lint named as the ESLint-10 blocker |
| `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md` | 88 | `web-tests` row naming `packages/ui` |
| `docs/hooks/README.md` | 143 | "runs it (alongside `packages/ui`)" |
| `.claude/skills/ui-development/SKILL.md` | 26, 39, 41, 44, 45, 48, 136 | A whole "`@repo/ui` primitives" section with `import { Button } from "@repo/ui/button";` |
| `.claude/skills/testing/SKILL.md` | 33, 246 | Documents `npm run test -w packages/ui` as a command to run |
| `.claude/skills/signet-cutover/SKILL.md` | 71 | "Do not extend `@repo/ui` / `@repo/theme` patterns onto Signet mobile" |
| `CONTRIBUTING.md` | 59 | The `web-tests` row of the **required-status-checks table** (not a package list) — reword the job description |
| `AGENTS.md` | — | "13 shared packages" becomes 12 |

Leaving the two skills unfixed is the real hazard: a future agent reads
`.claude/skills/ui-development/SKILL.md:44` and imports from a package that no longer exists.

### What is not lost

The live components are `apps/web/components/ui/` — 25 shadcn/Radix files including a real
`button.tsx` on `@radix-ui/react-slot` + `class-variance-authority`. `apps/landing` uses inline
Tailwind. Nothing imports the deleted package, so nothing changes at runtime.

`packages/ui` contents for the record: `button.tsx` (41), `card.tsx` (56), `code.tsx` (16), `utils.ts`
(3, a `joinClassNames` helper), `button.test.tsx` (49, exactly 6 cases), `test/setup.ts`, plus
package/tsconfig/eslint/vitest config and a README.

### Gotchas

- Deleting removes 6 tests from the `web-tests` CI job. There is no coverage threshold
  (`docs/internal/ci-cd/QUALITY_GATES.md:267-268`), so nothing fails — but `web-tests` is a required
  check, so confirm the job still exists and passes with the step gone.
- `.dependency-cruiser.cjs` and `.dependency-cruiser-known-violations.json` contain **no** references
  to `packages/ui`. No baseline edit needed.
- `turbo.json` enumerates no packages; the root `workspaces` glob is `["apps/*", "packages/*"]`.
  Neither needs an edit.
- A stale comment at `apps/web/lib/providers/api-base-url.test.ts:8` mentions the package. It is inside
  the fence as an exception — fix the comment, change no behavior.

### Scope fence

Everything in the two tables above, plus `apps/web/lib/providers/api-base-url.test.ts:8` (comment
only) and `packages/ui/` itself. **No other application source file.**

### Docs/spec to update

`spec/architecture/README.md:123` (delete the catalog row) at minimum; ideally all of the doc/spec/skill
rows in the second table.

### Collisions

**Hard** with item 1 on `apps/web/package.json`, `apps/web/next.config.js`, `.github/workflows/ci.yml`,
and `package-lock.json` (item 1 adds `@repo/formatting` to the same lines item 3 removes `@repo/ui`
from), and with most items on `spec/architecture/README.md`. **Disjoint from items 2, 4, 5, 6, 7, 8, 9
on source.**

## Item 4 — Chat shim imports → `@repo/chat-core`, delete the 6 shims

**Scope verdict: shim count EXACT (6). Importer count is 23 files, not 21** — the audit's "21" is the
number of `@/lib/chat/*` import *statements* under `apps/web/components/`, which misses the two
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

Each carries the marker `// Re-export shim (#937 S3) — delete in the cleanup PR once importers point
at @repo/chat-core.` (the `topic-registry` one is worded differently and also references #817).

### Importers — 23 files, two import styles

**Style 1 — `@/` alias (21 files).** 19 component files import `@/lib/chat/types` (all for
`ChatMessage` unless noted): `thread-panel.tsx:7`, `renderers/text-renderer.tsx:3`,
`renderers/task-card.tsx:12`, `renderers/task-card.test.tsx:5`, `renderers/system-audit-card.tsx:4`,
`renderers/poll-card.tsx:5`, `renderers/points-card.tsx:4`, `renderers/loading-card.tsx:4`,
`renderers/index.tsx:3`, `renderers/event-card.tsx:6`, `renderers/event-card.test.tsx:5`,
`renderers/coming-soon-card.tsx:4`, `renderers/announcement-card.tsx:4`, `pins-popover.tsx:10`,
`message-timeline.tsx:11`, `message-item.tsx:16`, `message-item.test.tsx:4`, `chat-shell.tsx:36`, and
`reaction-bar.tsx:12-16` (the only non-`ChatMessage` component importer — `actionTypeFromEmoji`,
`emojiFromActionType`, `ReactionState`). Plus `components/chat/reconnect-pill.tsx:4`
(`ConnectionStatus` from the realtime-manager shim), `components/chat/chat-shell.tsx:29`
(`ResolveMember` from the dispatch shim), and `lib/realtime/supabase-realtime.ts:5`
(`isTopicOccupied`, `releaseTopic` from the topic-registry shim).

**Style 2 — relative (2 files, 8 statements). These are invisible to an `@/`-only search:**

| File:line | Specifier | Symbols |
|-----------|-----------|---------|
| `apps/web/lib/chat/use-chat-channel.ts:17-23` | `./types` | `chatMessagesKey`, `ChannelCache`, `ChatMessage`, `RawChatMessage`, `RawChatMessageAction` |
| `apps/web/lib/chat/use-chat-channel.ts:24-29` | `./cache` | `applyReactionInsert`, `emptyCache`, `mergeServerRows`, `selectMessages` |
| `apps/web/lib/chat/use-chat-channel.ts:30` | `./realtime-manager` | `chatRealtime`, `ConnectionStatus` |
| `apps/web/lib/chat/use-chat-channel.ts:31-41` | `./chat-client` | 9 symbols incl. `react`, `unreact`, `ToastFn` |
| `apps/web/lib/chat/use-chat-channel.ts:42` | `./dispatch` | `dispatchSlashCommand`, `ResolveMember` |
| `apps/web/lib/chat/chat-provider.tsx:21` | `./realtime-manager` | `chatRealtime` |
| `apps/web/lib/chat/chat-provider.tsx:22` | `./chat-client` | `flushOutbox` |
| `apps/web/lib/chat/chat-provider.tsx:24` | `./types` | `RawChatMessage` |

### Do NOT delete — real implementations, not shims

In `apps/web/lib/chat/`: `use-chat-channel.ts` (336 lines), `chat-provider.tsx` (86),
`offline-queue.ts` (179, the Dexie `OutboxStore`), `parsers.test.ts` (335). Those four plus the five
shims are the entire directory.

In `apps/web/lib/realtime/` — the item deletes `topic-registry.ts` from this directory, so be explicit
about its neighbours: `supabase-realtime.ts` (136), `supabase-realtime.test.tsx` (382),
`change-topics.ts` (44), `change-topics.test.ts` (140), `use-realtime-table.ts` (100). All real.

### Verified safe

- Every symbol reached through a shim **is** exported from `packages/chat-core/src/index.ts` (8
  `export *` lines). No duplicate exported names across the eight chat-core modules, so no star-export
  ambiguity silently drops a name. No barrel additions needed.
- No shim renames anything. `actionTypeFromEmoji` is an alias declared inside chat-core itself
  (`types.ts:26`, aliasing `reactionActionType` at `:21`) and is exported under the name importers
  already use.
- `use-chat-channel.ts:36` and `:39` alias `react as reactAction` and `unreact as unreactAction` at
  the **import site**, not in a shim. Preserve both local aliases when rewriting that file.
- Both apps already declare the dependency: `apps/web/package.json:35`, `apps/mobile/package.json:22`.
- No tsconfig change needed — shims resolve via the generic `"@/*": ["./*"]` mapping
  (`apps/web/tsconfig.json:5-7`); there is no dedicated `@/lib/chat/*` path entry.
- Exactly three test files import through a shim and must be rewritten:
  `renderers/task-card.test.tsx:5`, `renderers/event-card.test.tsx:5`, `message-item.test.tsx:4`. No
  file `vi.mock`s a shim path.
- Four shims carry `"use client"` and no chat-core module does. Harmless: the only runtime importers
  (`use-chat-channel.ts`, `chat-provider.tsx`) are themselves `"use client"`, and the rest are
  type-only.

### Definition of done

Both searches must return nothing, and both must be pasted into the PR. **The alias pattern alone is
not sufficient** — it cannot match the 8 relative imports above, so on its own it produces a green
proof while two files still import shims:

```sh
rg -n '@/lib/chat/(types|cache|realtime-manager|dispatch|chat-client)|@/lib/realtime/topic-registry' apps/web
rg -n 'from "\./(types|cache|realtime-manager|dispatch|chat-client)"' apps/web/lib/chat
```

Plus: the six files are deleted, and `apps/web/lib/chat/` retains exactly the four real
implementations listed above.

### Scope fence

The 6 shim files, the 23 importer files listed above, and nothing else. **Do not touch
`packages/chat-core/`** — no barrel change is needed.

### Docs/spec to update

`spec/ui/resilience.md` — a maintenance note that web now imports chat-core directly and the #937 S3
shims are gone.

### Collisions

**Hard** with item 8 (`chat-shell.tsx`, `chat-provider.tsx`) and item 5 (`use-chat-channel.ts`).
**Soft** with item 1 on four renderer/component files. Safe alongside items 3, 6, 9.

## Item 5 — Query-key call sites → `createChapterQueryKeys`

**Scope verdict: the factory has ZERO production adoption, and this is the highest-risk item. Do not
run it as an unsupervised parallel goal.**

`createChapterQueryKeys` (`packages/hooks/src/chapter-query-keys.ts:19`) is referenced only by its own
spec (`chapter-query-keys.spec.ts:8,9`) and two API test comments. Every hook still hand-rolls its key.

### The tuple gotcha — state this verbatim in the goal prompt

From `packages/hooks/src/chapter-query-keys.ts:28-35`:

- `lists(chapterId)` → `[scope, chapterId, "list"]` — **invalidation prefix only, never mount on it**
- `list(chapterId, filters?)` → `[scope, chapterId, "list", filters]` — **always** carries the filters
  slot, even when `filters` is `undefined`, so it is a *different tuple* from `lists(chapterId)`

**Mount queries on `list`. Invalidate with `lists`.** Mounting on `lists` appears to work in a smoke
test and then silently fails to match once any caller passes filters. `chapterId` is a required
`string` by design — a hook with no chapter yet must leave the query `enabled: false` rather than build
a key with `null`.

### Current state: 60 mounted read keys, 18 not chapter-scoped

The audit's "18 of 55" holds on the numerator; the denominator is 60 at this commit.

| File:line | Key | Genuinely global? |
|-----------|-----|-------------------|
| `packages/hooks/src/use-chat.ts:9` | `["channels"]` | No |
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
| `packages/hooks/src/use-polls.ts:55` | `["polls", messageId]` | No — see defect 1 |
| `apps/web/lib/chat/use-chat-channel.ts:117` | `chatMessagesKey(channelId)` | No |
| `apps/mobile/lib/chat/use-chat-channel.ts:110` | `chatMessagesKey(channelId)` | No |

**Correctly global — do not "fix" these:** `["user","me"]` (`use-user.ts:9`), `userSettingsKey`
(`use-notifications.ts:30`), `chapterQueryKey("accessible")` (`use-chapters.ts:33`),
`["chapter-directory","search",…]` (`use-chapter-directory.ts:34`), `["sentry-identity"]`
(`apps/web/lib/providers/sentry-identity-provider.tsx:52`).

### Two real defects to fix, not just re-key

1. **Prefix collision in `use-polls.ts`.** `:28` mounts `["polls", chapterId, options]` and `:55`
   mounts `["polls", messageId]`. Both start `"polls"`, so `invalidateQueries({ queryKey: ["polls"] })`
   at `:92`, `:120`, `:142` clears both, and a `messageId` equal to a `chapterId` would alias. The
   factory's `list`/`detail` discriminator fixes this by construction.
2. **Unscoped invalidations blast across chapters.** `use-study.ts:84,116,133` invalidate
   `["geofences"]` and `:154,188,210,226` invalidate `["study-sessions"]` while the queries mount on
   the chapter-scoped keys. Same in `use-service-entries.ts:73,128,145`, `use-documents.ts:122,139`,
   `use-backwork.ts:121,138`, `use-tasks.ts:496`, `use-polls.ts:93`.

### Neither existing factory is a drop-in model

The Wave 0 helper was written *against* `taskKeys` and `notificationKeys`, but **both violate its
rules**, so neither migration is mechanical:

**`taskKeys` (`packages/hooks/src/use-tasks.ts:29-35`)** — the first draft of this plan called it the
clean reference diff. It is not:

- `lists` and `detail` take `chapterId: string | null` (`:32-34`) — the same `null` acceptance that
  disqualifies `notificationKeys`. `useActiveChapterId()` returns `string | null`
  (`packages/hooks/src/use-frapp-client.tsx:22,46`), so swapping in the factory is an immediate type
  error at `:324` and `:338` until `useTasks`/`useTask` move to `enabled: false`.
- `taskKeys` has **no `list` member**, and `useTasks` **mounts** on `taskKeys.lists(chapterId)` at
  `:324` — precisely the forbidden pattern. That same `["tasks", chapterId, "list"]` tuple is the
  exact-key target of `getQueryData` at `:120` and `:198` and `setQueryData` at `:203` and `:263`.
  Moving the mount to `list(chapterId)` changes the tuple to `["tasks", chapterId, "list", undefined]`
  and all four exact-key writes plus `use-tasks.spec.tsx:30` must move in lockstep. The spec fails
  loudly if they diverge, so this is not silent — but it is not pre-cleared either.

**`notificationKeys` (`packages/hooks/src/use-notifications.ts:14-27`)**:

- `list(chapterId: string | null, limit?)` accepts `null`.
- Its tuple is `["notifications", chapterId, limit]`, not `[scope, chapterId, "list", filters]`.
- `all: ["notifications"]` currently also prefix-matches `preferencesRoot`
  (`["notifications","preferences"]`) and `preferences(chapterId)`. Under the factory,
  `lists(chapterId)` would **stop** matching the preferences entries. The comment at `:19-23` says the
  broad preferences invalidation is deliberate — preserve it explicitly or notification preferences go
  stale on chapter switch.

### Higher-risk call sites — repositories with no tenant-scope test

PR #1087 covered **24 of 33** repositories. The nine deferred ones are listed with reasons in
`apps/api/src/infrastructure/supabase/repositories/tenant-scope-coverage.spec.ts:28-47`. Four sit
directly behind query keys this item moves (all four route→repository mappings traced end to end):

| Query key | Route | Backing repository | Ledger reason | Risk |
|-----------|-------|--------------------|---------------|------|
| `use-notifications.ts:162` `notificationKeys.list` | `GET /v1/notifications` (`notification.controller.ts:56`) | `supabase-notification.repository.ts` | *"carries `chapter_id` but no read filters by it — `findByUser` filters by `user_id`, `findById` by id alone; needs a scoping decision before a test can pin behaviour"* | **Highest.** No test, and the correct behavior is undecided. Do not re-key without making that decision. |
| `use-chat.ts:40` `["channels","unread"]` | `GET /v1/channels/unread` (`chat.controller.ts:76`) | `supabase-read-receipt.repository.ts` | *"read receipts are channel-scoped; the unread-count RPC does take `p_chapter_id`. Backlog."* | High |
| `use-chat.ts:106` `["messages", messageId, "reactions"]` | `GET /v1/channels/messages/{messageId}/reactions` (`chat.controller.ts:389`) | `supabase-message-reaction.repository.ts` | *"reactions are message-scoped like `poll_votes`; covered indirectly by the chat-channel boundary. Backlog."* | High |
| chat card actions (`chat-client.actOnCard`) | `POST /v1/channels/messages/{messageId}/actions` | `supabase-chat-message-action.repository.ts` | *"message actions are message-scoped like `poll_votes`. Backlog."* | High |

Two more uncovered repositories sit behind **correctly** unscoped keys and are not a concern:
`supabase-user.repository.ts` (`["user","me"]`) and `supabase-user-settings.repository.ts`
(`userSettingsKey`). The remaining three (`push-token`, `stripe-webhook-event`,
`activation-milestone`) have no query-key call site.

Everything else this item touches — tasks, events, members, invites, chapters, roles, points, dues,
invoices, documents, backwork, service entries, study, semesters, polls, attendance, chat channels and
messages — **is** covered by a PR #1087 spec.

Separately, the coverage ledger only walks
`apps/api/src/infrastructure/supabase/repositories/`, so **two** repositories sit outside its scan
entirely: `apps/api/src/modules/scheduled-jobs/scheduled-jobs.repository.ts` and
`apps/api/src/modules/chat-push-worker/chat-notification-preference.repository.ts`. Both have their own
specs, so they are not untested — but neither is tenant-scope tested and neither can ever fail the
ledger. No query-key call site, so not a risk for this item; it is a real hole in the ledger.

### Recommendation

Run supervised and split, after the first batch merges:

- **5a:** `taskKeys` → factory. Expect a `null`-to-`enabled:false` change and a mount move from `lists`
  to `list`, with four exact-key cache writes and one spec assertion moving in lockstep. Not mechanical.
- **5b:** the plainly chapter-scoped families with covered repositories (events, members, invites,
  roles, points, invoices, documents, backwork, service entries, study, semesters, polls).
- **5c:** chat + notifications. Blocked on a scoping decision for `supabase-notification.repository.ts`
  and ideally on tenant-scope specs for the three chat backlog repositories.

### Scope fence

`packages/hooks/src/use-*.ts` for the families in the sub-goal being run, plus
`apps/web/lib/hooks/use-org-config.ts`, `use-custom-roles.ts`, `use-custom-fields.ts` and both
`use-chat-channel.ts` files **only in 5c**. **No `apps/api` file** — if a repository needs a scoping
fix, file it rather than doing it here.

### Docs/spec to update

`spec/behavior/multi-tenancy.md` — PR #1087 already extended it; record that client cache keys are now
chapter-scoped by construction and which families remain exceptions.

### Collisions

**Hard** with item 8 (`use-org-config.ts`, `use-custom-roles.ts`, `use-custom-fields.ts` all carry keys
and are all on item 8's move list) and item 4 (`use-chat-channel.ts`).

## Item 6 — `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk`

**Scope verdict: 9 implementations, not 8** — one canonical plus eight duplicates. The "5 use
`instanceof Error`" claim is exactly right.

### The canonical one

`apps/web/lib/utils.ts:20` — `export function getErrorMessage(error: unknown, fallback: string): string`.
Reads `"message" in error` on a plain object, so it **does** surface openapi-fetch error bodies.

`apps/web/lib/utils.ts` is 26 lines and also exports `cn:4` (clsx + tailwind-merge), `asArray:8`, and
`initials:13`. No date helpers, no MIME lists — it is not a collision hub, though `cn()` is imported by
~20 components so the file itself is hot.

### The 8 duplicates

| File:line | `instanceof Error`? | Fallback |
|-----------|---------------------|----------|
| `apps/web/components/points-adjustment-dialog.tsx:44` | **Yes** | `"Something went wrong. Please retry."` |
| `apps/web/components/events/event-editor-dialog.tsx:29` | **Yes** | same |
| `apps/web/components/events/event-detail-sheet.tsx:33` | **Yes** | same |
| `apps/web/components/members/member-detail-sheet.tsx:78` | **Yes** | same |
| `apps/web/components/members/invite-member-dialog.tsx:52` | **Yes** | same |
| `apps/web/app/sign-up/page.tsx:17` | No | `"Something went wrong. Please try again."` |
| `apps/web/app/sign-in/page.tsx:16` | No | same |
| `apps/web/app/join/page.tsx:17` | No (and no explicit return type) | same |

### The behavior change is real but narrower than it looks

The five `instanceof Error` copies cannot read openapi-fetch's thrown body (a plain object with
`message`/`statusCode`), so today they always show the generic fallback and swallow the real server
message. Consolidating surfaces real server messages at their **7** call sites:
`points-adjustment-dialog.tsx:149`, `event-editor-dialog.tsx:244`, `event-detail-sheet.tsx:122`,
`member-detail-sheet.tsx:280,303`, `invite-member-dialog.tsx:202,235`. That is the point of the fix,
but it is user-visible copy — budget reviewer time for it.

The three non-`instanceof` copies (`sign-up`, `sign-in`, `join`) already read `"message" in error` and
are behaviorally identical to the canonical version; their 4 call sites
(`sign-up/page.tsx:68`, `sign-in/page.tsx:56,92`, `join/page.tsx:93`) change only in that the fallback
becomes an argument. **11 call sites change; 7 change behavior.**

51 further call sites already use the canonical `@/lib/utils` version and do not change.

### Mobile `api-error.ts` → `@repo/api-sdk`

`apps/mobile/lib/api-error.ts` (54 lines) exports `statusOf:22`, `serverMessageOf:37`, `codeOf:49`. No
`instanceof Error`; reads `statusCode`/`status`, joins string arrays, extracts structured API codes
like `chapter.module.disabled`. It is the better implementation and deserves to be shared.

Importers to rewire: `apps/mobile/lib/study/errors.ts:14`, `apps/mobile/lib/dues/pay-errors.ts:21`,
`apps/mobile/app/(tabs)/study.tsx:35`, `apps/mobile/app/(tabs)/check-in.tsx:21`.

**Codegen safety — verified.** `packages/api-sdk/package.json:12` is
`openapi-typescript ../../apps/api/openapi.json -o ./src/types.ts`. It overwrites **only**
`src/types.ts` (which carries the "Do not make direct changes" header). `src/client.ts` and
`src/index.ts` are hand-written and survive regeneration. A new hand-written
`packages/api-sdk/src/api-error.ts` is safe, and **must** be exported from `src/index.ts` — the
`exports` map only exposes `.` and `./types`, so a subpath import would not resolve. Do not put this
logic in `types.ts`.

Dependents already in place: `apps/web:33`, `apps/mobile:21`, `packages/hooks:16`,
`packages/chat-core:23`. `apps/api` does not depend on the SDK.

### Scope fence

`apps/web/lib/utils.ts`, the 8 duplicate files and their 11 call sites, `apps/mobile/lib/api-error.ts`,
its 4 importers, `packages/api-sdk/src/api-error.ts` (new) and `packages/api-sdk/src/index.ts`.
**Do not add a test harness or CI step to `packages/api-sdk`** — that would touch
`package-lock.json` and `.github/workflows/ci.yml`, which item 3 owns in this batch. File a follow-up
issue for the harness instead.

### Docs/spec to update

`spec/architecture/README.md:112` — the `@repo/api-sdk` catalog row currently reads "Auto-generated
TypeScript client from OpenAPI spec", which stops being the whole truth once a hand-written error
module lives there.

### Out of scope but worth filing

`payIntentErrorCopy` is duplicated between `apps/web/components/billing/pay-invoice-dialog.tsx:41` and
`apps/mobile/lib/dues/pay-errors.ts:23`. Same fact, two copies. File it per floor requirement 7.

### Collisions

**Hard** with item 8 on `apps/mobile/app/(tabs)/study.tsx` and
`apps/web/components/members/member-detail-sheet.tsx`. **Soft** with item 1 on
`member-detail-sheet.tsx`, `invite-member-dialog.tsx`, `event-detail-sheet.tsx`. Verified disjoint from
items 2, 3, 4, 9.

## Item 7 — `AnalyticsProvider` (web/mobile) → `@repo/hooks`

**Scope verdict: the duplicate providers are real, but the item is smaller than it looks.** The
`useAnalytics` convenience hook had zero production call sites and has been deleted; `track` remains
the context value on each mounted `AnalyticsProvider`, with opt-out still enforced inside `track`.
Consolidating the unused wrapper into `@repo/hooks` is defensible cleanup, but it should not outrank
items with live consumers.

### The two copies

`apps/web/lib/providers/analytics-provider.tsx` (69 lines) and `apps/mobile/lib/analytics-provider.tsx`
(73 lines).

**Identical:** the `TrackFn` signature (web `:20`, mobile `:28`), the context +
`useMemo`/`useCallback` structure (web `:22-57`, mobile `:30-62`), the
`client.POST("/v1/analytics/events", …)` call (web `:36-43`, mobile `:41-48`), the fire-and-forget
`.catch(() => {})` (web `:44-46`, mobile `:49-51`). Both import `useFrappClient`/`useActiveChapterId`
from `@repo/hooks` and `AnalyticsProperties` from `@repo/validation`. `useAnalytics` was deleted
(zero production callers).

**Genuinely different — this is the design decision:**

- Web checks a client-side opt-out: `useOrgConfig().data?.analytics_opt_out === true` (`:31`),
  early-returns at `:35`, imports `useOrgConfig` at `:6`.
- Web sends `chapter_id` **optionally**: `...(chapterId ? { chapter_id: chapterId } : {})` (`:40`).
- Mobile **hard-gates on chapter**: `if (!chapterId) return;` (`:38-40`) and always sends `chapter_id`
  (`:45`). It has no `useOrgConfig` equivalent — `apps/mobile` has no chapter-config surface at all.

A shared hook needs the opt-out **injected**, not imported. `packages/chat-core/src/adapters.ts:18-134`
is the repo's reference pattern (interface + browser default + platform injection at wiring time).

### The stale comment

`apps/mobile/lib/analytics-provider.tsx:18-26`, verbatim:

> NOTE: the mobile client has no active-chapter context yet (it is still the preview shell — real
> member flows land in #253, and `frapp-client.tsx` hardcodes `getChapterId: () => null`). Until then
> mobile events carry no `chapter_id` …

**It is stale.** `apps/mobile/lib/frapp-client.tsx:51` reads `const { chapterId } = useAuthSession()`
and `:68` passes `getChapterId: () => chapterIdRef.current`. Mobile screens already call
`useActiveChapterId()` (e.g. `apps/mobile/app/(tabs)/tasks.tsx:73`). Delete the comment, and re-decide
whether the hard chapter gate at `:38-40` is still wanted now that a chapter exists.

### Not overlapping

`packages/validation/src/analytics.ts` already shares the crypto/hashing/payload-hygiene layer
(`hashUserIdForAnalytics:182`, `assertContentFreeProperties:376`, `ACTIVATION_MILESTONES:286`). The
providers only consume the `AnalyticsProperties` type from it. Neither client reads a PostHog key —
analytics is API-mediated (`apps/api/src/modules/analytics/analytics.module.ts:34,38`).

### Scope fence

`apps/web/lib/providers/analytics-provider.tsx`, `apps/web/lib/providers/analytics-provider.test.tsx`,
`apps/web/app/providers.tsx:7,19-21`, `apps/mobile/lib/analytics-provider.tsx`,
`apps/mobile/app/_layout.tsx:18,85,91`, a new module in `packages/hooks/src/`, and
`packages/hooks/src/index.ts`.

### Docs/spec to update

`spec/architecture/README.md:119` — the `@repo/hooks` catalog row.

### Collisions

**Hard** with item 8 on `analytics-provider.tsx`, `analytics-provider.test.tsx`,
`packages/hooks/src/index.ts`, and `packages/hooks/package.json`.

## Item 8 — 5 stranded web hooks → `@repo/hooks`

**Scope verdict: MIXED — 3 of 5 are portable, 2 are blocked on web-only dependencies, and the mobile
module-gating half is a design decision, not a wiring change.**

| Hook | Path | Lines | Portable? | Blocker |
|------|------|-------|-----------|---------|
| `use-org-config` | `apps/web/lib/hooks/use-org-config.ts` | 194 | **Yes** | Needs `@repo/validation` added to `packages/hooks` |
| `use-custom-roles` | `apps/web/lib/hooks/use-custom-roles.ts` | 114 | **Yes** | Needs `@repo/validation` (imports 3 types at `:5-9`) |
| `use-custom-fields` | `apps/web/lib/hooks/use-custom-fields.ts` | 109 | **Yes** | Needs `@repo/validation` (imports 3 types at `:5-9`) |
| `use-subscription-write-state` | `apps/web/lib/hooks/use-subscription-write-state.ts` | 111 | **No** | `useChapterStore` from `@/lib/stores/chapter-store` at `:4` (Zustand + `persist`, no `storage` option → **`localStorage`**, `chapter-store.ts:12`), and `@/lib/subscription` at `:5-11` (item 9's target) |
| `use-chapter-theme` | `apps/web/lib/hooks/use-chapter-theme.ts` | 41 | **No** | Writes CSS custom properties to `document.documentElement` at `:21-22`, `:31`, `:37`. Also imports `useChapterStore` |

`"use client"` is **not** a blocker — 23 of the 40 files in `packages/hooks/src` already open with it
(e.g. `packages/hooks/src/use-roles.ts:1`).

### Exports and call sites

- **`use-org-config`** exports `OrgWorkflow:21`, `OrgDues:33`, `OrgConfig:35`, `useOrgConfig:54`,
  `usePendingConfigKeys:124`, `usePatchOrgConfig:148`. Callers:
  `apps/web/lib/providers/analytics-provider.tsx:31`, `app/(dashboard)/members/page.tsx:93`,
  `components/settings/settings-page.tsx:139,146,149`, `components/service/service-page.tsx:124`,
  `components/layout/dashboard-shell.tsx:219`, `components/layout/dashboard-command-menu.tsx:214`,
  `components/chat/chat-shell.tsx:95`.
- **`use-custom-roles`** exports `useCustomRoles:28`, `useCreateCustomRole:46`,
  `useUpdateCustomRole:67`, `useDeleteCustomRole:95`. Callers:
  `components/settings/settings-roles-tab.tsx:144,266,267,268,269`,
  `components/members/member-detail-sheet.tsx:173`.
- **`use-custom-fields`** exports `useCustomFields:23`, `useCreateCustomField:41`,
  `useUpdateCustomField:62`, `useDeleteCustomField:90`. Callers:
  `components/settings/settings-fields-tab.tsx:85,142,143,267`.
- **`use-subscription-write-state`** exports `ChapterSubscription:13`, `useChapterSubscription:34`,
  `UseSubscriptionWriteStateResult:59`, `useSubscriptionWriteState:92`. Callers:
  `components/shared/subscription-gate.tsx:82`, `components/billing/subscription-checkout-card.tsx:68`,
  `app/(dashboard)/billing/page.tsx:70`.
- **`use-chapter-theme`** exports `useChapterTheme:16`. Exactly one caller:
  `apps/web/lib/chat/chat-provider.tsx:34`.

### Test files — every one breaks if the modules move

Nine test files reference the hooks. Missing any of them means a red `check-types` and stale
`vi.mock` paths that silently stop mocking:

| File:line | Kind |
|-----------|------|
| `apps/web/lib/hooks/use-org-config.test.tsx:14-15` | direct test of the module |
| `apps/web/lib/providers/analytics-provider.test.tsx:16-17` | `vi.mock` of use-org-config |
| `apps/web/components/layout/dashboard-command-menu.test.tsx:17-18` | `vi.mock` |
| `apps/web/components/settings/settings-rollover-gating.test.tsx:34-42` | `vi.mock` |
| `apps/web/components/service/service-page.test.tsx:65-66` | `vi.mock` |
| `apps/web/components/settings/settings-workflows-tab.test.tsx:4` | type import |
| `apps/web/components/settings/settings-dues-tab.test.tsx:4` | type import |
| `apps/web/components/settings/settings-roles-tab.test.tsx:12-16` | `vi.mock` of use-custom-roles |
| `apps/web/components/members/member-detail-sheet.test.tsx:30-31` | `vi.mock` of use-custom-roles |
| `apps/web/components/settings/settings-fields-tab.test.tsx:12-16` | `vi.mock` of use-custom-fields |

Type-only source imports also move: `settings-workflows-tab.tsx:16`, `settings-dues-tab.tsx:24`.

### `packages/hooks` conventions

`packages/hooks/package.json:5-7` exports `"." → ./src/index.ts` (single barrel, no subpaths).
Dependencies: `react` 19.2.3, `@tanstack/react-query`, `@repo/api-sdk` — **no `@repo/validation`**
(`package.json:15-19`), which all three portable hooks need. Adding a hook = new file + one
`export * from "./use-x"` line. Hooks get their client via `useFrappClient()` / `useActiveChapterId()`
(`packages/hooks/src/use-frapp-client.tsx:15-47`). No platform-specific code exists in the package
today. No name collisions — zero hits for all five names in `packages/hooks`. Note `useRoles`
(`use-roles.ts:6`) hits `/v1/roles` while `useCustomRoles` hits `/v1/custom-roles`: similar names,
different endpoints, not a duplicate.

### The mobile module-gating half is not mechanical

Web and mobile read `enabled_modules` from **different endpoints**:

- Web: `useOrgConfig()` → `GET /v1/chapters/{id}/config` (merged archetype config), then attaches an
  `isModuleEnabled` predicate at `use-org-config.ts:69-75`.
- Mobile: reads `enabled_modules` straight off `useCurrentChapter()` → `GET /v1/chapters/current`
  (`packages/hooks/src/use-chapters.ts:58`), then calls the shared predicate directly —
  `apps/mobile/app/(tabs)/study.tsx:577-585` (`"hours"`),
  `apps/mobile/app/(tabs)/preferences.tsx:349-355` (`"geofences"`).

The pure predicate is **already shared**: `isModuleEnabled` at `packages/validation/src/index.ts:399-404`
(imported server-side at `apps/api/src/interface/guards/chapter.guard.ts:23`, called at `:292`). So
"wire mobile's module-gating to the shared one" really asks *should mobile start calling the config
endpoint?* — an extra network call for merged archetype defaults and vocabulary. **Decide before the
goal runs; do not let an agent decide it silently.**

### `use-chapter-theme` probably belongs elsewhere

`packages/chapter-theme` is pure palette derivation (`derivePalette` at `src/index.ts:173`, WCAG
machinery at `:50` and `:83-96`) with no React and no DOM. `packages/theme` holds design tokens and
`resolveChapterAccentColor`. The web hook is a **DOM side-effect applier**. Mobile has its own
`useChapterBranding` (`apps/mobile/lib/chapter-branding.ts:42`) and will never consume it. Moving it
as-is puts a `document`-touching effect into a package with no platform-specific code. Recommend:
**drop it from this item**, or split it into a shared data hook plus a web-only applier.

### Recommendation

Reduce to **three hooks** (`use-org-config`, `use-custom-roles`, `use-custom-fields`). Handle
`use-subscription-write-state` only after item 9 lands, swapping `useChapterStore` for
`useActiveChapterId`. Drop `use-chapter-theme` or re-scope it.

### Scope fence (reduced item)

The three portable hook files, their call sites and the ten test files above,
`packages/hooks/src/index.ts`, `packages/hooks/package.json`. **Not**
`use-subscription-write-state.ts` or `use-chapter-theme.ts`. Mobile module-gating only if the endpoint
decision has been made.

### Docs/spec to update

`spec/ui/web-dashboard/README.md:60` and `docs/hooks/README.md:68` both name
`apps/web/lib/hooks/use-org-config.ts` by path — that path dies with the move, and a search by *import
specifier* will not surface either. If `use-chapter-theme` is ever moved,
`spec/ui/design-system/accent-engine.md:97` names it too.

### Collisions

**Hard** with item 9 (`use-subscription-write-state.ts`, `subscription-gate.tsx`), item 7
(`analytics-provider.tsx`, `packages/hooks/src/index.ts`, `packages/hooks/package.json`), item 4
(`chat-shell.tsx`, `chat-provider.tsx`), item 5 (all three portable hooks carry query keys), item 6
(`apps/mobile/app/(tabs)/study.tsx`, `member-detail-sheet.tsx`), and item 1 (`member-detail-sheet.tsx`,
`billing/page.tsx`, `members/page.tsx`, `dashboard-command-menu.tsx`, `service-page.tsx`).

**Item 8 is the most entangled item on the list — it collides with six of the other eight.** Run it
alone.

## Item 9 — `apps/web/lib/subscription.ts` → `@repo/validation`

**Scope verdict: EXACTLY as claimed — 177 lines, verified — and the cleanest move on the list.** Its
only import is a *type*, and that type already comes from the destination package.

### The file

`apps/web/lib/subscription.ts`, 177 lines. Sole import, line 1:
`import type { CurrentChapterPayload } from "@repo/validation"`. No `next/*`, no `react-dom`, no
browser APIs, no `apps/web`-local types. Fully portable.

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

Gates only on `subscription_status`, `past_due_since`, and `writeClass` — no plan tiers, seat counts,
or trial state.

### Follow the `permissions.ts` pattern exactly

- **`can`** — `packages/validation/src/permissions.ts:25` (plus `canAll:39`, `canAny:53`,
  `WILDCARD_PERMISSION:17`), re-exported from the barrel at `packages/validation/src/index.ts:886`. Web
  wraps it in a `Can` component at `apps/web/components/shared/can.tsx:51` (the import is at `:6`).
- **`isModuleEnabled`** — inline at `packages/validation/src/index.ts:399-404`.

So: create `packages/validation/src/subscription.ts` (a **separate file**, mirroring `permissions.ts` —
do not inline 177 lines into `index.ts`), add one re-export line to `src/index.ts`, and move
`apps/web/lib/subscription.test.ts` (116 lines) into the package's Vitest suite.
`packages/validation` depends on `zod` only (`package.json:22-24`).

### The four importers — verified exhaustively

1. `apps/web/lib/hooks/use-subscription-write-state.ts:11` — **also item 8's target**
2. `apps/web/components/shared/subscription-gate.tsx:11`
3. `apps/web/components/shared/subscription-gate.test.tsx:12`
4. `apps/web/lib/subscription.test.ts:6` (via `./subscription`; moves with the file)

**Not importers, despite appearances:** 22 components call `useSubscriptionGate`, importing it from
`@/components/shared/subscription-gate` (defined at `:79`). They do not change.

### Mobile has no subscription gate — confirmed

Zero hits for `subscriptionWriteState`, `isSubscriptionStatus`, `SubscriptionWriteClass`,
`subscription_status`, or `past_due_since` anywhere in `apps/mobile`. Mobile billing is member-dues
only (`apps/mobile/app/(tabs)/dues.tsx:59-60` explicitly distinguishes the two). Moving the gate makes a
mobile gate *possible*; building one is not part of this item.

### The server-side namesake is an orphan — flag, do not merge

`apps/api/src/domain/utils/subscription.ts` (631 bytes) has **zero production callers** — the only
importer repo-wide is its own `subscription.spec.ts:1`, and there is no barrel in
`apps/api/src/domain/utils/`. Worse, its `canPerformWriteAction` at `:7-9` is `status === 'active'`,
which blocks every `past_due` write with no grace window and no free-tier carve-out — directly
contradicting the live guard at `apps/api/src/interface/guards/chapter.guard.ts` (3-day
`GRACE_PERIOD_MS`, `isWithinGrace`, `@FreeTier`) that `apps/web/lib/subscription.ts:97-105,165-171`
mirrors. Per the tech-debt protocol this is orphaned **and** contradictory code: flag it in the PR body
and file a GitHub issue. **Do not delete or merge it as part of this item** — that is a separate
decision.

### Scope fence

`apps/web/lib/subscription.ts` (delete), `apps/web/lib/subscription.test.ts` (move),
`packages/validation/src/subscription.ts` (new), `packages/validation/src/index.ts` (one line), and the
three remaining importers. **Do not touch `apps/api/src/domain/utils/subscription.ts`** — file it.

### Docs/spec to update

`spec/ui/design-system/README.md:111` names `apps/web/lib/subscription.ts` by path in the "subscription
mirror is a predicate" paragraph. That path dies with the move and a specifier search will not surface
it. Also `spec/architecture/README.md:124` (the `@repo/validation` catalog row).

### Collisions

**Hard** with item 8 (`use-subscription-write-state.ts`, `subscription-gate.tsx`) and item 2
(`packages/validation/src/index.ts`).

## Recommended sequencing

Review bandwidth is the constraint, so batch by *review cost*, not agent capacity.

**Batch 1 — run in parallel now: items 3, 4, 6, 9.** Verified mutually disjoint on source, subject to
the two constraints in the [batch-1 note](#recommended-first-batch-3-4-6-9). Roughly **73 distinct
files** (item 3 ≈ 22 counting the doc/skill rows, item 4 ≈ 29, item 6 ≈ 15, item 9 ≈ 7), but most are
one-line import rewrites.

- **3** is the cheapest review: deletions plus config edits, zero source imports. Its doc half matters
  more than its code half — two skills currently tell future agents to import the deleted package.
- **4** is pure import rewriting against six proven-passthrough shims, with a two-command zero-match
  proof.
- **9** is one file move, four importers, and a test that moves with it.
- **6** is 8 deletions, 11 call-site updates, and the mobile `api-error.ts` promotion. Budget the
  review time here — 7 of those call sites change user-visible error copy, for the better.

**Batch 2 — item 2.** Fixes a real user-facing bug and spans three layers including SQL. Review alone.
Sequence after 9 to avoid the `packages/validation/src/index.ts` conflict.

**Batch 3 — items 1a and 7, not 8.** The first draft of this plan put 1a, 7, and 8 together; that was
wrong. Item 8 collides with item 1 on five files and with item 7 on four. Run **1a ∥ 7**, then **8
alone**. Each needs a decision made *before* the goal fires: which date clusters merge (1a), how the
analytics opt-out gets injected (7), whether mobile switches to the config endpoint (8).

Note item 1 also collides with item **3** on four manifest/config/CI files, so 1a cannot run until
batch 1 has landed.

**Batch 4 — item 5, supervised, split 5a/5b/5c.** Highest risk, touches tenant scoping, and 5c is
blocked on a scoping decision for `supabase-notification.repository.ts`.

## Debt spotted

Every row here needs a `triage`-labeled GitHub issue (floor requirement 7) unless it is fixed inline by
the item named. No issue numbers yet — this planning pass had no tracker writes in scope.

| Item | Debt | Action |
|------|------|--------|
| 1 | Web and mobile stopwatch formatters disagree on minute padding (`04:12` vs `4:12`); mobile's test enshrines its form | Decide in 1b; do not merge blindly |
| 1 | Bare-date parsing splits local-midnight vs UTC-noon across three files | Decide in 1b |
| 1 | Minute-duration formatters differ on rounding and negative clamping | Decide in 1b |
| 2 | `image/gif` accepted by Documents, rejected by Backwork client-side, while the Backwork API and bucket both allow it | Fix in item 2 with a regression test |
| 2 | Legacy Office MIME types (`.doc`/`.xls`/`.ppt`) allowed server-side, absent from every web client map | Decide: add to client or drop from server |
| 2 | `apps/web/components/chat/composer.tsx:356-361` file input has no `accept` and forwards raw `file.type` | Fold into item 2 |
| 2 | `packages/validation/src/index.ts:433` hardcodes `.max(10_000)` instead of importing `CHAT_MESSAGE_CONTENT_MAX_LENGTH` | Fix in item 2 |
| 2 | `apps/mobile/lib/tasks/limits.ts:16` hand-copies `POINTS_MAX` with a comment pointing at `field-limits.ts:55` | Fix in item 2 |
| 2 | `apps/web/components/backwork/backwork-page.tsx:99,100,112` redefines `SEMESTERS`/`ASSIGNMENT_TYPES`/`DOCUMENT_VARIANTS`, byte-identical to `packages/validation/src/index.ts:165,166,178` | Fix in item 2 — the file is already open |
| 2 | No client-side `file.size` check anywhere; 25 MB is copy only | Add with the shared limits |
| 3 | Two skills (`ui-development`, `testing`) instruct agents to import from / test a package that is about to be deleted | Fix in item 3 |
| 5 | `use-polls.ts:28` and `:55` share a `"polls"` prefix with different tuple shapes | Fixed by the factory |
| 5 | Seven hooks invalidate an unscoped prefix while mounting a scoped key | Fix during migration |
| 5 | Both `taskKeys` and `notificationKeys` accept `chapterId: string \| null`, and `useTasks` mounts on `taskKeys.lists()` — the pattern the factory forbids | Fix in 5a |
| 5 | `supabase-notification.repository.ts` has no tenant read filter and no test; the ledger records the correct behavior as undecided | Needs a decision — file it |
| 5 | `scheduled-jobs.repository.ts` and `chat-notification-preference.repository.ts` sit outside the coverage ledger's directory scan and can never fail it | Widen the scan — file it |
| 6 | `payIntentErrorCopy` duplicated: `apps/web/components/billing/pay-invoice-dialog.tsx:41` and `apps/mobile/lib/dues/pay-errors.ts:23` | File it |
| 6 | `packages/api-sdk` has no test harness or CI step, so a hand-written module there is untested | File it; do not fix in batch 1 |
| 7 | `useAnalytics` had zero production call sites in either app | Deleted (hygiene); providers + `track` remain |
| 7 | `apps/mobile/lib/analytics-provider.tsx:18-26` comment is factually stale | Delete in item 7 |
| 9 | `apps/api/src/domain/utils/subscription.ts` is an orphan (only its own spec imports it) whose `canPerformWriteAction` contradicts the live guard's 3-day grace window | Flag in the PR and file it; do not merge or delete in item 9 |
