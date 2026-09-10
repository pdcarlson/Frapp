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
| API            | NestJS 11, TypeScript (strict)               | `apps/api`. REST + WebSocket gateway.                                                                                 |
| Database       | PostgreSQL (via Supabase)                    | Supabase-hosted Postgres. Migrations via Supabase CLI.                                                                |
| Auth           | Supabase Auth                                | Email/password, magic link, OAuth.                                                                                    |
| Storage        | Supabase Storage                             | Eight private buckets (§7), all declared in migrations. Signed URLs only — no public access.                          |
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
    api/            # NestJS backend (REST + WebSockets)
    web/            # Next.js admin dashboard (app.frapp.live)
    mobile/         # Expo mobile app (iOS + Android)
    landing/        # Next.js marketing site (frapp.live)
  packages/         # 14 shared workspaces
    api-sdk/        # Generated API client + TypeScript types
    brand-assets/   # Canonical SVG marks (favicon + lockup)
    chapter-theme/  # Signet chapter accent engine (one seed -> `--signet-*` role tokens)
    chat-core/      # Platform-neutral chat hot path (cache, send client, realtime manager) behind injected adapters
    chat-integrations/ # Chat slash-command / integration helpers
    color/          # Shared WCAG contrast math
    eslint-config/  # Shared ESLint configuration
    formatting/     # Shared date/time/duration display helpers (web + mobile)
    hooks/          # Shared React hooks (use-members, use-frapp-client, etc.)
    observability/  # Browser-safe observability policy (Sentry PII scrubbing, sample-rate parse)
    org-archetypes/ # Greek-org directory / archetype data
    theme/          # Tailwind preset + stylesheets: Signet (`signet.css`) and legacy bone/bronze (`globals.css`, landing only)
    typescript-config/ # Shared tsconfig
    validation/     # Shared Zod schemas (used by API + web + mobile)
  spec/             # Product spec, behavior spec, architecture, environments
  supabase/         # Supabase project config, migrations, seed files
```

---

## 3. Applications

### 3.1 API (`apps/api`)

- **Framework:** NestJS 11 (Node.js, TypeScript — `apps/api` is not full `strict`; see §11).
- **Role:** REST API + WebSocket gateway. All business logic lives here.
- **Architecture pattern:** Layered — Interface (controllers, DTOs, guards) -> Application (services/use-cases) -> Infrastructure (repositories, Supabase client, external adapters) -> Domain (entities, interfaces, business rules).
- **Database access:** Supabase JS client (`@supabase/supabase-js`) for Postgres queries, storage operations, and auth admin operations. No ORM; raw SQL or query builder via Supabase.
- **Security:**
  - `SupabaseAuthGuard`: Validates JWT from Supabase Auth on every request.
  - `ChapterGuard`: Resolves the active chapter from the JWT `active_chapter_id` claim and verifies membership. `x-chapter-id` is a fallback for clients that have not refreshed their token and never overrides the claim; precedence and the mismatch response are owned by [`../behavior/multi-tenancy.md`](../behavior/multi-tenancy.md), item 1 of its Enforcement layers list.
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
- **Observability:** Not initialized today. When wired, landing stays anonymous — no identity call, no alias onto an authenticated distinct id ([`observability.md`](../behavior/observability.md#provider-ownership)).
- **Deployment:** Vercel, independent from the web app.

### 3.5 Documentation (no `apps/docs` web app)

- **Authoring:** Developer guides in **[`docs/guides/`](../../docs/guides/README.md)**; product and architecture in **`spec/`**. Read and edit in GitHub or your editor; there is no separate Next.js documentation deployment in this repo for now.
- **Spec rendering:** Previously the removed docs app rendered `spec/*.md` in a browser. Today, use the repo view on GitHub (or a local markdown preview). A future public docs site may restore styled rendering.
  - **Sync rule:** When behavior, architecture, or workflows change, update **`docs/`** and/or **`spec/`** in the same change set. Spec is intended behavior; code is current behavior; disagreement is a tracked bug (see [`AGENTS.md`](../../AGENTS.md) § Spec vs code).
  - **Enforcement:** none. A gate that required a `docs/` or `spec/` write on every product-code PR existed and was deleted in #1597: it could not tell a real doc edit from filler, so it got filler. The sync rule above is reviewed, not gated — see [`docs/internal/ci-cd/DOCS_CI.md`](../../docs/internal/ci-cd/DOCS_CI.md) for what CI does still check.
  - **Workflow:** The PR template requires a “Docs / Spec impact” section; treat “None” as an explicit claim that reviewers should challenge.

---

## 4. Shared Packages

| Package                   | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `@repo/api-sdk`           | OpenAPI-generated TypeScript client plus a hand-written error reader (`statusOf`, `serverMessageOf`, `codeOf` in `src/api-error.ts`). Codegen overwrites only `src/types.ts`. Used by web + mobile + hooks + chat-core. |
| `@repo/brand-assets`      | Canonical SVG marks (favicon + lockup).                                   |
| `@repo/chapter-theme`     | The Signet chapter accent engine: one seed hex to the `--signet-*` role tokens, over a vendored Radix generator. Server code imports the barrel; browser code imports the dependency-free `./accent-vars` leaf. Canon: [`ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md). |
| `@repo/chat-core`         | Platform-neutral chat hot path — normalized cache, optimistic send client, realtime manager, shared topic registry — behind injected `KeyValueStore` / `NetworkState` / `OutboxStore` ports. |
| `@repo/chat-integrations` | Chat slash-command / integration helpers. `/points` reason length is `POINTS_REASON_MAX_LENGTH` from `@repo/validation`, not a local copy. |
| `@repo/color`             | Shared WCAG contrast math. DOM-free so theme packages and the API share one implementation. |
| `@repo/eslint-config`     | Shared ESLint rules.                                                      |
| `@repo/formatting`        | Shared date/time/duration display helpers. Generic locale formatters (`formatClock`, `formatLocaleDateTime`, `formatLocaleDate`) plus three **protected clusters** that must stay distinct: stopwatch padding (`formatPaddedStopwatch` / `formatTimer`), bare-date timezone parsing (`parseBareDateLocalMidnight` / `parseBareDateUtcNoon`), and minute-duration rounding (`formatMinutesExact` / `formatMinutesRounded`). Used by web + mobile. |
| `@repo/hooks`             | Shared React hooks wrapping api-sdk with TanStack Query.                  |
| `@repo/observability`      | Browser-safe observability policy: Sentry PII scrubbing, correlation types, sample-rate parsing in `[0,1]`, and the constants that describe the Sentry/PostHog split. Identify / groups / hex validation / Sentry correlation attach are a separate `@repo/observability/identified-posthog` entry (web and mobile only; landing must not import it). Vendor SDK init stays runtime-local to NestJS, Next.js, and React Native. Used by API + web + mobile. |
| `@repo/org-archetypes`    | Greek-org directory / archetype data for onboarding autofill. Consumed by the API (chapter config seed), web Settings + first-officer wizard, and `apps/mobile` (`package.json` declares the workspace dependency; the wizard reads `ARCHETYPES` directly). |
| `@repo/theme`             | Shared Tailwind preset plus two stylesheets: `signet.css` (dark-only Signet tokens, imported by `apps/web`) and the legacy bone/bronze `globals.css` (imported by `apps/landing` only). Typed tokens for non-Tailwind consumers; `accent.ts` holds `resolveChapterAccentColor`, the per-surface accent re-validator. |
| `@repo/typescript-config` | Shared tsconfig presets.                                                  |
| `@repo/validation`        | Shared Zod 4 schemas, upload MIME/size allowlists (`image` / `proof` / `document` / `archive`), field-length caps, plus client gates (`can`, `isModuleEnabled`, `subscriptionWriteState`, `isAnalyticsOptedOut`) used by API + clients. `z.record` requires a key schema and a value schema. |

---

## 5. Data Model (Supabase Postgres)

All tables use `uuid` primary keys (generated by `gen_random_uuid()`). Timestamps default to `now()`. Nearly every table carries `chapter_id` for tenant scoping.

### Core Tables

**users** — `id`, `supabase_auth_id` (unique), `email`, `display_name`, `avatar_url` (nullable), `bio` (nullable), `graduation_year` (int, nullable — for alumni directory), `current_city` (text, nullable — for alumni directory), `current_company` (text, nullable — for alumni directory), `created_at`, `updated_at`.

**chapters** — `id`, `name`, `university`, `stripe_customer_id` (unique, nullable), `subscription_status` (incomplete | active | past_due | canceled), `subscription_id` (unique, nullable), `accent_color` (text, nullable — hex string for chapter branding, default `#2563EB`), `logo_path` (text, nullable — Supabase Storage path for chapter logo), `donation_url` (text, nullable — external donation link for alumni), `created_at`, `updated_at`.

**members** — `id`, `user_id` (FK users), `chapter_id` (FK chapters), `role_ids` (text[]), `custom_role_ids` (uuid[], default `{}` — assigned `chapter_custom_roles`; capabilities flatten into the permission set per the bridge model in `spec/behavior/rbac.md`), `has_completed_onboarding` (bool, default false — controls onboarding tutorial display), `dismissed_ops_nudges` (text[], default `{}` — `MODULE_CATALOG` keys whose ops-setup nudge this member has dismissed in this chapter; see [`product/modules.md`](../product/modules.md#ops-setup-nudges)), `created_at`, `updated_at`. Unique on (user_id, chapter_id).

**roles** — `id`, `chapter_id` (FK chapters), `name`, `system_key` (text, nullable — rename-proof identity for seeded system roles, null for custom roles; see [`behavior/rbac.md`](../behavior/rbac.md#role-lifecycle)), `permissions` (text[]), `is_system` (bool), `display_order` (int), `color` (text, nullable, hex string), `created_at`. Unique on (chapter_id, name); partial unique on (chapter_id, system_key) where `system_key is not null`.

**invites** — `id`, `token` (unique), `chapter_id` (FK chapters), `role`, `expires_at`, `created_by` (FK users), `used_at` (nullable), `created_at`.

### Backwork

**backwork_departments** — `id`, `chapter_id` (FK chapters), `code` (e.g. "CS"), `name` (nullable, e.g. "Computer Science"), `created_at`. Unique on (chapter_id, code).

**backwork_professors** — `id`, `chapter_id` (FK chapters), `name`, `created_at`. Unique on (chapter_id, name).

**backwork_resources** — `id`, `chapter_id` (FK chapters), `department_id` (FK backwork_departments, nullable), `course_number` (text, nullable), `professor_id` (FK backwork_professors, nullable), `uploader_id` (FK users), `title` (nullable), `year` (int, nullable), `semester` (text, nullable — Spring | Summer | Fall | Winter), `assignment_type` (text, nullable — Exam | Midterm | Final Exam | Quiz | Homework | Lab | Project | Study Guide | Notes | Other), `assignment_number` (int, nullable), `document_variant` (text, nullable — Student Copy | Blank Copy | Answer Key), `storage_path` (Supabase Storage path), `file_hash` (SHA-256), `is_redacted` (bool, default false), `tags` (text[]), `created_at`. Unique on (chapter_id, file_hash).

### Points & Events

**point_transactions** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `amount` (int), `category` (text — ATTENDANCE | ACADEMIC | SERVICE | FINE | MANUAL | STUDY), `description` (text), `metadata` (jsonb — may contain `event_id`, `study_session_id`, `adjusted_by`, `flagged`), `client_message_id` (text, nullable — idempotency key for chat-originated adjustments; null on every other award path), `created_at`. Partial unique on (chapter_id, client_message_id) where `client_message_id` is not null. The ledger is append-only, so a retried adjustment that wrote a second row could not be undone — the index is what makes a replay a no-op. See [`points.md`](../behavior/points.md) § Anti-Fraud for the contract it enforces.

**events** — `id`, `chapter_id` (FK chapters), `name`, `description` (nullable), `location` (text, nullable), `start_time`, `end_time`, `point_value` (int, default 10), `is_mandatory` (bool, default false), `recurrence_rule` (text, nullable — e.g. "WEEKLY", "BIWEEKLY", "MONTHLY"), `parent_event_id` (FK events, nullable — for recurring instances), `required_role_ids` (text[], nullable — roles required to attend; null = open to all), `notes` (text, nullable — markdown meeting minutes, editable by admins post-event), `created_at`.

**event_attendance** — `id`, `event_id` (FK events), `user_id` (FK users), `status` (PRESENT | EXCUSED | ABSENT | LATE), `check_in_time` (nullable), `excuse_reason` (text, nullable — admin-provided reason when marking EXCUSED), `marked_by` (FK users, nullable — admin who set EXCUSED/ABSENT/LATE), `created_at`. Unique on (event_id, user_id).

### Communications

**chat_channel_categories** — `id`, `chapter_id` (FK chapters), `name`, `display_order` (int), `created_at`.

**chat_channels** — `id`, `chapter_id` (FK chapters), `name`, `description` (nullable), `type` (PUBLIC | PRIVATE | ROLE_GATED | DM | GROUP_DM), `required_permissions` (text[], nullable — for ROLE_GATED channels, any permission strings), `member_ids` (uuid[], nullable — the explicit membership list for PRIVATE, DM and GROUP_DM channels; a PRIVATE channel is seeded with its creator at create time, since the access predicate has no wildcard bypass on that branch and a NULL list is readable by nobody), `category_id` (FK chat_channel_categories, nullable), `is_read_only` (bool, default false — for channels like #announcements where only permitted users can post), `created_at`.

**chat_messages** — `id`, `channel_id` (FK chat_channels), `sender_id` (FK users, **nullable**), `author_name` / `author_avatar_path` / `author_external_id` (text, nullable — attribution for a message whose author is not a Signet user), `content` (text), `content_search` (tsvector, generated from `content`, GIN-indexed), `type` (TEXT | POLL), `reply_to_id` (FK chat_messages, nullable), `metadata` (jsonb — link previews, poll data, and `attachment_count`), `mentions` (uuid[], default `{}` — `users.id` of everyone mentioned, resolved server-side at send time; see [`../behavior/chat/README.md`](../behavior/chat/README.md) § Mentions), `is_pinned` (bool, default false), `pinned_at` (timestamp, nullable), `edited_at` (timestamp, nullable), `is_deleted` (bool, default false), `created_at`. CHECK `chat_messages_author_present`: `sender_id is not null or author_name is not null` — a nullable sender never means an anonymous message.

**chat_message_attachments** — `id`, `message_id` (FK chat_messages, ON DELETE CASCADE), `channel_id` (FK chat_channels — denormalised so the row's chapter is one hop away, exactly as `chat_messages` reaches it), `bucket`, `storage_path`, `filename`, `content_type` (nullable), `byte_size` (bigint, nullable), `width` / `height` (int, nullable), `external_url` (nullable — reserved for a source-system URL, and **always null on both Discord import paths** — neither holds a CDN URL when the row is built (the DCE export has rewritten every URL to an export-relative path; the bot mapper substitutes `discordAttachmentKey`), and storing one would be a private-bucket bypass that outlives its own signature, since a Discord CDN link is signed and time-limited. It is also a disclosure boundary, dropped by `stripAttachmentRow` on both repository exits that return attachment rows — the read and the upsert alike), `created_at`. Unique on `(message_id, bucket, storage_path)` — the `message_id` is load-bearing and the migration says why: a `(bucket, storage_path)` key would let two messages quoting the same deduplicated file insert once and silently skip the second. RLS enabled with **no policies** (default deny): the table is not a Realtime carrier and is read only by the API on the service-role key.

**message_reactions** — `id`, `message_id` (FK chat_messages), `user_id` (FK users), `emoji` (text), `created_at`. Unique on (message_id, user_id, emoji).

**channel_read_receipts** — `id`, `channel_id` (FK chat_channels), `user_id` (FK users), `last_read_at` (timestamp), `updated_at`. Unique on (channel_id, user_id).

### Polls

**poll_votes** — `id`, `message_id` (FK chat_messages, where type = POLL), `user_id` (FK users), `option_index` (int — index into the poll options array in message metadata), `created_at`. **One constraint, not two:** `unique (message_id, user_id, option_index)` — that is the only uniqueness the table declares, for single- and multi-choice alike (`00000000000000_initial_schema.sql:259`). Single-choice does **not** have a narrower `(message_id, user_id)` unique; "one option per member" is enforced in the application layer, by `PollService.vote` deleting the member's prior rows before inserting the new selection. Corrected 2026-09-05 — the previous text described a single-choice constraint that has never existed, which reads as a database guarantee that is not there.

### Notifications

**push_tokens** — `id`, `user_id` (FK users), `token` (unique), `device_name` (nullable), `created_at`.

**notifications** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `title`, `body`, `data` (jsonb — includes `target` for deep linking, `priority`), `read_at` (nullable), `created_at`.

**notification_preferences** — `id`, `user_id` (FK users), `chapter_id` (FK chapters), `category` (text), `is_enabled` (bool, default true), `updated_at`. Unique on (user_id, chapter_id, category).

**user_settings** — `id`, `user_id` (FK users), `quiet_hours_start` (time, nullable), `quiet_hours_end` (time, nullable), `quiet_hours_tz` (text, nullable — a time zone identifier `Intl.DateTimeFormat` can resolve, normally an IANA name like `America/New_York`; see [`spec/behavior/notifications.md`](../behavior/notifications.md) § Quiet Hours), `theme` (text, default 'system' — light | dark | system), `updated_at`. Unique on (user_id).

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

### Chapter Documents

**chapter_documents** — `id`, `chapter_id` (FK chapters), `title` (text), `description` (text, nullable), `folder` (text, nullable — single-level folder name), `storage_path` (text — Supabase Storage path), `uploaded_by` (FK users), `created_at`.

### Semester Archives

**semester_archives** — `id`, `chapter_id` (FK chapters), `label` (text — e.g. "Fall 2025"), `start_date` (date), `end_date` (date), `created_at`.

### Chapter Customization (DB-first)

Customization is the product: every chapter runs differently, so vocabulary, roles, dues, branding, and enabled modules are all data, not code branches. The merged read/write shape and endpoints are specified in [`behavior/chapter-config.md`](../behavior/chapter-config.md); the canonical storage is below.

**New columns on `chapters`:**

- `org_archetype text not null default 'ifc'` — one of `ifc | npc | nphc | mgc | professional | service | honor | colony`. Drives the seed defaults (role pack, vocabulary, module presets).
- `enabled_modules jsonb not null default '{"chat":true,"members":true,"announcements":true,"audit-log":true}'` — per-module on/off map. A module is enabled unless its key is explicitly `false`. The free set (`chat`, `members`, `announcements`, `audit-log`, `chapter-settings`) is always-on in the UI only: the Settings toggle is locked for it, but the config PATCH applies whatever it is given, so disabling one through the API is accepted today ([`../behavior/integrations.md`](../behavior/integrations.md)). See [`product/modules.md`](../product/modules.md).
- `vocabulary jsonb not null default '{}'` — per-chapter term overrides (rush/recruitment/intake, pledge/aspirant/candidate, class/line/cohort), applied everywhere including channel names and slash-command labels.
- `branding jsonb not null default '{}'` — `{ greek_letters, designation, school_short, founded_at, colors: { accent } }`. `colors` held a second `dark` key until the #920 slice-9 cutover; it fed only the legacy token map, and rows written before then keep an inert value that nothing reads.
- `theme_palette jsonb not null default '{}'` — the derived accent role map, regenerated server-side whenever the accent changes (see *Theming Model* below). Unconstrained jsonb, and no backfill prunes it, so rows predating a given engine revision keep whatever keys they were written with.
- `directory_id uuid references chapter_directory(id)` — link to the autofill source row; nullable for chapters not found in the directory.
- `beta_config jsonb not null default '{"enabled":true,"style":"sidebar_pill"}'`.
- `subscription_status` keeps its existing enum but **no longer gates chat / members / announcements** — only the paid ops integrations.

**New tables (all `chapter_id`-scoped except the directory, RLS via chapter membership):**

- **chapter_directory** — `(id, org_letters, org_name, archetype, chapter_designation, university, university_short, founded_year, default_colors jsonb, website, source)`. Seeded from a curated CSV (top ~2000 US chapters at MVP). Indexed on `(university_short, org_letters)` and full-text on the combined name. These are public chapter identities, not personal data — the one allowed exception to the no-real-identifiers seed rule.
- **chapter_custom_fields** — `(id, chapter_id, key, label, type, required, visibility, sensitive, options jsonb, sort)`. `visibility ∈ {self, chapter, exec, president}`.
- **chapter_custom_roles** — `(id, chapter_id, key, label, rank, capabilities text[], core boolean)`. `core=false` roles are deletable.
- **chapter_workflows** — `(id, chapter_id, key, enabled, threshold int, params jsonb)`. Each enabled workflow can configure a numeric threshold.
- **chapter_dues_config** — `(chapter_id PK, cadence, active_amount_cents, new_member_amount_cents, alumni_amount_cents, installments_allowed, late_fee_cents, grace_days, scholarship_pool_cents)`. One singleton row per chapter. All cents columns are validated as non-negative integers at the boundary (see [`engineering.md`](../engineering.md)).
- **chapter_service_config** — `(chapter_id PK, minutes_per_point int default 60 check >= 1, created_at, updated_at)`. One singleton row per chapter, holding the service-hours points conversion rate. An **absent row means the default rate**, so no chapter needs provisioning; rows are created lazily on first PATCH. Named to match `study_geofences.minutes_per_point`, the same conversion for study hours.
- **chapter_points_config** — `(chapter_id PK, adjustment_rate_limit_per_hour int default 50 check >= 1, anomaly_threshold int default 100 check >= 1, created_at, updated_at)`. One singleton row per chapter, holding the two points anti-fraud limits [`points.md`](../behavior/points.md) § Anti-Fraud has always described as chapter-configurable. Same shape and lifecycle as `chapter_service_config`: an **absent row means the defaults** — which are exactly the constants `PointsService` hardcoded before #394 — so no chapter needs provisioning and no backfill was required; rows are created lazily on first PATCH. Both floors are `>= 1` rather than `>= 0`, for two different reasons: a rate limit of `0` would refuse every adjustment with no corrective write available through the append-only ledger, and a threshold of `0` would flag every row.
- **chapter_audit_log** — `(id, chapter_id, actor_user_id, action, target_type, target_id, scope, diff jsonb, created_at, member_visible boolean)`. Append-only; mirrored into the `#chapter-audit` channel via the audit→chat bridge (ADR-08). The index set is not restated here — `supabase/migrations/` is what would falsify it, and this hand-kept copy had already drifted, naming two of the three indexes the table shipped with.

Seed materialization deep-clones the shared archetype seeds into the chapter's rows so per-chapter edits never mutate the shared reference. The roster is not restated here — `buildChapterConfigFromArchetype` in `packages/org-archetypes/src/index.ts` is the thing that would falsify it, and a hand-kept copy of the list had already drifted in both docs that carried one. The rule itself: [`engineering.md`](../engineering.md) § Seeds and shared state.

### Chat Hot-Path Schema Extensions

The existing chat tables (above) are extended for the high-volume, offline-tolerant hot path:

- `chat_messages` also gains `external_message_id text` — the source-system message id (a Discord snowflake) and the archive importer's idempotency key, `UNIQUE (channel_id, external_message_id) WHERE external_message_id IS NOT NULL`. Deliberately separate from `client_message_id`, which stays the client's optimistic-send key (see the 2026-08-24 amendment to ADR-03).
- `chat_messages` gains `kind text not null default 'text'`, `payload jsonb` (inline-card data), `client_message_id text` (client-generated idempotency key), and `deleted_at timestamptz` (soft-delete; hard delete is admin-only cold path). `kind` carries **no CHECK constraint**, so its allowed set is enforced by `CHAT_MESSAGE_KINDS` in code, not by the schema; the value list is owned by [`../behavior/chat/README.md`](../behavior/chat/README.md) § Message Kinds and Actions and is not restated here. One of those values, `kind = 'imported'`, marks a read-only archive row brought in from another system (Discord); it is server-only, never counts toward unread, never pushes, and is excluded from the `chat_messages` SELECT policy so Supabase Realtime does not fan a bulk import out to connected clients.
- **chat_message_actions** — `(id, message_id, user_id, action_type, payload jsonb, created_at)`. Per-user action history per message (RSVP, vote, pay, confirm, emoji reaction). Indexed on `(message_id, user_id)` and `(user_id, action_type, created_at desc)`; unique on `(message_id, user_id, action_type)` for the dedupe / vote-change path (ADR-07).
- **Idempotency index (non-negotiable):** `UNIQUE (channel_id, sender_id, client_message_id) NULLS NOT DISTINCT WHERE client_message_id IS NOT NULL` so retries after a dropped connection never duplicate a message (ADR-03). *(Corrected 2026-08-24: this line read `chat_messages` has no `chapter_id` column — chapter scope is reached through `chat_channels` — and ADR-03 itself says `channel_id`.)*
- **Volume index:** `(chapter_id, channel_id, created_at desc)`. Partition by `chapter_id` if/when global rows exceed ~100M.
- **chat_notification_preferences** — `(id, user_id, chapter_id, scope text in ('channel','kind'), scope_id uuid|null, scope_kind text|null, level text in ('all','mentions','off'), updated_at)`, unique over `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))`. The tri-state per-channel / per-kind chat preference table (ADR-06), distinct from the boolean `notification_preferences`.

**File attachments.** Pre-signed upload from client → direct PUT to Supabase Storage → callback attaches the storage path to the message. Chat uploads land in the private `chat` bucket (signed URLs only).

---

## 5.1 Repository Conventions

All Supabase repository implementations follow these conventions:

- **Read-single queries** use `.maybeSingle()` (not `.single()`) so a missing row returns `{ data: null, error: null }` instead of raising a `PGRST116` error. This matches the `Promise<T | null>` return type on the repository interface.
- **Read-list queries** check the `error` field before returning data and default to an empty array only when no error is present.
- **All read methods** destructure `{ data, error }` and throw if `error` is truthy, ensuring infrastructure failures (connectivity issues, permission errors) are never silently swallowed.
- **Write methods** (`create`, `update`, `delete`) already follow this pattern — they check `error` and throw.
- **Write payloads are `TablesInsert<'table'>` / `TablesUpdate<'table'>`**, passed uncast. `Insert`/`Update` in `database.types.ts` are mapped types of the domain entity (same index-signature trick as `Row`), so PostgREST accepts the payload without a cast and still rejects mistyped columns. Domain repository interfaces stay `Partial<Entity>` so the domain layer does not import `Database`. There is no generic base repository — each class keeps its own queries; only the write-method parameter type changes. `apps/api/src/infrastructure/supabase/repositories/no-as-never.spec.ts` fails if a write call carries a cast or a `@ts-expect-error`, the schema binding is erased at `.from()` or on the client, the repository count drifts, or a file injects a bare `SupabaseClient`; its corpus is every `*.repository.ts` under `apps/api/src`, module-local ones included. It matches the write call rather than a list of cast spellings, so read-path casts stay legal and `as any` / `as unknown as …` / the expanded `Database[…]['Insert']` are all covered. It is a text scan, not a type checker: a cast applied before the call, one behind a nested call in the args, and an `any`-annotated write parameter are named gaps in the spec's own docblock — read it there rather than treating a green run as a proof of absence. Direct service-layer writes (chapter config, custom fields/roles, chapter-create channel seed, onboarding, chat-bridge, scheduled-jobs) use the same table types; inject `FrappSupabaseClient` everywhere the `SUPABASE_CLIENT` token is taken, never the bare `SupabaseClient`.

### Invite redemption atomicity

The `InviteService.redeem` flow performs deterministic validation checks (invite existence, expiry, existing membership, subscription hard-lock, role lookup) before consuming the invite. The invite is marked as used via an atomic conditional update (`markUsedAtomically`: `UPDATE ... WHERE used_at IS NULL`) that returns the timestamp written, or `null` if another writer already claimed the row. This prevents race conditions where concurrent redeems could both succeed. If the membership insert then fails, `releaseClaim` clears `used_at` only when it still equals that claim timestamp, so the same token is not 410'd and a concurrent revoke's `markUsed` is not undone (#1863). The release is skipped when a membership row for that user and chapter already exists: `create()` can throw after the insert committed, and releasing then would let a second redeemer join on the same token. *(Corrected 2026-09-08: the earlier wording treated existing membership as a post-claim check; that check runs before the claim. Role lookup also runs before the claim so a roles outage does not consume the token.)*

---

## 6. Authentication and Authorization

### Supabase Auth

- **Methods:** Email/password, magic link, Google OAuth (expandable).
- **JWT:** Supabase issues a JWT on login. The JWT is sent as a Bearer token to the NestJS API.
- **User sync:** On first API request (or via Supabase Auth webhook/trigger), the API ensures a corresponding `users` row exists with the `supabase_auth_id`.
- **Web:** Uses `@supabase/ssr` for server-side session handling in Next.js.
- **Mobile:** Uses `@supabase/supabase-js` with `AsyncStorage` for session persistence.

### Authorization Flow

Owned by [`docs/internal/security/AUTHORIZATION_MODEL.md`](../../docs/internal/security/AUTHORIZATION_MODEL.md) § "1. The model in short": the `SupabaseAuthGuard` → `ChapterGuard` → `PermissionsGuard` chain and what each guard proves; that the active chapter comes from the JWT `active_chapter_id` claim, with `x-chapter-id` a legacy fallback that never overrides it (a disagreement is a hard `403 chapter.context.mismatch`); and the four tenancy-proof idioms every route uses. `ChapterGuard`'s subscription and module write-gating: [`docs/guides/api-architecture.md`](../../docs/guides/api-architecture.md) § "Subscription enforcement (ChapterGuard)".

---

## 7. Storage (Supabase Storage)

**Buckets:**

- **`backwork`** (private) — Academic resources. Paths: `chapters/{chapter_id}/backwork/{resource_id}/{filename}`.
- **`chat`** (private) — Chat file/image uploads. Paths: `chapters/{chapter_id}/chat/{channel_id}/{message_id}/{filename}`.
- **`profiles`** (private) — Member profile photos. Paths: `chapters/{chapter_id}/profiles/{user_id}/{filename}`.
- **`service`** (private) — Service hour proof uploads. Paths: `chapters/{chapter_id}/service/{entry_id}/{filename}`.
- **`documents`** (private) — Chapter organizational documents. Paths: `chapters/{chapter_id}/documents/{document_id}/{filename}`.
- **`branding`** (private) — Chapter branding assets (logo). Paths: `chapters/{chapter_id}/branding/logo.{ext}`.
- **`reports`** (private) — Server-rendered report PDFs. Paths: `chapters/{chapter_id}/reports/{kind}-{YYYY-MM-DD}-{uuid}.pdf`. Written only by the API's renderer — no signed upload URL is ever minted for it.
- **`chat-archive`** (private) — Media and export partitions pulled out of a Discord export by the archive importer. Paths are keyed on the **import**, not on channel/message: `chapters/{chapter_id}/chat-archive/imports/{import_id}/export/…` for the uploaded DiscordChatExporter JSON partitions and `…/imports/{import_id}/media/{digest}-{flattened}` for attachments and avatars (`archiveImportPrefix` / `archiveExportPrefix` / `archiveMediaObjectPath`, `apps/api/src/domain/constants/storage.ts`). It has to be import-keyed: the admin's browser uploads before any Signet channel or message id exists, so a message-derived key is unknowable at upload time — and the import prefix is the single thing the purge sweeps, which is the bucket's only lifecycle. **Two write paths, and they differ:** the *bot* importer writes server-side through `IStorageProvider.uploadFile` on the service-role key (`discord-export-worker.service.ts`), while the *upload* importer mints signed upload URLs the browser PUTs to directly (`POST /v1/discord-imports/:id/upload-urls`, `channels:manage` — `discord-import.service.ts`). Unlike `reports`, signed upload URLs **are** minted for this bucket.

**Access control:** All buckets are private. All access goes through API-generated signed URLs (upload and download). No public access. `IStorageProvider` (`apps/api/src/domain/adapters/storage.interface.ts`) has no `getPublicUrl` method, so the API cannot express a public read even by accident.

**Declaration (IaC).** All eight buckets are declared in `supabase/migrations/`, so a fresh project, a preview branch, or a restore reproduces them with the same privacy and limits:

| Bucket | Migration |
| -- | -- |
| `service` | `20260803231500_service_proof_bucket.sql` |
| `reports` | `20260805133000_reports_bucket.sql` |
| `branding`, `profiles`, `documents`, `backwork`, `chat` | `20260808204500_declare_dashboard_created_buckets.sql` |
| `chat-archive` | `20260823124000_chat_archive_bucket.sql` |

Each declaration pins `public = false`, an `allowed_mime_types` list, and `file_size_limit`. That limit is 26214400 (25MB = `MAX_UPLOAD_BYTES` in `@repo/validation`) on seven of the eight; `chat-archive` is 104857600 (100MB), sized to Discord's boosted-server per-file ceiling. `supabase/config.toml`'s global `[storage] file_size_limit` is 104857600 to match the highest of them — it caps the local stack and overrides any per-bucket column that is higher, so it is deliberately *not* 25MB and must not be "corrected" down to `MAX_UPLOAD_BYTES`. Application-layer MIME and extension checks use the same module (`packages/validation/src/upload-allowlists.ts`, kinds `image` / `proof` / `document` / `archive`) — do not keep a second copy in a service or page. The bucket MIME list is **load-bearing, not documentation**: a signed upload URL cannot pin a content type — the uploader sets its own header on the PUT — so for the member-upload buckets the API's check gates only URL *issuance*, and these bucket columns are the only thing enforced on the upload itself. (`reports` is the exception: it is written only server-side, which passes the content type the server actually resolved, so there the column is a second belt rather than the only one. `chat-archive` is **both** — server-side on its bot path, but signed-URL on its upload path, where the bucket column is again the only enforcement.) What they enforce is the **declared header, not the bytes**, so the column does not stop hostile bytes reaching storage; it constrains the type they are served as. Without it a member with upload permission could have `text/html` served from the storage origin. Measurement, and what is *not* covered, in `packages/validation/src/upload-allowlists.ts` § What the bucket allowlist actually enforces. Add the bucket declaration in the same change set as any new bucket; never create one from the dashboard alone. Shipped migration DDL is immutable; a genuine bucket-policy change is a new migration with a comment pointing at the shared kind.

**Upload flow:** API generates a signed upload URL; client uploads directly to Supabase Storage. API generates a signed download URL; client fetches directly.

---

## 8. Realtime (Supabase Realtime)

- **Chat messages:** Clients subscribe to Postgres changes on `chat_messages` filtered by `channel_id`. New inserts (and edits/deletes) are pushed in real time.
- **Reactions:** Clients subscribe to changes on `message_reactions` filtered by relevant message IDs. New reactions are pushed in real time.
- **Typing indicators:** Supabase Realtime Broadcast (ephemeral, not persisted). Clients send "typing" events to a channel-specific broadcast topic; other clients in the same channel receive them.
- **Presence:** Supabase Realtime Presence tracks which users are online per chapter. Heartbeat-based (~30s timeout). Three states: Online, Idle, Offline.
- **Fallback:** If Supabase Realtime cannot support a needed pattern, Socket.io via NestJS WebSocket gateway remains available. The goal is to minimize Socket.io usage.

---

## 9. Observability

The **behavior contract** — provider ownership, correlation identifiers, privacy and replay,
release naming, logging sinks, sampling, and verification — lives in
[`spec/behavior/observability.md`](../behavior/observability.md). The **decision** (why Sentry
owns exceptions and traces, why PostHog owns product analytics, alternatives rejected) is
[ADR-22](adr/adr-22.md).
Operational routing and dated live-rule observations:
[`ALERT_ROUTING.md`](../../docs/internal/ops/ALERT_ROUTING.md).

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
- **Contract freshness check (CI):** for any PR touching `apps/api/src/`, `npm run check:api-contract` **regenerates** `openapi.json` and `packages/api-sdk/src/types.ts` and fails if the committed artifacts differ. It previously used a `git diff` heuristic, which false-positived on contract-neutral controller edits (demanding both artifacts change when neither's content did) and false-negatived when only one artifact needed updating. Regenerating bootstraps the NestJS application, but only to build the Swagger document — it never calls Supabase or Stripe, so placeholder credentials suffice and no real secrets are needed in CI. The script builds the shared workspace packages itself, so it also runs on a cold clone.
- **Developer workflow:** After changing an API endpoint: (1) run `npm run openapi:export -w apps/api`, (2) run `npm run generate -w packages/api-sdk`, (3) commit both generated files alongside the source changes.

**Implementation status (Phase 2):** Events (CRUD), Event Attendance (check-in, list, update status), Points (me, leaderboard, per-member summary, adjust, **chapter-wide transaction list**), and Polls (create in channel, get, vote / remove vote, **chapter-wide list**) are implemented and included in the OpenAPI spec.

**Dashboard list surfaces (permissions):** `GET /v1/points/transactions` is gated by `points:view_all` (same permission as `GET /v1/points/members/:userId` for another member’s summary). `GET /v1/polls` requires `members:view` (controller baseline) plus `polls:view_all` on the list route; it is **not** part of the default Member role seed. Treasurer includes `points:view_all` and `polls:view_all` alongside billing and points tools. Vice President and Secretary system roles include `members:view` and `polls:view_all` so the polls dashboard matches `PollController` guards (see seeded role matrix in [`behavior/rbac.md`](../behavior/rbac.md)). Full query parameters, pagination, and invariants: [`behavior/points.md`](../behavior/points.md) and [`behavior/polls.md`](../behavior/polls.md).

---

## 11. Quality Standards

- **Testing:** TDD encouraged. `apps/api` line coverage is measured (`npm run test:cov -w apps/api`,
  currently ~80%) but not CI-gated — a deliberate decision, not an oversight; see
  [`QUALITY_GATES.md` § Coverage](../../docs/internal/ci-cd/QUALITY_GATES.md#coverage).
- **Linting:** ESLint (shared config), Prettier for formatting.
- **Type safety:** TypeScript strict mode across apps and packages, with one recorded exception:
  `apps/api` sets `"strict": false` and opts into `strictNullChecks` / `noImplicitAny` /
  `strictBindCallApply` only. Nest DTO class fields are assigned by class-validator, not
  constructors, so `strictPropertyInitialization` would be hundreds of `TS2564`s with no
  runtime meaning. TypeScript 6/7 default `strict` to true, which is why the flag is now
  explicit. See [`docs/internal/ci-cd/AGENT_INFRA.md`](../../docs/internal/ci-cd/AGENT_INFRA.md)
  § TypeScript 7.
- **Validation:** Global ValidationPipe (class-validator) on API, running `whitelist` + `forbidNonWhitelisted` so unexpected properties are rejected rather than dropped; every request-DTO property carries a real constraint behind any `@IsOptional()` gate, and controllers order write payloads so server-decided keys (`chapter_id`, `created_by`) win over the spread DTO. Zod schemas shared to clients are UX only, never enforcement. See `docs/guides/api-architecture.md` § Never trust the client.
- **Security:** No hardcoded secrets. Input validation on all endpoints. SQL injection prevented by parameterized queries. CORS configured per environment. Rate limiting per user per endpoint — keyed on the authenticated user (Supabase JWT `sub`, after verifying the token's signature: HS256 locally against `SUPABASE_JWT_SECRET`, ES256/RS256 against the project JWKS via `supabase.auth.getClaims()` — the hosted projects sign ES256, so until 2026-09-06 no hosted request was keyed per user), falling back to client IP for unauthenticated, invalid, or expired tokens so a forged/rotating `sub` cannot evade the limit — at 100 req/min read and 30 req/min write, with stricter static overrides on expensive and fan-out routes (see [`spec/behavior/README.md` § Per-route rate limits](../behavior/README.md#per-route-rate-limits)); a standard `Retry-After` header (seconds) accompanies every `429`. The Stripe webhook route is exempt (see Security Note below). File upload MIME type validation.

## Database Performance

- For complex aggregations, computation should be pushed down to the Postgres database via RPC functions using `this.supabase.rpc('func_name')`.
- This approach avoids querying large amounts of raw data into application memory just to group and calculate totals.
- Examples of this pattern include `get_points_report` which aggregates point transactions by user and category, and `get_poll_vote_option_totals` / `get_poll_user_votes_for_messages` which aggregate poll votes — the former for both the chapter poll list and the single-poll detail view, the latter for the list only.

## Refactoring Note: TaskStatus Enum

The `TaskStatus` type, originally implemented as a string literal union, has been promoted to a TypeScript string `enum`.
This ensures greater type safety and consistency across `apps/api` DTOs, service transition logic (`VALID_ASSIGNEE_TRANSITIONS`), and other modules utilizing task statuses. This does not change runtime behavior but improves compile-time checks and API documentation generation.

## Security Note (2024-03-26)

Rate limiting is enforced globally via `ThrottlerGuard` in `AppModule`. The guard's storage key is `sha256(ClassName-HandlerName-throttlerName-tracker)`, so the two registered buckets are counted **per handler**, not across the app — which is why stricter limits are expressed as per-route `@Throttle` overrides of `read`/`write` (`interface/decorators/throttle-profiles.decorator.ts`) rather than as a third named throttler, which would be registered globally and run on every route. Exception: `WebhookController` (`POST /v1/webhooks/stripe`) opts out with `@SkipThrottle({ read: true, write: true })` — the route is unauthenticated so it would be throttled per IP, and Stripe deliveries burst from a small shared IP pool; Stripe signature verification is the abuse control there. The named-keys decorator form is required because the app registers named `read`/`write` throttlers (a bare `@SkipThrottle()` only sets the `default` key and skips nothing).

---

## 12. Chat Hot-Path Architecture

Chat is the spine of the product (see [`product/positioning.md`](../product/positioning.md)), so the architecture is biased for chat latency, reliability, and offline tolerance. The decisions this overview hangs off are recorded as ADRs in [`adr/`](adr/README.md); this section is the durable framing, not the decision log. The client half of the hot path lives in `packages/chat-core` (normalized cache, optimistic send client, realtime manager, and the shared topic registry) behind injected platform adapters; `apps/web/lib/chat/` keeps the web glue — the React provider and hook, and the Dexie outbox.

### Hot path vs cold path

Two write paths, two latency budgets:

- **Hot (chat):** send message, add reaction, RSVP / vote / pay / confirm an inline card, presence / typing. Budget: <100ms p50, <300ms p99. Optimistic on the client, eventually consistent on the server.
- **Cold (admin / ops):** chapter config changes, Stripe webhooks, exports, reports, bulk member imports, audit-log writes. Budget: <2s. Strongly consistent, full validation.

Both paths run in NestJS today (ADR-11 unwound the original Edge split, ADR-01); cold reads — history backfill (`GET /chat/channels/:id/messages?since=<id>`), config, reports — were always NestJS and stay there. Heavy slash commands (`/dues remind overdue`) take a `kind="loading"` optimistic placeholder card, call NestJS, and replace the card via Realtime; simple commands (`/poll`, `/announce`) are a single round-trip.

### Realtime channels

- **Messages:** Postgres Changes on `chat_messages` filtered by `chapter_id` + subscribed channels.
- **Reactions + action state:** Postgres Changes on `chat_message_actions` (one global subscription — the table has no `channel_id` to filter on; ADR-05).
- **Typing + presence:** Supabase Realtime Broadcast / Presence (ephemeral, not DB-backed; ADR-02, ADR-10).
- **System notifications:** the audit→chat bridge posts a `system_audit` message on `chapter_audit_log` insert, which streams as a normal Postgres Change into `#chapter-audit` (ADR-08).

### Edge Function / hot-path authorization

The chat write path uses the service-role client (RLS bypassed) on a client-supplied `channel_id` / `message_id`, so it **must verify the caller belongs to the target chapter before the write** — otherwise a member of chapter A could target chapter B's channel. A single pure predicate, `canAccessChannel`, exported from `@repo/validation`, is the shared authorization gate reused by the NestJS chat + search services (and, historically, both Edge Functions). It takes an `operation: 'read' | 'post'` parameter (default `'read'`): for `operation:'post'`, after the read check it denies when `channel.is_read_only` (e.g. `#announcements`) and the caller holds neither `'announcements:post'` nor `'*'`. The client hides disallowed commands for UX, but the server is the trust boundary.

### Presence-aware push rules

- Don't push a user who is currently online in the affected channel (presence read from Supabase Realtime Presence; ADR-04, ADR-10).
- Don't push `#chapter-audit` unless the user explicitly subscribed.
- Bundle bursts: 3+ messages within 60s from one sender → one push titled "N new messages from X".
- Per-channel / per-kind notification preferences (`all | mentions | off`). The default tier that applies when a user has no stored preference is owned by [`../behavior/notifications.md`](../behavior/notifications.md#chat-notification-preferences) § Chat notification preferences, not restated here.

### Reconnection

Websocket drops are assumed. Exponential backoff (1→2→4→8→16→30s capped). On reconnect, each channel re-attaches through the single `SUBSCRIBED` callback: re-attach the Postgres Changes subscription first, **then** REST-backfill `?since=<lastSeenMessageId>` (subscribe-then-backfill tolerates a harmless overlap, deduped by `client_message_id` + server `id`, instead of risking a gap). An unobtrusive "Reconnecting…" pill renders near the channel header.

Decisions that hang off this overview live in [`adr/`](adr/README.md) — one file per ADR, including later records that are not chat decisions (CI, project management, deploys).

---

## 13. AI Corpus Architecture (v1)

### Sources

The AI corpus (Q&A, summarization) reads from authoritative surfaces only. Casual chat is not indexed — see [`behavior/ai.md`](../behavior/ai.md) for the product rules.

| Source           | Table / location                                     | Access path                                   |
| ---------------- | ---------------------------------------------------- | --------------------------------------------- |
| Meeting minutes  | `meeting_recordings`, `meeting_summaries`            | Indexed on insert; re-indexed on summary edit. |
| Chapter documents | `chapter_documents` + Supabase Storage `documents/` | Indexed on upload; OCR/extraction at index time for PDFs. |
| Announcements    | `chat_messages` where channel is `#announcements`    | Indexed on insert; deleted/edited mirrored.    |
| Structured data  | `chapters`, `members`, `events`, `dues_*`, `roles`   | **Not indexed.** Read at answer time via tool calls against the guarded API. |

The structured-data row previously specified a materialized "facts" view refreshed on write. That is
withdrawn: an embedded copy of a mutable row is only correct as of the last refresh and cannot answer
aggregate questions. Structured data is now a **tool surface**, not corpus — see
[`behavior/ai.md`](../behavior/ai.md) for the product-level rationale.

### Retrieval

- Vector index per chapter (pgvector), keyed by chapter ID. Cross-chapter retrieval is impossible by construction — no chapter sees another chapter's vectors. pgvector remains the right call at this scale: a per-chapter corpus is orders of magnitude below the ~5–10M-vector point where a dedicated vector service starts to pay for itself, and it avoids operating a second datastore.
- **Retrieval is hybrid, not vector-only:** a dense vector search for semantic similarity, a sparse keyword search for exact terms (a bylaw article number, a dollar amount, a member's name), and a reranking pass over the merged candidate set. Dense-only retrieval reliably misses exact-match queries, which are common in this corpus.
  - **The sparse half now exists for global search, and the corpus can build on it.** `apps/api/src/application/services/search.service.ts` runs Postgres full-text search — all four sources match a `GENERATED ALWAYS … STORED` tsvector behind a GIN index, queried with `websearch_to_tsquery`. The per-source columns, indexes and migrations are enumerated in [`spec/behavior/search.md`](../behavior/search.md) (the Implementation bullet) and are not restated here. What remains corpus-specific is chunk-level indexing, **relevance scoring on the sparse side** — `search.service.ts` ranks nothing today, ordering chat by `created_at` and cutting at a flat limit — and rerank. The sparse *index* exists; the sparse *scoring* hybrid retrieval needs to merge candidate sets does not.
  - What **is** reusable from that service is the more valuable part: its authorization-filtered retrieval pattern — candidate rows are filtered through `canAccessChannel` before returning, and role lookups are re-scoped by `chapter_id` so a stray cross-chapter `role_id` cannot leak permissions. Corpus retrieval must follow the same shape.
- Retrieval returns source rows with provenance metadata (source type, author or document title, timestamp, internal ID). The LLM prompt template injects this metadata so the model can cite it back.
- Recency decay is applied at retrieval time so newer authoritative content outranks older content on time-sensitive questions ("when is the meeting"); decay is off for time-invariant content (policies, bylaws).

### Citation protocol

- Citations use the model provider's **native citation support** — documents are passed as document content blocks with citations enabled, and the API returns each cited claim as structured data: the quoted source text, the document title, and a character or page location. The UI renders those directly as links to the source surface.
- This replaces an earlier design that had the prompt emit citation tokens and a post-processor parse them back out, rejecting and re-prompting uncited answers. Native citations make the grounding structural rather than something recovered from free text, and delete the post-processor and its retry path.
- **Design constraint:** native citations are mutually exclusive with the provider's structured-output/JSON-schema mode — requesting both is rejected. The citing Q&A path therefore returns prose plus a structured citation list, not a JSON envelope. Any surface that needs strictly-shaped JSON must be a separate, non-citing call.
- The "couldn't find a confident answer" response is retained, but it is now driven by retrieval returning nothing above the relevance threshold rather than by a failed citation parse.

### Prerequisites (decide before the corpus work starts)

- **pgvector vs. the PGlite migration gate — settled, no constraint on the corpus migrations.** `scripts/check-pglite-migrations.mjs` is a CI gate requiring every migration to replay under PGlite. PGlite ships pgvector as a first-party extension (**pgvector 0.8.1** as measured under `@electric-sql/pglite@0.4.6`), so the gate registers it on the PGlite constructor alongside `pgcrypto` and `create extension vector` replays normally. **Its import path moved in PGlite 0.5:** the non-`contrib` extensions were unbundled out of the main package's `exports` map into their own packages, so `@electric-sql/pglite/vector` is now `@electric-sql/pglite-pgvector` — a separate dependency, peer-pinned to an exact `@electric-sql/pglite`, which is why the two move as a pair. `package.json` declares `^0.5.5` / `^0.0.6`. Nothing about the registration or the replay changed; only where the `vector` export is imported from. Verified: typed `vector(n)` columns, the `<=>` distance operators, and **both** ANN index access methods (`hnsw` and `ivfflat`) all work under the harness. Write the corpus migrations against pgvector as you would for hosted Postgres — no conditional extension creation, no gate carve-out, no shim.
  - Registration is load-bearing and silent when missing: installing the extension only makes it *available*, and an unregistered one fails with `extension "vector" is not available` — which reads like a PGlite limitation but is a one-line fix in the harness. A landmark assertion in the gate pins the registration so it fails there, not under the first corpus migration.
  - Two things this decision does **not** cover. `check:migration-safety` rejects any change set touching `supabase/migrations/` without a matching update to `docs/internal/ops/DB_PROMOTION_RUNBOOK.md` or `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`, and separately requires a per-migration entry in **both** of those docs — budget for both doc updates in the corpus migration PR. And **neither pgvector version is pinned by this decision**: the landmark asserts the extension is *available*, never which version, so the PGlite-side build moves with any `@electric-sql/pglite-pgvector` bump and the hosted Supabase build moves independently of both. Treat the 0.8.1 above as "what was measured on the day", not a guarantee — if a corpus migration ever depends on version-gated pgvector behavior, read the version on both sides rather than inferring either from this gate passing.
- **`chapter_documents` metadata is too thin for the retrieval design above.** It carries only `title`, `description`, `folder`, `storage_path`, `uploaded_by`, and `created_at` — no mime type, size, page count, document type, or effective date. Recency decay keyed on `created_at` measures *upload* time, not document currency, so a bylaw uploaded yesterday would outrank the amendment that superseded it. A metadata migration is a prerequisite; `backwork_resources` (year, semester, assignment type, variant, `file_hash`, `tags`) is the better shape to copy.

### Evals

- Adversarial test set under `apps/api/test/ai-evals/` covering: stale information (old meeting minutes contradicted by newer ones), conflicting sources (two documents disagreeing), missing information (corpus has nothing on the question), prompt injection from user-uploaded content.
- The eval suite runs on every change to the prompt template or retrieval logic. A regression fails the build.
- **Built (2026-08-07), ahead of the corpus and the agent.** The suite exists now so the FRA-309 / FRA-310 work has a target to satisfy rather than a retrofit. `npm run test:ai-evals -w apps/api`; it carries its own jest config because the unit project is `rootDir: "src"` and the e2e project matches `.e2e-spec.ts`. It runs as a step of the `api-tests` CI job — unconditionally rather than path-gated, which is a superset of the rule above and avoids spending ADR-15 minutes on a separate job's checkout and install to gate ~1.5s of tests.
  - The accompanying threat model is [`docs/internal/security/ai-prompt-injection.md`](../../docs/internal/security/ai-prompt-injection.md), covering the four injection vectors: uploaded documents, `#announcements`, chat messages in retrieved context, and **tool results** — the last being the easily-missed one, since "structured data" reaches the model through fields (profile notes, custom field values) that ordinary members control.
  - **Two grading layers.** Per-case expectations (refusal, citation, conflict-surfacing, tool allowlists), plus universal invariants no case can opt out of: chapter scoping, and an **authority ceiling** set to the intersection of the caller's and the *injector's* permissions. The intersection is what makes it a confused-deputy test — plain RBAC would permit a president's session to do president things at a rank-and-file member's written request.
  - **The behavioural cases skip until an agent is registered** (`AgentUnderTest`, via `registerAgentUnderTest()` or `AI_EVALS_AGENT_MODULE`), and say `NOT_IMPLEMENTED` rather than passing quietly. What runs today is the corpus coverage check and a set of grader tests that assert each injection's intended outcome is rejected — so the enforcement logic is itself under test before there is anything to enforce it against. Set **`AI_EVALS_REQUIRE_AGENT=1`** in CI as soon as an implementation lands; a missing agent then fails the build.

### Out of scope for v1

- Chat indexing (see [`behavior/ai.md`](../behavior/ai.md) non-goals).
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

Chapter theming runs deeper than an accent chip — it themes the chrome, message accents, mention pills, links and reaction highlights. A chapter supplies **one colour**: an accent seed at `branding.colors.accent`, mirrored to `chapters.accent_color`. #795 settled which is authoritative — `branding.colors.accent` is, and the column follows it on every write path. New code MUST NOT add a third read path.

**The derivation is canonical in [`ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md), not here.** This section owns where the palette lives and who writes it; the pipeline, role map, default seed and contrast gate live in that one place, because the two used to disagree.

### What produces it

`deriveSignetPalette(seed?)` (`packages/chapter-theme/src/signet.ts`) wraps a vendored Radix generator and emits the `--signet-*` role tokens. It never throws: an absent or unparseable seed resolves to house gold and reports `invalidSeed`. Contrast is guaranteed **by construction** for the roles that paint text, asserted at generation time rather than re-checked per surface (`accent-engine.md` §8).

The **neutral ladder is not derived**. Backgrounds, borders, the sidebar and the text ladder are fixed constants; chapter identity reaches a surface only through engine accent roles. That is a deliberate reversal — see *Why the sidebar is not branded* below.

### Computation and caching

`buildChapterPalette` (`apps/api/src/application/services/chapter-palette.ts`) is the single writer behind all three doors: onboarding, the config PATCH / `POST /chapters/:id/theme-palette` recompute endpoint, and the Settings accent save (`PATCH /v1/chapters/current`, the only path the UI actually uses). It is rebuilt **server-side** and cached in `chapters.theme_palette` — never recomputed on read, never client-side. A colour problem is logged, never thrown: it must not fail a save an officer asked for.

Delivery differs per surface, and neither client applies the column blindly:

- **Web** — `apps/web/lib/hooks/use-chapter-theme.ts`, mounted once by `DashboardShell`. It reads a fixed allow-list of `--signet-*` roles and re-keys them onto the semantic names `signet.css` defines, all-or-nothing. A row missing those keys leaves the house-gold defaults standing.
- **Native** — `apps/mobile/lib/chapter-branding.ts` reads `--signet-accent-text` (step 11, a foreground) and falls back to `resolveChapterAccentColor` against the real surface for a row that predates the Signet map.

### The legacy engine, and why the stored map is not self-describing

`derivePalette({ dark, accent })` produced a separate eight-token map (`--side-bg`, `--side-accent`, `--brand-band`, `--mention-*`, `--chat-self-bubble`, `--reaction-active`, `--ring`) merged into the same column. Six of the eight were composited over or validated against the **bone** background, so they could not survive the move to a `#0E0D0B` surface. The other two were dark-context and died with the concept instead: `--side-bg` was `mixHex(dark, ink, 0.3)` and never contrast-tested at all, and `--side-accent` was validated against *it* — both belonged to the branded sidebar the Signet shell replaced with a fixed neutral surface. The #920 shell slice stopped applying all eight; the slice-9 cutover deleted the engine.

Nothing migrated the stored data, because nothing needed to — the column is unconstrained jsonb and both clients read by allow-list. Rows written before the cutover therefore still **hold** the eight dead keys, and the guards that keep them off `:root` are load-bearing rather than historical.

The general hazard is worth naming: `theme_palette` has no version stamp, so a stored row cannot be distinguished from a current one by inspection, and each engine change silently applies only to chapters saved after it. The backfill is tracked in #1165.

### Why the sidebar is not branded

Kept because it is what rules the alternative out, not as live work — #1150, #1164 and #1149 are all closed, by removal rather than by derivation.

The five sidebar companions `derivePalette` did *not* write — `--side-bg-hi`, `--side-divider`, `--side-fg`, `--side-fg-hi`, `--side-muted` — kept neutral-ink `:root` defaults on a branded sidebar, which read as a hole (#1150). It could not be fixed piecemeal: `mixHex(dark, ink, 0.3)` put a branded `--side-bg` at a median 2.7× (up to 6.6×) the stock sidebar's luminance, so the stock text tokens were already spending their headroom — `--side-muted` measured 2.43:1 at worst across the 50 seeded chapters, below AA-large for 9 of them, and **2.10:1, below AA-large for 21 of 50, in dark mode**, because `.dark` declared its own darker `--side-muted` while the hook wrote `--side-bg` as an inline `:root` style that outranked it. Branding the raised surface consumed what was left: the elevation tokens and the text ladder had to be derived together or not at all. Five strategies were measured and none was adopted — four failed outright across the seed, and the fifth (deriving the text floors only) measured stable but landed both tiers materially quieter than stock, which is a visible downgrade rather than a fix.

Two lessons survive the code. **Measure both modes** — quoting the light-mode figure alone understated the affected chapters by more than double, the same conflation #1149 recorded for `--ring`, which was validated against bone only while being written as an inline `:root` style that outranked `.dark`. And **an inline style written from data outranks a stylesheet rule**, so a token validated against one background can land on another.

The Signet answer is the one approach the measurements left standing — surface and text derived together from one seed against a fixed background — obtained by construction instead of by a second derivation mechanism.

### Monospace decision

`--font-mono` is a deliberate system-monospace stack (`ui-monospace, SFMono-Regular, …, monospace`), **not** a bundled webfont. Ledger-line motifs, eyebrow labels, and `#chapter-audit` cards render against the system stack. Do not bundle a mono webfont unless brand explicitly revisits this — the "monospace family must be loaded" requirement is satisfied by a stack that needs no loading.

---

## 16. Mobile Chat Architecture

The Expo app opens directly into chat and shares web's realtime transport and outbox, so presence and the offline composer queue are the same on both (ADR-10). Reactions and rich-message cards are **not** at parity, and voice memos are not built at all — [`../behavior/chat/README.md`](../behavior/chat/README.md#web--mobile-parity) § Web ↔ mobile parity owns that roster. The hot-path client and realtime manager are shared across platforms as `@repo/chat-core`, with the platform-specific layers injected through its adapter ports (`KeyValueStore`, `NetworkState`, `OutboxStore`) rather than forked. The renderer registry is web-only (`apps/web/components/chat/renderers/`); `apps/mobile` does not consume `@repo/chat-integrations` and renders its one card kind directly.

### Storage layer (the Dexie analogue)

Web persists composer state in IndexedDB via Dexie (ADR-05); mobile uses the native equivalents behind the same storage interface (the `OutboxStore` port in `@repo/chat-core`):

- **Drafts + outbound send/action queue:** AsyncStorage. Persist between cold launches so a force-quit mid-compose never loses input, and a queued message flushes in order on reconnect (idempotent on `client_message_id`, same dedupe index as web).
- **Inbound message cache — specified, not built:** SQLite (`op-sqlite` or `expo-sqlite`) for last-N-per-channel offline reads and fast cold-start render. `apps/mobile` has no sqlite dependency; today the inbound cache is TanStack's in-memory cache, and the AsyncStorage KV holds only the backfill cursor.

The same TanStack Query mutations and Supabase Realtime subscriptions run on both platforms; the storage seam differs, as do the renderer registry and the reaction affordance recorded above.

### App lifecycle and presence

- **Foreground:** resubscribe Realtime and REST-backfill since the last cursor **before** rendering the channel, so the user never sees a stale thread.
- **Background:** persist per-channel cursors.
- **Presence states — specified, not built.** As designed: active → `online`; backgrounded → `idle`; force-quit → `offline`. Today the tracked payload is exactly `{ userId, ts }` — no status field, pinned by key-set equality in `packages/chat-core/src/presence-contract.spec.ts` — and nothing in `apps/mobile` binds `AppState` to presence. Presence is Supabase Realtime Presence on the channel topic (ADR-10); [`../behavior/chat/README.md`](../behavior/chat/README.md) owns that status. Web derives `idle` from timestamp age on the *chapter* topic rather than from a tracked status, so "consistent with web" would describe the transport, not the mechanism.

### Push delivery

Burst bundling and presence-aware suppression match the web push rules (ADR-04, ADR-09). What the
app actually declares and sends is owned by [`../ui/mobile/patterns.md`](../ui/mobile/patterns.md)
§ Push notifications and [`../behavior/notifications.md`](../behavior/notifications.md) — and it is
narrower than this section used to claim: there is **one** Android channel (`default`), no
per-category iOS or Android grouping, and **no silent/background push at all** (`UIBackgroundModes`
is deliberately unset, so there is no background-sync handler to wake).

### Voice memos

**Specified, not built.** `audio` is not in `CHAT_MESSAGE_KINDS`, so a send with that kind is rejected at the DTO today; [`../behavior/chat/README.md`](../behavior/chat/README.md) § Message Kinds and Actions marks it as specified-but-unbuilt and is the owner of that status. As designed: the mobile composer records a voice memo, uploads it to Supabase Storage (pre-signed upload, same flow as other attachments), and sends it as `kind="audio"` with waveform metadata in `payload`. Web would render the `audio` card with waveform playback.
