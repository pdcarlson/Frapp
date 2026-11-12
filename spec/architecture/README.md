# Architecture Specification: Frapp

---

## 1. High-Level Stack

| Layer          | Technology                                   | Notes                                                                                                                 |
| -------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Monorepo       | Turborepo + npm workspaces                   | Single repo, task orchestration, caching.                                                                             |
| Landing        | Next.js (App Router)                         | `apps/landing` at frapp.live. Static/SSG for speed.                                                                   |
| Web App        | Next.js (App Router), Tailwind, ShadCN UI    | `apps/web` at app.frapp.live. Admin dashboard.                                                                        |
| Mobile App     | Expo (React Native), Expo Router             | `apps/mobile`. Signet StyleSheet tokens; NativeWind removed. iOS + Android.                                           |
| Developer docs | Markdown in-repo                             | [`docs/guides/`](../../docs/guides/README.md) + `spec/`. No deployed docs web app; a public site may return post-launch. |
| API            | NestJS 11, TypeScript (strict)               | `apps/api`. REST only; realtime is Supabase Realtime.                                                                 |
| Database       | PostgreSQL (via Supabase)                    | Supabase-hosted Postgres. Migrations via Supabase CLI.                                                                |
| Auth           | Supabase Auth                                | Email/password, magic link, Google, Apple.                                                                            |
| Storage        | Supabase Storage                             | Private buckets ([§7](#7-storage-supabase-storage)), all declared in migrations. Signed URLs only — no public access.                          |
| Realtime       | Supabase Realtime                            | Postgres changes for chat + the audit-log worker (publication membership is required and was missing until #867). Private broadcast for dashboard change-pings. Broadcast for typing indicators. Presence for online status. |
| Billing        | Stripe                                       | Subscriptions, checkout, webhooks, invoices.                                                                          |
| Push           | Expo Push Service                            | Mobile push notifications via `expo-server-sdk`.                                                                      |
| Observability  | Sentry + PostHog + structured logging        | Contract: [`spec/behavior/observability.md`](../behavior/observability.md). Decision: [ADR-22](adr/adr-22.md). |
| CI/CD          | GitHub Actions + Vercel + EAS                | Lint, typecheck, test, deploy.                                                                                        |

---

## 2. Repository Structure

```
Frapp/
  apps/
    api/            # NestJS REST API (realtime is Supabase Realtime)
    web/            # Next.js admin dashboard (app.frapp.live)
    mobile/         # Expo mobile app (iOS + Android)
    landing/        # Next.js marketing site (frapp.live)
  packages/         # 13 shared workspaces
    api-sdk/        # Generated API client + TypeScript types
    brand-assets/   # Canonical SVG marks (favicon + lockup)
    chapter-theme/  # Signet chapter accent engine (one seed -> `--signet-*` role tokens)
    chat-core/      # Platform-neutral chat hot path (cache, send client, realtime manager) behind injected adapters
    color/          # Shared WCAG contrast math
    eslint-config/  # Shared ESLint configuration
    formatting/     # Shared date/time/duration display helpers and the CSV cell writer (API + web + mobile)
    hooks/          # Shared React hooks (use-members, use-frapp-client, etc.)
    observability/  # Browser-safe observability policy (Sentry PII scrubbing, sample-rate parse)
    org-archetypes/ # Greek-org directory / archetype data
    theme/          # Tailwind preset + the Signet stylesheet (`signet.css`, both web surfaces) and typed tokens
    typescript-config/ # Shared tsconfig
    validation/     # Shared Zod schemas (used by API + web + mobile)
  spec/             # Product spec, behavior spec, architecture, environments
  supabase/         # Supabase project config, migrations, seed files
```

---

## 3. Applications

### 3.1 API (`apps/api`)

- **Framework:** NestJS 11 (Node.js, TypeScript — `apps/api` is not full `strict`; see §11).
- **Role:** REST API. All business logic lives here. Realtime goes through Supabase Realtime, not the API.
- **Architecture pattern:** Layered — Interface (controllers, DTOs, guards) -> Application (services/use-cases) -> Infrastructure (repositories, Supabase client, external adapters) -> Domain (entities, interfaces, business rules).
- **Database access:** Supabase JS client (`@supabase/supabase-js`) for Postgres queries, storage operations, and auth admin operations. No ORM; raw SQL or query builder via Supabase.
- **Security:**
  - `SupabaseAuthGuard`: Validates JWT from Supabase Auth on every request.
  - `ChapterGuard`: Resolves the active chapter and verifies membership. How the chapter is resolved — claim, header fallback, precedence and the mismatch response — is owned by [`../behavior/multi-tenancy.md`](../behavior/multi-tenancy.md), item 1 of its Enforcement layers list.
  - `PermissionsGuard`: Checks `@RequirePermissions()` metadata against the user's flattened permission set.
- **Validation:** Global `ValidationPipe` using `class-validator` and `class-transformer`.
- **Documentation:** Swagger UI at `/docs` via `@nestjs/swagger`.
- **Observability:** Structured JSON logging, `x-request-id`, Sentry (exceptions and traces), PostHog via the API analytics transport. Contract: [`spec/behavior/observability.md`](../behavior/observability.md).

### 3.2 Web App (`apps/web`)

- **Framework:** Next.js (App Router), React, Tailwind CSS, ShadCN UI.
- **Data fetching:** TanStack Query + `@repo/api-sdk`.
- **Client state:** Zustand is the sanctioned store for client-only state, distinct from TanStack Query's server-state cache. The active-chapter selection is the live example — `apps/web/lib/stores/chapter-store.ts` wraps the store in Zustand's `persist` middleware so the choice survives reloads.
- **Auth:** Supabase Auth (browser client via `@supabase/ssr`). Session token forwarded to API.
- **Role:** Admin console for Presidents, Treasurers, and officers.
- **Server Components** by default; Client Components marked with `'use client'` only where interactivity requires it.
- **Dark mode:** Dark-only since the #920 shell slice — no theme provider and no user-facing switch, so there is nothing to detect or override.

### 3.3 Mobile App (`apps/mobile`)

- **Framework:** Expo (~57), React Native, Expo Router. Styling is typed `StyleSheet` factories over the `@repo/theme` Signet tokens — **not** NativeWind, which was removed and is banned on this surface (`spec/ui/design-system/README.md` §2, `spec/ui/mobile/README.md`).
- **Auth:** Supabase Auth (React Native client with `AsyncStorage` persistence).
- **Data fetching:** TanStack Query + `@repo/api-sdk`.
- **Push notifications:** Registers push token with API on login; receives via Expo Push.
- **Study mode:** Uses Expo `AppState` API for foreground/background detection. Heartbeat timer stops on background.
- **Haptics:** Expo Haptics for tactile feedback on key actions.
- **Dark mode:** The app is dark-only. Signet is dark-first and `SignetAppearance` admits exactly `"dark"`, so there is no light theme to detect or override (`spec/ui/design-system/foundations.md`).
- **Offline:** Future consideration (WatermelonDB or similar for chat caching). Not in scope for v1.

### 3.4 Landing (`apps/landing`)

- **Framework:** Next.js (App Router), Tailwind.
- **Role:** Marketing, pricing, CTA. No auth state. Links to app.frapp.live for sign-up/log-in.
- **Observability:** Anonymous Sentry errors and PostHog page/CTA analytics when credentials are set. No identity call, no alias onto an authenticated distinct id, no chapter group ([`observability.md`](../behavior/observability.md#provider-ownership)). Replay stays off in every environment until #2038.
- **Deployment:** Vercel, independent from the web app.

### 3.5 Documentation (no `apps/docs` web app)

- **Authoring:** Developer guides in **[`docs/guides/`](../../docs/guides/README.md)**; product and architecture in **`spec/`**. Read and edit in GitHub or your editor; there is no separate Next.js documentation deployment in this repo for now.
- **Spec rendering:** Previously the removed docs app rendered `spec/*.md` in a browser. Today, use the repo view on GitHub (or a local markdown preview). A future public docs site may restore styled rendering.
- **Keeping it true:** what to do when a change makes a doc wrong, or when spec and code disagree, is owned by [`AGENTS.md` § Spec vs code](../../AGENTS.md#spec-vs-code) and [§ Documentation discipline](../../AGENTS.md#documentation-discipline). What CI checks: [`docs-ci.md` § What runs](../../docs/ci-cd/docs-ci.md#what-runs).

---

## 4. Shared Packages

| Package                   | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `@repo/api-sdk`           | OpenAPI-generated TypeScript client plus a hand-written error reader (`statusOf`, `serverMessageOf`, `codeOf` in `src/api-error.ts`). Codegen overwrites only `src/types.ts`. Used by web + mobile + hooks + chat-core. |
| `@repo/brand-assets`      | Canonical SVG marks (favicon + lockup).                                   |
| `@repo/chapter-theme`     | The Signet chapter accent engine: one seed hex to the `--signet-*` role tokens, over a vendored Radix generator. Server code imports the barrel; browser code imports the dependency-free `./accent-vars` leaf. Canon: [`ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md). |
| `@repo/chat-core`         | Platform-neutral chat hot path — normalized cache, optimistic send client, realtime manager, shared topic registry — behind injected `KeyValueStore` / `NetworkState` / `OutboxStore` ports. Source-only and imported by subpath (there is no barrel). `./integrations` holds the slash-command catalog, parsers and rich-message payload shapes (until #3228, the separate `@repo/chat-integrations` package); `/points` reason length there is `POINTS_REASON_MAX_LENGTH` from `@repo/validation`, not a local copy. |
| `@repo/color`             | Shared WCAG contrast math. DOM-free so `@repo/chapter-theme` (and through it the API), `@repo/hooks` and `apps/web` share one implementation. |
| `@repo/eslint-config`     | Shared ESLint rules.                                                      |
| `@repo/formatting`        | Shared date/time/duration display helpers, and the one spreadsheet-cell writer every CSV export calls (`toCsvCell`, built on `neutralizeFormulaCell`, which makes formula-shaped text inert; #3976): the API's `toCSV` and the dashboard's `rowsToCsv`. A new export reaches for it rather than writing its own escaping. `parseInstant` is the primitive under every member that parses a **string** — the locale formatters (`formatClock`, `formatLocaleDateTime`, `formatLocaleDate`, and the chat thread's `formatTimeOfDay` / `formatTimeOfDayShort`) and both bare-date parsers — and returns a `Date` or `null`, i.e. "parse this timestamp, or treat it as absent". (The members that take a number or an already-built `Date` — the stopwatch pair, the minute pair, `formatBytes`, `dayDelta`, `localIsoDate` — never reach it.) It is exported so a surface reaches for it instead of hand-rolling `new Date(v)` + a `NaN` guard; only `apps/web` has a gate enforcing that (`apps/web/lib/date-call-sites.spec.ts`), so on mobile and the API it is a convention. It *is* `new Date(v)`, so it carries the bare-date defect exactly as `formatLocaleDate` does: a bare `date` column takes a display helper below or `formatBareDate`, never this. **The display helpers** in `display.ts` (`formatDay`, `formatDayRange`, `formatDayTime`, `formatDayTimeRange`, `formatRelativeDayTime`, `formatSentLabel`, `formatDueLabel`, `formatWeekdayDay`, `formatTimestampFull`, and `formatDayHeading` for a list's written-out day headings) are the house date shapes web shows, and mobile where it reads one ("Fri, Nov 6 · 5:00 PM", "Due tomorrow", "Tomorrow"): they read a bare `date` at local noon themselves and return `null` for a value they can't read, so a caller guards on the result, never on the raw field. Since 2026-11-05 no web screen calls `formatLocaleDate`, `formatLocaleDateTime` or `formatBareDate`; retiring them is [#3420](https://github.com/pdcarlson/Frapp/issues/3420), after mobile stops using them. Generic locale formatters (`formatClock`, `formatLocaleDateTime`, `formatLocaleDate`, and the chat thread's time-only `formatTimeOfDay` / `formatTimeOfDayShort`) plus three **protected clusters** that must stay distinct: stopwatch padding (`formatPaddedStopwatch` / `formatTimer`), bare-date timezone parsing (`parseBareDateLocalMidnight` / `parseBareDateLocalNoon` / `parseInstantOrBareLocalNoon` for a column of mixed shape, plus the cluster's own formatter `formatBareDate` — a `date` column takes that, never `formatLocaleDate`), and minute-duration rounding (`formatMinutesExact` / `formatMinutesRounded`), plus `formatBytes`. Calendar-day arithmetic (`dayDelta`) is here too rather than per-screen — it reads each instant's *local* Y/M/D, which is what every "due tomorrow" and TODAY/EARLIER split wants, so a bare `date` column reaches it through a cluster parser and never through `new Date`. Writing one goes the other way through `localIsoDate`: a `Date`'s local calendar day as `YYYY-MM-DD`, which is what a form pre-fills as "today" and what a bare `date` column takes, never `toISOString().slice(0, 10)` (the UTC day, so an evening entry in the Americas lands on tomorrow). Day headings (`formatDayHeading`: Today, Tomorrow, Yesterday, the weekday, then the date) and the month grid (`monthGrid`, `startOfMonth`) live here too. Used by API + web + mobile + chat-core (the thread's day dividers and grouping). |
| `@repo/hooks`             | Shared React hooks wrapping api-sdk with TanStack Query.                  |
| `@repo/observability`      | Browser-safe observability policy: Sentry PII scrubbing, correlation types, sample-rate parsing in `[0,1]`, first-party Sentry trace-propagation origins, and the constants that describe the Sentry/PostHog split. Vendor SDK **init calls** stay runtime-local to NestJS, Next.js, and React Native. Identify / groups / hex validation / identified Sentry attach are `@repo/observability/identified-posthog` (web and mobile only). `@repo/observability/next` holds anonymous Next.js option builders (replay-off, both scrubber hooks, debug IDs, path-only analytics) with **no** identify / group / `setUser` APIs — landing imports only that entry. Used by API + web + landing + mobile. |
| `@repo/org-archetypes`    | Greek-org directory / archetype data for onboarding autofill and the module catalog; the chapter's own words, where `vocab()` and `memberViewVocabulary()` name its recruitment, new-member, class and order-number terms over its archetype's defaults; and per-organization profiles (`ORG_PROFILES`: official colors, short name, whether the organization displays its Greek letters). The letter rules live here: `orgHidesGreekLetters` matches an organization's name exactly, `orgHidingGreekLettersIn` finds one inside a chapter's name, and `orgMarkFieldsFor` sets a setup form's short name and letters switch. Consumed by the API (chapter config seed, the invite preview's letter override), web (first-officer wizard, Settings, accent swatches, the nav crest's letter override, and the chapter's words in chat and Settings), and `apps/mobile` (create-chapter, accent picker, Chat home's letter override, the chat rush card's recruitment word), and `@repo/hooks/chapter-identity` (setup's Organization-field glue). Tested by its own suite (`npm run test -w @repo/org-archetypes`). |
| `@repo/theme`             | Shared Tailwind preset plus one stylesheet: `signet.css` (dark-only Signet tokens), imported by `apps/web` and, since #2366, `apps/landing`. The legacy bone/bronze `globals.css` was deleted in that cutover. Typed tokens for non-Tailwind consumers (`./signet`). |
| `@repo/typescript-config` | Shared tsconfig presets.                                                  |
| `@repo/validation`        | Shared Zod 4 schemas, upload MIME/size allowlists (kinds: [`content-validation.md` § 1](../../docs/security/content-validation.md#1-allowed-content-types)), field-length caps, plus client gates (`can`, `isModuleEnabled`, `subscriptionWriteState`, `isAnalyticsOptedOut`) used by API + clients. `z.record` requires a key schema and a value schema. |

---

## 5. Data Model (Supabase Postgres)

All tables use `uuid` primary keys (generated by `gen_random_uuid()`). Timestamps default to `now()`. Nearly every table carries `chapter_id` for tenant scoping.

### Core Tables

**users** — `id`, `supabase_auth_id` (unique), `email`, `display_name`, `avatar_url` (nullable — the `profiles`-bucket path of a confirmed upload, served to clients as a signed URL; see [`members.md`](../behavior/members.md#profiles)), `bio` (nullable), `graduation_year` (int, nullable — for alumni directory), `major` (text, nullable, ≤ 100 characters through the API — the member's own; added 2026-11-06 so the bio stops asking for it), `current_city` (text, nullable — for alumni directory), `current_company` (text, nullable — for alumni directory), `created_at`, `updated_at`.

**chapters** — `id`, `name`, `university`, `stripe_customer_id` (unique, nullable), `subscription_status` (incomplete | active | past_due | canceled), `subscription_id` (unique, nullable), `accent_color` (text, nullable — hex string for chapter branding, default `#2563EB`), `logo_path` (text, nullable — Supabase Storage path for chapter logo), `donation_url` (text, nullable — external donation link for alumni), `chat_background` (text, default `plain` — the chapter's default chat background key), `chat_background_photo_path` (text, nullable — in `branding`, set exactly when the key is `photo`), `chat_background_message_id` (FK chat_messages, nullable, `on delete set null` — the line announcing that photo; see [chat § Chat backgrounds](../behavior/chat/README.md#chat-backgrounds)), `created_at`, `updated_at`.

**members** — `id`, `user_id` (FK users), `chapter_id` (FK chapters), `role_ids` (text[]), `custom_role_ids` (uuid[], default `{}`; always empty since #4075 folded custom roles into `roles`, read by nothing, and dropped in a later release: [`rbac.md` § Custom roles folded into roles](../behavior/rbac.md#custom-roles-folded-into-roles)), `has_completed_onboarding` (bool, default false — controls onboarding tutorial display), `dismissed_ops_nudges` (text[], default `{}` — `MODULE_CATALOG` keys whose ops-setup nudge this member has dismissed in this chapter, plus `setup-checklist` once they hide the setup checklist; the API accepts `MEMBER_DISMISSAL_KEYS`. See [`product/modules.md`](../product/modules.md#ops-setup-nudges) and [§ Setup checklist](../product/modules.md#setup-checklist)), `pledge_class_id` (nullable; composite FK with `chapter_id` to `chapter_pledge_classes (id, chapter_id)`, so always a class of the member's own chapter; set null when the class is deleted), `order_number` (nullable int, 1 to 1,000,000: the member's order within their class or chapter-wide, [`members.md` § Pledge class and order number](../behavior/members.md#pledge-class-and-order-number)), `created_at`, `updated_at`. Unique on (user_id, chapter_id).

**chapter_pledge_classes** — `id`, `chapter_id` (FK chapters, on delete cascade), `name` (1 to 80 characters trimmed; unique per chapter on `lower(btrim(name))`), `position` (int; orders the chapter's list, lowest first, which is oldest first), `created_at`, `updated_at`. Unique on (id, chapter_id), the target of the `members` foreign key.

**roles** — `id`, `chapter_id` (FK chapters), `name`, `system_key` (text, nullable — rename-proof identity for seeded system roles, null for custom roles; see [`behavior/rbac.md`](../behavior/rbac.md#role-lifecycle)), `permissions` (text[]), `is_system` (bool), `display_order` (int), `color` (text, nullable, hex string), `tier_id` (uuid, nullable; the role's tier, null for a role outside the tiers; composite FK `(tier_id, chapter_id)` to `role_tiers (id, chapter_id)`, no cascade), `permission_overrides` (jsonb object, default `{}`; permission key to true or false), `created_at`. Unique on (chapter_id, name); partial unique on (chapter_id, system_key) where `system_key is not null`. `permissions` is kept equal to the tier's permissions with the overrides applied by the `trg_roles_sync_permissions` and `trg_role_tiers_sync_roles` triggers; see [`behavior/rbac.md`](../behavior/rbac.md#tiers-and-overrides).

**role_tiers** — `id`, `chapter_id` (FK chapters, on delete cascade), `position` (int, 1 to 1000; 1 is highest; unique per chapter, deferrable), `name` (1 to 80 characters trimmed; unique per chapter on `lower(btrim(name))`), `permissions` (text[], never `*`), `created_at`, `updated_at`. A chapter's own ordered tiers of roles (#4071).

**invites** — `id`, `token` (unique), `chapter_id` (FK chapters), `role`, `expires_at`, `created_by` (FK users), `used_at` (nullable; set on redeem and on revoke), `created_at`, `email` (nullable; the address an emailed invite went to), `revoked_at` (nullable).

### Backwork

**backwork_departments** — `id`, `chapter_id` (FK chapters), `code` (e.g. "CS"), `name` (nullable, e.g. "Computer Science"), `created_at`. Unique on (chapter_id, code).

**backwork_courses** — `id`, `chapter_id` (FK chapters), `department_id` (FK backwork_departments, on delete cascade), `course_number` (text), `course_key` (generated: `lower(btrim(course_number))`), `name` (nullable, e.g. "Calculus I"), `nicknames` (text[], at most 20, each 1 to 60 characters, checked by `backwork_course_nicknames_ok`), `created_at`, `updated_at`. Unique on (chapter_id, department_id, course_key). Files are not linked by FK: a resource belongs to a course by its `department_id` and trimmed, lowercased `course_number` ([`backwork.md` § Course Names](../behavior/backwork.md#course-names)).

**backwork_professors** — `id`, `chapter_id` (FK chapters), `name`, `created_at`. Unique on (chapter_id, name).

**backwork_resources** — `id`, `chapter_id` (FK chapters), `department_id` (FK backwork_departments, nullable), `course_number` (text, nullable), `professor_id` (FK backwork_professors, nullable), `uploader_id` (FK users), `title` (nullable), `year` (int, nullable), `semester` (text, nullable — Spring | Summer | Fall | Winter), `assignment_type` (text, nullable — Exam | Midterm | Final Exam | Quiz | Homework | Lab | Project | Study Guide | Notes | Other), `assignment_number` (int, nullable), `document_variant` (text, nullable — Student Copy | Blank Copy | Answer Key), `storage_path` (Supabase Storage path), `file_hash` (SHA-256), `is_redacted` (bool, default false), `tags` (text[]), `created_at`. Unique on (chapter_id, file_hash).

### Points & Events

**point_transactions** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `amount` (int), `category` (text — ATTENDANCE | ACADEMIC | SERVICE | FINE | MANUAL | STUDY), `description` (text), `metadata` (jsonb — may contain `event_id`, `study_session_id`, `adjusted_by`, `flagged`), `client_message_id` (text, nullable — idempotency key for manual and fine adjustments, sent by the `/points` command and the dashboard; null on every other award path, and on dashboard rows written before the dashboard sent one), `created_at`. Partial unique on (chapter_id, client_message_id) where `client_message_id` is not null. The ledger is append-only, so a retried adjustment that wrote a second row could not be undone — the index is what makes a replay a no-op. See [`points.md`](../behavior/points.md) § Anti-Fraud for the contract it enforces.

**events** — `id`, `chapter_id` (FK chapters), `name`, `description` (nullable), `location` (text, nullable), `start_time`, `end_time`, `point_value` (int, default 10), `is_mandatory` (bool, default false), `recurrence_rule` (text, nullable — e.g. "WEEKLY", "BIWEEKLY", "MONTHLY"), `parent_event_id` (FK events, nullable — for recurring instances), `required_role_ids`, `optional_role_ids`, `excluded_role_ids` (text[], nullable — roles set apart from the default), `others_invited` (bool, nullable — whether a member holding none of the listed roles is invited; null reads as "unless `required_role_ids` is non-empty"), see [`events.md` § Event Creation](../behavior/events.md#event-creation), `notes` (text, nullable — markdown meeting minutes, editable by admins post-event), `check_in_zone` (jsonb, nullable — the check-in geofence polygon) and `check_in_zone_name` (text, nullable), `check_in_opens_minutes` (int, default 10 — how early check-in opens), `search_vector` (tsvector, for search), `created_by` (FK users, nullable, on delete set null — who made it; null before 2026-11-11), `event_type_id` (nullable; composite FK with `chapter_id` to `event_types (id, chapter_id)`, set null when the type is deleted; [`events.md` § Event types](../behavior/events.md#event-types)), `created_at`.

**event_types** — `id`, `chapter_id` (FK chapters, on delete cascade), `name` (1 to 60 characters trimmed; unique per chapter on `lower(btrim(name))`), `point_value` (int, 0 to 100,000), `is_mandatory` (bool), `position` (int; orders the list, lowest first), `created_at`, `updated_at`. Unique on (id, chapter_id), the target of the `events` foreign key. Seven defaults per chapter, inserted by a trigger on `chapters`.

**event_attendance** — `id`, `event_id` (FK events), `user_id` (FK users), `status` (PRESENT | EXCUSED | ABSENT | LATE), `check_in_time` (nullable), `excuse_reason` (text, nullable — admin-provided reason when marking EXCUSED), `marked_by` (FK users, nullable — admin who set EXCUSED/ABSENT/LATE), `created_at`. Unique on (event_id, user_id).

### Communications

**chat_channel_categories** — `id`, `chapter_id` (FK chapters), `name`, `display_order` (int), `created_at`.

**chat_channels** — `id`, `chapter_id` (FK chapters), `name`, `description` (nullable), `type` (PUBLIC | PRIVATE | ROLE_GATED | DM | GROUP_DM), `required_permissions` (text[], nullable — for ROLE_GATED channels, any permission strings), `member_ids` (uuid[], nullable — the explicit membership list for PRIVATE, DM and GROUP_DM channels; a PRIVATE channel is seeded with its creator at create time, since the access predicate has no wildcard bypass on that branch and a NULL list is readable by nobody; after that a `channels:manage` holder adds and removes its members through the `add_private_channel_member` / `remove_private_channel_member` RPCs, which refuse to leave it with no chapter member, and removing a member from the chapter takes them off every PRIVATE list in it (#1302, [chat § Channels](../behavior/chat/README.md#channels))), `category_id` (FK chat_channel_categories, nullable), `is_read_only` (bool, default false — for channels like #announcements where only permitted users can post), `default_notification_level` (text, nullable, CHECK `all` | `mentions` | `off` — the officer-set push default for members who have set none; null means the built-in default, see [notifications § Chat notification preferences](../behavior/notifications.md#chat-notification-preferences), #2771), `is_default` (bool, default false — the chapter's default channel, where Chat opens when a device has no last channel; at most one per chapter by a partial unique index, see [chat § Where Chat opens](../behavior/chat/README.md#where-chat-opens)), `display_locked` (bool, default false — Always formal: every member sees the channel in the formal display, see [chat § Always formal](../behavior/chat/README.md#always-formal), #3787), `created_by` (FK users, nullable, on delete set null — who created it through `POST /v1/channels`, the one member besides `channels:manage` holders who may set `display_locked`; null for channels from before it was recorded), `background`, `background_photo_path`, `background_message_id` (all nullable, as the three `chat_background*` columns on `chapters`; a null `background` follows the chapter default, and a DM or group DM never has one; [chat § Chat backgrounds](../behavior/chat/README.md#chat-backgrounds)), `activity_excluded` (bool, default false — "Leave out of Activity": links posted here never reach anyone's Activity page; never set on a DM or group DM; [activity § Links](../behavior/activity.md#links), #3897), `created_at`.

**chat_messages** — `id`, `channel_id` (FK chat_channels), `sender_id` (FK users, **nullable**), `author_name` / `author_avatar_path` / `author_external_id` (text, nullable — attribution for a message whose author is not a Frapp user), `content` (text), `content_search` (tsvector, generated from `content`, GIN-indexed), `type` (TEXT | POLL), `reply_to_id` (FK chat_messages, nullable), `thread_root_id` (FK chat_messages, nullable — the parent when the row is a message-thread reply), `thread_reply_count` / `thread_last_reply_at` / `thread_recent_sender_ids` (the parent's thread summary, kept by the `chat_messages_thread_summary` trigger; see [`../behavior/chat/README.md`](../behavior/chat/README.md) § Message threads), `thread_last_reply` (jsonb, nullable — the parent's newest reply that isn't deleted, for the thread card's preview, kept by the same trigger and `chat_messages_thread_last_reply`; the replier's words on the parent's row, so a read that masks withholds it from a viewer who blocked that replier, #4297), `metadata` (jsonb — link previews, poll data, `attachment_count`, and `attachment_photos`, each photo's display geometry; [chat § Messages, Photo previews](../behavior/chat/README.md#messages)), `mentions` (uuid[], default `{}` — `users.id` of everyone mentioned, resolved server-side at send time; see [`../behavior/chat/README.md`](../behavior/chat/README.md) § Mentions), `is_pinned` (bool, default false), `pinned_at` (timestamp, nullable), `flag` (text, nullable — `important`, `funny`, `interesting`, `question`, `hype` or `fyi`, CHECK `chat_messages_flag_known`; [chat § Message flags](../behavior/chat/README.md#message-flags)), `flagged_by` (FK users, nullable, on delete set null), `flagged_at` (timestamp, nullable; CHECK `chat_messages_flag_cleared`: an unflagged row has no flagger or time), `edited_at` (timestamp, nullable), `is_deleted` (bool, default false), `created_at`. CHECK `chat_messages_author_present`: `sender_id is not null or author_name is not null` — a nullable sender never means an anonymous message.

**chat_message_important_seen** — `user_id` (FK users, cascade), `message_id` (FK chat_messages, cascade), `chapter_id` (FK chapters, cascade), `seen_at`; primary key `(user_id, message_id)`. One row per Important message a member has seen, which takes it off their "1 important message" strip. Private to each member: RLS on with no policies, and `anonymize_user` deletes a member's rows (#4186; [`behavior/chat/README.md`](../behavior/chat/README.md#message-flags)).

**chat_thread_follows** — `thread_root_id` (FK chat_messages, cascade), `user_id` (FK users, cascade), `channel_id` (FK chat_channels, cascade), `state` (`following` | `muted`), `last_read_at` (nullable), `created_at`, `updated_at`; primary key `(thread_root_id, user_id)`. No row means not following. RLS on, no policies (API only).

**chat_message_links** — `id`, `chapter_id` (FK chapters, cascade), `channel_id` (FK chat_channels, cascade), `message_id` (FK chat_messages, cascade), `thread_root_id` (uuid, nullable — the message's thread root when it is a reply), `url`, `host`, `posted_by` (FK users, nullable, set null — the message's sender), `posted_at` (the message's `created_at`), `removed_at` / `removed_by` (nullable — an officer's remove for everyone), `title` (nullable — the page's own name, #4187), `title_attempts` (smallint, default 0 — the title sweep's tries; 3 once it has a definite answer), `title_checked_at` (nullable — when the last try began); unique `(message_id, url)`. One row per sign-up link per message, written only by the `chat_messages` index triggers through `activity_action_links`, the list that decides what is gathered (`activityLinkKind` in `@repo/hooks` and `isSignUpHost` in `apps/api` keep copies); the API's title sweep writes only the three title columns. [activity § Links](../behavior/activity.md#links), #3897. RLS on, no policies (API only).

**chat_link_member_states** — `link_id` (FK chat_message_links, cascade), `user_id` (FK users, cascade), `chapter_id` (FK chapters, cascade), `state` (`done` | `hidden`), `updated_at`; primary key `(link_id, user_id)`. A member's own Done or Hide on a link; no row means it still shows. Deleted by `anonymize_user`. RLS on, no policies (API only).

**activity_item_reads** — `user_id` (FK users, cascade), `chapter_id` (FK chapters, cascade), `kind` (`task` | `hours_entry` | `poll` | `event` | `link`), `item_id` (the module's id; no FK, since the items live in five tables), `read_at`; primary key `(user_id, chapter_id, kind, item_id)`. When a member last opened an item from Activity, for its unread dot (#4173; [`behavior/activity.md` § Unread](../behavior/activity.md#unread)). Deleted by `anonymize_user`. RLS on, no policies (API only).

**ai_runs** — `chapter_id` (FK chapters, cascade), `kind` (a handler name in the API's `AiRunRegistry`, `snake_case`), `dedupe_key` (built from ids; unique per chapter and kind), `status` (`queued` | `running` | `succeeded` | `failed` | `cancelled`), `requested_by` and `acting_user_id` (FK users, set null; the member who asked, and the member the run reads as), `input_ref` and `result_ref` (jsonb of ids and counts only, enforced by `ai_run_ref_is_ids_only`), `attempt_count`, `max_attempts`, `failure_reason` (set exactly when failed), the lease (`lock_token`, `locked_by`, `lease_expires_at`, as on `discord_imports`), `created_at`, `updated_at`, `started_at`, `finished_at`. One row per background AI job; claimed through `claim_ai_run` (#4310; [§ 13](#13-ai-corpus-architecture-v1)). Holds no prompt, answer or member text. Enqueueing the key of a failed or cancelled run queues that row again in place. Finished runs are deleted after 90 days, by a prune that runs while AI is on. RLS on, no policies (API only).

**ai_usage_events** — `chapter_id` (FK chapters, cascade), `user_id` (FK users, set null; the acting member), `run_id` (FK ai_runs, set null), `task` and `family` (the catalog task and its consent family), `provider` (`anthropic` | `google` | `assemblyai` | `scripted`), `model`, `prompt_version`, `status` (`reserved` | `settled` | `expired`), `outcome` (`completed` | `refused` | `invalid_output` | `error`, set when settled), `error_kind`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `audio_seconds` (the audio a transcription was billed for; 0 on every other call, #712), `reserved_cost_micro_usd` (the hold), `cost_micro_usd` (set when settled), `cost_estimated` (the hold was charged because the provider never reported the call's use), `latency_ms`, `created_at`, `settled_at`. The AI spend ledger: one row per provider call, held against the caps by `reserve_ai_spend` before the call and settled by `settle_ai_spend` after it (#714; [`behavior/billing.md` § AI Usage Pricing](../behavior/billing.md#ai-usage-pricing)). No text column. Spend is always a sum over this table; there is no balance. RLS on, no policies (API only).

**chapter_ai_settings** — `chapter_id` (primary key; FK chapters, cascade), `ask_enabled`, `meeting_notes_enabled`, `chat_source_enabled` (booleans, default false), `updated_by` (FK users, set null), `updated_at`. The president's AI switches, one per feature family; a chapter with no row has every switch off (#4308; [`behavior/ai.md` § Consent](../behavior/ai.md#consent)). RLS on, no policies (API only).

**user_ai_consents** — `user_id` (FK users, cascade), `sheet_version` (integer, 1 or more), `accepted` (true is Yes, false is No), `answered_at`; primary key `(user_id, sheet_version)`. A person's answer on each version of the AI sheet. Only the row for the current version counts, and no row counts as No (#4308; [`behavior/ai.md` § Consent](../behavior/ai.md#consent)). Deleted by `anonymize_user`. RLS on, no policies (API only).

**activity_unread_starts** — `user_id` (FK users, cascade), `chapter_id` (FK chapters, cascade), `started_at`; primary key `(user_id, chapter_id)`. When a member's Activity unread dots began: set once, the first time a client that draws them opens Activity; nothing older is unread (#4173). Deleted by `anonymize_user`. RLS on, no policies (API only).

**chat_message_attachments** — `id`, `message_id` (FK chat_messages, ON DELETE CASCADE), `channel_id` (FK chat_channels — denormalised so the row's chapter is one hop away, exactly as `chat_messages` reaches it), `bucket`, `storage_path`, `filename`, `content_type` (nullable), `byte_size` (bigint, nullable), `width` / `height` (int, nullable — a photo's upright size, filled by the sending device since 2026-11-07), `thumbhash` (text, nullable — the photo's ThumbHash, base64, which readers draw as its loading blur), `preview_storage_path` (text, nullable — the photo's 1280 px JPEG copy, always `chatPreviewPathFor(storage_path)`; [chat § Photo previews](../behavior/chat/README.md)), `external_url` (nullable — reserved for a source-system URL, and **always null on both Discord import paths** — neither holds a CDN URL when the row is built (the DCE export has rewritten every URL to an export-relative path; the bot mapper substitutes `discordAttachmentKey`), and storing one would be a private-bucket bypass that outlives its own signature, since a Discord CDN link is signed and time-limited. It is also a disclosure boundary, dropped by `stripAttachmentRow` on both repository exits that return attachment rows — the read and the upsert alike), `created_at`. Unique on `(message_id, bucket, storage_path)` — the `message_id` is load-bearing and the migration says why: a `(bucket, storage_path)` key would let two messages quoting the same deduplicated file insert once and silently skip the second. RLS enabled with **no policies** (default deny): the table is not a Realtime carrier and is read only by the API on the service-role key.

**message_reactions** — `id`, `message_id` (FK chat_messages), `user_id` (FK users), `emoji` (text), `created_at`. Unique on (message_id, user_id, emoji).

**channel_read_receipts** — `id`, `channel_id` (FK chat_channels), `user_id` (FK users), `last_read_at` (timestamp), `hidden_at` (nullable timestamp: when this member hid a 1:1 DM from their own list, [`chat/README.md` § Direct Messages](../behavior/chat/README.md#direct-messages)), `updated_at`. Unique on (channel_id, user_id).

### Polls

**poll_votes** — `id`, `message_id` (FK chat_messages, where type = POLL), `user_id` (FK users), `option_index` (int — index into the poll options array in message metadata), `created_at`. **One constraint, not two:** `unique (message_id, user_id, option_index)` — that is the only uniqueness the table declares, for single- and multi-choice alike (`00000000000000_initial_schema.sql:259`). Single-choice does **not** have a narrower `(message_id, user_id)` unique; "one option per member" is enforced in the application layer, by `PollService.vote` deleting the member's prior rows before inserting the new selection. Corrected 2026-09-05 — the previous text described a single-choice constraint that has never existed, which reads as a database guarantee that is not there.

### Notifications

**push_tokens** — `id`, `user_id` (FK users), `token` (unique), `device_name` (nullable), `created_at`.

**notifications** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `title`, `body`, `data` (jsonb — includes `target` for deep linking, `priority`), `read_at` (nullable), `created_at`.

**notification_preferences** — `id`, `user_id` (FK users), `chapter_id` (FK chapters), `category` (text), `is_enabled` (bool, default true), `updated_at`. Unique on (user_id, chapter_id, category).

**user_settings** — `id`, `user_id` (FK users), `quiet_hours_start` (time, nullable), `quiet_hours_end` (time, nullable), `quiet_hours_tz` (text, nullable — a named time zone `Intl.DateTimeFormat` can resolve, normally an IANA name like `America/New_York`, never a UTC offset such as `-05:00`; see [`spec/behavior/notifications.md`](../behavior/notifications.md) § Quiet Hours), `theme` (text, default 'system' — light | dark | system), `time_zone` (text, nullable, at most 100 characters — the zone the member's device last reported, which pushes name times in; see [`spec/behavior/notifications.md`](../behavior/notifications.md) § What a push says), `status` (text, default 'online' — online | idle | dnd | invisible), `status_expires_at` (timestamptz, nullable), `custom_status` (text, nullable, at most 80 characters, member-written), `custom_status_expires_at` (timestamptz, nullable) — the member's chosen status and custom line, see [`spec/behavior/notifications.md`](../behavior/notifications.md) § Do Not Disturb, `updated_at`. Unique on (user_id).

### Location & Study

**study_geofences** — `id`, `chapter_id` (FK chapters), `name`, `coordinates` (jsonb — array of {lat, lng}), `is_active` (bool, default true), `minutes_per_point` (int, default 30), `points_per_interval` (int, default 1), `min_session_minutes` (int, default 15), `pause_grace_minutes` (int, default 5 — how long a backgrounded session may stay paused before it auto-expires), `created_at`.

**study_sessions** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `geofence_id` (FK study_geofences), `status` (ACTIVE | COMPLETED | EXPIRED | PAUSED_EXPIRED | LOCATION_INVALID), `start_time`, `end_time` (nullable), `last_heartbeat_at` (watermark up to which foreground time has been credited — advances by whole credited minutes, so sub-minute remainders carry forward), `paused_at` (nullable — set while backgrounded; pause is a sub-state of ACTIVE, not a status), `total_foreground_minutes` (int, default 0), `points_awarded` (bool, default false), `created_at`.

### Financials

**financial_invoices** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `title`, `description` (nullable), `amount` (int, cents), `status` (DRAFT | OPEN | PAID | VOID), `due_date`, `paid_at` (nullable), `stripe_payment_intent_id` (nullable, partial-unique when set), `created_at`.

**financial_transactions** — `id`, `chapter_id` (FK chapters), `invoice_id` (FK financial_invoices, nullable), `amount` (int), `type` (PAYMENT | REFUND | ADJUSTMENT), `stripe_charge_id` (nullable, partial-unique among PAYMENT rows when set), `created_at`.

Member invoice payments are applied by the `apply_invoice_payment` RPC — compare-and-set `OPEN → PAID` plus the `PAYMENT` ledger insert in one transaction (idempotent under duplicate webhook delivery and admin races; see `spec/behavior/billing.md`).

### Service Hours

**service_entries** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `date` (date), `duration_minutes` (int), `description` (text), `proof_path` (text, nullable — Supabase Storage path), `status` (PENDING | APPROVED | REJECTED), `reviewed_by` (FK users, nullable), `review_comment` (text, nullable), `points_awarded` (bool, default false), `created_at`.

### Tasks

**tasks** — `id`, `chapter_id` (FK chapters), `title` (text), `description` (text, nullable), `assignee_id` (FK users), `created_by` (FK users), `due_date` (date), `status` (TODO | IN_PROGRESS | COMPLETED | OVERDUE), `point_reward` (int, nullable), `points_awarded` (bool, default false), `completed_at` (timestamp, nullable), `confirmed_at` (timestamp, nullable), `created_at`.

### Rush / Recruitment

**rush_candidates** — `id`, `chapter_id` (FK chapters), `display_name` (text, 1–200 after trim), generated `name_key` (`lower(trim(display_name))` stored), `user_id` (FK users, nullable, ON DELETE SET NULL), `stage` (text, default `'new'`), `bid_status` (`none` | `extended`), `created_by` (FK users, ON DELETE RESTRICT), `created_at`. Unique on `(chapter_id, name_key)`. RLS enabled, no policies — the API holds the service-role key. Behavior: [`../behavior/rush.md`](../behavior/rush.md).

**rush_candidate_votes** — `id`, `candidate_id` (FK rush_candidates, ON DELETE CASCADE), `chapter_id` (FK chapters), `voter_id` (FK users, ON DELETE CASCADE), `created_at`. Unique on `(candidate_id, voter_id)`. `voter_id` is stored so a member can vote once and is never listed on the card.

### Chapter Documents

**chapter_documents** — `id`, `chapter_id` (FK chapters), `title` (text), `description` (text, nullable), `folder` (text, nullable — single-level folder name), `storage_path` (text — Supabase Storage path), `uploaded_by` (FK users), `content_type` (text, nullable), `byte_size` (bigint, nullable), `document_type` (text, nullable — free text), `effective_date` (date, nullable), `pinned_at` (timestamptz, nullable — an officer's pin for the whole chapter, #3934), `created_at`. Unique on (storage_path), so a retried confirm cannot file one object twice (#3399; [`behavior/chapter-docs.md`](../behavior/chapter-docs.md#storage)).

**chapter_document_folders** — `id`, `chapter_id` (FK chapters), `name` (text, unique per chapter), `sort_order` (int), `pinned_at` (timestamptz, nullable — an officer's pin for the whole chapter, #3934), `created_at`. A document names its folder by `name`, not by id.

**chapter_document_stars** — `id`, `user_id` (FK users), `chapter_id` (FK chapters), `folder_id` (FK chapter_document_folders, nullable), `document_id` (FK chapter_documents, nullable), `created_at`. Exactly one of the two targets is set; deleting the folder or document deletes its stars. Unique on (user_id, folder_id) and (user_id, document_id). Private to each member: RLS on with no policies, and `anonymize_user` deletes a member's rows (#3934; [`behavior/chapter-docs.md`](../behavior/chapter-docs.md#pinned-and-starred)).

### Semester Archives

**semester_archives** — `id`, `chapter_id` (FK chapters), `label` (text — e.g. "Fall 2025"), `start_date` (date), `end_date` (date), `created_at`.

### Chapter Customization (DB-first)

Customization is the product: every chapter runs differently, so vocabulary, roles, dues, branding, and enabled modules are all data, not code branches. The merged read/write shape and endpoints are specified in [`behavior/chapter-config.md`](../behavior/chapter-config.md); the canonical storage is below.

**New columns on `chapters`:**

- `org_archetype text not null default 'ifc'` — one of `ifc | npc | nphc | mgc | professional | service | honor | colony`. Drives the seed defaults (vocabulary, module presets); it seeds no roles.
- `enabled_modules jsonb not null default '{"chat":true,"members":true,"announcements":true,"audit-log":true}'` — per-module on/off map. A module is enabled unless its key is explicitly `false`. The free set (`chat`, `members`, `announcements`, `audit-log`, `chapter-settings`) is always-on in the UI only: the Settings toggle is locked for it, but the config PATCH applies whatever it is given, so disabling one through the API is accepted today ([`../behavior/integrations.md`](../behavior/integrations.md)). See [`product/modules.md`](../product/modules.md).
- `vocabulary jsonb not null default '{}'` — per-chapter term overrides (rush/recruitment/intake, pledge/aspirant/candidate, class/line/cohort, and since #3939 `order`: fraternal order/bond number/line number/roll number), meant to apply everywhere a surface names one of these concepts. Where it reaches today is listed in [`product/positioning.md` § Vocabulary-first](../product/positioning.md#vocabulary-first): the recruitment slash command's label does, chat channel names don't yet ([#1504](https://github.com/pdcarlson/Frapp/issues/1504)). *(Corrected 2026-11-05: this said it was applied everywhere, channel names included.)*
- `branding jsonb not null default '{}'` — `{ greek_letters, short_name, show_greek_letters, designation, school_short, founded_at, colors: { accent } }`. `colors` held a second `dark` key until the #920 slice-9 cutover; it fed only the legacy token map, and rows written before then keep an inert value that nothing reads.
- `theme_palette jsonb not null default '{}'` — the derived accent role map, regenerated server-side whenever the accent changes, and by the hourly stale-palette sweep whenever the engine that wrote it is behind (see *Theming Model* below). Unconstrained jsonb; every write replaces the whole map.
- `theme_palette_engine_version integer` — the `SIGNET_ENGINE_VERSION` that wrote `theme_palette`. Every palette write sets it in the same statement (`chapterPaletteColumns`). The config PATCH also clears it to `NULL` in its branding write, ahead of its recompute ([`accent-engine.md`](../ui/design-system/accent-engine.md) §6 Persistence). `NULL` or lower than the running engine's means stale, and is what the sweep selects on (#1165). Clearing it is always safe, since it only re-queues the row. Never set it to a version without the palette that version wrote.
- `directory_id uuid references chapter_directory(id)` — link to the autofill source row; nullable for chapters not found in the directory.
- `beta_config jsonb not null default '{"enabled":true,"style":"sidebar_pill"}'`.
- `subscription_status` keeps its existing enum but **no longer gates chat / members / announcements** — only the paid ops integrations.

**New tables (all `chapter_id`-scoped except the directory, RLS via chapter membership):**

- **chapter_directory** — `(id, org_letters, org_name, archetype, chapter_designation, university, university_short, founded_year, default_colors jsonb, website, source, aliases text[], org_aliases text[])`, plus generated `search_*` columns. Seeded from a CSV built from Wikipedia's chapter lists (about 13,300 active chapters; [`docs/guides/database.md` § Reference data](../../docs/guides/database.md#reference-data-the-chapter-directory)). Searched by `search_chapter_directory` ([`onboarding.md` § Chapter Directory Search](../behavior/onboarding.md#chapter-directory-search)); indexed on `(university_short, org_letters)`. These are public chapter identities, not personal data — the one allowed exception to the no-real-identifiers seed rule.
- **chapter_custom_fields** — `(id, chapter_id, key, label, type, required, visibility, sensitive, options jsonb, sort)`. `visibility ∈ {self, chapter, exec, president}`.
- **chapter_custom_roles** — `(id, chapter_id, key, label, rank, capabilities text[], core boolean, folded_role_id)`. Retired by #4075: each row was folded into a `roles` row (`folded_role_id`), nothing reads it, and it is dropped in a later release ([`rbac.md` § Custom roles folded into roles](../behavior/rbac.md#custom-roles-folded-into-roles)).
- **chapter_workflows** — `(id, chapter_id, key, enabled, threshold int, params jsonb)`. Each enabled workflow can configure a numeric threshold.
- **chapter_dues_config** — `(chapter_id PK, cadence, active_amount_cents, new_member_amount_cents, alumni_amount_cents, installments_allowed, late_fee_cents, grace_days, scholarship_pool_cents)`. One singleton row per chapter. All cents columns are validated as non-negative integers at the boundary (see [`engineering.md`](../engineering.md)).
- **chapter_service_config** — `(chapter_id PK, minutes_per_point int default 60 check >= 1, created_at, updated_at)`. One singleton row per chapter, holding the service-hours points conversion rate. An **absent row means the default rate**, so no chapter needs provisioning; rows are created lazily on first PATCH. Named to match `study_geofences.minutes_per_point`, the same conversion for study hours.
- **chapter_points_config** — `(chapter_id PK, adjustment_rate_limit_per_hour int default 50 check >= 1, anomaly_threshold int default 100 check >= 1, created_at, updated_at)`. One singleton row per chapter, holding the two points anti-fraud limits [`points.md`](../behavior/points.md) § Anti-Fraud has always described as chapter-configurable. Same shape and lifecycle as `chapter_service_config`: an **absent row means the defaults** — which are exactly the constants `PointsService` hardcoded before #394 — so no chapter needs provisioning and no backfill was required; rows are created lazily on first PATCH. Both floors are `>= 1` rather than `>= 0`, for two different reasons: a rate limit of `0` would refuse every adjustment with no corrective write available through the append-only ledger, and a threshold of `0` would flag every row.
- **chapter_audit_log** — `(id, chapter_id, actor_user_id, action, target_type, target_id, scope, diff jsonb, created_at, member_visible boolean)`. Append-only; mirrored into the `#chapter-audit` channel via the audit→chat bridge (ADR-08). The index set is not restated here — `supabase/migrations/` is what would falsify it, and this hand-kept copy had already drifted, naming two of the three indexes the table shipped with.

Seed materialization deep-clones the shared archetype seeds into the chapter's rows so per-chapter edits never mutate the shared reference. The roster is not restated here — `buildChapterConfigFromArchetype` in `packages/org-archetypes/src/index.ts` is the thing that would falsify it, and a hand-kept copy of the list had already drifted in both docs that carried one. The rule itself: [`engineering.md`](../engineering.md) § Seeds and shared state.

### Chat Hot-Path Schema Extensions

The existing chat tables (above) are extended for the high-volume, offline-tolerant hot path:

- `chat_messages` also gains `external_message_id text` — the source-system message id (a Discord snowflake) and the archive importer's idempotency key, `UNIQUE (channel_id, external_message_id) WHERE external_message_id IS NOT NULL`. Deliberately separate from `client_message_id`, which stays the client's optimistic-send key (see the 2026-08-24 amendment to ADR-03).
- `chat_messages` gains `kind text not null default 'text'`, `payload jsonb` (inline-card data), `client_message_id text` (the idempotency key: client-generated for a member's send, `audit:<audit id>` for the system actor's `#chapter-audit` mirror, ADR-03 amendment 2026-09-30), and `deleted_at timestamptz` (soft-delete; hard delete is admin-only cold path). `kind` carries **no CHECK constraint**, so its allowed set is enforced by `CHAT_MESSAGE_KINDS` in code, not by the schema; the value list is owned by [`../behavior/chat/README.md`](../behavior/chat/README.md) § Message Kinds and Actions and is not restated here. One of those values, `kind = 'imported'`, marks a read-only archive row brought in from another system (Discord); it is server-only, never counts toward unread, never pushes, and is excluded from the `chat_messages` SELECT policy so Supabase Realtime does not fan a bulk import out to connected clients.
- **chat_message_actions** — `(id, message_id, user_id, action_type, payload jsonb, created_at)`. Per-user action history per message (RSVP, vote, pay, confirm, emoji reaction). Indexed on `(message_id, user_id)` and `(user_id, action_type, created_at desc)`; unique on `(message_id, user_id, action_type)` for the dedupe / vote-change path (ADR-07).
- **Idempotency index (non-negotiable):** `UNIQUE (channel_id, sender_id, client_message_id) NULLS NOT DISTINCT WHERE client_message_id IS NOT NULL` so retries after a dropped connection never duplicate a message (ADR-03). *(Corrected 2026-08-24: this line read `chat_messages` has no `chapter_id` column — chapter scope is reached through `chat_channels` — and ADR-03 itself says `channel_id`.)*
- **Volume index:** `(chapter_id, channel_id, created_at desc)`. Partition by `chapter_id` if/when global rows exceed ~100M.
- **chat_notification_preferences** — `(id, user_id, chapter_id, scope text in ('channel','kind','chapter'), scope_id uuid|null, scope_kind text|null, level text in ('all','mentions','off'), updated_at)`, unique over `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))` plus one plain unique index per arm (the `chapter` arm's is `NULLS NOT DISTINCT`; [`notifications.md`](../behavior/notifications.md#chat-notification-preferences) § Chat notification preferences). The tri-state per-channel / per-kind / chapter-wide chat preference table (ADR-06), distinct from the boolean `notification_preferences`. *(Corrected 2026-11-11: the `chapter` arm was added for #3840.)*

**File attachments.** Pre-signed upload from client → direct PUT to Supabase Storage → callback attaches the storage path to the message. Chat uploads land in the private `chat` bucket (signed URLs only).

---

## 5.1 Repository Conventions

All Supabase repository implementations follow these conventions:

- **Read-single queries** use `.maybeSingle()` (not `.single()`) so a missing row returns `{ data: null, error: null }` instead of raising a `PGRST116` error. This matches the `Promise<T | null>` return type on the repository interface.
- **Read-list queries** check the `error` field before returning data and default to an empty array only when no error is present.
- **All read methods** destructure `{ data, error }` and throw if `error` is truthy, ensuring infrastructure failures (connectivity issues, permission errors) are never silently swallowed.
- **Write methods** (`create`, `update`, `delete`) already follow this pattern — they check `error` and throw.
- **Write payloads are `TablesInsert<'table'>` / `TablesUpdate<'table'>`**, passed uncast. `Insert`/`Update` in `database.types.ts` are mapped types of the domain entity (same index-signature trick as `Row`), so PostgREST accepts the payload without a cast and still rejects mistyped columns. Domain repository interfaces stay `Partial<Entity>` so the domain layer does not import `Database`. There is no generic base repository — each class keeps its own queries; only the write-method parameter type changes. `apps/api/src/infrastructure/supabase/repositories/no-as-never.spec.ts` fails if a write call carries a cast or a `@ts-expect-error`, the schema binding is erased at `.from()` or on the client, the repository count drifts, or a file injects a bare `SupabaseClient`; its corpus is every `*.repository.ts` under `apps/api/src`, wherever it lives. It matches the write call rather than a list of cast spellings, so read-path casts stay legal and `as any` / `as unknown as …` / the expanded `Database[…]['Insert']` are all covered. It is a text scan, not a type checker: a cast applied before the call, one behind a nested call in the args, and an `any`-annotated write parameter are named gaps in the spec's own docblock — read it there rather than treating a green run as a proof of absence. No service or worker queries the client directly any more: only the chat push and audit-bridge workers inject it, and only for Realtime subscriptions (the interface-layer guards and the health controller still query it). Inject `FrappSupabaseClient` everywhere the `SUPABASE_CLIENT` token is taken, never the bare `SupabaseClient`.

### Invite redemption atomicity

The `InviteService.redeem` flow performs deterministic validation checks (invite existence, expiry, existing membership, subscription hard-lock, role lookup) before consuming the invite. The invite is marked as used via an atomic conditional update (`markUsedAtomically`: `UPDATE ... WHERE used_at IS NULL`) that returns the timestamp written, or `null` if another writer already claimed the row. This prevents race conditions where concurrent redeems could both succeed. If the membership insert then fails, `releaseClaim` clears `used_at` only when it still equals that claim timestamp, so the same token is not 410'd and a concurrent revoke is not undone (#1863): `markRevoked` overwrites `used_at` and sets `revoked_at`, and the release also requires `revoked_at` to be null. The release is skipped when a membership row for that user and chapter already exists: `create()` can throw after the insert committed, and releasing then would let a second redeemer join on the same token. *(Corrected 2026-09-08: the earlier wording treated existing membership as a post-claim check; that check runs before the claim. Role lookup also runs before the claim so a roles outage does not consume the token.)*

---

## 6. Authentication and Authorization

### Supabase Auth

- **Methods:** Email/password, magic link, Google, Apple. Web returns through `/auth/callback` (the same PKCE `code` exchange as email links). Mobile tries native sign-in first (Sign in with Apple on iOS; Google through Google's SDK once the platform's client ID is recorded, #2126), passes the ID token to `signInWithIdToken`, and falls back to an Expo auth session. Redirect URLs reuse the magic-link allow list (`https://app.{staging.}frapp.live/**`, `frapp://**`).
- **JWT:** Supabase issues a JWT on login. The JWT is sent as a Bearer token to the NestJS API.
- **User sync:** On first API request (or via Supabase Auth webhook/trigger), the API ensures a corresponding `users` row exists with the `supabase_auth_id`. Apple may omit email on a later native grant: AuthSync then stores `noreply+<auth-id>@users.invalid` and adopts a later real address only when the stored one is that placeholder or an Apple private-relay address — never the reverse. Display name prefers `user_metadata.full_name` / `name`. A new OAuth identity colliding with an existing email/password user is GoTrue **Automatic linking** (hosted Auth setting), not a merge of `public.users` rows (`supabase_auth_id` is the unique key). Invite redeem binds the current user id, not the invite email: [`spec/behavior/onboarding.md`](../behavior/onboarding.md).
- **Web:** Uses `@supabase/ssr` for server-side session handling in Next.js.
- **Mobile:** Uses `@supabase/supabase-js` with `AsyncStorage` for session persistence.

### Authorization Flow

Owned by [`docs/security/authorization-model.md`](../../docs/security/authorization-model.md) § "1. The model in short": the `SupabaseAuthGuard` → `ChapterGuard` → `PermissionsGuard` chain and what each guard proves; and the four tenancy-proof idioms every route uses. How the active chapter is resolved (claim, header fallback, mismatch response) is owned by [`behavior/multi-tenancy.md`](../behavior/multi-tenancy.md). `ChapterGuard`'s subscription and module write-gating: [`docs/guides/api-architecture.md`](../../docs/guides/api-architecture.md) § "Subscription enforcement (ChapterGuard)".

---

## 7. Storage (Supabase Storage)

**Buckets:**

- **`backwork`** (private) — Academic resources. Paths: `chapters/{chapter_id}/backwork/{resource_id}/{filename}`.
- **`chat`** (private) — Chat file/image uploads. Paths: `chapters/{chapter_id}/chat/{channel_id}/{message_id}/{filename}`, and a photo's preview copy at `chapters/{chapter_id}/chat/{channel_id}/{message_id}/preview/preview.jpg`.
- **`profiles`** (private) — Member profile photos. Paths: `chapters/{chapter_id}/profiles/{user_id}/{uuid}.{ext}`, the key minted by `UserService.requestAvatarUploadUrl`. Read through signed URLs by `ProfilePhotoUrlService`.
- **`service`** (private) — Service hour proof uploads. Paths: `chapters/{chapter_id}/service/{entry_id}/{filename}`.
- **`documents`** (private) — Chapter organizational documents. Paths: `chapters/{chapter_id}/documents/{document_id}/{filename}`.
- **`branding`** (private) — Chapter branding assets: the logo, and chat background photos (#3973). Paths: `chapters/{chapter_id}/branding/logo-{uuid}.{ext}`, a fresh key per upload, where rows from before #2592 may still hold `logo.{ext}`; and `chapters/{chapter_id}/chat-backgrounds/{uuid}.{ext}`, member-visible and reportable, not yet swept when replaced (#4032).
- **`reports`** (private) — Server-rendered report PDFs. Paths: `chapters/{chapter_id}/reports/{kind}-{YYYY-MM-DD}-{uuid}.pdf`. Written only by the API's renderer — no signed upload URL is ever minted for it.
- **`chat-archive`** (private) — Media and export partitions pulled out of a Discord export by the archive importer. Paths are keyed on the **import**, not on channel/message: `chapters/{chapter_id}/chat-archive/imports/{import_id}/export/…` for the uploaded DiscordChatExporter JSON partitions and `…/imports/{import_id}/media/{digest}-{flattened}` for attachments and avatars (`archiveImportPrefix` / `archiveExportPrefix` / `archiveMediaObjectPath`, `apps/api/src/domain/constants/storage.ts`). It has to be import-keyed: the admin's browser uploads before any Frapp channel or message id exists, so a message-derived key is unknowable at upload time — and the import prefix is the single thing the purge sweeps, which is the bucket's only lifecycle. **Two write paths, and they differ:** the *bot* importer writes server-side on the service-role key, through the `discord-attachment-copy` Edge Function, which the worker (`discord-export-worker.service.ts`) calls via `IArchiveMediaCopier` so the bytes never pass through the API ([ADR-26](adr/adr-26.md)), while the *upload* importer mints signed upload URLs the browser PUTs to directly (`POST /v1/discord-imports/:id/upload-urls`, `channels:manage` — `discord-import.service.ts`). Unlike `reports`, signed upload URLs **are** minted for this bucket.

- **`meeting-audio`** (private) — A meeting's uploaded recording, held only from upload until its transcript is written or the transcription fails for good ([`meetings.md` § Uploading a recording](../behavior/meetings.md#uploading-a-recording), #712). Paths: `{chapter_id}/{meeting_id}/{upload_id}.{ext}`. The officer's browser uploads through an API-signed resumable (TUS) upload; the only reader is the API, which signs a short link for the transcription provider. `MeetingRecordingService.sweepAudio` deletes any object no `meeting_recordings.storage_path` names.

**Access control:** All buckets are private. All access goes through API-generated signed URLs (upload and download). No public access. `IStorageProvider` (`apps/api/src/domain/adapters/storage.interface.ts`) has no `getPublicUrl` method, so the API cannot express a public read even by accident.

**Declaration (IaC).** All nine buckets are declared in `supabase/migrations/`, so a fresh project, a preview branch, or a restore reproduces them with the same privacy and limits:

| Bucket | Migration |
| -- | -- |
| `service` | `20260803231500_service_proof_bucket.sql` |
| `reports` | `20260805133000_reports_bucket.sql` |
| `branding`, `profiles`, `documents`, `backwork`, `chat` | `20260808204500_declare_dashboard_created_buckets.sql` |
| `chat-archive` | `20260823124000_chat_archive_bucket.sql` |
| `meeting-audio` | `20261112210000_meeting_recordings.sql` |

Each declaration pins `public = false`, an `allowed_mime_types` list, and `file_size_limit`. That limit is 26214400 (25MB = `MAX_UPLOAD_BYTES` in `@repo/validation`) on six of the nine; `backwork` is 104857600 (100MB = `MAX_BACKWORK_UPLOAD_BYTES`; raised to 50MB by `20261105230000_backwork_bucket_50mb.sql` because scanned exams run large, #3487, then to 100MB by `20261106153000_backwork_bucket_100mb.sql` to match the hosted global limit); `chat-archive` is 104857600 (100MB), sized to Discord's boosted-server per-file ceiling; `meeting-audio` is 209715200 (200MB = `MAX_MEETING_RECORDING_BYTES`, two hours from a phone's recorder), which the hosted projects' own 100MB project-level limit caps until it is raised in the dashboard (#712). `supabase/config.toml`'s global `[storage] file_size_limit` is 209715200 to match the highest of them — it caps the local stack and overrides any per-bucket column that is higher, so it is deliberately *not* 25MB and must not be "corrected" down to `MAX_UPLOAD_BYTES`. Application-layer MIME and extension checks use the same module (`packages/validation/src/upload-allowlists.ts`; kinds in [`content-validation.md` § 1](../../docs/security/content-validation.md#1-allowed-content-types)) — do not keep a second copy in a service or page. The bucket MIME list is **load-bearing, not documentation**: a signed upload URL cannot pin a content type — the uploader sets its own header on the PUT — so for the member-upload buckets the API's check gates only URL *issuance*, and these bucket columns are the only thing enforced on the upload itself. (`reports` is the exception: it is written only server-side, which passes the content type the server actually resolved, so there the column is a second belt rather than the only one. `chat-archive` is **both** — server-side on its bot path, but signed-URL on its upload path, where the bucket column is again the only enforcement.) What they enforce is the **declared header, not the bytes**, so the column does not stop hostile bytes reaching storage; it constrains the type they are served as. Without it a member with upload permission could have `text/html` served from the storage origin. Measurement, and what is *not* covered, in `packages/validation/src/upload-allowlists.ts` § What the bucket allowlist actually enforces. Add the bucket declaration in the same change set as any new bucket; never create one from the dashboard alone. Shipped migration DDL is immutable; a genuine bucket-policy change is a new migration with a comment pointing at the shared kind.

**Upload flow:** API generates a signed upload URL; client uploads directly to Supabase Storage. API generates a signed download URL; client fetches directly.

---

## 8. Realtime (Supabase Realtime)

- **Chat messages:** Clients subscribe to Postgres changes on `chat_messages` filtered by `channel_id` for each open thread. New inserts (and edits/deletes) are pushed in real time.
- **New-message inbox:** Clients also hold one global subscription to `chat_messages` inserts, unfiltered (`chat:inbox:global`, #3698). Realtime applies the table's SELECT policy per subscriber, so each member receives only messages they may read, archive imports excluded. It carries no message into a timeline; it tells the client to re-read the unread counts and latest messages, which keeps badges and the Messages order live ([`message-delivery.md` § Receiving Messages](../ui/resilience/message-delivery.md#receiving-messages-realtime)). The cost is one RLS evaluation per connected subscriber per message.
- **Reactions:** Clients hold one global subscription to inserts and deletes on `chat_message_actions` (`packages/chat-core/src/realtime-manager.ts`). New reactions are pushed in real time. Inserts are delivered only for messages the member can read, and not at all for a reaction by a member the subscriber has blocked in that message's chapter, because Realtime applies the table's SELECT policy to them ([`authorization-model.md`](../../docs/security/authorization-model.md) § The policies that do exist). Deletes are not RLS-filtered, so every subscriber receives the bare id of every removal and ignores ids it doesn't hold (`20260803150000_chat_message_actions_membership_rls.sql`).
- **Typing indicators:** Supabase Realtime Broadcast (ephemeral, not persisted). Clients send "typing" events to a channel-specific broadcast topic; other clients in the same channel receive them.
- **Presence:** Supabase Realtime Presence tracks which users are online per chapter. Heartbeat-based (~30s timeout). Three automatic states, Online, Idle and Offline, plus the two a member picks, Do Not Disturb and Invisible (#3845; [`../behavior/chat/README.md`](../behavior/chat/README.md) § Online/offline presence).
- **Fallback:** If Supabase Realtime cannot support a needed pattern, Socket.io via NestJS WebSocket gateway remains available. The goal is to minimize Socket.io usage.

---

## 9. Observability

The **behavior contract** — provider ownership, correlation identifiers, privacy and replay,
release naming, logging sinks, sampling, and verification — lives in
[`spec/behavior/observability.md`](../behavior/observability.md). The **decision** (why Sentry
owns exceptions and traces, why PostHog owns product analytics, alternatives rejected) is
[ADR-22](adr/adr-22.md).
Operational routing and dated live-rule observations:
[`alert-routing.md`](../../docs/ops/alert-routing.md).

This page does not restate the request-log JSON, the metrics list, or the alert conditions.
Those copies had already drifted: the JSON omitted `xffCount` / `xffSocketIsLast`, and Error
Tracking here still claimed raw user and chapter ids left the process. The stale copies are
deleted rather than synced.

Health-check response bodies remain owned by
[`spec/behavior/observability.md`](../behavior/observability.md) § Health Check.

---

## 10. API Contract Strategy

- **Source of truth:** NestJS controllers with `@nestjs/swagger` decorators produce an OpenAPI spec.
- **Committed artifacts:** `apps/api/openapi.json` and `packages/api-sdk/src/types.ts` are committed to the repository. They are the canonical, versioned contract that all consumers (web, mobile) depend on.
- **Export:** `npm run openapi:export -w apps/api` regenerates `openapi.json` locally. Run this whenever the API surface changes.
- **SDK generation:** `npm run generate -w packages/api-sdk` regenerates the TypeScript client from the committed OpenAPI spec.
- **Contract freshness check (CI):** for any PR touching `apps/api/src/`, `npm run check:api-contract` **regenerates** `openapi.json` and `packages/api-sdk/src/types.ts` and fails if the committed artifacts differ. It previously used a `git diff` heuristic, which false-positived on contract-neutral controller edits (demanding both artifacts change when neither's content did) and false-negatived when only one artifact needed updating. Regenerating bootstraps the NestJS application (including `onModuleInit`). The contract script's `placeholder_value` Stripe secret skips the Price retrieve, so CI still never hits live Stripe. The script builds the shared workspace packages itself, so it also runs on a cold clone.
- **Developer workflow:** After changing an API endpoint: (1) run `npm run openapi:export -w apps/api`, (2) run `npm run generate -w packages/api-sdk`, (3) commit both generated files alongside the source changes.

**Implementation status (Phase 2):** Events (CRUD), Event Attendance (check-in, list, update status), Points (me, leaderboard, per-member summary, adjust, **chapter-wide transaction list**), and Polls (create in channel, get, vote / remove vote, **chapter-wide list**) are implemented and included in the OpenAPI spec.

**Dashboard list surfaces (permissions):** `GET /v1/points/transactions` is gated by `points:view_all` (same permission as `GET /v1/points/members/:userId` for another member’s summary). `GET /v1/polls` requires `members:view` (controller baseline) plus `polls:view_all` on the list route; it is **not** part of the default Member role seed. Which seeded roles carry those permissions: the seeded role matrix in [`behavior/rbac.md` § Role Lifecycle](../behavior/rbac.md#role-lifecycle). Full query parameters, pagination, and invariants: [`behavior/points.md`](../behavior/points.md) and [`behavior/polls.md`](../behavior/polls.md).

### Error responses

Every error response has one body, written only by `AllExceptionsFilter` (`apps/api/src/interface/filters/all-exceptions.filter.ts`) and documented in `openapi.json` as each operation's `default` response, `ApiErrorResponseDto`. The generated SDK types it as the `error` of every call, exported from `@repo/api-sdk` as `ApiErrorBody`.

| Key | Present | Value |
| --- | --- | --- |
| `statusCode` | always | The HTTP status. |
| `error` | always | The status's `HttpStatus` name, such as `FORBIDDEN`. |
| `message` | always | For people. A string, or one string per failed field when the validation pipe rejects a request. |
| `requestId` | always | The request's `x-request-id`, as logged ([`observability.md` § Request Tracing](../behavior/observability.md#request-tracing)). |
| `code` | when the refusal has one | A stable, machine-readable reason, such as `chapter.module.disabled`. |

- **When `code` is present.** A throw opts in by giving the `HttpException` an object that carries a non-empty string `code`: `new ForbiddenException({ code, message })`. Every validation-pipe refusal carries `request.validation_failed` beside its field messages (`apps/api/src/interface/pipes/validation-pipe.options.ts`, #4096). Otherwise the key is absent, not `null`, and the body is exactly the four other keys. A raw error that becomes a 500 never exposes a code of its own (a PostgREST SQLSTATE, a Node errno): that names an implementation detail, not a refusal (#1020).
- **A code is public and permanent.** Once shipped it is never renamed, reused, or given a new meaning, because an installed mobile build keeps the codes it was built against. Codes are dotted and lowercase, and begin with the area that refuses: `chapter.subscription.write_locked`, `legal.acceptance_required`. `/health/ready`'s 503 carries `DEGRADED`, the one exception; no client reads it.
- **Every code is classified** as client-contract (a correct client never sees it, so a client that does reports a bug) or member-caused, in `packages/observability/src/api-error-codes.ts`. `apps/api/src/interface/api-error-codes.spec.ts` fails on a code the API throws that neither list names. What the clients do with the class: [`observability.md` § Error Tracking](../behavior/observability.md#error-tracking).
- **Clients branch on `code`** where a refusal has one, read with `codeOf` from `@repo/api-sdk`, and on `statusCode` otherwise. `message` is copy, not a key. Some clients still match exact message text instead, which is [#2995](https://github.com/pdcarlson/Frapp/issues/2995); a message an installed build matches can't be reworded ([`product/modules.md`](../product/modules.md#module-disabling-behavior)).

---

## 11. Quality Standards

- **Testing:** TDD encouraged. `apps/api` line coverage is measured (`npm run test:cov -w apps/api`,
  currently ~80%) but not CI-gated — a deliberate decision, not an oversight; see
  [`quality-gates.md` § Coverage](../../docs/ci-cd/quality-gates.md#coverage).
- **Linting:** ESLint (shared config), Prettier for formatting.
- **Type safety:** TypeScript strict mode across apps and packages, with one recorded exception:
  `apps/api` sets `"strict": false` and opts into `strictNullChecks` / `noImplicitAny` /
  `strictBindCallApply` only. Nest DTO class fields are assigned by class-validator, not
  constructors, so `strictPropertyInitialization` would be hundreds of `TS2564`s with no
  runtime meaning. TypeScript 6/7 default `strict` to true, which is why the flag is now
  explicit. See [`docs/ci-cd/agent-infra.md`](../../docs/ci-cd/agent-infra.md)
  § TypeScript 7.
- **Validation:** enforced on the API by DTOs under a global `ValidationPipe`; Zod schemas shared to clients are UX only, never enforcement. The pipe's flags and the DTO and write-payload conventions that keep it honest: [`docs/guides/api-architecture.md` § Never trust the client](../../docs/guides/api-architecture.md#never-trust-the-client).
- **Security:** No hardcoded secrets. Input validation on all endpoints. SQL injection prevented by parameterized queries. CORS configured per environment. Rate limiting per user per endpoint — keyed on the authenticated user (Supabase JWT `sub`, after verifying the token's signature: HS256 locally against `SUPABASE_JWT_SECRET`, ES256/RS256 against the project JWKS via `supabase.auth.getClaims()` — the hosted projects sign ES256, so until 2026-09-06 no hosted request was keyed per user), falling back to client IP for unauthenticated, invalid, or expired tokens so a forged/rotating `sub` cannot evade the limit — at 100 req/min read and 30 req/min write, with stricter static overrides on expensive and fan-out routes (see [`spec/behavior/README.md` § Per-route rate limits](../behavior/README.md#per-route-rate-limits)); a standard `Retry-After` header (seconds) accompanies every `429`. The Stripe webhook route is exempt (see Security Note below). File upload MIME type validation.

## Database Performance

- For complex aggregations, computation should be pushed down to the Postgres database via RPC functions using `this.supabase.rpc('func_name')`.
- This approach avoids querying large amounts of raw data into application memory just to group and calculate totals.
- Examples of this pattern include `get_points_report` which aggregates point transactions by user and category, and `get_poll_vote_option_totals` / `get_poll_user_votes_for_messages` which aggregate poll votes — the former for both the chapter poll list and the single-poll detail view, the latter for the list only.

## Refactoring Note: TaskStatus Enum

The `TaskStatus` type, originally implemented as a string literal union, has been promoted to a TypeScript string `enum`.
This ensures greater type safety and consistency across `apps/api` DTOs, service transition logic (`VALID_ASSIGNEE_TRANSITIONS`), and other modules utilizing task statuses. This does not change runtime behavior but improves compile-time checks and API documentation generation.

## Security Note (2024-03-26)

Rate limiting is enforced globally via `CustomThrottlerGuard` (a `ThrottlerGuard` subclass) in `AppModule`. The guard's storage key is `sha256(ClassName-HandlerName-throttlerName-tracker)`, so the two registered buckets are counted **per handler**, not across the app — which is why stricter limits are expressed as per-route `@Throttle` overrides of `read`/`write` (`interface/decorators/throttle-profiles.decorator.ts`) rather than as a third named throttler, which would be registered globally and run on every route. Exception: `WebhookController` (`POST /v1/webhooks/stripe`) opts out with `@SkipThrottle({ read: true, write: true })` — the route is unauthenticated so it would be throttled per IP, and Stripe deliveries burst from a small shared IP pool; Stripe signature verification is the abuse control there. The named-keys decorator form is required because the app registers named `read`/`write` throttlers (a bare `@SkipThrottle()` only sets the `default` key and skips nothing).

---

## 12. Chat Hot-Path Architecture

Chat is the spine of the product (see [`product/positioning.md`](../product/positioning.md)), so the architecture is biased for chat latency, reliability, and offline tolerance. The decisions this overview hangs off are recorded as ADRs in [`adr/`](adr/README.md); this section is the durable framing, not the decision log. The client half of the hot path lives in `packages/chat-core` (normalized cache, optimistic send client, realtime manager, and the shared topic registry) behind injected platform adapters; `apps/web/lib/chat/` keeps the web glue — the React provider and hook, and the Dexie outbox.

### Hot path vs cold path

Two write paths, two latency budgets:

- **Hot (chat):** send message, add reaction, RSVP / vote / pay / confirm an inline card, presence / typing. Budget: <100ms p50, <300ms p99. Optimistic on the client, eventually consistent on the server.
- **Cold (admin / ops):** chapter config changes, Stripe webhooks, exports, reports, bulk member imports, audit-log writes. Budget: <2s. Strongly consistent, full validation.

Both paths run in NestJS today (ADR-11 unwound the original Edge split, ADR-01); cold reads — history backfill (`GET /v1/channels/{id}/messages?since=<id>`, [chat § Reconnect replay](../behavior/chat/README.md#reconnect-replay)), config, reports — were always NestJS and stay there. Heavy slash commands (`/dues remind overdue`) take a `kind="loading"` optimistic placeholder card, call NestJS, and replace the card via Realtime; simple commands (`/poll`, `/announce`) are a single round-trip.

### Realtime channels

- **Messages:** Postgres Changes on `chat_messages` filtered by `channel_id`, one subscription per visible channel.
- **Reactions + action state:** Postgres Changes on `chat_message_actions` (one global subscription — the table has no `channel_id` to filter on; ADR-05).
- **Typing + presence:** Supabase Realtime Broadcast / Presence (ephemeral, not DB-backed; ADR-02, ADR-10).
- **System notifications:** the audit→chat bridge posts a `system_audit` message on `chapter_audit_log` insert, which streams as a normal Postgres Change into `#chapter-audit` (ADR-08).

### Edge Function / hot-path authorization

The chat write path uses the service-role client (RLS bypassed) on a client-supplied `channel_id` / `message_id`, so it **must verify the caller belongs to the target chapter before the write** — otherwise a member of chapter A could target chapter B's channel. A single pure predicate, `canAccessChannel` (`apps/api/src/domain/utils/channel-access.ts`), is the shared authorization gate reused by the NestJS chat + search services (and, historically, both Edge Functions). It takes an `operation: 'read' | 'post'` parameter (default `'read'`): for `operation:'post'`, after the read check it denies when the channel has a who-can-post list (e.g. `#announcements`) and the caller holds no entry on it and not `'*'` (#3722, [`chat/README.md` § Who can see and post](../behavior/chat/README.md#who-can-see-and-post)). The client hides disallowed commands for UX, but the server is the trust boundary.

### Presence-aware push rules

- Don't push a user who is currently online in the affected channel (presence read from Supabase Realtime Presence; ADR-04, ADR-10).
- Don't push `#chapter-audit` unless the user explicitly subscribed.
- Bundle bursts: 3+ messages within 60s from one sender → one push titled "N new messages from X"; the first later message in the burst that mentions the recipient still pushes on its own ([`notifications.md` § Notification Grouping](../behavior/notifications.md#notification-grouping)).
- Per-channel / per-kind notification preferences (`all | mentions | off`). The default tier that applies when a user has no stored preference is owned by [`../behavior/notifications.md`](../behavior/notifications.md#chat-notification-preferences) § Chat notification preferences, not restated here.

### Reconnection

Websocket drops are assumed. Exponential backoff (1→2→4→8→16→30s capped). On reconnect, each channel re-attaches through the single `SUBSCRIBED` callback: re-attach the Postgres Changes subscription first, **then** REST-backfill `?since=<lastSeenMessageId>` (subscribe-then-backfill tolerates a harmless overlap, deduped by `client_message_id` + server `id`, instead of risking a gap). An unobtrusive "Reconnecting…" pill renders near the channel header.

Decisions that hang off this overview live in [`adr/`](adr/README.md) — one file per ADR, including later records that are not chat decisions (CI, project management, deploys).

---

## 13. AI Corpus Architecture (v1)

### Sources

The AI corpus (Q&A, summarization) reads the chapter's official surfaces first, and chapter-channel chat from members who agreed to it — see [`behavior/ai.md`](../behavior/ai.md) for the product rules. [ADR-28](adr/adr-28.md) records the platform decisions this section now follows, and says what existed when it was written.

| Source           | Table / location                                     | Access path                                   |
| ---------------- | ---------------------------------------------------- | --------------------------------------------- |
| Meeting minutes  | `meetings`, the posted minutes (#4312; indexed since 2026-11-12, #720). [`behavior/meetings.md`](../behavior/meetings.md) owns the behavior. | Indexed on post; re-indexed on edit; dropped when un-posted or deleted. Read only by the meeting's audience. Standards meetings never reach a model or the index. |
| Chapter documents | `chapter_documents` + Supabase Storage `documents/` | Indexed on upload; text extracted at index time from PDFs, Word (.docx) and plain text. A scanned PDF, an image, a slide deck or a spreadsheet is skipped: there is no OCR yet (2026-11-12, #720; this cell used to promise OCR). |
| Announcements    | Top-level `chat_messages` in `#announcements`; a thread reply there is a channel message, the row below | Indexed on insert; deleted/edited mirrored.    |
| Channel messages | `chat_messages` in chapter channels, only from authors who accepted the member sheet; never DMs | Indexed on insert; deleted/edited mirrored; purged when the author opts out or deletes their account. Ranked below the rows above. |
| Structured data  | `chapters`, `members`, `events`, `dues_*`, `roles`   | **Not indexed.** Read at answer time via tool calls against the guarded API. |

The structured-data row previously specified a materialized "facts" view refreshed on write. That is
withdrawn: an embedded copy of a mutable row is only correct as of the last refresh and cannot answer
aggregate questions. Structured data is now a **tool surface**, not corpus — see
[`behavior/ai.md`](../behavior/ai.md) for the product-level rationale.

### Retrieval

- Vector index per chapter (pgvector), keyed by chapter ID. **Every retrieval is scoped to one chapter:** the active chapter the request's guard resolved for the acting member, never an id taken from the model or the request body, and never "every chapter this user belongs to". A test must prove that a member of chapter A, and a member of both A and B asking in B, retrieve nothing of A's. (Corrected 2026-11-11. This bullet used to call cross-chapter retrieval "impossible by construction". That was never true while the API reads with the service role, which bypasses RLS, so isolation is the retrieval function's own filter and the test above. Whether retrieval also runs under the caller's database identity, so RLS backs the filter, was open until 2026-11-12 and is settled in [What is built](#what-is-built-2026-11-12-720).)
- **Every candidate is filtered by the acting member's read access to its source,** not only by `chapter_id`: a message by `canAccessChannel` and by the block mask, minutes and transcripts by their meeting's audience ([`behavior/meetings.md` § Who can read minutes](../behavior/meetings.md#who-can-read-minutes)). A member can't retrieve what they couldn't open (#3295).
- **There is always an acting member.** A question's is the asker. A background run's is the officer it acts for ([`behavior/ai.md` § Whose access an AI run uses](../behavior/ai.md#whose-access-an-ai-run-uses)). A run with none does not retrieve.
- **Embeddings are Gemini Embedding at 1,536 dimensions** ([ADR-28](adr/adr-28.md) decision 3), under pgvector's 2,000-dimension limit for an indexed `vector` column. That the model can be cut to 1,536 was read from search results, not from Google's documentation, so it was to be checked before the column was sized (ADR-28, "Not verified"). The column was sized at 1,536 on 2026-11-12 (#720) without that check, because the build could not reach Google; it is checked before the first chapter turns Ask on, while the table holds no passages and a width change is one small migration. Each row stores the name of the model that embedded it, so a model change re-embeds in the background. pgvector remains the right call at this scale: a per-chapter corpus is orders of magnitude below the ~5–10M-vector point where a dedicated vector service starts to pay for itself, and it avoids operating a second datastore.
- **Retrieval is hybrid, not vector-only:** a dense vector search for semantic similarity, a sparse keyword search for exact terms (a bylaw article number, a dollar amount, a member's name), merged by reciprocal rank fusion. There is no reranker in the first version; one is added only if the retrieval evals show misses ([ADR-28](adr/adr-28.md) decision 3, answering #1456; until 2026-11-11 this bullet required a reranking pass over the merged candidates). Dense-only retrieval reliably misses exact-match queries, which are common in this corpus.
  - **The sparse half now exists for global search, and the corpus can build on it.** `apps/api/src/infrastructure/supabase/repositories/supabase-search.repository.ts` runs indexed Postgres full-text search on every source (a message filter with no text, which has no text to match, is served per channel through indexes instead), behind `SearchService`; how (columns, indexes, parse mode, migrations) is [`spec/behavior/search.md`](../behavior/search.md#global-search) (the Implementation bullet), not restated here. What remains corpus-specific is chunk-level indexing, **relevance scoring on the sparse side** — search ranks nothing today, ordering chat by `created_at` and cutting at a flat limit — and the merge. The sparse *index* exists; the sparse *scoring* hybrid retrieval needs to merge candidate sets does not.
  - What **is** reusable from that service is the more valuable part: its authorization-filtered retrieval pattern — candidate rows are filtered through `canAccessChannel` before returning, and role lookups are re-scoped by `chapter_id` so a stray cross-chapter `role_id` cannot leak permissions. Corpus retrieval must follow the same shape.
- Retrieval returns source rows with provenance metadata (source type, author or document title, timestamp, internal ID). The LLM prompt template injects this metadata so the model can cite it back.
- Recency decay is applied at retrieval time so newer authoritative content outranks older content on time-sensitive questions ("when is the meeting"); decay is off for time-invariant content (policies, bylaws).

### What is built (2026-11-12, #720)

Chapter documents and posted minutes are indexed and can be retrieved. Chapter chat followed the same day ([below](#chat-in-the-index-2026-11-12-4314)), and Ask is what calls retrieval ([below](#ask-2026-11-12-450)). All of it is off unless the server sets `AI_ENABLED=true`.

- **Two tables.** `corpus_sources` has one row per indexable thing, with a revision that goes up each time the thing changes. `corpus_chunks` has the passages: the text, a 1,536-wide vector and a generated `tsvector`. A passage's chapter cannot differ from its source's (a composite foreign key).
- **The database follows the sources, not the API.** Triggers on `chapter_documents` and `meetings` bump the source's revision and delete its passages in the same transaction as the change, and remove the source on delete or un-post. So a changed or deleted source is out of retrieval at once, whichever code path changed it, and is back when its new text is indexed. Moving a document between folders, pinning or starring it changes nothing in the index.
- **Indexing is an AI run** (kind `corpus_index`). A sweep each minute claims the sources that are waiting, or whose passages were made by another embedding model or pipeline version, and queues one run each. The run reads the source, splits it into passages of about 1,600 characters that never cross a heading (a passage of a PDF can run across a page break, and records the first and last page it covers), embeds them through the gateway's `corpus.embed` task, and writes them only if the source is still at the revision it read. It acts for the member who last changed the source, or the president when that member has left.
- **A source that can't be read is marked skipped with a reason** (`unsupported_type`, `too_large`, `no_text`, `unreadable`) and is not retried until it changes. Limits: 25 MB, 500 pages, 1,000 passages.
- **Retrieval is `CorpusRetrievalService.retrieve`.** It embeds the question with the `ask.embed-query` task, which sits in the Ask family, so the gateway requires the asker's own yes ([`behavior/ai.md` § Consent](../behavior/ai.md#consent)); indexing needs only the chapter's switch. One database function, `match_corpus_chunks`, returns the top 40 passages by vector distance and the top 40 by word rank for one chapter. The service then drops every passage whose source the acting member can't open, merges the two lists by reciprocal rank fusion (k = 60), applies recency, and returns 8 by default.
- **Isolation, settled here** ([ADR-28](adr/adr-28.md) "What this record does not decide"). `match_corpus_chunks` takes the chapter and the acting member and returns nothing unless that member belongs to that chapter; called with a member's token, the token must be that member's. The API still calls with the service role. The cases the first bullet of Retrieval asks for run against the real SQL in the migration gate (`scripts/pglite/tiers/ai-corpus.mjs`).
- **Index type, settled here.** No approximate vector index. Each search scans one chapter's passages exactly; HNSW with an iterative scan is the later step past about 20,000 passages in one chapter.
- **Read checks are per source type,** behind one small interface (`CorpusSourceAdapter`: read the text, and say which of these ids this member can open). Documents: a member who can see the chapter's documents. Minutes: `MeetingService.canRead`, and only while posted. A passage of a type with no adapter is dropped. Chat is the third adapter (below).
- **No member's name is copied in.** Minutes are indexed as written, with each decision's vote and each action item's due day in words. An action item's owner is a member id and is left out, so no rename or account deletion has a copy in the index to chase; who owns what is live data for a tool call.
- **A chapter with Ask off costs one small update every ten minutes** while it has sources waiting, and its indexing starts within about ten minutes of the president turning Ask on.
- **Recency.** Minutes lose weight with age (half-life 180 days, never below half). Documents do not: a bylaw is not less true for being old. A document's date is its `effective_date`, else its upload date.
- **Not built:** OCR; a relevance threshold for "couldn't find a confident answer" (Ask sets it against the retrieval evals); any screen showing what is indexed or skipped.

### Chat in the index (2026-11-12, #4314)

Messages in chapter channels are the third source type, `chat_message`, built on the tables and queue above. It is off with the rest of AI, and within a chapter it also needs the chat switch ([`behavior/ai.md` § Chat as a source](../behavior/ai.md#chat-as-a-source)).

- **A source is a conversation window:** one channel's messages on one day, the day turning at 09:00 UTC (chapters have no time zone setting yet). A thread reply belongs to its root's day, so a late answer stays with the question. `corpus_chat_windows` holds one row per channel and day; the migration is `20261112170000_ai_corpus_chat.sql`. Inside a window a pause of 45 minutes or more starts a new passage, passages follow the same size limits as documents, and no message is split across two unless it alone is too long for one.
- **The database never offers a DM or group DM,** nor the audit log channel: windows are only made for `PUBLIC`, `PRIVATE` and `ROLE_GATED` channels, and the read function refuses the others at the query level.
- **Statement triggers on `chat_messages` follow every insert, edit and delete,** whichever code path made it (the API, a Discord import, the account-deletion cascade). A changed window loses its passages in the same transaction and waits about ten minutes before it is re-indexed, so a busy channel is embedded once per lull, not once per message. Indexing claims documents and minutes before chat.
- **Whose words are read is decided three times.** At indexing the adapter keeps only messages whose author said yes on the current member sheet while the chat switch is on (`AiConsentService.chatAuthorsWhoSaidYes`); the rest are left out and counted, and the passage is rebuilt without them. An imported Discord message counts only once its author is linked to a member (#2878). At retrieval a passage with any author who no longer says yes is withheld until its window is rebuilt. At prompt assembly the caller runs `chatPassagesStillAllowed` once more, just before text leaves Frapp.
- **A No takes effect at once.** `ChatCorpusConsentService` listens for a withdrawn answer and drops every window holding the member's words, in every chapter, in the same request; the windows are rebuilt without them. An hourly reconcile catches what changes without a No being given: a new sheet version, a deleted account, a member who says yes after being left out. Turning the chapter's chat switch off removes its chat index at once.
- **Answers follow the asker's access now,** not when the window was indexed: `readableBy` asks `ChannelAccessService.filterAccessibleChannelIds`, the timeline's own check, and a passage by a member the asker blocked is withheld without being counted.
- **Ranking.** A chat passage's fused score is halved, and official passages are ordered before chat whatever the scores. Chat decays with age like minutes. The retrieval result carries `leftOutMessages`: how many messages in the returned windows were left out or withheld, never whose.
- **Names are copied in, unlike minutes.** Each line of a passage is "Name: text", so the model can say who said what. A rename reads stale until the window is next re-indexed.
- **Announcements are indexed under these chat rules for now** (consent applies and they rank below official sources), though the table above lists them as their own source.
- **Scale.** At about 30 tokens a message, 500,000 messages are about 15 million embedding tokens. The sweep claims 25 sources a minute across all chapters, so a backfill of 20,000 windows takes about 13 hours. Spend is bounded by the spend caps (#714, #4374).
- **Chat never triggers an action.** Its text is retrieved content: data in a prompt, never an instruction ([`ai-prompt-injection.md`](../../docs/security/ai-prompt-injection.md), C8).

### Ask (2026-11-12, #450)

The first caller of retrieval, and the first member-facing AI surface. What a member sees is [`behavior/ai.md` § Ask Frapp](../behavior/ai.md#ask-frapp); this is how it is put together.

- **`AskService.ask` is the product path, and the evals grade it.** The eval suite (`apps/api/test/ai-evals`) runs its cases through this service with a scripted model and an in-memory corpus, so the chapter filter, the authority order, the no-source rule and the read-only tool rule are tested where they are enforced, not in a harness copy ([`ai-prompt-injection.md`](../../docs/security/ai-prompt-injection.md)).
- **Three model calls at most per question,** all through the gateway, each with its own consent and spend check: `ask.embed-query` (inside retrieval), `ask.plan` (which tools) and `ask.answer` (the cited answer, streamed). The planner sees only the question and the names of the tools this member may use, never a source, so retrieved text cannot steer which tools run. A planning call that fails means no live data, not no answer.
- **Tools are a small Frapp-owned registry** (`ASK_TOOLS`): each names the permission and module of the route it mirrors and an effect, `read` or `propose`. Ask offers and runs only `read` tools, checks the permission as the asker, and passes the chapter from the guard, never from a model. A tool result from another chapter is dropped and reported. At most three tools run for one question.
- **Sources reach the model in authority order:** tool results, then official passages, then chat, each labelled as what it is. Chat passages are checked against consent a last time just before the call ([Chat in the index](#chat-in-the-index-2026-11-12-4314)).
- **The answer is decided after the model stops.** Citations are verified by the gateway ([Citation protocol](#citation-protocol)); the service keeps only citations of sources it sent, places each marker at the end of the sentence it backs, and turns an answer with no kept citation into `not_found`. Text deltas are a preview and the `done` event is the answer.
- **The stream is Server-Sent Events over the POST's response,** one JSON event per frame, format version 1 in `@repo/validation`. Refusals a client acts on (no consent, Ask off, AI off) are checked before the stream opens and arrive as ordinary errors. A keepalive comment goes out every 15 seconds, and a closed connection aborts the model call.
- **Nothing is stored** except by the diagnostics window ([`behavior/ai.md` § Stored AI text](../behavior/ai.md#stored-ai-text)): two tables, one row for the open window (at most one exists) and one sealed row per kept exchange, AES-256-GCM under `AI_STORED_TEXT_KEY`. No log line, Sentry event or analytics event carries a question or an answer.
- **Not built:** follow-up questions; a relevance threshold; tools for attendance or for chapter-wide dues; reporting an answer; Ask on mobile.

### Citation protocol

- **Frapp verifies citations itself.** The model returns each cited claim with the quoted source text and the id of the source. The gateway keeps a citation only when the quote appears verbatim in that source, and drops it otherwise. The UI renders the surviving citations as links to the source surface. This is the rule `apps/api/test/ai-evals/harness/grader.ts` already applies to an answer.
- **Changed 2026-11-11 ([ADR-28](adr/adr-28.md) decision 4).** Until then this section required the model provider's native citation support, where documents are passed as content blocks and the API returns each cited span as structured data. That replaced a still earlier design, in which the prompt emitted citation tokens and a post-processor parsed them back out. Native citations are sound, and an adapter may still use them to produce the quotes. They can't be the contract, because only one provider offers them for sources Frapp retrieves itself.
- **Design constraint, where native citations are used:** they are mutually exclusive with the provider's structured-output mode. The citing Q&A path therefore returns prose plus a structured citation list, not a JSON envelope. Any surface that needs strictly-shaped JSON (drafted minutes, a proposal) is a separate call. It doesn't cite, but a quote it returns as a proposal's source gets the same verbatim check before it is shown.
- The "couldn't find a confident answer" response is driven by retrieval returning nothing above the relevance threshold. A claim whose every citation fails the check is shown as unsupported or dropped.

### Model access

One gateway in the API's `ai` module makes every model call, behind a provider-neutral port ([ADR-28](adr/adr-28.md) decisions 1, 2 and 10). No feature imports a provider SDK.

- **The gateway** checks consent, reserves spend against the caps before the call, picks the model for the task from a catalog, verifies citations, and writes the usage ledger row before it returns.
- **Adapters** sit below the port: Anthropic, Google, a transcription provider, and a scripted adapter the tests use with no network.
- **Background work is a table.** AI runs (an index job, a nightly scan, a transcription) are rows with a dedupe key, claimed by a scheduled worker with a lease, as the Discord import worker does. A run that reads the corpus records the member it acts for. A move to Cloud Tasks changes what wakes the worker, not the table. A feature adds a run kind by registering a handler (`AiRunRegistry`) and nothing else: the queue retries a failed try after a pause, takes over a run whose worker died once its lease runs out, ends a run as failed with a reason a person can read after its tries (3 unless the kind says otherwise), fails a run whose acting member has left the chapter (or lost a permission the kind names) without running it, and gives a run back without using a try when a deploy stops the process. A replica claims only the kinds it has handlers for, so an old build mid-deploy leaves a new kind alone. Clients poll `GET /v1/ai/runs/{id}` for status; who may read a run is [`behavior/ai.md` § Whose access an AI run uses](../behavior/ai.md#whose-access-an-ai-run-uses), with the kind's handler deciding (`canView`) for anyone but the two members it names.
- **Proposals are a table.** Anything the AI suggests waits as a row until a person with the permission accepts it ([`behavior/ai.md` § Suggestions](../behavior/ai.md#suggestions)).
- **Streamed answers use one versioned event format,** defined in `packages/validation` and read by web and mobile alike, so an older mobile build keeps working when an event type is added.
- **No chapter content is stored at a provider:** no provider-side file store, retrieval corpus or cache of documents.

### Prerequisites (decide before the corpus work starts)

- **pgvector vs. the PGlite migration gate — settled, no constraint on the corpus migrations.** `scripts/pglite/` replays every migration under PGlite in CI (`pglite-migrations`). PGlite ships pgvector as a first-party extension (**pgvector 0.8.1** as measured under `@electric-sql/pglite@0.4.6`), so the gate registers it on the PGlite constructor alongside `pgcrypto` and `create extension vector` replays normally. **Its import path moved in PGlite 0.5:** the non-`contrib` extensions were unbundled out of the main package's `exports` map into their own packages, so `@electric-sql/pglite/vector` is now `@electric-sql/pglite-pgvector` — a separate dependency, peer-pinned to an exact `@electric-sql/pglite`, which is why the two move as a pair. `package.json` declares the current versions. Nothing about the registration or the replay changed; only where the `vector` export is imported from. Verified: typed `vector(n)` columns, the `<=>` distance operators, and **both** ANN index access methods (`hnsw` and `ivfflat`) all work under the harness. Write the corpus migrations against pgvector as you would for hosted Postgres — no conditional extension creation, no gate carve-out, no shim.
  - Registration is load-bearing and silent when missing: installing the extension only makes it *available*, and an unregistered one fails with `extension "vector" is not available` — which reads like a PGlite limitation but is a one-line fix in the harness. A landmark assertion in the gate pins the registration so it fails there, not under the first corpus migration.
  - Two things this decision does **not** cover. `check:migration-safety` rejects any change set touching `supabase/migrations/` without a matching update to `docs/ops/database/promotion-log.md` or `docs/ops/db-rollback-playbook.md`, and separately requires a per-migration entry in **both** of those docs — budget for both doc updates in the corpus migration PR. And **neither pgvector version is pinned by this decision**: the landmark asserts the extension is *available*, never which version, so the PGlite-side build moves with any `@electric-sql/pglite-pgvector` bump and the hosted Supabase build moves independently of both. Treat the 0.8.1 above as "what was measured on the day", not a guarantee — if a corpus migration ever depends on version-gated pgvector behavior, read the version on both sides rather than inferring either from this gate passing.
- **`chapter_documents` metadata still lacks three fields ingestion needs.** `supabase/migrations/20260831220000_chapter_documents_metadata.sql` added `content_type`, `byte_size`, `document_type` and `effective_date` (#716). Still missing are a page count, a content hash, and `updated_at`. `effective_date` is what recency decay should key on: `created_at` measures *upload* time, not document currency, so a bylaw uploaded yesterday would otherwise outrank the amendment that superseded it. (Corrected 2026-11-11, #3283. This bullet used to say the table carried only `title`, `description`, `folder`, `storage_path`, `uploaded_by` and `created_at`.)

### Evals

- Adversarial test set under `apps/api/test/ai-evals/` covering: stale information (old meeting minutes contradicted by newer ones), conflicting sources (two documents disagreeing), missing information (corpus has nothing on the question), prompt injection from user-uploaded content.
- The eval suite runs on every change to the prompt template or retrieval logic. A regression fails the build.
- **Built (2026-08-07), ahead of the corpus and the agent.** The suite exists now so the FRA-309 / FRA-310 work has a target to satisfy rather than a retrofit. `npm run test:ai-evals -w apps/api`; it carries its own jest config because the unit project is `rootDir: "src"` and the e2e project matches `.e2e-spec.ts`. It runs as a step of the `api-tests` CI job — unconditionally rather than path-gated, which is a superset of the rule above and avoids spending ADR-15 minutes on a separate job's checkout and install to gate ~1.5s of tests.
  - The accompanying threat model is [`docs/security/ai-prompt-injection.md`](../../docs/security/ai-prompt-injection.md), covering the four injection vectors: uploaded documents, `#announcements`, chat messages in retrieved context, and **tool results** — the last being the easily-missed one, since "structured data" reaches the model through fields (profile notes, custom field values) that ordinary members control.
  - **Two grading layers.** Per-case expectations (refusal, citation, conflict-surfacing, tool allowlists), plus universal invariants no case can opt out of: chapter scoping, and an **authority ceiling** set to the intersection of the caller's and the *injector's* permissions. The intersection is what makes it a confused-deputy test — plain RBAC would permit a president's session to do president things at a rank-and-file member's written request.
  - **The behavioural cases run against the AI gateway with a scripted model** (since 2026-11-12, [#4306](https://github.com/pdcarlson/Frapp/issues/4306)), and CI sets `AI_EVALS_REQUIRE_AGENT=1`, so a build with no agent registered fails instead of skipping them. That run has no model in it. The scripted model cites quotes that are not in the document and documents it was never given, and repeats any other chapter's text that reaches it. Of the rules that stop those, only the gateway's quote check is product code; the chapter filter and "no answer without a source" are in the suite's own test agent until Ask ([#450](https://github.com/pdcarlson/Frapp/issues/450)) is built and put under test, and the tool cases pass only because that agent has no tools. Whether a real model resists an injection or surfaces a conflict is graded by running the same cases against providers, in the bake-off ([#4311](https://github.com/pdcarlson/Frapp/issues/4311)). [`apps/api/test/ai-evals/README.md`](../../apps/api/test/ai-evals/README.md) has the detail.

### Out of scope for v1

- Direct messages and group DMs (see [`behavior/ai.md`](../behavior/ai.md) non-goals). Channel chat was out of scope until 2026-11-11 and is now a source, above.
- Rush and prospective-member data, and location.
- Vault content (see [`behavior/vault.md`](../behavior/vault.md)).
- Cross-chapter aggregate analytics (would require national-tier infrastructure).

---

## 14. Vault Key Management

The vault ([`behavior/vault.md`](../behavior/vault.md)) stores high-sensitivity chapter content (risk, standards, legal). Key management lives in a managed KMS / HSM, not in Frapp application memory.

### Per-chapter key

- One symmetric key per chapter, generated at chapter creation and stored in the KMS.
- Application code never reads the raw key — encryption/decryption operations go through the KMS API. The KMS enforces access via service-role policy.
- Storage path: `chapters/{chapter_id}/vault/{document_id}/{filename}`. Blobs are AEAD-encrypted (e.g. AES-GCM) with the chapter's key plus a per-document nonce stored alongside the blob.

### Break-glass recovery

- A separate HSM-protected recovery key exists per environment. The recovery key can derive any chapter's per-chapter key on demand.
- Recovery operations require multi-party authorization at the HSM layer (split between Frapp ops and a designated escrow holder). Single-operator recovery is not possible.
- Every recovery operation emits an audit row: `(operation_id, chapter_id, requesting_president_id, request_reference, hsm_operator, completed_at)`. The audit row is written to a separate database from the application database (defense-in-depth — operations on the application DB cannot tamper with the audit trail).

### Transparency log

- The recovery audit table feeds the quarterly transparency report. The report is auto-generated from the audit table, manually reviewed by Frapp leadership, and published at `frapp.live/transparency`.
- Reports include: total recovery operations per quarter, anonymized chapter identifier, request reason category, completion latency. They do not include chapter content.

### Threat model

- **Attacker with application DB access:** sees encrypted blobs, cannot decrypt without KMS access.
- **Attacker with Supabase Storage access:** same — blobs are AEAD-encrypted.
- **Compromised Frapp operator:** can request recovery but cannot complete it solo (multi-party HSM authorization). Every operation is logged.
- **Legal compulsion (subpoena):** recovery is possible but logged in the transparency report.

---

## 15. Theming Model

Chapter theming runs deeper than an accent chip — it themes the chrome, the viewer's own name in chat, links and reaction highlights (the `@mention` chip is fixed, never accent-derived). A chapter supplies **one colour**: an accent seed at `branding.colors.accent`, mirrored to `chapters.accent_color`. #795 settled which is authoritative — `branding.colors.accent` is, and the column follows it on every write path. New code MUST NOT add a third read path.

**The derivation is canonical in [`ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md), not here.** This section owns where the palette lives and who writes it; the pipeline, role map, default seed and contrast gate live in that one place, because the two used to disagree.

### What produces it

`deriveSignetPalette(seed?)` (`packages/chapter-theme/src/signet.ts`) wraps a vendored Radix generator and emits the `--signet-*` role tokens. It never throws: an absent or unparseable seed resolves to house gold and reports `invalidSeed`. Contrast is guaranteed **by construction**, asserted at generation time rather than re-checked per surface: 4.5:1 for the roles that paint text, and 3:1 for the `accent-primary` fill and its `accent-hover` shade on every ladder surface, with the fill's label held to 4.5:1 on both (`accent-engine.md` §8, which also says what the floor leaves out: the momentary pressed shade).

The **neutral ladder is not derived**. Backgrounds, borders, the sidebar and the text ladder are fixed constants; chapter identity reaches a surface only through engine accent roles. That is a deliberate reversal — see *Why the sidebar is not branded* below.

### Computation and caching

`buildChapterPalette` (`apps/api/src/application/services/chapter-palette.ts`) is the single writer behind all three doors: onboarding, the config PATCH / `POST /chapters/:id/theme-palette` recompute endpoint, and the Settings accent save (`PATCH /v1/chapters/current`, the only path the UI actually uses). It is rebuilt **server-side** and cached in `chapters.theme_palette` — never recomputed on read, never client-side. A colour problem is logged, never thrown: it must not fail a save an officer asked for. Each write also records which engine produced the map (`theme_palette_engine_version`), and an hourly sweep in `ScheduledJobsService` re-runs the same builder over every row an older engine wrote, so an engine change reaches stored chapters without waiting for each to save. The mechanism, and the compare-and-set that keeps the sweep off a racing officer save, is canon in [`accent-engine.md` § 4](../ui/design-system/accent-engine.md#4-caching-and-persistence).

Delivery differs per surface, and neither client applies the column blindly:

- **Web** — `apps/web/lib/hooks/use-chapter-theme.ts`, mounted once by `DashboardShell`. It reads a fixed allow-list of `--signet-*` roles and re-keys them onto the semantic names `signet.css` defines, all-or-nothing. A row missing those keys applies nothing, so what already paints stands: the browser's cached palette for the chapter if it holds one, otherwise the `signet.css` default-seed palette ([`accent-engine.md` § 6](../ui/design-system/accent-engine.md#6-implementation-status), the Delivery (web) row).
- **Native** — `apps/mobile/lib/chapter-branding.ts`; which role it reads, and the house tokens it paints for a row without the Signet map, are in [`accent-engine.md` § 6](../ui/design-system/accent-engine.md#6-implementation-status).

### The legacy engine, and why the stored map is not self-describing

`derivePalette({ dark, accent })` produced a separate eight-token map (`--side-bg`, `--side-accent`, `--brand-band`, `--mention-*`, `--chat-self-bubble`, `--reaction-active`, `--ring`) merged into the same column. Six of the eight were composited over or validated against the **bone** background, so they could not survive the move to a `#0E0D0B` surface. The other two were dark-context and died with the concept instead: `--side-bg` was `mixHex(dark, ink, 0.3)` and never contrast-tested at all, and `--side-accent` was validated against *it* — both belonged to the branded sidebar the Signet shell replaced with a fixed neutral surface. The #920 shell slice stopped applying all eight; the slice-9 cutover deleted the engine.

The cutover migrated no stored data, because nothing needed to: the column is unconstrained jsonb and both clients read by allow-list. Rows written before it keep holding the eight dead keys until the #1165 sweep recomputes them, and since every writer replaces the whole map, that recompute drops the keys. That happens within an hour of each environment's first deploy of #1165, so on production only once **Deploy production** has shipped it. The allow-list guards stay, because they are what keeps any non-role key in the column off `:root`.

The general hazard was that `theme_palette` carried no version stamp, so a stored row could not be told from a current one by inspection, and each engine change silently applied only to chapters saved after it. That is how the #2541 fill floor shipped to no existing chapter. #1165 added the stamp and the sweep that acts on it.

### Why the sidebar is not branded

Kept because it is what rules the alternative out, not as live work — #1150, #1164 and #1149 are all closed, by removal rather than by derivation.

The five sidebar companions `derivePalette` did *not* write — `--side-bg-hi`, `--side-divider`, `--side-fg`, `--side-fg-hi`, `--side-muted` — kept neutral-ink `:root` defaults on a branded sidebar, which read as a hole (#1150). It could not be fixed piecemeal: `mixHex(dark, ink, 0.3)` put a branded `--side-bg` at a median 2.7× (up to 6.6×) the stock sidebar's luminance, so the stock text tokens were already spending their headroom — `--side-muted` measured 2.43:1 at worst across the 50 seeded chapters, below AA-large for 9 of them, and **2.10:1, below AA-large for 21 of 50, in dark mode**, because `.dark` declared its own darker `--side-muted` while the hook wrote `--side-bg` as an inline `:root` style that outranked it. Branding the raised surface consumed what was left: the elevation tokens and the text ladder had to be derived together or not at all. Five strategies were measured and none was adopted — four failed outright across the seed, and the fifth (deriving the text floors only) measured stable but landed both tiers materially quieter than stock, which is a visible downgrade rather than a fix.

Two lessons survive the code. **Measure both modes** — quoting the light-mode figure alone understated the affected chapters by more than double, the same conflation #1149 recorded for `--ring`, which was validated against bone only while being written as an inline `:root` style that outranked `.dark`. And **an inline style written from data outranks a stylesheet rule**, so a token validated against one background can land on another.

The Signet answer is the one approach the measurements left standing — surface and text derived together from one seed against a fixed background — obtained by construction instead of by a second derivation mechanism.

### Monospace decision

`--font-mono` is a deliberate system-monospace stack (`ui-monospace, SFMono-Regular, …, monospace`), **not** a bundled webfont. Ledger-line motifs and eyebrow labels render against the system stack. (`#chapter-audit` entries did too while they were cards; since 2026-11-06 they are plain audit lines with no mono, [`components.md`](../ui/design-system/components.md) §11.) Do not bundle a mono webfont unless brand explicitly revisits this — the "monospace family must be loaded" requirement is satisfied by a stack that needs no loading.

---

## 16. Mobile Chat Architecture

The Expo app opens directly into chat and shares web's realtime transport and outbox, so presence and the offline composer queue are the same on both (ADR-10). Reactions and rich-message cards are **not** at parity, and voice memos are not built at all — [`../behavior/chat/README.md`](../behavior/chat/README.md#web--mobile-parity) § Web ↔ mobile parity owns that roster. The hot-path client and realtime manager are shared across platforms as `@repo/chat-core`, with the platform-specific layers injected through its adapter ports (`KeyValueStore`, `NetworkState`, `OutboxStore`) rather than forked. The renderer registry is web-only (`apps/web/components/chat/renderers/`). `apps/mobile` sends no slash commands; it draws its card kinds directly (`apps/mobile/components/chat/`, on the shared `ChatCardShell`), and posts polls from the composer's New poll sheet rather than `/poll`, through the same `buildPollMessage` (#3701). *(Corrected 2026-11-09: this said mobile renders one card kind, polls. It also draws event, task, points, hours, announcement and recruitment cards; [`../ui/mobile/screens.md`](../ui/mobile/screens.md) s05 lists them.)*

### Storage layer (the Dexie analogue)

Web persists composer state in IndexedDB via Dexie (ADR-05); mobile uses the native equivalents behind the same storage interface (the `OutboxStore` port in `@repo/chat-core`):

- **Drafts + outbound send/action queue:** AsyncStorage. Persist between cold launches so a force-quit mid-compose never loses input, and a queued message flushes in order on reconnect (idempotent on `client_message_id`, same dedupe index as web).
- **Inbound message cache — specified, not built:** SQLite (`op-sqlite` or `expo-sqlite`) for last-N-per-channel offline reads and fast cold-start render. `apps/mobile` has no sqlite dependency; today the inbound cache is TanStack's in-memory cache, and the AsyncStorage KV holds only the backfill cursor.

The same TanStack Query mutations and Supabase Realtime subscriptions run on both platforms; the storage seam differs, as do the renderer registry and the reaction affordance recorded above.

### App lifecycle and presence

- **Foreground:** resubscribe Realtime and REST-backfill since the last cursor **before** rendering the channel, so the user never sees a stale thread.
- **Background:** persist per-channel cursors.
- **Presence states — specified, not built.** As designed: active → `online`; backgrounded → `idle`; force-quit → `offline`. Today the tracked payload is exactly `{ userId, ts }` — no status field, pinned by key-set equality in `packages/chat-core/src/presence-contract.spec.ts` — and nothing in `apps/mobile` binds `AppState` to presence on that topic (the *chapter* presence topic is bound since #3917: a backgrounded phone leaves it). Presence is Supabase Realtime Presence on the channel topic (ADR-10); [`../behavior/chat/README.md`](../behavior/chat/README.md) owns that status. Web derives `idle` from timestamp age on the *chapter* topic rather than from a tracked status, so "consistent with web" would describe the transport, not the mechanism.

### Push delivery

Burst bundling and presence-aware suppression match the web push rules (ADR-04, ADR-09). What the
app actually declares and sends — its Android channels, any grouping, and whether it sends
silent/background push at all — is owned by
[`../ui/mobile/patterns.md` § Push notifications](../ui/mobile/patterns.md#push-notifications) and
[`../behavior/notifications.md`](../behavior/notifications.md). It is narrower than this section
used to claim, so read those rather than this file.

### Voice memos

**Specified, not built.** `audio` is not in `CHAT_MESSAGE_KINDS`, so a send with that kind is rejected at the DTO today; [`../behavior/chat/README.md`](../behavior/chat/README.md) § Message Kinds and Actions marks it as specified-but-unbuilt and is the owner of that status. As designed: the mobile composer records a voice memo, uploads it to Supabase Storage (pre-signed upload, same flow as other attachments), and sends it as `kind="audio"` with waveform metadata in `payload`. Web would render the `audio` card with waveform playback.
