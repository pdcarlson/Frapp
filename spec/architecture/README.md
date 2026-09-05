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
| Observability  | Sentry + structured logging                  | Error tracking, request tracing, metrics.                                                                             |
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
  packages/         # 13 shared workspaces
    api-sdk/        # Generated API client + TypeScript types
    brand-assets/   # Canonical SVG marks (favicon + lockup)
    chapter-theme/  # Signet chapter accent engine (one seed -> `--signet-*` role tokens)
    chat-core/      # Platform-neutral chat hot path (cache, send client, realtime manager) behind injected adapters
    chat-integrations/ # Chat slash-command / integration helpers
    color/          # Shared WCAG contrast math
    eslint-config/  # Shared ESLint configuration
    formatting/     # Shared date/time/duration display helpers (web + mobile)
    hooks/          # Shared React hooks (use-members, use-frapp-client, etc.)
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
- **Observability:** Structured JSON logging, request tracing via `x-request-id`, Sentry integration, health check endpoint.

### 3.2 Web App (`apps/web`)

- **Framework:** Next.js (App Router), React, Tailwind CSS, ShadCN UI.
- **Data fetching:** TanStack Query + `@repo/api-sdk`.
- **Client state:** Zustand is the sanctioned store for client-only state, distinct from TanStack Query's server-state cache. The active-chapter selection is the live example — `apps/web/lib/stores/chapter-store.ts` wraps the store in Zustand's `persist` middleware so the choice survives reloads.
- **Auth:** Supabase Auth (browser client via `@supabase/ssr`). Session token forwarded to API.
- **Role:** Admin console for Presidents, Treasurers, and officers.
- **Server Components** by default; Client Components marked with `'use client'` only where interactivity requires it.
- **Dark mode:** Supported via `@repo/theme` with system preference detection and manual override.

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

**chat_message_attachments** — `id`, `message_id` (FK chat_messages, ON DELETE CASCADE), `channel_id` (FK chat_channels — denormalised so the row's chapter is one hop away, exactly as `chat_messages` reaches it), `bucket`, `storage_path`, `filename`, `content_type` (nullable), `byte_size` (bigint, nullable), `width` / `height` (int, nullable), `external_url` (nullable — reserved for a source-system URL, and **always null for Discord imports**: the exporter has already rewritten every URL to an export-relative path, so there is no CDN link to keep, and storing one would outlive its own signature), `created_at`. Unique on `(message_id, bucket, storage_path)` — the `message_id` is load-bearing and the migration says why: a `(bucket, storage_path)` key would let two messages quoting the same deduplicated file insert once and silently skip the second. RLS enabled with **no policies** (default deny): the table is not a Realtime carrier and is read only by the API on the service-role key.

**message_reactions** — `id`, `message_id` (FK chat_messages), `user_id` (FK users), `emoji` (text), `created_at`. Unique on (message_id, user_id, emoji).

**channel_read_receipts** — `id`, `channel_id` (FK chat_channels), `user_id` (FK users), `last_read_at` (timestamp), `updated_at`. Unique on (channel_id, user_id).

### Polls

**poll_votes** — `id`, `message_id` (FK chat_messages, where type = POLL), `user_id` (FK users), `option_index` (int — index into the poll options array in message metadata), `created_at`. Unique on (message_id, user_id) for single-choice polls; unique on (message_id, user_id, option_index) for multi-choice.

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
- `enabled_modules jsonb not null default '{"chat":true,"members":true,"announcements":true,"audit-log":true}'` — per-module on/off map. A module is enabled unless its key is explicitly `false`. The always-on free set (`chat`, `members`, `announcements`, `audit-log`, `chapter-settings`) cannot be disabled. See [`product/modules.md`](../product/modules.md).
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
- **chapter_audit_log** — `(id, chapter_id, actor_user_id, action, target_type, target_id, scope, diff jsonb, created_at, member_visible boolean)`. Append-only; mirrored into the `#chapter-audit` channel via the audit→chat bridge (ADR-08). Indexed on `(chapter_id, created_at desc)` and `(actor_user_id, created_at desc)`.

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
- **Write payloads are `TablesInsert<'table'>` / `TablesUpdate<'table'>`**, not `as never`. `Insert`/`Update` in `database.types.ts` are mapped types of the domain entity (same index-signature trick as `Row`), so PostgREST accepts the payload without a cast and still rejects mistyped columns. Domain repository interfaces stay `Partial<Entity>` so the domain layer does not import `Database`. There is no generic base repository — each class keeps its own queries; only the write-method parameter type changes. `apps/api/src/infrastructure/supabase/repositories/no-as-never.spec.ts` fails if an `as never` cast returns, the repository count drifts, or a file injects a bare `SupabaseClient`. Direct service-layer writes (chapter config, custom fields/roles, chapter-create channel seed, onboarding, chat-bridge, scheduled-jobs) use the same table types; inject `FrappSupabaseClient` everywhere the `SUPABASE_CLIENT` token is taken, never the bare `SupabaseClient`.

### Invite redemption atomicity

The `InviteService.redeem` flow performs deterministic validation checks (invite existence, expiry, existing membership) before consuming the invite. The invite is marked as used via an atomic conditional update (`markUsedAtomically`: `UPDATE ... WHERE used_at IS NULL`) that returns whether the row was claimed. This prevents race conditions where concurrent redeems could both succeed, while ensuring the invite is not irreversibly consumed if a subsequent validation check (e.g. existing membership) would fail.

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

### Structured Logging

Every API request is logged as structured JSON:

```json
{
  "requestId": "req_abc123",
  "userId": "uuid",
  "chapterId": "uuid",
  "method": "POST",
  "path": "/v1/points/adjust",
  "statusCode": 200,
  "latencyMs": 45,
  "timestamp": "2026-02-25T12:00:00Z"
}
```

### Request Tracing

A unique `x-request-id` header is generated for each incoming request (or preserved if the client sends one). This ID is included in all log entries, all error responses, and all Sentry reports.

### Health Check

Two unauthenticated endpoints — `GET /health` (liveness, always 2xx while the
process is up) and `GET /health/ready` (readiness, 503 when a dependency is
degraded, which is what the post-deploy smoke checks poll).

The response bodies and the reason the two differ are owned by
[`spec/behavior/observability.md`](../behavior/observability.md) § Health Check
and are not restated here.

### Error Tracking

Sentry (or equivalent) integration. All unhandled exceptions and 5xx responses are reported with full context (request ID, user ID, chapter ID, stack trace). PII is scrubbed before reporting.

### Metrics

Key metrics exported for monitoring dashboards:

- Request rate (per endpoint, per status code).
- Error rate (4xx, 5xx).
- Response latency (p50, p95, p99).
- Active Realtime connections.
- Active study sessions.
- Push notification delivery success/failure rate.

### Alerting

Configurable alerts via the monitoring provider. The list is not restated here — it is owned by
[`../behavior/observability.md`](../behavior/observability.md) § Alerting, which carries all five
conditions. This copy had already drifted: it carried an "API downtime … for >1 minute" duration
that no document states and no provider configuration in the repo backs, so the number is deleted
rather than moved.

**Most of those alerts have no recorded threshold.** [`ALERT_ROUTING.md`](../../docs/internal/ops/ALERT_ROUTING.md)
§ Thresholds documents two — push notification delivery, and security events. API downtime, database
connection-pool exhaustion and Stripe webhook failures have none written down anywhere; they live
only in the provider dashboard, if they are configured at all. Read that as a gap, not as a pointer
to go and follow.

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
- **Security:** No hardcoded secrets. Input validation on all endpoints. SQL injection prevented by parameterized queries. CORS configured per environment. Rate limiting per user per endpoint — keyed on the authenticated user (Supabase JWT `sub`, after verifying the token's HS256 signature against `SUPABASE_JWT_SECRET`), falling back to client IP for unauthenticated, invalid, or expired tokens so a forged/rotating `sub` cannot evade the limit — at 100 req/min read and 30 req/min write, with stricter static overrides on expensive and fan-out routes (see [`spec/behavior/README.md` § Per-route rate limits](../behavior/README.md#per-route-rate-limits)); a standard `Retry-After` header (seconds) accompanies every `429`. The Stripe webhook route is exempt (see Security Note below). File upload MIME type validation.

## Database Performance

- For complex aggregations, computation should be pushed down to the Postgres database via RPC functions using `this.supabase.rpc('func_name')`.
- This approach avoids querying large amounts of raw data into application memory just to group and calculate totals.
- Examples of this pattern include `get_points_report` which aggregates point transactions by user and category, and `get_poll_vote_option_totals` / `get_poll_user_votes_for_messages` which aggregate poll votes for the chapter poll list.

## Refactoring Note: TaskStatus Enum

The `TaskStatus` type, originally implemented as a string literal union, has been promoted to a TypeScript string `enum`.
This ensures greater type safety and consistency across `apps/api` DTOs, service transition logic (`VALID_ASSIGNEE_TRANSITIONS`), and other modules utilizing task statuses. This does not change runtime behavior but improves compile-time checks and API documentation generation.

## Security Note (2024-03-26)

Rate limiting is enforced globally via `ThrottlerGuard` in `AppModule`. The guard's storage key is `sha256(ClassName-HandlerName-throttlerName-tracker)`, so the two registered buckets are counted **per handler**, not across the app — which is why stricter limits are expressed as per-route `@Throttle` overrides of `read`/`write` (`interface/decorators/throttle-profiles.decorator.ts`) rather than as a third named throttler, which would be registered globally and run on every route. Exception: `WebhookController` (`POST /v1/webhooks/stripe`) opts out with `@SkipThrottle({ read: true, write: true })` — the route is unauthenticated so it would be throttled per IP, and Stripe deliveries burst from a small shared IP pool; Stripe signature verification is the abuse control there. The named-keys decorator form is required because the app registers named `read`/`write` throttlers (a bare `@SkipThrottle()` only sets the `default` key and skips nothing).

---

## 12. Chat Hot-Path Architecture

Chat is the spine of the product (see [`product/positioning.md`](../product/positioning.md)), so the architecture is biased for chat latency, reliability, and offline tolerance. The decisions below are recorded as ADRs; this overview is the durable framing they hang off. The client half of the hot path lives in `packages/chat-core` (normalized cache, optimistic send client, realtime manager, and the shared topic registry) behind injected platform adapters; `apps/web/lib/chat/` keeps the web glue — the React provider and hook, and the Dexie outbox.

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

### ADR-01: Why we split chat to Supabase Edge Functions

> **⚠️ Superseded for the hot path by [ADR-11](#adr-11-agent-dev-stack--chat-hot-path-moves-to-in-process-nestjs-pglite-for-local-db-validation-401) (#401 / #416).** `chat-send` and `chat-react` now live in NestJS (`apps/api/src/interface/controllers/chat.controller.ts`); the `supabase/functions/` Deno surface for chat retired in #416. The rationale below is retained as historical context — the cold-path / shared-validation framing still holds, only the hot-path split was unwound. ADR-11's "Trigger to revisit" governs any future reversal.

**Decision:** Chat hot-path writes (send message, add reaction, action/RSVP) go to Supabase Edge Functions (Deno), not NestJS.

**Rationale:** NestJS runs on a single Render instance (US-East). Edge Functions run at the CDN edge closest to the user, reducing p50 latency from ~150ms (single-region) to <50ms. The hot path is also the highest volume path — routing it past NestJS removes that single point of contention. Cold reads (history backfill, config, reports) stay in NestJS where guards, DTOs, and test infrastructure already live.

**Consequences:** Two write paths to maintain. Zod schemas in `packages/validation` must be importable from both Node.js and Deno (enforced by keeping validation dependency-light: `zod` only).

### ADR-02: Why Supabase Realtime Broadcast for presence/typing

**Decision:** Typing indicators and presence (online/offline) use Supabase Realtime Broadcast, not Postgres Changes.

**Rationale:** Broadcast is ephemeral (not persisted to DB), avoiding write amplification on every keystroke. A 200-member chapter where everyone is typing would generate ~200 rows/second to `presence` if DB-backed. Broadcast routes through the Realtime server without touching Postgres. On disconnect, the presence state naturally evaporates — no cleanup job needed.

**Consequences:** Presence/typing state is lost on server restart. This is acceptable; reconnecting clients re-emit their state within 1s. Persistent state (last-seen cursor, notification preferences) stays in DB.

### ADR-03: Why optimistic + idempotent client UUIDs

**Decision:** Every outbound message carries a client-generated UUID (`client_message_id`). The UI renders the message optimistically before the server confirms. The server dedupes on `(channel_id, sender_id, client_message_id)` — historically inside the `chat-send` Edge Function, now inside `ChatService.sendMessage` per ADR-11 / #416.

**Rationale:** Mobile connections drop; retries are the norm, not the exception. Without idempotency, a retry after a network drop creates a duplicate message. With client UUIDs, retries are safe. Optimistic rendering removes the perceived latency of the server round-trip entirely — the user sees their message immediately.

**Consequences:** The UI must handle the "sent → confirmed" state transition (swap optimistic message for server-confirmed one). TanStack Query `onMutate`/`onError` handles this. Dedup index on `chat_messages` is non-negotiable: `UNIQUE (channel_id, sender_id, client_message_id) NULLS NOT DISTINCT WHERE client_message_id IS NOT NULL`. The `NULLS NOT DISTINCT` clause is load-bearing rather than decorative: `sender_id` is nullable for imported archive rows, and Postgres treats NULLs in a unique index as distinct by default, so without it the index silently stops enforcing anything for exactly the rows a re-run importer would duplicate.

- **Amendment (2026-08-24) — the archive importer does not use `client_message_id`, and `NULLS NOT DISTINCT` is now inert.** The sentence above about the clause being load-bearing was written when phase 1 of the Discord importer (#1228) planned to write the Discord message snowflake into `client_message_id`. Phase 2 reversed that and gave the importer its own column, `external_message_id`, with its own partial unique index `(channel_id, external_message_id)` (`20260824120000_discord_import.sql`). The reason is the one this ADR is about: `client_message_id` is a *client-minted* idempotency key — the composer generates it, the offline outbox round-trips it, and both clients compare against it to swap an optimistic bubble for the confirmed row. An identifier issued by a foreign system is a different fact, and one column carrying both meant every reader of either path had to establish which kind of value it held. **`idx_chat_messages_dedupe` keeps its `NULLS NOT DISTINCT` clause** — imported rows no longer set `client_message_id` and live rows always carry a sender, so it now governs a shape nothing produces, and dropping it would mean rebuilding a unique index on the hot insert path to remove something that costs nothing. It is retained as a defensive invariant, not as the importer's guarantee. **Trade-off:** one more nullable column on the product's largest table, and two indexes on `chat_messages` where the plan had one.

### ADR-04: Why presence-aware push notifications

**Decision:** Push notifications are suppressed for users who are currently online in the affected channel.

**Rationale:** Sending a push to a user who is already reading the channel is noise. It trains users to mute notifications. "Presence-aware" means: if the user's Realtime subscription to the channel is active, skip the push. If they're offline or in a different channel, send it.

**Consequences:** Requires tracking per-channel presence, not just global online status. Supabase Broadcast presence tracks this. Edge Function (or NestJS notification trigger) must query presence before enqueuing push. False negatives (push skipped for briefly-offline user) are acceptable; false positives (push sent to active reader) are worse.

### ADR-05: Dexie-backed offline queue + reconnect-with-backfill (Chunk 04)

**Decision:** The web client persists chat composer state in IndexedDB via [Dexie](https://dexie.org/) and routes every reconnect through a REST `?since=<id>` backfill before resubscribing.

**Schema (`frapp-chat` IndexedDB):**

```text
drafts(channelId PK, body, updatedAt)
outbox(clientId PK, channelId, body, kind?, payload?, replyToId?, attempts, queuedAt, status: "queued"|"failed", lastError?)
```

- **Drafts** are written debounced from the composer (Tiptap text via `editor.getText()`, _not_ the editor JSON — keeps the schema stable across editor upgrades). Restored on tab reload so a mid-compose user never loses input.
- **Outbox** rows are enqueued _before_ the chat-send POST; the row's `clientId` doubles as `chat_messages.client_message_id`, which the NestJS chat controller dedupes on (ADR-03, ADR-11). On success the row is dequeued; on a `4xx` it moves to `failed` with an inline Retry/Discard affordance; on network/5xx it stays `queued`. The flush loop iterates `queued` rows oldest-first and **sequentially** so message order is preserved end-to-end.

**Channel-attach ordering (subscribe-then-backfill):** every channel attach — both the **initial join** for a freshly-subscribed channel and every **reconnect** after `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` — runs through the same `SUBSCRIBED` callback in the realtime manager. The callback (a) re-attaches the Postgres Changes subscription first, then (b) calls `GET /v1/channels/{id}/messages?since=<lastSeenMessageId>` via the api-sdk. Gating both paths on the single `SUBSCRIBED` callback guarantees the Realtime listener is genuinely attached before the REST backfill HTTP fires, so any row that lands during the overlap is still caught by the live subscription. The last-seen id is persisted per channel in `localStorage` (`chat:lastSeen:{channelId}`) and advanced only from confirmed tail rows. Subscribe-then-backfill tolerates a harmless overlap (deduped by `mergeServerRow` keyed on both `client_message_id` and server `id`) instead of risking a gap. Backoff between failed resubscribes is 1→2→4→8→16→30s capped.

**Rationale:** Mobile/laptop networks drop; without persistence, a 30-second offline window costs the user their draft and any messages they typed but didn't send. With Dexie + the idempotency index from ADR-03, the user can compose offline, reload the tab, come back online minutes later, and see their messages flush in order with zero duplicates.

**Consequences:** Dexie is web-only; the Expo mobile client uses AsyncStorage/SQLite for the analogue (Chunk 11). The reaction subscription is one **global** `chat_message_actions` channel (the table has no `channel_id` column to filter on); reactions on not-yet-loaded messages are intentionally dropped and recovered on next backfill. Reaction _removals_ go to the row directly under RLS (`chat_message_actions_delete` scopes to own rows) rather than adding a remove path to the NestJS actions endpoint — keeps the server-side surface read+insert+upsert only.

### ADR-06: `chat_notification_preferences` is a new table, not a column on `notification_preferences` (Chunk 05)

**Decision:** Chat per-channel + per-kind preferences live in a dedicated table `chat_notification_preferences (user_id, chapter_id, scope text in ('channel','kind'), scope_id uuid|null, scope_kind text|null, level text in ('all','mentions','off'), updated_at)` with a unique index over `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))`.

**Rationale:** The existing `notification_preferences` table is boolean (`is_enabled`) and category-keyed. Chat needs a tri-state level (`all` / `mentions` / `off`) and two scope arms: per-channel (default for muting one channel) and per-kind (default for muting all `system_audit` messages globally). Squatting on `category` to encode `channel:<uuid>` or `kind:system_audit` loses type safety, complicates indexes, and would force a brittle string-parsing layer in the worker. **Alternatives considered:** (a) extend `notification_preferences` with a level column — would orphan every existing row's semantics; (b) inline preferences in `users.metadata` JSON — no DB-enforced uniqueness, hard to query at scale. Migration path: when chat is the last preference producer, a follow-up PR consolidates both tables behind a single view.

**Consequences:** Two preference tables until consolidation. The push worker queries both arms in a single `eq(user_id).eq(chapter_id)` load per recipient and resolves precedence locally (channel-pref ▶ kind-pref ▶ channel-name default). The defaults live in `apps/api/src/modules/chat-push-worker/push-rules.ts:defaultLevelFor` so the rule chain is unit-testable without DB seeds; [`../behavior/notifications.md`](../behavior/notifications.md#chat-notification-preferences) § Chat notification preferences is the doc that states them.

### ADR-07: chat-react UPSERT semantics for poll vote-change (Chunk 05)

**Decision:** When `action_type === 'vote'` and the unique index `(message_id, user_id, action_type)` rejects the INSERT, the chat-react handler (originally the Edge Function, now `ChatService.recordMessageAction` per ADR-11 / #416) performs an UPDATE on the existing row — overwriting `payload` (the new `option_id`) and refreshing `created_at` — and returns `{ action, deduplicated:false, updated:true }`. The unique index stays in place; only `action_type='vote'` takes the UPDATE branch. Emoji reactions (`action_type` starts with `reaction:`) keep the 23505 → select-existing dedup path unchanged.

**Rationale:** A poll lets a user change their vote (Mon → Tue). The brief calls vote-change idempotent, but a second INSERT would either duplicate the row or fail; an UPDATE on the existing row keeps "one vote per user per message" enforced by the DB constraint while still letting the option_id move. Distinguishing insert vs UPDATE in the response shape lets the optimistic client merge the new payload onto the same row (`applyActionUpdate` in `packages/chat-core/src/cache.ts`) without re-inserting into the action list. **Alternatives considered:** (a) per-option `action_type='vote:<option_id>'` — multiplies the action surface and means vote-change is "delete old + insert new", two round-trips; (b) a separate `chat_poll_votes` table — duplicates the dedup index and forks the renderer's data source.

**Consequences:** The `chat_message_actions` row id stays stable across vote-changes, so Postgres Changes broadcasts the new payload as a single UPDATE event. Realtime listeners that only handle INSERT must be extended (the web manager already routes UPDATE through the same path). Poll renderers read tallies from `message.actions` (raw rows with payloads), not from `message.reactions` (aggregated user lists by action_type), because the per-option breakdown is in the payload.

### ADR-08: Audit→chat bridge via NestJS Realtime subscriber (Chunk 05)

**Decision:** The `#chapter-audit` system message is posted by `ChatBridgeWorkerService` (an `OnApplicationBootstrap` lifecycle on a NestJS module) which subscribes to `postgres_changes` on `chapter_audit_log` INSERT via the service-role Supabase client. The previous inline `postAuditMessage` call in `chapter-config.service.ts` is removed; future audit-writing services do nothing chat-related.

**Rationale:** The bridge needs exactly one owner so the format of `system_audit` messages (`payload: { action, actor_user_id, diff }`) doesn't drift across services. **Alternatives considered:** (a) Postgres `AFTER INSERT` trigger calling a PL/pgSQL function — works but is harder to test/deploy/version in lockstep with the NestJS image, and Supabase migrations don't surface trigger failures the way NestJS logs do; (b) inline calls from every audit-writing service — fan-out makes drift inevitable (each new caller copies the prior code, drops a field, forgets the channel lookup). The Realtime subscriber pattern matches how the push worker (ADR-09) ingests `chat_messages` events, so the operational surface is consistent.

**Consequences:** A bootstrap failure (no service-role key, network) means audit rows are written but `#chapter-audit` doesn't mirror — caught by `OnApplicationBootstrap` logging and never throws. Older chapters without a `chapter-audit` channel are tolerated (debug log, skip). Unit tests invoke `handleAuditRow` directly so the row→message mapping is verified without spinning up Realtime.

### ADR-09: Push worker host is the in-process NestJS API, with a documented scaling watermark (Chunk 05)

**Decision:** `ChatPushWorkerService` runs in the same NestJS process as the REST API, subscribing to `chat_messages` INSERT via `OnApplicationBootstrap`. It reuses `NotificationService.notifyUser` (preference-aware + quiet-hours-aware Expo fanout) and the existing `notification_preferences` / `user_settings` tables. The worker is split into a standalone service when **either** `p99 fanout latency > 1s` for sustained periods **or** `worker-loop CPU > 40%` of the API instance. The watermark is enforced via dashboards, not code.

**Rationale:** Standalone deployments cost an extra Render instance, a separate deploy pipeline, and a second source of secrets. At MVP scale (~50 active chapters) the fanout cost is tiny vs the REST request mix, so in-process is the right default. Putting the trigger ahead of time in the ADR means no one has to re-derive when to split. **Alternatives considered:** (a) cron-pull every 10s — adds latency and can miss bursts; (b) standalone Render worker from day one — operational overhead with no payoff at current scale.

**Consequences:** API restarts drop the Realtime subscription for the restart window — the missed messages do not retroactively push (acceptable: cold-path notifications are best-effort). Burst bundling, presence skipping, and preference resolution all run in the same memory space as the REST app; future scaling moves the entire `ChatPushWorkerModule` out without API code changes. Documented in `docs/internal/ops/DEPLOYMENT.md`.

### ADR-10: Supabase Realtime Presence is the presence source — no custom broadcast topic (Chunk 05)

**Decision:** Presence on `chat:channel:<id>` uses Supabase Realtime's built-in Presence API: the web client calls `channel.track({ userId, ts })` from the `SUBSCRIBED` callback in `packages/chat-core/src/realtime-manager.ts` (pinned by that package's `presence-contract.test.ts`); the push worker opens a service-role subscription on the same topic and reads `presenceState()` per channel before fanout.

**Rationale:** A bespoke broadcast topic (e.g. `presence:channel:<id>` with manual heartbeats) would re-implement what Realtime Presence already does — connect/disconnect tracking, a state aggregator, automatic cleanup on socket drop — and create a second source of truth that can drift from the actual subscription state. Presence on the chat channel topic is automatic; we already pay the realtime cost for messages on the same topic. **Alternatives considered:** (a) custom broadcast topic with periodic `still-here` pings — duplicates Presence with more bugs; (b) a global presence map maintained by the API via REST heartbeats — loses ephemerality, creates DB write amplification (ADR-02 anti-pattern); (c) skip presence and always push — trains users to mute notifications (ADR-04 anti-pattern).

**Consequences:** The web client now joins Presence on every active channel — small additional cost on the same socket. The push worker opens a presence subscription per channel it sees a message for (cached for the process lifetime); presence reads are synchronous (`presenceState()`) so the rule chain stays cheap. False negatives (recipient briefly offline) are acceptable; false positives (recipient actively reading) are worse — the rule order skips presence first.

### ADR-11: Agent dev stack — chat hot path moves to in-process NestJS; PGlite for local DB validation (#401)

**Decision:** Two changes, paired to close the cloud-agent testing gap that #401 escalated to a program-level risk.

1. **Chat hot-path writes (`chat-send`, `chat-react`) move from Supabase Edge Functions into the existing NestJS API**, extending `ChatController` (`apps/api/src/interface/controllers/chat.controller.ts`) and mirroring the in-process pattern established by ADR-09's push worker. The Deno surface under `supabase/functions/` retires; `_shared/chat-authz.ts` is replaced by the shared `canAccessChannel` predicate already exported from `@repo/validation`. This reverses the half of ADR-01 that scoped chat writes to Edge — cold reads were already in NestJS and stay there.
2. **A PGlite-backed harness lands under `tools/pglite-harness/`** as a supplemental always-on layer. It applies every `supabase/migrations/*.sql` to a fresh in-process Postgres-in-WASM instance (~323 ms for the current 12-migration set) and asserts the schema landmarks reviewers care about (chat dedupe partial unique index, `chat_message_actions` unique index, `chapter_audit_log` no-update/no-delete RLS, generated `search_vector`). It runs in CI alongside `edge-fn-tests` and from any cloud-agent sandbox without privileged tooling.

The chosen path is Path D + Path C from #401. Path A (per-session Supabase branches) and Path B (rootless Supabase stack inside the sandbox) were investigated and rejected — see Alternatives.

**Rationale:** Several early chunks shipped with runtime checks blocked (tracked as #235). The auth bugs from #233/#234 landed because nobody could runtime-verify the Edge Function. ADR-01's original framing ("edge proximity reduces p50 from ~150ms to <50ms") did not condition on geography: Frapp's user base today is US-centric Greek-life chapters, where the realistic delta between Render US-East and Supabase Edge's US POP is ~15–30ms p50 — fully hidden by ADR-03's optimistic UI. The latency case for Edge does not survive contact with the actual user base. Meanwhile, the testability case for NestJS is overwhelming: Jest + supertest + the existing `SupabaseAuthGuard` (`apps/api/src/interface/guards/supabase-auth.guard.ts`) + the Realtime-capable service-role `SUPABASE_CLIENT` provider (proven by ADR-09's push worker) cover the move with no new infrastructure. PGlite then makes migration validation a 323-millisecond unit-test problem instead of a "spin up Docker" problem, and runs identically in CI and in any sandbox.

**Alternatives considered:**

- **Path A — Supabase branches per agent session** ([#411 comment](https://github.com/pdcarlson/Frapp/issues/411#issuecomment-4559934654)). Architecturally compatible but relocates #401's blocker: the very Supabase MCP tools needed (`create_branch`, `apply_migration`, `deploy_edge_function`) are denied at the sandbox permission layer, and `deploy_edge_function`'s `files[]` has no monorepo awareness (every deploy would have to inline `packages/validation`'s 372 lines). Documented provisioning latency exceeds 60s (Supabase's own Health step waits up to 120s). Cost is fine ($0.01344/hr Micro) but the spike could not run live to confirm.
- **Path B — rootless Supabase stack in the sandbox** ([#412 comment](https://github.com/pdcarlson/Frapp/issues/412#issuecomment-4559937215)). Edge Runtime is Docker-only, Realtime requires Elixir/Erlang with ~daily release cadence, Supabase Postgres ships ~30 extensions with no tarball distribution. Estimated 15–25 maintenance hours/month steady-state, spiking past 40h on PG-major / breaking-auth releases. Maintenance cost prohibitive.
- **Path C alone — PGlite + Deno handler tests** ([#413 comment](https://github.com/pdcarlson/Frapp/issues/413#issuecomment-4559942991)). Covers migration validation and function SQL behavior, but explicitly misses Realtime, Presence, and GoTrue with real JWTs. Not sufficient as the primary path; adopted as supplemental.
- **Path D alone — move chat to NestJS without PGlite** ([#414 comment](https://github.com/pdcarlson/Frapp/issues/414#issuecomment-4559944971)). Closes the integration-test gap but leaves migration validation slow (requires a real Postgres). Pairing with C is cheap and finishes the job.
- **Keep ADR-01 as-is.** Documented elsewhere (every "BLOCKED in sandbox" STATUS row since Chunk 02).

**Consequences:**

- `supabase/functions/chat-send`, `supabase/functions/chat-react`, `supabase/functions/_shared/chat-authz.ts`, the Deno test suite under `supabase/functions/_tests/`, and the `edge-fn-tests` CI job **retired in #416**. The 716 LOC of Deno tests is replaced by Jest tests living next to the moved code (`apps/api/src/application/services/chat.service.spec.ts`).
- Web/mobile clients stopped calling `supabase.functions.invoke('chat-send'|'chat-react', …)` and use the existing `packages/api-sdk` chat endpoints (`POST /v1/channels/{id}/messages`, `POST /v1/channels/messages/{messageId}/actions`); the SDK regenerates from the extended controller. (Mobile mirrors in Chunk 11; web shipped with #416.)
- The Realtime broadcast emit previously in `chat-send` (`channel.send`) moved to `ChatService.broadcastNewMessage`. ADR-09's push worker already proved the service-role client there can do this.
- ADR-01 is **superseded for the hot path** but stays in this file as historical context (it's still right for the cold-path / Chunk-02 split rationale; the change is "no Edge Functions today" not "no Edge Functions ever").
- PGlite adds one npm dep (`@electric-sql/pglite`, WASM, no native code, no Docker). It does not replace integration testing against the hosted Supabase project — it complements unit + integration tiers.
- Chunks that previously shipped with "Runtime checks BLOCKED — see #235" can drop the disclaimer once the migration completes. #235 closes-as-subsumed; the PGlite job in CI is the migration-validation deliverable.

- **Amendment (2026-09-02, #472) — the moved Realtime broadcast emit is deleted; the move never brought its consumer with it.** The Consequences bullet above ("The Realtime broadcast emit previously in `chat-send` (`channel.send`) moved to `ChatService.broadcastNewMessage`") describes what #416 did and is retained as that record. What it did not say, because nobody checked at the time, is that **the client half never arrived**: the emit published `new_message` to a bespoke `chapter:<channel_id>` topic, while clients join `chat:channel:<id>` (ADR-10) and read messages through `postgres_changes` on `chat_messages`. In the tree as it stands, no `new_message` handler exists in `apps/web`, `apps/mobile` or `packages` — and both clients drive chat through the same `chat-core` realtime manager, so that covers both. So the emit was dead on **both** halves independently: wrong topic *and* no listener. (`git log -S"new_message"` over `apps/web apps/mobile packages` is also empty, but that was run in a sandbox holding a **shallow clone**, so it evidences the recent history it covers, not "never".) It also cost an HTTP round trip per message, and reported nothing when it failed. Both follow from the channel never being subscribed: `RealtimeChannel.send()` takes its REST fallback when `!canPush() && type === 'broadcast'` (`@supabase/realtime-js`), so each call POSTed to the broadcast endpoint, and that branch **catches internally and returns `'ok' | 'error' | 'timed out'` rather than throwing**. The return value was discarded. So the `catch` block was unreachable for a send failure and its `logger.debug` line never ran — which means #472's premise, that failures were "logged at `debug`", was itself wrong: they were logged nowhere. That is a stronger reason to remove the emit than to instrument it. `ChatService.broadcastNewMessage`, `realtimeTopicForChannel` and the now-unused `SUPABASE_CLIENT` injection are removed; `ChatService` no longer depends on the Supabase client at all. **This does not change message delivery**, which was already Postgres Changes and nothing else (`spec/ui/resilience.md` §3.2). The prompt was #472, which asked for the swallowed broadcast failure to be instrumented — a counter on a path that delivers to nobody could never indicate user-visible degradation, so the emit was removed rather than measured. Whether chat should have a *genuine* sub-second broadcast fast-path is a separate, open question (**#1613**). Note that no ADR forbids one: ADR-02 chose Broadcast *for* typing and presence rather than ruling it out for messages, and ADR-10 governs the presence topic. Building one is therefore a new decision, and it needs a client handler, de-duplication against the Postgres Changes echo of the same row, and ADR-10's coupling respected — the topic stays `chat:channel:<id>`, because the push worker reads Presence there. Pinned by `apps/api/src/application/services/chat-realtime-carrier.spec.ts`, which asserts the API emits no Broadcast; that guard describes today's architecture, not a prohibition.

**Trigger to revisit:**

- **Geography shift.** If Frapp's user base meaningfully expands outside US-East — measured by ≥15% of monthly active chapters resolving to a non-US-East region — re-evaluate moving the hot path back to Edge.
- **New hot path emerges that genuinely benefits from <50ms global p50.** If a future chunk identifies one, that chunk lands its own Edge Function with the testability problem solved per-case (likely a thin function calling NestJS, so most logic stays testable).
- **PGlite drops support for an extension we adopt** (e.g. if we add `pg_cron` or `pg_net` to a migration that PGlite can't load), the harness falls back to a documented "schema-only assertion" mode and the migration's runtime behavior gets a real Postgres in CI.
- **Sandbox unblocks Supabase MCP write tools** (`create_branch`, `apply_migration`, `deploy_edge_function`). Path A becomes runnable; revisit only if we've grown a need for a real Realtime/Edge-Runtime substrate in-loop that PGlite + NestJS unit tests don't cover.

### ADR-12: Agent hot-path verification — PGlite+NestJS default, Supabase branch opt-in (#401)

**Decision:** Cloud agents and CI verify the Supabase hot path with **PGlite-backed NestJS tests as the default substrate** (Path C + Path D), and a **per-session Supabase branch as an opt-in escape hatch** (Path A) for work that genuinely needs Realtime, Storage, or the Edge runtime. A rootless in-sandbox Supabase stack (Path B) is **rejected**. The same substrate runs in CI and in the agent loop. This operationalises the testability that ADR-11 created; ADR-11 moved the logic, ADR-12 records how it is verified and where the branch escape hatch fits.

- **Default (C + D).** Hot-path logic lives in NestJS (ADR-11) and is unit-tested with PGlite (in-process Postgres-in-WASM): schema, constraints, and RLS are exercised deterministically in milliseconds with no daemon, no Docker, no privileged tooling. This is the substrate for both CI and in-loop verification and covers the data layer for most chunks.
- **Opt-in escape hatch (A).** When a task must observe Realtime / Storage / the Edge runtime, a real Supabase preview branch may be created for the session. It is **off by default**: it requires explicit opt-in, cost acknowledgement (`confirm_cost`), and a SessionEnd teardown that always deletes the branch so cost can't leak. The Supabase MCP write tools (`create_branch` / `apply_migration` / `delete_branch`) stay **un-allowlisted in `.claude/settings.json`** — they prompt, which unattended sessions cannot approve; the committed file has never carried a deny rule — until a session opts in.
- **Rejected (B).** Running the full Supabase Docker/`podman` stack rootless inside the sandbox is too flaky across providers (Docker-only Edge runtime, Elixir/Erlang Realtime, ~30 PG extensions without a tarball distribution; ~15–25 maint hrs/month) for too little gain over A.

**Context:** #401 (P0): cloud-agent sandboxes can't apply migrations to real Postgres, run Edge Functions, observe Realtime, or exercise the push worker, so chat-adjacent chunks shipped with unverified runtime paths. Four research spikes settled the trade-offs:

| Path | Verdict | Role |
| ---- | ------- | ---- |
| A — Supabase branch per session (#411) | adopt, opt-in | full hot path, in-loop when needed |
| B — rootless Supabase stack in sandbox (#412) | no-go | — |
| C — PGlite + Deno harness (#413) | adopt | CI + cheap in-loop data layer |
| D — hot-path logic into NestJS (#414) | adopt, strategic | makes C sufficient for most work |

**Consequences:** CI gains a PGlite migration + RLS smoke job (no live Postgres needed). The `pglite-migrations` job (`scripts/check-pglite-migrations.mjs`) applies every migration to a fresh in-process Postgres-in-WASM and runs an RLS smoke tier: every `public` table enables RLS (the default-deny invariant, #360), the chat hot-path tables hold their posture (`chat_channels`/`chat_messages` default-deny with no policies; `chat_message_actions` reaction policies scoped to `auth.uid()`), and `chapter_audit_log` stays append-only. It verifies policy *presence and shape* — enforcement as the `authenticated` role (`SET ROLE` + real JWT) stays out of this tier (#423) and lives in the NestJS Jest + hosted-Supabase tiers. Agents verify the data layer in-loop cheaply and deterministically and stop handing off blind on the data layer. Work needing the full hot path is explicit, opt-in, and self-cleaning, so the MCP write-tool security surface stays closed by default. Continuing the Edge→NestJS migration is load-bearing: the more hot-path logic lives in NestJS, the more PGlite alone suffices and the rarer the branch escape hatch is needed. Implementation is tracked in dedicated follow-up issues (PGlite CI job #531 — shipped, subsumes #356/#360; Path-A SessionEnd teardown + scoped allowlist #532; continued Edge→NestJS migration #533).

**Revisit-when:** PGlite proves insufficient for a recurring class of work (forcing the branch escape hatch to become routine), or Supabase branch cost/security posture shifts enough that Path A should become the default rather than an opt-in.

- **Amendment (2026-09-02, #423) — the PGlite tier now verifies enforcement black-box, for four tables.** The Consequences text above says the tier verifies policy *presence and shape* and defers enforcement to the NestJS tier. That was true when written and is now only half true: the harness stands up its own non-owner `rls_probe` role, stubs `auth.uid()`/`auth.role()` to a signed-in client, and reads the tables for real. `chat_message_actions` and `chat_messages` are asserted as exact visibility *sets* (#977, #974); `members` and `financial_invoices` are asserted to return **zero rows**, since neither carries a policy any client role can reach and both must stay default-deny — so a migration that adds a permissive policy to either turns the job red. **The change that made this work at all** is that the harness now creates the **`authenticated` role before applying migrations**. Roughly 18 migrations wrap policy and grant statements in `if exists (select 1 from pg_roles where rolname = 'authenticated')` — the repo's dominant idiom for anything targeting a client role, since the role exists on hosted Supabase but not in a bare Postgres. Without it, every one of those blocks was silently skipped and the harness validated a schema the hosted project does not run: a `create policy … to authenticated using (true)` written that way left the entire job green while handing every signed-in client every row of the table. Creating the role also means the `to authenticated` clause (`v_role_clause`, `20260803150000_chat_message_actions_membership_rls.sql:154-168`) is real here rather than empty, closing a gap `SECURITY_FIXES.md` had recorded as promotion-time-only.

  **A separate correction to the Consequences text, unrelated to enforcement:** it describes the chat posture as "`chat_channels`/`chat_messages` default-deny with no policies". That stopped being true for `chat_messages` on 2026-08-16, when `20260816140000_realtime_carrier_repair.sql` gave it the client-read `chat_messages_select` policy that is now the sole gate on Realtime chat delivery. `chat_channels` is still policy-less. Anyone adding a client read path over `chat_messages` should review that policy rather than assume the table is unreachable.

  **Two limits worth stating, because the Consequences paragraph will otherwise be read as fully superseded.** First, this is *four* tables, not all 50: a permissive policy added to any other RLS-enabled table still changes no assertion here, and the every-table invariant remains a presence check only. Second, there is still no `anon` **role**, so a policy whose `TO` clause names `anon` does not bind the probe — `auth.role()` *is* stubbed to `'anon'` for the unauthenticated scenarios, so predicates that test the role are exercised, but grant-level `to anon` targeting is not. A real GoTrue JWT — any claim beyond `sub`/`role` — also remains out of reach. Roster: [`AUTHORIZATION_MODEL.md`](../../docs/internal/security/AUTHORIZATION_MODEL.md) §RLS enforcement.

### ADR-13: Repository visibility — public → private on GitHub Pro (2026-05-31)

**Decision:** The `pdcarlson/Frapp` repository moved from **public** to **private**, on a **GitHub Pro** plan. Frapp is a commercial multi-tenant SaaS; the source, the issue backlog/roadmap, and implementation details are no longer publicly visible.

**Rationale:** Protect proprietary source (multi-tenant RLS model, Stripe billing, business logic); stop publicly exposing the roadmap (the issue backlog mirrored to GitHub was world-readable); reduce the source-disclosure attack surface. The project is effectively solo (one human collaborator + AI agents), so the open-source/community upside given up is negligible.

**Consequences:**

- **Branch protection and repository-level Actions secrets are unaffected** — both are available on private repos with Pro. The deploy pipeline resolves runtime secrets from Infisical at workflow time and uses only repo-level bootstrap secrets, so it keeps working.
- **The `production` environment's manual-approval pause is gone.** Required-reviewer **environment** protection rules are GitHub **Enterprise-only** on private repos. On Pro+private the `migrate-production` / `deploy-production` jobs no longer pause; the human gate is now solely the `main` → `production` promotion PR (branch protection: CI + an approving review + conversation resolution). Acceptable while solo. Docs updated: `deploy-api.yml`, `docs/internal/ops/DEPLOYMENT.md`, `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`, `docs/internal/ci-cd/AGENT_INFRA.md`, `spec/environments/README.md`.
  - **Correction (2026-08-28), recorded rather than rewritten — this consequence did not hold.** The pause is not gone. `migrate-production` was measured waiting **29m52s** to start on run [33184010470](https://github.com/pdcarlson/Frapp/actions/runs/33184010470) while unscoped and `staging`-scoped jobs in the same runs started in about two seconds; two `workflow_dispatch` runs waited 15m19s and 3m13s. Both premises this bullet rested on had already failed — the repo's visibility was corrected to **public** on 2026-08-21, so the private-repo exemption never applied. Canonical statement, evidence table, and the limits of that evidence: [`docs/internal/ci-cd/AGENT_INFRA.md`](../../docs/internal/ci-cd/AGENT_INFRA.md) § GitHub environments and bootstrap secrets. The decision below stands as taken; only this stated consequence was wrong.
- **GitHub Actions minutes are now metered** (public repos are unlimited; private on Pro includes 3,000 min/month, then per-minute overage). The CI suite is heavy. A dedicated CI-cost/efficiency audit is **deferred to its own effort** — intentionally not done in this change.
- **GitHub-native secret scanning, push protection, and code scanning stop** (public-repo-only / otherwise require paid GitHub Advanced Security). Mitigation: a local `gitleaks` pre-commit + CI check replaces the lost push protection — **implemented in ADR-17** ([`docs/internal/ci-cd/SECRET_SCANNING.md`](../../docs/internal/ci-cd/SECRET_SCANNING.md)).
- **The repository's past is already disclosed.** One public fork existed at flip time; GitHub detaches it into its own network (it is not retracted), and any prior clone retains the public history. A full-history secret scan on 2026-05-31 (provider-pattern + assignment-pattern across all 50 commits, plus a committed-file check) found **no leaked secrets**, so nothing required rotation — but treat all pre-2026-05-31 history as potentially public regardless.
- **CodeRabbit's free OSS tier no longer applies** — a private repo needs a paid CodeRabbit plan. Other integrations authenticate via the GitHub App / deploy hooks (Vercel, Render, EAS, Infisical, Claude Code on the web) and are unaffected by visibility.
- **Stars/watchers were erased** by the visibility change (cosmetic; the project had ~1 of each).

- **Correction (2026-09-05) — the repo is public again, so every consequence above that turns on
  private visibility has lapsed.** The bullets stay as written: they record what was decided and
  expected on 2026-05-31, and the reasoning is the part nobody can reconstruct. What is no longer
  true of the world is that the repo is private. It is public, **observed** 2026-08-21 by an
  unauthenticated `raw.githubusercontent.com` fetch returning HTTP 200 against a 404 control
  ([`AGENT_INFRA.md`](../../docs/internal/ci-cd/AGENT_INFRA.md) § GitHub environments and bootstrap
  secrets) and re-observed 2026-09-05 via the repository API (`"visibility": "public"`). **When the
  flip happened is not recorded anywhere**, and 2026-08-21 is the date someone first looked, not the
  date it changed — do not use it as the start of a public-exposure window. Consequently: GitHub-native secret scanning, push protection and code scanning are
  **available**, not stopped — the `secret-scan` gate is still required and still runs, but whether
  to adopt the native features as well, or instead, has not been decided; ADR-17's revisit trigger
  has fired and is unactioned. And Actions minutes are **not** metered. The CodeRabbit consequence is the
  one worth reading twice: its free OSS tier would apply again, and that constraint is exactly what
  ADR-14 gave as its reason for replacing CodeRabbit — so that decision rested on a premise that has
  since lapsed. It is moot only because the CI reviewer it introduced was itself abandoned on
  2026-06-04 in favour of a local pre-push gate, for reasons that had nothing to do with visibility.
  The required-reviewer bullet already carries its own dated correction above.

**Trigger to revisit:**

- The project open-sources again for adoption/marketing (would restore free Actions + GitHub Advanced Security and the public-tier integrations). **Fired, and unactioned (recorded 2026-09-05)** — the repo is public, so free Actions and the public tiers are already restored; see the dated correction above and ADR-17's matching trigger.
- Metered Actions cost exceeds budget (drives the deferred CI-efficiency audit). **Cannot fire as written (recorded 2026-09-05)** — Actions minutes are unmetered on a public repo. The audit this trigger deferred was not lost: it shipped the same day as **ADR-15**, which cites this 3,000-minute budget and lands five measured levers. ADR-15's own "savings still insufficient" trigger is the live one.
- Additional human collaborators are added — reconsider real approval gates (and whether GitHub Enterprise's private-repo environment protection is worth a true production-deploy approval pause).

### ADR-14: Code review — CodeRabbit → self-hosted Claude review GitHub Action (2026-06-01)

**Decision (2026-06-01):** Replace CodeRabbit with a self-hosted automated PR review running `anthropics/claude-code-action@v1` in GitHub Actions, gated by a required `claude-review-gate` check.

**Removed 2026-09-05.** The Decision, Rationale, Consequences and the 2026-06-01 / 2026-06-03 amendments described the CI reviewer's machinery — the two model tiers, the gate job and its commit-status plumbing across two event shapes, the override label, the fork/draft/no-token special-casing. **Every artifact they describe was deleted on 2026-06-04** (see the amendment below), so the text was operating instructions for a workflow that does not exist. What the log is for is kept here rather than in that detail:

- **Why CodeRabbit was dropped:** on a private repo its free tier posts summary-only, rate-limited reviews; the assertive line-by-line config this repo wanted needed Pro at ~$24/dev/mo. Frapp already pays for Claude, so an OAuth-token Action added no per-token bill.
- **Alternatives rejected in the 2026-06-03 market scan**, none clearly better under the constraints (free or ≤$10/mo flat, ~100 private PR reviews/mo, CodeRabbit-like UX): CodeRabbit Pro (~$24–30/mo, over budget); Gemini Code Assist's free GitHub reviewer (free and on Google infra, but its free tier was reported sunsetting ~2026-07-17); Greptile and Cursor BugBot (per-PR pricing); Qodo/PR-Agent self-hosted (still spends Actions minutes plus per-token).
- **Why it was abandoned rather than tuned:** even reconfigured to Opus-once-on-open, it carried disproportionate machinery for a solo repo, and per-push review drained both metered Actions minutes and subscription quota. The measured driver was the imminent **Max-5× → Pro downgrade, ~80% less quota** — a plan change, so do not read "drained quota" as a property of the plan in force today.
- **Evidence that anyone rebuilding this will need, and that exists nowhere else in the tree.** The gate deliberately did **not** key on the action's exit code, because of two upstream defects: **`claude-code-action#1299`**, a permanent-red-required-check failure mode, and **`#846`**, spurious non-zero exits. The workaround was a `--json-schema` `structured_output`, with a `<!-- claude-review-verdict: important=N sha=<head_sha> -->` marker as **fallback**, and a separate gate job failing only on `important > 0`. That gate **always reported a conclusion** (so a required check never hung "pending") and passed for bot/draft/fork/no-token/skipped runs — and it is that always-reporting property, not anything upstream, that avoided both defects. Drop it when rebuilding and the required check hangs on any run where the action dies before emitting a verdict; the `sha=` was added by **#599** so a prior commit's verdict could not mask a failed run. A second trap: an `issue_comment`-triggered run's implicit check-run attaches to the **default-branch head**, not the PR head, so the gate had to post an explicit commit status to the resolved PR head SHA. And the purpose-built **`claude-code-security-review`** action was rejected as **API-key-only** — it cannot authenticate with the subscription OAuth token this repo holds, which is why the general `claude-code-action` carried a custom prompt instead.

The live rule is the 2026-08-01 amendment below; the current gate is [`/diff-review`](../../.claude/skills/diff-review/SKILL.md). Runbook: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

- **Amendment (2026-06-04) — the CI Claude review is removed entirely; review moves to a local pre-push gate.** The GitHub Actions reviewer (`.github/workflows/claude-review.yml`), the `claude-review-gate` required check (and its `claude-review-gate-runner` job + `evaluate-review-gate.mjs` decision logic and tests), the `.github/claude-review/` rubric + learnings, and the `CLAUDE_CODE_OAUTH_TOKEN` dependency are **all deleted**. Even reconfigured to Opus-once-on-open, the CI reviewer was not working as designed and carried disproportionate machinery (gate status plumbing across two event shapes, the override label, fork/draft/no-token special-casing, branch-protection coupling). **Replacement:** a local Claude Code **PreToolUse hook** (`.claude/hooks/pre-push-review-gate.sh`, wired in `.claude/settings.json`) gates `git push` — the first push of each branch HEAD is blocked with guidance to run the built-in **`/code-review`** skill in-session on the diff; a HEAD-keyed, session-scoped sentinel makes it deny-once-then-allow (no loop), and a new HEAD (after committing fixes) re-gates so the review always covers what is pushed. This is now the **single** pre-PR review gate (the `/next` flow no longer runs `/code-review` as a separate step — the push hook drives it once). Review sub-agents inherit the session model (Opus): the `CLAUDE_CODE_SUBAGENT_MODEL` Sonnet pin is also removed from `.claude/settings.json`. **Trade-offs:** review now happens on the author's machine before the PR exists (no server-side enforcement on merge, and no inline GitHub review comments) — acceptable for a solo project where every PR is authored by an agent that runs the gate; and a PreToolUse hook can only *instruct* Claude to run `/code-review` (it cannot invoke a skill), so the gate reliably interrupts the first push per HEAD rather than hard-blocking. `claude-review-gate` is removed from `scripts/configure-branch-protection.mjs` and de-required via `npm run configure:branch-protection`. Runbook updated: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

- **Amendment (2026-07-30) — the gate is satisfied by `/diff-review`, a project skill.** ⚠️ **The premise stated in this amendment was measured wrong; see the 2026-08-01 amendment below for the corrected rule. The conclusion — keep `/diff-review` — still holds, for different reasons.** The 2026-06-04 amendment above assumed the hook could "instruct Claude to run `/code-review`". It cannot: `/code-review` is **author-locked against model invocation**. It has no file on disk — it is a native command compiled into the Claude Code binary with `disableModelInvocation` hardcoded at its registration site, and that lock resolves *before* user settings, clamping the skill to `user-invocable-only` at best. The sole escape hatch is the runtime `userTypedThisTurn` condition, so ~~only a human physically typing `/code-review` can run it~~ (**wrong — see below**); a `skillOverrides` entry is a verified no-op. In practice every agent session stalled at the gate waiting for a keystroke. **Replacement:** [`.claude/skills/diff-review/SKILL.md`](../../.claude/skills/diff-review/SKILL.md) — a project skill that is model-invocable (it simply omits `disable-model-invocation`) and reproduces the bundled workflow: scope the diff, fan out parallel finder subagents per angle, run **one independent verifier subagent per candidate** (`CONFIRMED`/`PLAUSIBLE`/`REFUTED`), then report once via `ReportFindings`. It additionally encodes repo-specific invariants as first-class angles — `chapter_id` scoping and chapter-scoped role lookups (load-bearing given ADR-13's application-layer-only isolation: RLS is enabled with no permissive policies and the API holds the `service_role` key that bypasses it), permission decorators, the PGlite migration gate, the doc-sync mandate, Linear-not-GitHub, and verification honesty. **Corrected 2026-09-05:** two of those angles no longer describe the skill. The tracker angle now reads the other way — issues are opened **on GitHub** with the `triage` label (Linear was retired 2026-08-08, amendment 5 of ADR-16); and the "doc-sync mandate" angle went with the coercive gate in #1597, replaced by a docs angle that reads a diff against `DOCUMENTATION_CONVENTIONS.md`. The rest of the sentence stands. Deliberately **not** named `code-review` (precedence against a native command is untraced, and a silent shadowing failure would make the gate look satisfied while nothing ran) and deliberately **not** `context: fork` (which would move `ReportFindings` into a subagent where the host UI cannot render it). **Trade-offs:** the gate is now self-certifying — the same agent writes the code and triggers its review — so the per-candidate verifier pass is what keeps it honest and must not be weakened; and we no longer inherit upstream improvements to the bundled reviewer. Humans should still prefer `/code-review`, which is richer (cloud `ultra` mode, `--fix`, `--comment`).

- **Amendment (2026-08-01) — `/code-review` is *conditionally* model-invocable; the 2026-07-30 premise was wrong.** Measured against Claude Code **2.1.220** (`AI_AGENT=claude-code_2-1-220_agent`). `disableModelInvocation` is real, but the runtime check is `disableModelInvocation && !userTypedThisTurn`, and `userTypedThisTurn` is **not** a keystroke flag: it scans the current turn for a message that is `type: "user"`, not `isMeta`, and matches the bare token `/code-review`. So an agent **can** call `Skill(skill: "code-review")` when the turn's prompt carries that token **whitespace-delimited on both sides**. ⚠️ **Precision fix (2026-08-02):** this amendment originally said "whenever the turn's prompt mentions it in prose", which overstates reachability. The regex is `(?<!\S)/code-review(?=$|\s)`, so backticks, surrounding quotes, `**bold**`, and a trailing `.` or `,` all **defeat** it — and backticking commands is this repo's own house style. Re-measured against the running 2.1.220 build: a session referencing `/code-review` eight times, every occurrence backticked, was still refused with `disable-model-invocation`. The conclusion below is unchanged and in fact strengthened — `/code-review` is reachable *less* often than the 2026-08-01 text implied, so `/diff-review` carries more of the load, not less. It **cannot** when the token is absent or only present in a rejected form, inside a sub-agent, from a slash-command expansion (skipped via `<command-message>` — so **never under `/next`**), or from a hook (all hook `additionalContext`, on every event, renders `isMeta: true`, so a hook can neither invoke a skill nor enable one). **Evidence:** both directions executed in one session — token present → a full forked review ran; token absent → `Skill code-review cannot be used with Skill tool due to disable-model-invocation`. The scan rule, the `isMeta` renderer and the check ordering were read out of the 2.1.220 bundle, not merely inferred from those two observations. **Consequence:** `/diff-review` is retained, but as *the always-reachable review* rather than *the only one* — `/code-review` is now preferred wherever it is reachable. Its remaining unique value is the Frapp-specific angle set; its generic half duplicates a harness that is tuned per model upstream (tracked separately for a measure-then-cut decision). `skillOverrides` remains a verified no-op: `disableModelInvocation` returns before that branch is reached. Version-pinning is not an escape either — the command did not exist in 2.1.42 (whose `pluginCommand: "code-review"` registers `/review`), and 2.1.220 was the latest published release at the time of writing.

**Trigger to revisit:**

- External human (non-agent) contributors are added, or PRs start landing without having gone through the local gate → reintroduce a server-side review/check on merge.
- Claude Code makes `/code-review` invocable *unconditionally* by an agent — i.e. without the current turn's prompt carrying the token, and from inside a sub-agent — or a hook-driven subprocess route (`claude -p "/code-review"`) proves reliable → retire `/diff-review` and point the hook at the bundled reviewer. **Note the 2026-08-01 amendment does not fire this trigger**: conditional invocability is not enough, because the `/next` flow can never satisfy the condition.
- The local-only model proves too easy to skip → add a CI check that the diff was reviewed, or restore a managed Code Review service if Frapp lands on a Team/Enterprise plan.

### ADR-15: CI cost — Actions-cache build dedup, Playwright/Docker caches, path-gating (2026-06-01)

**Decision:** Cut metered CI minutes (ADR-13: 3,000/mo on Pro) across `.github/workflows/ci.yml` **without changing any required status-check job name or re-running branch protection**. Five levers: (A) cache Turbo's `.turbo` via `actions/cache` — `packages-build` writes it and the six downstream jobs restore it read-only, turning each redundant `turbo run build --filter='./packages/*'` into a cache hit; (B) cache `~/.cache/ms-playwright` keyed on the resolved Playwright version in `web-visual-regression` (OS deps still install every run); (C) Docker layer cache via `docker/build-push-action@v6` `type=gha` for `api-docker-build` (build-only); (D) a `changes` job (`dorny/paths-filter`) path-gates the three **non-required** jobs (`web-tests`, `web-visual-regression`, `pglite-migrations`) on PRs while always running them on push; (F) `cancel-in-progress` concurrency on `docs.yml`/`links.yml` and dropping `fetch-depth: 0` on the jobs that don't diff git history. Build dedup uses the **GitHub Actions cache**, not Turbo Cloud or a self-hosted remote cache. Deferred: caching `node_modules` and path-gating the *required* jobs (needs a skip→success wrapper).

**Rationale:** The suite ran ~40 billable job-min/PR with ~7.5 min of pure redundant package rebuild across six jobs, and ADR-14's per-push review now also draws on the 3,000-min budget. The GitHub Actions cache keeps build artifacts in-house (no third-party egress, no new secret) — consistent with the ADR-13 protect-IP goal — at the cost of slightly more workflow YAML than Turbo Cloud. Keeping job names intact and not touching `scripts/configure-branch-protection.mjs` decouples this from the ADR-14 review-gate rollout (which stays un-required until verified green). Target: ~28 billable min/run, ~15 on scoped PRs.

**Consequences:**

- The three caches share the repo's ~10 GB Actions cache (LRU). `.turbo` is tiny and Playwright ~0.3 GB; the Docker `mode=max` cache (~1–3 GB) is the only real consumer — downgrade to `mode=min` if eviction is observed.
- First run after merge is a cold miss everywhere (expected, one-time). Turbo's own input hashing remains the correctness arbiter, so a stale `.turbo` never replays wrong output — a miss simply rebuilds as before. No correctness risk.
- `web-tests`, `web-visual-regression`, and `pglite-migrations` now **skip on out-of-scope PRs**; because they are not required checks, a skip cannot block merge, and every push to `main`/`production` still runs them in full. Filters are deliberately broad (`packages/**`, lockfile, `turbo.json`) to avoid missing a transitive dependency. *(Superseded for `web-tests` by the 2026-08-19 amendment: it is now required, and path-gating turned out never to have been in tension with that.)*
- The required checks are never path-gated and keep reporting on every PR; branch protection is untouched. *(ADR-14's `claude-review-gate` was removed in the 2026-06-04 amendment. The "never path-gated" half no longer holds — see the 2026-08-19 amendment.)*
- Fork PRs get read-only tokens, so the Docker `cache-to` export is a no-op there (the build still passes).

**Trigger to revisit:**

- Docker GHA cache evicting the smaller caches → `cache-to: type=gha,mode=min` (or scope/prune).
- Savings still insufficient → adopt a Turbo remote cache (reassessing the in-house-vs-Vercel privacy trade-off), path-gate the required jobs behind a skip→success wrapper, or cache `node_modules`.
- A required job is renamed/added/removed → update `scripts/configure-branch-protection.mjs` and re-run it.

- **Amendment (2026-08-19) — `web-tests` becomes a required check, and the "skip→success wrapper" premise was wrong.** `web-tests` is the **only** suite covering `packages/hooks`, `packages/ui` and `packages/chat-core`; the consolidation work now beginning edits `packages/hooks` directly, so leaving it advisory meant a broken shared hook could merge green. It is added to `CI_CHECKS` in [`scripts/configure-branch-protection.mjs`](../../scripts/configure-branch-protection.mjs).

  The original decision assumed path-gating and required-ness were incompatible — hence "path-gate the required jobs behind a **skip→success wrapper**" above, and the consequence note that these jobs are safe to gate *because* they are not required. **No wrapper is needed, and the two properties were never in tension for the form used here.** GitHub's [required-status-check troubleshooting table](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks) distinguishes two cases: a **workflow** skipped by path/branch filtering or a skip-commit-message leaves its checks "Pending" forever and **does** block merging; a **job** skipped by a conditional "reports Success". `success`, `skipped` and `neutral` all satisfy a required check. `web-tests` is gated by a job-level `if:` and `ci.yml` carries no workflow-level `paths:` filter, so only the benign case applies.

  One real caveat from the same table, and it is why **`changes` is now required too**: a job skipped because a `needs:` parent **failed** "may not block merging". `web-tests` needs `[packages-build, changes]`, and `changes` was not a required check — so a `changes` failure would skip `web-tests`, report `skipped`, satisfy the requirement, and merge with the only suite covering `packages/hooks` never having run. The trigger is real rather than theoretical: `changes` is the one CI job that calls the GitHub API (`dorny/paths-filter` lists the PR's files), so it can fail on a rate limit or an action-download error — the failure mode this repo already hit once on #659 — while `packages-build`, which shares none of that surface, stays green. GitHub's prescribed alternative, `always()` plus explicit `needs.*.result` assertions, is rejected here because `always()` keeps running through the `cancel-in-progress` cancellations this ADR exists to bank.

  **The general invariant, which nothing currently enforces: every `needs:` parent of a required check must itself be a required check.** `web-tests` is the first job in this repo to have needed it.

  `web-visual-regression` stays advisory (visual flake should not block merge) and `pglite-migrations` stays advisory. **Applying this needs a manual `npm run configure:branch-protection` run** — and note that run will *also* newly apply `chapter-directory-seed`, which has been listed in the script since #840 but was never pushed to the live config. Both were verified green on `main` first.

- **Amendment (2026-08-21) — `web-visual-regression` is deleted, and lever B now applies to `web-responsive-floor`.** The Playwright snapshot job this ADR path-gated (lever D) and browser-cached (lever B) no longer exists. Its spec, its sixteen committed baselines and the `test:visual` script went with it. The reason is the reason it was never a required check: baselines pinned to CI's Chromium build drift with every Playwright bump, so the job's red X was normally answered by regenerating the fixture rather than fixing the page — a cost on every UI change with no enforcement to show for it. The `~/.cache/ms-playwright` cache from lever B is unchanged but now has a single consumer, `web-responsive-floor`, which also ends the concurrent-writer race that produced a harmless "Unable to reserve cache" annotation on cold keys. Every sentence above naming `web-visual-regression` is historical — both the 2026-06-01 decision text and the 2026-08-19 amendment's "`web-visual-regression` stays advisory". Pixel coverage, if it returns, belongs in a hosted service with per-PR baseline review rather than PNGs in the repo — see [`QUALITY_GATES.md`](../../docs/internal/ci-cd/QUALITY_GATES.md).

- **Amendment (2026-08-20) — `web-tests` no longer covers a deleted unused UI workspace.** A later consolidation deleted the unused shared UI workspace under `packages/` (zero importers; dashboard primitives live in `apps/web/components/ui/`; landing uses inline Tailwind). `web-tests` still uniquely covers `packages/hooks` and `packages/chat-core` plus `apps/web`. The 2026-08-19 required-check rationale is unchanged for those remaining suites. The 2026-08-19 text naming the deleted workspace is historical.

- **Amendment (2026-09-02) — lever (A) is now one composite action, and it has seven consumers, not six.** The decision text above says `packages-build` writes the cache and *"the six downstream jobs restore it read-only."* It is **seven** — `lint-and-typecheck`, `api-tests`, `web-tests`, `api-contract-check`, `dependency-cruiser`, `mobile-validate` and `web-responsive-floor`; the last was added after this ADR was written and nothing caught the count. All eight call sites (one producer, seven consumers) now `uses: ./.github/actions/turbo-packages-build`, the repo's first composite action, per stage 4 of the CI/CD redesign (#1382). The producer passes `save: "true"` and gets `actions/cache`, whose post-job hook writes `.turbo` back; consumers get `actions/cache/restore`, which has no post hook and so cannot race the producer for the same key — the split the eight hand-written blocks already made, now stated once. Collapsing to `cache/restore` + a conditional `cache/save` was considered and rejected — not on cost, which is identical either way (four declared steps, three run for a consumer), but because it cannot express `actions/cache`'s `post-if: success()`, and this extraction is meant to preserve the eight blocks' semantics exactly. **The cache key is byte-identical**, so existing entries stay warm.

  **This buys no CI minutes, and it is worth being explicit about that under a cost ADR.** Key, producer/consumer split, `path` and build command are all unchanged, so hit rates are unchanged; the change is drift prevention, and it costs one extra step per job. Nor is the drift it prevents a *cold rebuild* — an earlier draft of this amendment said so and was wrong. Because `restore-keys` keeps the shared `turbo-pkgbuild-<os>-` prefix, a consumer whose exact key drifted would still restore the producer's most recent `.turbo` through the prefix, and turbo's own content hashing would still hit for unchanged packages: a stale-but-useful cache, not a cold build. A true cold rebuild needs the prefix itself to drift. The reason to single-source it is that either failure is **silent** — a cache miss is not an error — not that it is catastrophic. `clean-checkout-typecheck` and `web-production-build` deliberately do **not** use the action; their in-file comments say so, [`AGENT_INFRA.md`](../../docs/internal/ci-cd/AGENT_INFRA.md) repeats it, and `scripts/ci/__tests__/turbo-packages-build-action.test.mjs` fails if either acquires it.
- **Amendment (2026-09-02) — the apply named above is a human step, and the bare command is no longer the narrow delta it describes.** Read "**Applying this needs a manual `npm run configure:branch-protection` run**" in the 2026-08-19 amendment as a record of what that rollout needed, not as a vetted command to run today. `npm run configure:branch-protection` with no flags prints `Mode: LIVE` and **PUTs the whole protection payload**, built from the roster arrays exactly as they stand at the moment it runs — not the small delta the 2026-08-19 text describes. Those arrays have changed since: `web-production-build` was added and `migration-drift` was swapped for `migration-order` in [`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs), so an apply today writes today's roster, whatever it has become. **Applying is a human step, run with an admin PAT, by policy.** From an agent session, run **`npm run configure:branch-protection:verify`** — it reads live protection back and diffs it, writes nothing, and exits non-zero on any difference — **and nothing else**. And note that `npm run configure:branch-protection --dry-run` is *not* a dry run: without the `--` separator npm swallows the flag, the script sees no argv, and it applies. `npm run configure:branch-protection -- --dry-run` is the form that does not write.

### ADR-16: Project management — retire the in-repo backlog, adopt Linear as canonical (2026-06-01)

**Decision (2026-06-01):** Adopt **Linear** as Frapp's canonical project-management system and retire the in-repo markdown backlog (`docs/backlog/`).

**Removed 2026-09-05.** The Decision, Rationale, Consequences, Trigger to revisit and amendments 1–3 described operating Linear: the cut-over steps, the MCP probe results, Cursor's key-led automation, and how the 250-issue cap bound on active rather than Backlog issues. **Linear was retired on 2026-08-08** (amendment 5 below) and the workspace is gone, so none of it describes anything that exists. Kept, because it is the part nobody can reconstruct:

- **Why the flat-file backlog was retired:** diff-able and agent-readable, but a poor human PM surface — no board, no prioritisation UI, manual reconciliation, and it went stale as fast as the code.
- **Alternative rejected:** GitHub Projects, which had been rejected once before and was unreachable from the cloud agent (no Projects MCP tool, no `gh` CLI in the web sandbox).
- **The escape hatch it named, never evaluated:** the deleted Trigger to revisit listed "cost or team changes make a different tool (or **self-hosted Plane**) preferable". Plane was the direction to move *toward* if cost changed — it was never assessed and never rejected. Do not read it as ruled out.
- **The risk that materialised:** the decision recorded MCP availability as its main risk and mitigated it by keeping GitHub Issues as a synced always-available surface. That mitigation is what made the 2026-08-08 retirement cheap — Linear's MCP write tools requiring a manual permission step per call is what finally forced it.
- **Dated measurements the deleted amendments carried**, kept because they are evidence rather than narration. Amendment 3's cap finding, verified via `/next` on **2026-06-03**: the workspace held **276 non-archived issues — 260 Backlog, ~2 active** — and issue creation still succeeded at 276, which is how the 250 cap was established as binding on *active* (Started + Unstarted) rather than on the Backlog. Amendment 2's probe established that a headless Cursor background agent had **no Linear MCP and no injected credentials**, which is the only reason a `LINEAR_API_KEY` (a Cursor cloud-agent secret, used against `https://api.linear.app/graphql`) was ever minted — it is dead and marked for revocation in [`AGENT_CREDENTIALS.md`](../../docs/internal/environment/AGENT_CREDENTIALS.md). Amendment 1 also recorded a non-Linear fact: `/triage`, `/status` and `/next-task` were deleted and replaced by `/next`.

Work tracking today is **GitHub Issues** — see amendment 5 and [`GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md).

**Read amendments 4–7 below with one caveat each way.** Amendments **5–7 are current**. Amendment **4 is not**: it predates the Linear retirement by five days, so it still calls the routines "Linear Issue Curator"/"Linear Triage", names `.claude/skills/linear-curator/` and `linear-triage/` (renamed since to `issue-curator/` and `issue-triage/`), and its "Unchanged and reaffirmed" bullet states *"issues are born in Linear, never GitHub"* — **which amendment 5 explicitly reverses**. What survives from amendment 4 is that the automations moved to Claude Code Routines and Cursor was retired. It also cites amendments 1–3 by number in four places; those are removed, and what they said is: (1) the original keyless MCP access model, (2) a `LINEAR_API_KEY`/GraphQL exception to it, and (3) that Linear's 250-issue cap bound on *active* (Started + Unstarted) issues rather than Backlog — a cap that no longer applies to anything, GitHub Issues having none.

#### ADR-16 amendment 4 — backlog automations move to Claude Code Routines; Cursor retired (2026-08-03)

The two backlog automations no longer run on Cursor. Development has consolidated on Claude Code, so
the **Linear Issue Curator** and **Linear Triage** flows now run as scheduled **Claude Code
Routines** — fresh cloud sessions in the same web environment as interactive work, on the same
staggered daily cadence.

- **Keyless again — amendment 1's access model is restored.** Routine sessions inherit the
  environment's injected **native Linear MCP**, so amendment 2's `LINEAR_API_KEY`/GraphQL exception
  (a workaround for a headless sandbox with no MCP) is retired along with the platform that required
  it. The key can be revoked; if the MCP is unavailable at fire time the routine stops and reports —
  no key fallback.
- **Behavior contracts moved into the repo's skill layer:** `.claude/skills/linear-curator/SKILL.md`
  and `.claude/skills/linear-triage/SKILL.md`; the `.cursor/` tree is deleted and the task playbooks
  it held migrated to `.claude/skills/` as well. Runbook + paste-ready Routine prompts:
  [`docs/internal/ci-cd/ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md) (formerly
  `CURSOR_AUTOMATIONS.md`; amendment 1–2 links repoint there).
- **Amplified in the move:** a fourth curator discovery lens (live runtime signals — Sentry, Supabase
  advisors, CI — through the MCPs the environment injects); a per-issue **Agent brief**
  (`depth:` / `model:` / `ultracode:`, defaulting to `depth:deep`) that the curator writes, triage
  backfills, and `/next` honors when scaling verification and review depth (policy:
  `LINEAR_PM.md`, now [`GITHUB_PM.md` → Agent briefs](../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode));
  a triage board-health report each run; and a bounded **self-maintenance contract** — each routine
  verifies its own config against the live workspace and may open a **docs-only PR restricted to its
  own skill files and runbook**, the routines' only permitted repo write.
- **Unchanged and reaffirmed:** issues are born in Linear, never GitHub; the `suggestion` ownership
  boundary with the pre-write label gate; the conservative net-new budget and the active-scoped cap
  guard (amendment 3); routines never touch product code.
- Legacy `<!-- cursor-suggestion: … -->` dedup markers in existing issue bodies stay valid (dedup
  matches on the `fp=` string); new filings embed `agent-suggestion`, and old bodies upgrade
  opportunistically when refreshed. *(Superseded 2026-08-20 on form only: the marker is now a
  **visible line** rather than an HTML comment, because the GitHub MCP read has repeatedly deleted
  comments — hiding the marker from the search index too. That has since recovered (2026-09-05) but
  the visible-line form stays, because the defect has flipped four times and a visible line costs
  nothing. The `fp=` grammar and the dedup rule are unchanged, and comment-form markers remain
  valid. See [`GITHUB_PM.md` → Reading a body you
  intend to rewrite](../../docs/internal/ci-cd/GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity).)*

#### ADR-16 amendment 5 — Linear retired; GitHub Issues becomes canonical (2026-08-08)

**Decision:** retire Linear entirely and make **GitHub Issues** on `pdcarlson/Frapp` the canonical
tracker. Owner-approved 2026-08-08, conditional on a viability test that passed: GitHub issue
writes from a **fresh** cloud sandbox ran prompt-free (owner-observed — the only valid instrument
for permission behavior), because the cloud harness pre-approves the whole GitHub MCP
(`mcp__github__*` in its `--allowed-tools`). Linear's write tools, by contrast, prompted in every
cloud session, and three shipped workarounds (#667 server-level allows, #669 connector-UUID
allows, #676 PreToolUse auto-allow hook) failed — each with an invalid verification claim, since
an agent cannot observe permission prompts. Decision record, probe table, and migration mapping:
[#680](https://github.com/pdcarlson/Frapp/issues/680).

- **This reverses amendment 4's "issues are born in Linear, never GitHub" rule**: issues are now
  born on GitHub with the `triage` label. Board states become label conventions
  (`triage`/`P1`–`P4`/`in-progress`/`in-review` + native `state_reason` on close); epics use
  native sub-issues; `Fixes #N` closes work on merge with no sync layer at all.
- **Migration shape:** all 206 open GitHub issues were already 1:1 twins of open Linear issues
  (the June import + one-way GitHub→Linear sync); the 60 Linear-born issues without twins were
  recreated on GitHub; priority labels were applied across the open set. Nothing was closed by
  the migration.
- **Carried over unchanged:** the `suggestion` ownership boundary and pre-write label gate, the
  Agent brief, the `fp=` dedup markers, the conservative net-new budget, the three Routines
  (renamed **Issue Curator** / **Issue Triage** / PR Follow-ups; skills at
  `.claude/skills/issue-curator/`, `.claude/skills/issue-triage/`), and the `/next` claim
  protocol (claims are still comments; GitHub comments are append-only and server-timestamped).
  Amendment 3's 250-active cap accounting is moot — GitHub has no cap.
- Policy doc: [`GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md) (replaces `LINEAR_PM.md`);
  runbook: [`ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md).

#### ADR-16 amendment 6 — a fourth Routine, and the first that fixes instead of files (2026-08-21)

**Context:** amendment 5 carried over *three* Routines, all of which file GitHub issues and none of
which edit docs. Documentation drift was left to `check-our-docs`, a mid-task habit with the
coverage of whatever a session happened to read, so the low-traffic runbooks a cold session most
needs were never swept. Routing that debt to the tracker instead did not work: well over half of
all `area:docs` issues ever filed were still open, roughly a third of the open ones were
five-minute fixes on the day they were filed, and several had never been touched since.

**Corrected 2026-09-05:** `check-our-docs` was retired. The paragraph above records what was true
on 2026-08-21; that responsibility now sits in the documentation standard
([`DOCUMENTATION_CONVENTIONS.md`](../../docs/internal/DOCUMENTATION_CONVENTIONS.md)) and in the
docs angle of [`diff-review`](../../.claude/skills/diff-review/SKILL.md).

**Decision:** add a fourth Routine, **Docs Upkeep** (`.claude/skills/docs-upkeep/`), weekly on
Wednesday. It sweeps a calendar-derived rotating fifth of `docs/` and `spec/`, verifies the claims
a machine can settle, and **fixes them in a docs-only PR**. It is explicitly forbidden from opening
`area:docs` issues — anything not fixable in a docs edit goes in its run report to the owner.

**What this changes and what it does not.** It widens the *scope* of the self-maintenance docs-only
PR from a routine's own skill files to `docs/`, `spec/` and the root guides. It does **not** relax
the product-code ban, the never-self-merge rule, the one-PR-per-run cap, or the pre-push review
gate. It inverts the report-don't-fix posture scheduled routines had inherited (from the
retired `check-our-docs` skill's §"Inside a scheduled routine" — see the Context above) and
[`audit`](../../.claude/skills/audit/SKILL.md)'s read-only posture **for this routine only**; the
other three still file rather than fix. **Corrected 2026-09-05:** this amendment also said "ADRs
stay append-only — the routine may not rewrite one to match today's code." That carve-out is
revoked (ADR-18); ADRs are ordinary docs, and this routine corrects a wrong one in place like any
other.

- Runbook: [`ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md).

#### ADR-16 amendment 7 — a fifth Routine, and the first that edits product code (2026-09-02)

**Context:** amendment 6 left four Routines that between them keep the tracker and the docs
honest and never touch product code. Code hygiene had the problem docs had before amendment 6:
the Curator's engineering lens *files* it, and filed hygiene ages. The repo has no dead-code
tooling at all; its anti-pattern catalogue (the rule sections of `spec/engineering.md`) is
enforced only by whoever happens to be reading; `dependency-cruiser` carries seven grandfathered
violations that "exist to shrink"; and `jscpd` is a repo-wide percentage that only ratchets down
when someone consolidates. A first scheduled sweep landed with #1539 as a skill plus eight fixes,
without a runbook entry or an ADR, so the docs contradicted the repo: `ROUTINES.md` still said
four routines under a product-code ban that the fifth skill on `main` broke. Its fixes also showed
what an ungrounded sweep does: it traded one domain-layer import for a try/catch at four sites,
three of them byte-identical (then filed #1538 to dedupe those three), restyled a line of the
frozen `apps/landing`
surface on the strength of an "established idiom" that exists nowhere in the repo, and moved a file
out of a grandfathered violation without shrinking the baseline.

**Decision:** add a fifth Routine, **Hygiene Scan** (`.claude/skills/hygiene-scan/`, replacing the
#1539 skill), daily at 06:00 ET on **Fable 5.1**. It grounds itself first — the engineering
standard, the tech-debt protocol, the Signet-vs-legacy line, the app skill for the day's area, the
gates and their baselines, the ledger of prior runs — then reads a calendar-derived fifth of the
codebase *whole*, never just the recent diff, questioning legacy shapes rather than patching
around them, and **fixes one bounded, verified theme in a product-code PR** that a human merges.
What it will not fix unattended it files through `file-follow-up` (capped per run) or records in a
`routine-state` ledger issue so the next run does not re-litigate it.

**What this changes and what it does not.** It lifts the product-code ban **for this routine
only**, and only for repair: whole-pattern fixes that delete what they replace, leave the codebase
net simpler, and are proven by typecheck, lint, the workspace tests and the gates that cover the
change. It keeps every other rule — never self-merge, one PR per run, at most one open PR at a
time, the pre-push review gate, no migrations, no CI workflows, no dependency bumps, no visual
change on a frozen surface, no behaviour change except a bug fix carried by a failing-then-passing
test and called out on its own. It also makes the first exception to the 2026-08-21 "cadence sets
the tier" model convention: this daily routine runs on the top tier because editing product code
unattended is where a weaker judgement is most expensive.

- Runbook: [`ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md).

### ADR-17: Secret scanning — gitleaks pre-commit + CI gate (2026-06-03)

**Decision:** Implement the ADR-13 secret-scanning mitigation with [`gitleaks`](https://github.com/gitleaks/gitleaks) at three layers that share **one pinned binary and one `/.gitleaks.toml`** (`[extend] useDefault = true` + a tight allowlist), all routed through `scripts/scan-secrets.mjs`: (1) a **pre-commit hook** (`.githooks/pre-commit`, wired via `core.hooksPath` by the root `prepare` script `scripts/setup-git-hooks.mjs` — zero new npm deps) scanning staged changes; (2) **`npm run ci:local-gate`**, which now range-scans the branch's commits; and (3) a **`secret-scan` CI job** in `ci.yml` — fast and standalone (no `npm ci`; fetches the pinned binary via the checksum-verified `scripts/install-gitleaks.sh`), scanning only the PR/push commit range and registered as a **required check** in `scripts/configure-branch-protection.mjs`. The adoption-time claim that a full-history audit found no existing leaks, so no baseline ships, **no longer holds**: the 2026-08-15 audit (#851) found five historical findings — all triaged as false positives, none rotatable — so **a `/.gitleaks-baseline.json` now ships** with those five accepted fingerprints, generated `--redact` (no secret values). Without it the audit command exits non-zero on every run. Do not delete it as a stray artifact; regenerate it only alongside a new audit-record entry, and only from a clone with the full ref set. Runbook: [`docs/internal/ci-cd/SECRET_SCANNING.md`](../../docs/internal/ci-cd/SECRET_SCANNING.md).

**Rationale:** ADR-13 removed GitHub-native secret scanning + push protection (GHAS-only on private), and ADR-14's Claude review is not a reliable secret scanner. gitleaks is the de-facto OSS scanner: a single static binary, no service or per-token bill, with a maintained default ruleset for common provider/assignment patterns. **CI is the real server-side enforcement** that replaces push protection (a pre-commit hook alone is bypassable with `--no-verify`); the hook is the fast local primary that keeps most secrets from ever being committed. A **raw pinned binary** is used over `gitleaks/gitleaks-action` so local and CI run the identical version + config (no drift), stay license-free, and match the repo's hand-rolled `run:`-step CI. Scanning only the **commit range** (not full history every run) respects the ADR-13/ADR-15 metered-minutes budget — the job needs no `npm ci` and adds well under a minute.

**Consequences:**

- A new **required** `secret-scan` check, rollout-gated like the ADR-14 review gate: codified in `configure-branch-protection.mjs` but enforced only once the job exists on the target branch and has run green (applying branch protection is a manual PAT step). Until applied it still runs and surfaces failures, just non-blocking.
- Devs get the hook automatically on `npm install` (the `prepare` script sets `core.hooksPath`). The binary lands in a gitignored `.cache/gitleaks/` on first scan, or any `gitleaks` on `PATH` (e.g. Homebrew) is used. Offline, the hook/local-gate degrade to a warning (`--soft-missing`); CI is the hard gate. Emergency bypass: `git commit --no-verify`.
- False positives are managed via inline `gitleaks:allow`, a tight `/.gitleaks.toml` `[allowlist]`, or `/.gitleaks-baseline.json` (auto-detected) — the baseline is no longer hypothetical: one ships, with five accepted fingerprints, and deleting it turns the audit command red. The pinned version lives once in `scripts/install-gitleaks.sh` (`GITLEAKS_VERSION`); bumping it updates all three layers.

**Trigger to revisit:**

- The repo re-opens or adopts GitHub Advanced Security → native push protection returns and the CI job can become redundant. **Fired, and unactioned (recorded 2026-09-05).** The repo is public — observed 2026-08-21 and again 2026-09-05; the date of the flip itself is not recorded. Nobody has evaluated whether to adopt the native features. The `secret-scan` job remains required either way — see [`SECRET_SCANNING.md`](../../docs/internal/ci-cd/SECRET_SCANNING.md).
- Recurring false positives or a need for shared org config → tune `.gitleaks.toml`, re-baseline (a baseline is already adopted), or move to a managed scanner.
- Metered-minute pressure → the job is already minimal, but it can be folded into an existing job or made `paths`-aware. **Cannot fire as written (recorded 2026-09-05)** — minutes are unmetered while the repo is public.

### ADR-18: Agent operating docs — recurring rules vs one-off records; spec vs code (2026-08-19)

**Decision:** Split agent operating knowledge by half-life.

- **`AGENTS.md`** holds only rules that are (1) recurring, (2) still true, and (3) something an agent would not derive by reading the code. Target: short enough to load every session (~200 lines).
- **ADRs** in this file record one-off incidents and decisions — what was decided, and the reasoning that made it the decision. They are ordinary documentation, governed by [`DOCUMENTATION_CONVENTIONS.md`](../../docs/internal/DOCUMENTATION_CONVENTIONS.md) like every other doc: when an ADR says something that is no longer true, correct it in place and date the correction. **Corrected 2026-09-05** (this bullet, edited in place under the rule it now states): it previously read "ADRs in this file are the immutable, append-only log of one-off incidents and decisions. Never edit an ADR in place; supersede it with an amendment or a new ADR." That append-only rule is revoked — it was keeping known-wrong sentences in the log, including dead command names an agent would try to run. Amending or superseding is still the right shape when the *decision* itself changes; it is no longer required to fix a *wrong sentence*. Two things the ordinary standard still requires here: evidence (dated records, run links, run ids, the command behind a figure) is not discarded when a claim around it is corrected, and ADR numbers and headings are cited across CI workflows, scripts and tests with nothing validating them, so renaming one is a rename like any other: sweep for what points at it first. Incident narration (dated outages, specific PR numbers, permission-tool archaeology) lives here, not in `AGENTS.md`.
- **Skills** under `.claude/skills/` hold task playbooks (including filing follow-up issues). **Commands** under `.claude/commands/` hold user-invocable procedures (`/next` stays a command).
- **Spec vs code:** `spec/` is the source of truth for *intended* behavior; code is the source of truth for *current* behavior. Disagreement is a tracked bug to file, not silent agent discretion.

**Rationale:** `AGENTS.md` had grown into a mix of durable rules, one-off incident write-ups, and a 60-line issue-filing playbook. Agents either drowned in archaeology or treated a stale spec sentence as current behavior (or the reverse). The three-way split matches how the knowledge is actually used: always-on constraints, historical decisions, and on-demand playbooks.

**Consequences:**

- A new "we hit X, don't do Y" story is an ADR (or an amendment), not a paragraph in `AGENTS.md`, unless it meets the three-part graduation test.
- `README.md`, `spec/behavior/README.md`, and `spec/README.md` use the same spec-vs-code formulation. Do not reintroduce "the spec is the single source of truth" or "code is ground truth for behavior; docs are ground truth for intent" as competing slogans.
- Filing follow-up work lives in `.claude/skills/file-follow-up/SKILL.md`. Routine ownership boilerplate lives once in [`ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).

**Trigger to revisit:** `AGENTS.md` grows past ~200 lines again, or a rule in it is no longer true.

---

### ADR-19: Retire the `production` branch — deploy a named commit from `main` (2026-08-28)

**Decision:** Delete the `production` branch. Production is deployed by dispatching
`.github/workflows/deploy-production.yml` with an explicit commit SHA, gated by the
`production` GitHub Environment's Required reviewers.

**Context.** The two-branch model made a *branch tip* the deployable artifact, and nothing
in the flow ever named a commit. Three consequences, all measured rather than argued:

- `frapp-api-prod` was configured `autoDeploy: yes` / `autoDeployTrigger: commit`, so a
  push to `production` deployed **without waiting for CI**. `deploy-api.yml`'s green-CI
  gate governed only its own deploy hook.
- The human gates were both in the wrong place: the promotion PR's required review, and
  then the environment approval after merge on a click nobody was paged for. The second
  held a one-migration apply for 29m52s on 2026-08-28 (ADR-13 amendment, and
  `docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap secrets).
  Neither happened at a moment when anyone knew whether the migration would apply.
- A second long-lived branch cost `branch-policy`, a `[main, production]` filter on five
  workflows, an asymmetric branch-protection payload, and a `pr-base-guard` case — all to
  police a branch that carried **no unique file content**: `origin/production` (`95b489a`)
  had a tree byte-identical to `690aed9` on `main`.

**What replaced each piece.**

| Was | Is |
| --- | --- |
| `branch-policy` required check (PR into `production` must come from `main`) | `git merge-base --is-ancestor` in `scripts/ci/validate-deploy-sha.mjs` |
| Branch protection's required status checks on the promotion PR | The same `ALL_REQUIRED_CHECKS` list, asserted against the checks API for the exact SHA |
| Promotion PR's 1 required approving review | The `production` environment's Required reviewers, which pause the deploy itself |
| Render auto-deploy from `production` | `POST /v1/services/{id}/deploys` with `commitId` |
| Vercel Production Branch = `production` | `POST /v13/deployments` with `target: production` and a `gitSource` sha |
| `release.yml` on `push: [production]`, reading the merge-commit message | `workflow_call` from the deploy, reading `release:*` labels on every PR since the last tag |

**Consequences.**

- The deploy workflow is a **single job** on purpose: every environment-scoped job costs
  its own Approve click, so splitting it would silently turn one approval into four.
- A `v*` tag now means "this is live" — it is created after Render and Vercel report
  healthy, on the deployed SHA — where it used to mean "this merged and we hoped".
- Release labels moved from one promotion PR onto **every** PR. An unlabelled
  `release:major` change now ships as a patch.
- Two settings are load-bearing, dashboard-only, and **fail open**: Render auto-deploy
  must stay off, and neither Vercel project's Production Branch may be `main`. They cannot
  be enforced from this repository, only asserted — `scripts/ci/production-guardrails.mjs`
  does so on a schedule and again as a preflight before every deploy. Leaving Vercel
  pointed at the now-deleted `production` branch is the *safe* state.
- `migrate-production.yml` survives as the code-free escape hatch, and is now explicitly
  the weaker path: it does not rehearse the migration, where the deploy workflow does.
  - **Correction (2026-08-29), recorded rather than rewritten — this consequence was
    reversed.** `migrate-production.yml` has been **deleted**. Keeping a code-free path
    that skipped the rehearsal turned out to mean keeping the most dangerous workflow in
    the repository as a backup for the safest one: it took an arbitrary `ref` and skipped
    SHA validation, the provider guardrail preflight, the replay and the working-tree
    fence. Its stated reason for skipping the rehearsal — that reconstructing production's
    state is least dependable once something has gone wrong — does not hold: the state
    that cannot be reconstructed is a *foreign* migration, and a foreign migration blocks
    `supabase db push` outright anyway, so the rehearsal was not what would have failed,
    it was what would have said so first. The capability survives as
    `deploy-production.yml`'s `scope: migrations-only` input, which keeps every gate. What
    is genuinely given up is applying migrations from a ref that is not an ancestor of
    `main`, or from a commit whose CI was not green. Both were worth losing. The decision
    below stands as taken; only this consequence was reversed.
- ADR-13's consequence bullet ("the `production` environment's manual-approval pause is
  gone") and its 2026-08-28 correction both stand as written. This ADR does not revise
  them; it records that the pause was **kept deliberately** and is now the only human gate.

- **Amendment (2026-09-02) — the Vercel half of this ADR is superseded by ADR-21.** The owner
  disconnected both Vercel projects from Git — `frapp-landing` on 2026-09-01, `frapp-web` on
  2026-09-02 — so the "Vercel Production Branch = `production`" row above and the consequence that
  "neither Vercel project's Production Branch may be `main`" no longer describe anything the API
  exposes: with no Git link there is no Production Branch setting and no auto-deploy-from-push path
  at all, and Vercel's `list_projects` reports `link: null` for both projects. Of the two
  load-bearing, dashboard-only, fail-open settings, **one remains asserted** — Render auto-deploy
  must stay off. The Vercel one is not gone from the world, only from the API: the unlink is itself
  unversioned dashboard state that a re-link would undo, which is why the fix tracked in **#1579**
  is to **invert** `assertVercelProductionBranch` — a *present* Git link becomes the violation —
  rather than to delete it. Both statements stand as the record of what was true on 2026-08-28;
  ADR-21 is the canonical record of what replaces them and of the breakages the unlink left live.

**Trigger to revisit:** collaborators are added (a merge-time review may then be worth its
cost again), or a provider gains a writable API for the settings the guardrails can only
assert.

---

### ADR-20: CI/CD pipeline redesign — production-shaped CI, one path to production, a six-stage program (2026-08-30)

**Decision:** Rebuild the deployment pipeline rather than patch it, in six sequenced stages, each
independently valuable and revertable. Stages 1–2 are merged (#1374, #1378); stage 3 is this ADR and
the standard it points to. The program is tracked in **#1381**, a GitHub `[Epic]` with one sub-issue
per remaining stage (#1382, #1383, #1384), not a document.

**Context.** Production deploy run
[33275321347](https://github.com/pdcarlson/Frapp/actions/runs/33275321347) applied migrations and
shipped the API, then skipped both frontends and skipped the release job — leaving production split
across two commits with no tag recording what was live. Investigating it surfaced a class of
defect rather than a bug: CI proved that code compiled and tests passed, and asserted nothing about
the thing being deployed or the databases receiving it. Patching the immediate failure would have
left that premise intact, so the pipeline was taken as the unit of change instead. The eight
decisions below were taken between 2026-08-28 and 2026-08-30 and are recorded here because they are
the ones a later reader would otherwise re-litigate.

| # | Decision | Date | Why |
| --- | --- | --- | --- |
| 1 | Leave production blocked rather than hand-unblock it, until the pipeline fix landed | 2026-08-29 | Hand-unblocking would have spent the one forcing function that made the redesign urgent, and would have deployed through the path under suspicion |
| 2 | Defer production backups to stage 5, as an accepted risk | 2026-08-29 | `db-backup.yml` covers staging only, and the free tier has neither PITR nor daily backups. Until stage 5, a `frapp-prod` data-loss event is **unrecoverable**. Recorded as a risk taken knowingly, not an oversight |
| 3 | Make CI production-shaped; leave staging preview-based | 2026-08-29 | `web-production-build` builds `apps/web` and `apps/landing` under `npm ci --omit=dev`, matching Vercel's production install. Staging keeps preview builds, so a build-shape difference between the two environments persists — a recorded trade-off, not a bug to rediscover |
| 4 | Six stages, sequenced, each independently valuable and revertable | 2026-08-29 | A single change large enough to carry all of it could not be reviewed or reverted; the sequence is what makes the scale safe (`spec/engineering.md` § Changing existing code) |
| 5 | Demote `migration-drift` from required to reporting-only | 2026-08-30 | It measures whether staging is behind `main` — a question no PR contains or can change. As a required check it was a merge-freeze switch, not a gate: on 2026-08-29 it turned every open PR unmergeable over state none of them touched. Detection is not lost; `check-migration-drift.yml` covers both environments daily |
| 6 | Delete `migrate-production.yml`; give `deploy-production.yml` a `scope: full \| migrations-only` input | 2026-08-30 | The deleted workflow took an arbitrary `ref` and skipped SHA validation, the guardrail preflight, the replay and the working-tree fence — the most dangerous path in the repository, kept as a backup for the safest one. ADR-19's 2026-08-29 correction records the same reversal from the other side; this row is the decision as taken, that correction is its effect on ADR-19 |
| 7 | `--include-all` exists as a human-only recovery flag no workflow sets | 2026-08-30 | It discards the ordering guarantee `migration-order` exists to enforce. `run-migration.mjs` refuses it under `CI=true` unless `MIGRATION_ALLOW_INCLUDE_ALL` is set; recovery is deliberately human |
| 8 | The master plan lives in GitHub tracking issue **#1381**; the durable standard is written before any further CI refactoring | 2026-08-30 | `docs/internal/DOCUMENTATION_CONVENTIONS.md` hard rule 3 bans narrative plan documents and names migration plans as the example; hard rule 4 sends a new initiative to an `[Epic]` parent with sub-issues |

**What replaced each piece.**

| Was | Is |
| --- | --- |
| Nothing ever ran `next build` for either frontend | `web-production-build`, a required check building both apps under the production install |
| `ignoreCommand: "npx turbo-ignore <app>"`, which skipped production builds by diffing against a baseline identical by construction | `ignoreCommand: "exit 1"` in both `vercel.json` files — an explicit always-build that cannot be overridden from the Vercel dashboard |
| A missing deployment for a SHA read as neutral | A hard failure, with `CANCELED` neutral only when a *later* deployment overtook it |
| `--env` validated, printed, then dropped — `staging` and `production` were byte-identical programs | `--env` fails closed on a project-ref mismatch before `link` or `push` |
| Migration ordering caught only after merge, by a required check that froze every PR | `migration-order`, which reads the migrations a change *introduces* against the merge-base and makes zero network calls when a change touches none |
| `ALL_REQUIRED_CHECKS` asked of any past commit, silently un-deploying every commit older than the newest check | The expected set intersected with the job ids the deployed commit's own workflows define, with a narrowing floor |
| Two paths to production, the weaker one skipping every gate | One path, two scopes |

**Consequences.**

- **The rollout is not the merge.** Live branch protection is written by
  `scripts/configure-branch-protection.mjs` and is not read back by anything, so merging a check
  into the roster changes intent, not GitHub. Worse, `scripts/ci/validate-deploy-sha.mjs` *imports*
  that array, so a check gates the **production deploy path** from the moment it merges — before
  any admin action. The two halves move at different times and always will until stage 5.
- **Branch protection cannot be verified by an agent.** `api.github.com` returns 403 to
  authenticated and unauthenticated requests alike from a cloud sandbox, and the GitHub MCP exposes
  no branch-protection tool. Step 4 of any rollout is evidenced only by a human's own run output.
  This is why #813, #1166 and #1138 recur.
- **A `frapp-prod` data-loss event is unrecoverable until stage 5.** `frapp-prod` is
  `ACTIVE_HEALTHY` and holds all 54 migrations — the same set as staging — so this is a live
  exposure, not a hypothetical about a paused project.
- **Staging and production build differently on purpose.** Staging is verified through preview
  deployments; production is built through the API with `target: production`. `web-production-build`
  closes the type-check half of that gap in CI, not the deployment half.
- **`migration-order` is stricter than the databases require.** It also fails a migration that
  predates one merged while the PR was in review, even where a single `db push` would have swallowed
  both. The remedy is a free rename of an unapplied file, and the invariant — every new migration
  sorts after everything on the base branch — is one a person can hold in their head.
- **A non-transactional partial apply (`CREATE INDEX CONCURRENTLY`) still passes the rehearsal and
  fails the real apply.** Not a regression — the deleted workflow's dry run was equally blind — but
  nothing in the redesign catches it either.

- **Amendment (2026-09-01, #1383) — the rosters left `configure-branch-protection.mjs`, and the
  "cannot be verified by an agent" consequence is narrower than stated.** Two corrections to the
  consequences above, in the order they matter.

  **(a) The deploy path no longer imports a governance writer.** The consequence above notes that
  `scripts/ci/validate-deploy-sha.mjs` *imports* `ALL_REQUIRED_CHECKS` from
  `configure-branch-protection.mjs`, putting a module that PUTs live branch protection on every
  production deploy's import graph — the entry guard added in #903 being the only thing between a
  deploy and a governance write. The three arrays moved to `scripts/ci/lib/required-checks.mjs`,
  a pure data module with no entry point, no network calls and nothing to guard; both consumers
  import from there and `configure-branch-protection.mjs` no longer re-exports them, so no second
  import path can reappear. This is deliberately **not** the "split the lists" option #1375
  considered and rejected — there is still exactly one roster, because #1378 already fixed the
  backward-looking problem structurally (`jobIdsAtRef` narrowing with a floor), and a second
  hand-synced array would have re-introduced the drift class that fix removed. What was split is
  the data from the actor, not the list from itself. `scripts/check-doc-tables.mjs` parses those
  arrays as source text and its pointer moved with them.

  **(b) Branch protection was read successfully from an agent session.** The consequence above
  states that `api.github.com` "returns 403 to authenticated and unauthenticated requests alike"
  from a cloud sandbox. On 2026-09-01, `GET /repos/pdcarlson/Frapp/branches/main/protection`
  returned **HTTP 200** with the full protection object from a cloud sandbox session, using
  `GITHUB_PAT` loaded from `.env.local` through `node`'s `fetch`. The recorded 403s were `curl`
  probes through the agent proxy. **This does not retire the trigger below.** #680's evidence table
  already records this endpoint class as *session-dependent* — 403 and 200 observed on the same day
  in different sessions — so the honest statement is that the read **sometimes** works, not that it
  can be relied on. `configure-branch-protection.mjs` now reads live protection back in every mode
  and prints a before/after diff, and a `--verify` mode diffs without writing and exits non-zero on
  any difference; it **fails** rather than passes when the read is refused, so an unreadable answer
  is never mistaken for a matching one. A rollout step is now evidenceable wherever the read
  happens to work, and no less safe where it does not.

  **What that read found, as a dated observation and not a standing claim.** `CONTRIBUTING.md` and
  `spec/environments/README.md` both hold the rule that *no doc claims per-check whether a gate is
  live today*, because live protection is whatever an admin last applied and can lag the roster.
  This ADR does not get to be the exception, so: **at 2026-09-01, one read** reported `main`
  carrying all 21 roster contexts, with `migration-order` and `web-production-build` present and
  the demoted `migration-drift` absent — which, if it still holds when you read this, would mean
  step 4 of #1378's rollout had already happened. **Re-read it rather than citing this paragraph**
  (`npm run configure:branch-protection:verify`, or the `gh api` call in the runbook); an admin can
  change any of it in the UI without touching this repo.

  The same read surfaced `allow_fork_syncing` live `false` against the roster's `true`. That one is
  **not** drift an apply can fix: GitHub only honours fork-syncing on a locked branch, and this
  payload pairs it with `lock_branch: false`, so the written value is not persisted. The diff
  therefore skips it unless the branch is locked — a comparison no run could ever satisfy would
  have made `--verify` red forever, which is how a check teaches people to route around it. Both
  facts are the class of thing a write-only script structurally could not report, which is the
  point of the read-back rather than a claim about this particular repository's settings.

- **Amendment (2026-09-02) — the Vercel half of decision 3 is superseded by ADR-21, and the
  `api.github.com` 403 is a property of the route, not of the session.**

  **(a) Staging no longer builds from Git at all.** Decision 3 above records a deliberate
  build-shape difference: production built under `npm ci --omit=dev`, staging verified through
  Vercel preview deployments. The owner disconnected both Vercel projects from Git — landing
  2026-09-01, web 2026-09-02 (ADR-21) — so the staging half of that trade-off no longer exists:
  nothing deploys staging web or landing on merge, and both hosts are frozen at their last Git
  build. **ADR-21 below is the canonical record** of the unlink, the per-project freeze points and
  the breakages; read them there rather than restating them here. The `ignoreCommand: "exit 1"` row
  in the table above governs nothing while the projects stay unlinked — but **keep the key**, and
  `vercel.json`'s `git` block with it: they are the versioned form of settings that revert to
  dashboard-only state the moment Git is re-linked.
  `web-production-build` is unaffected — it runs in CI and never went through Vercel. #1381 also
  gained a **seventh** stage on 2026-09-02 — **#1578**, ADR-21's CI-driven Vercel deploys, filed
  that day as a native sub-issue of #1381 — so the "six sequenced stages" in the decision above,
  decision row 4, and the completion condition in the trigger below all now read as seven. The
  guardrail breakages the unlink left behind are **#1579**.

  **(b) Reachability of `api.github.com` is route-dependent, not session-dependent.** The
  consequence above states that branch protection "cannot be verified by an agent" because
  `api.github.com` "returns 403 to authenticated and unauthenticated requests alike"; amendment
  (2026-09-01, #1383)(b) narrowed that to a read that *sometimes* works, on #680's
  *session-dependent* framing. The session was never the variable. Measured on 2026-09-02 from one
  sandbox host, with one `GITHUB_PAT`, inside the same minute:

  - `curl`, which honours `HTTPS_PROXY`, gets **403** `{"message":"GitHub access is not enabled
    for this session"}` on **every** repo-scoped path, regardless of the `Authorization` header —
    the agent proxy's GitHub-credential layer answers, GitHub is never reached;
  - `curl` through that same proxy to `/user` gets **200**; the proxy allows non-repo paths;
  - `curl --noproxy '*' .../repos/pdcarlson/Frapp/branches/main/protection` gets **200**;
  - node's built-in `fetch` does not read `HTTPS_PROXY` (documented in the sandbox's agent-proxy
    README at /root/.ccr/README.md), so it goes direct and gets **200 from GitHub itself** — the
    response carries `server: github.com` and `x-github-request-id`.

  Direct egress is subject only to the environment's network allowlist, which includes
  `api.github.com`. So **reads are available to an agent as a ground-truth channel**:
  `npm run configure:branch-protection:verify` exits 0 from this sandbox, and step 4 of a rollout
  is evidenceable by an agent rather than only by a human's run output. Never respond to the 403 by
  regenerating the PAT with broader scopes — scope is not what it is about — and never set
  `NODE_USE_ENV_PROXY=1` for these scripts, which would push node onto the 403 route. What does
  **not** change: applying branch protection stays a human step with an admin PAT **by policy**,
  not because it is unreachable; and the GitHub MCP stays the sanctioned write path for issues, PRs
  and comments. REST is a read channel for settings the MCP exposes no tool for — not a write
  fallback, not an MCP replacement. This satisfies the read half of the trigger below; the write
  half is a policy choice and stands.

  The 2026-09-01 caution holds unchanged: a read reports what an admin last applied, so re-read
  rather than cite. Re-read on 2026-09-02, `main` still carried 21 required contexts with
  `strict: true`, `enforce_admins: true`, `required_linear_history: true`,
  `required_pull_request_reviews: null`, and `allow_fork_syncing` live `false` against the roster's
  `true` (**#1580**) — a dated observation, not a standing claim.

- **Amendment (2026-09-04, #1580) — the `allow_fork_syncing` divergence is closed, and the roster
  half of both readings above is now stale.** Both paragraphs also say 21 roster contexts, which
  was true when read: it has been **20** since #1637 (`bab7200`) dropped `docs-spec-sync` on
  2026-09-03. They record `allow_fork_syncing`
  live `false` "against the roster's `true`". The *live* half still holds (re-read 2026-09-04:
  `allow_fork_syncing: false`, `lock_branch: false`); the *roster* half does not. The roster now
  declares `false`, in [`scripts/configure-branch-protection.mjs`](../../scripts/configure-branch-protection.mjs).
  It was closed by changing the **declaration**, not by applying: GitHub honours fork-syncing only
  on a locked branch, so an apply would have written a value GitHub does not persist, and applying
  is a human step with an admin PAT by policy. `LOCK_DEPENDENT_FLAGS` still excludes the key from
  the `--verify` diff while `lock_branch` is `false`, so **a future divergence on that key would
  still be invisible to a green `:verify`** — the exclusion is the guard for a locked branch, not a
  claim that the flag is checked. The point of closing it was the hand comparison: an audit that
  diffs roster against live now finds no difference on any flag and no longer has to re-derive the
  lock-dependence reasoning to conclude the difference did not matter. Canonical page for the
  current state: [`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

- **Amendment (2026-09-04) — the doc-table checker was deleted; the parse-as-source-text constraint
  on `required-checks.mjs` lapses with it, and the agreement it enforced is now a review
  responsibility.** Amendment (2026-09-01, #1383)(a) closes on a present-tense clause:
  "`scripts/check-doc-tables.mjs` parses those arrays as source text and its pointer moved with
  them". That is the record of 2026-09-01 and stands exactly as written; what follows corrects its
  tense, not its words.

  **The checker is gone, with no successor.** On 2026-09-04 this repository retired all four docs
  gates — the doc-table checker along with the doc-path, doc-reference and structure checkers —
  deleting their scripts, their `npm` scripts and their allowlists, and replaced them with the
  written standard in `docs/internal/DOCUMENTATION_CONVENTIONS.md` plus a docs angle in the
  diff-review skill. `.github/workflows/docs.yml` is down to one job, `env-slugs`. Nothing now
  parses `scripts/ci/lib/required-checks.mjs` as source text for the **contents** of `CI_CHECKS`,
  `DOCS_CHECKS` or `DRIFT_CHECKS`, and no gate holds a pointer into that file that has to move when
  the arrays do.

  **"Unasserted" would overstate it, and the difference is the useful part.**
  `scripts/ci/__tests__/branch-protection-diff.test.mjs` still reads that file as source text — but
  only to assert that the module stays free of entry points and side effects (no `process.argv`, no
  `fetch(`, no `main`, no module-scope statement), which is precisely what makes it safe to import
  on the production deploy path. Nothing asserts what the arrays *hold*. Their only consumers are
  `scripts/configure-branch-protection.mjs` and `scripts/ci/validate-deploy-sha.mjs`, both by
  import, so a relocation touches three code sites — those two and that test's relative path — plus
  the comments and docs that name the path by hand, none of which anything checks any more.

  **What the deletion costs, named rather than left to be rediscovered as a bug.** The deleted
  checker compared exactly one doc against these arrays:
  `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`, which restates the roster by hand and is
  the one doc deliberately permitted to. Until 2026-09-04 a machine held those two in step. Nothing
  does now — a roster edit that leaves that runbook stale merges green, and the same is true of
  every other doc that describes these arrays in prose. Keeping them in agreement is a reviewer's
  job from here. The counts and rosters written in docs were already dated observations rather than
  sources of truth; they are now unverified ones as well, which is an argument for re-reading the
  arrays, not for copying them somewhere new.

  **One count above moves with this change.** The amendment recording the `allow_fork_syncing`
  closure notes the roster stood at 20 contexts after #1637 dropped `docs-spec-sync`. Retiring
  `doc-paths` takes it to 19. That is the last count either amendment states, and it will go stale
  the same way the previous one did — read `ALL_REQUIRED_CHECKS` rather than either number.

**Trigger to revisit:** the six-stage program completes or is abandoned; production backups exist
(retiring the decision-2 risk); or a provider gains a readable API for branch protection from an
agent session, which would retire the write-only rollout step.

---

### ADR-21: Retire the Vercel Git integration — deploys move into CI (landing 2026-09-01, web 2026-09-02)

This ADR is the **canonical record** of the Vercel Git unlink: the dates, the freeze points, the
live breakages and the work that repairs them. Other docs carry a sentence of current state and
link here; the detail belongs on this page only.

**Decision:** Disconnect both Vercel projects — `frapp-web` and `frapp-landing` — from Git. The
owner did this deliberately, and not as one event: `frapp-landing` was unlinked on **2026-09-01**
and `frapp-web` roughly six and a half hours later, on **2026-09-02** (measured boundaries under
**Consequences**). Vercel no longer observes the repository at all: no push produces a preview, no
branch is a Production Branch, and no Vercel dashboard setting decides what ships from a push.
Deploying moves into GitHub Actions.

**Context.** The Git integration did two jobs, and both had become liabilities. It built a preview
for every push to `main` — the staging verification path ADR-20 decision 3 recorded; both
`vercel.json` files pin `git.deploymentEnabled` to `{"main": true, "**": false}`, so feature-branch
and PR pushes never produced a deployment — and it held the settings that decided what a push to
`main` did: the Production Branch, and auto-deploy from push.
The Production Branch exists only in the Vercel dashboard: this repository could assert it
(`assertVercelProductionBranch` in `scripts/ci/production-guardrails.mjs`, daily and again as a
preflight before every deploy) but could never enforce it. It is the Vercel half of the pair ADR-19
recorded as "load-bearing, dashboard-only, and **fail open**"; the other half is Render auto-deploy,
which this ADR does not touch. Auto-deploy from push is the second liability the unlink removes — no
guardrail ever asserted it, and it was partly repo-governed through `git.deploymentEnabled` in both
`vercel.json` files. Removing the integration removes both.

Evidence for the state as of 2026-09-02: Vercel's `list_projects` reports `link: null` for **both**
projects. The last Git-sourced deployment each project accepted — its **freeze point**, and the
build that staging host still serves — is **landing `2bf143b` at 2026-09-01T20:19Z** and **web
`0372c6d` at 2026-09-02T02:41:42Z**; the web one carries `githubDeployment: 1` and
`githubCommitRef: main` in Vercel's deployment list, and `verify-deployments.yml` run #436 verified
it green. Nothing was failing beforehand — production-guardrails run #4 passed, and every push to
`main` produced previews only. This is a decision taken, not a breakage worked around.

**What it retires.** The Production Branch guardrail (`assertVercelProductionBranch` in
`scripts/ci/production-guardrails.mjs`) now asserts a setting the API no longer exposes. The
auto-deploy-from-push path is gone outright. The `git` settings and the `ignoreCommand: "exit 1"`
pin in both `vercel.json` files — ADR-20's always-build row — have no integration left to govern
while the projects stay unlinked, which makes the **premise** of **#1376** (that nothing enforces
the `ignoreCommand` pin) moot for exactly as long as that holds. #1376 is open; its disposition is
decided on the issue, not by this prose. **Do not delete either key.** `git.deploymentEnabled` and
`ignoreCommand` are the versioned form of settings that are otherwise dashboard-only — re-link Git
and branch filtering and the Ignored Build Step fall straight back to unversioned dashboard state.
And `scripts/ci/deploy-vercel-production.mjs` passes a `gitSource` to Vercel's create-deployment
API, an argument that only means anything while the integration exists.

**What replaces it.** CI-driven deploys: `vercel build` in a GitHub Actions job, then
`vercel deploy --prebuilt --prod` — or the `files` upload form of the create-deployment API —
shipping the artifact that job produced. That model is **designed, not built**: no workflow does it
today, and nothing in the repository deploys Vercel without the integration. It is tracked as
**#1578**, filed 2026-09-02 as CI/CD stage 7 — a native sub-issue of the #1381 epic.

**Consequences.** Four breakages are live as of 2026-09-02, recorded here as current known-broken
state rather than as history:

- **The daily 07:15 UTC production-guardrails run is red.** `assertVercelProductionBranch` reads
  `project?.link?.productionBranch` and treats an absent value as a violation; with `link: null` it
  is always absent. The same assertion runs as a preflight inside `deploy-production.yml`, so it
  **blocks every production deploy** — including a `--migrations-only` run, which drops only
  `frapp-landing`'s assertion and still makes `frapp-web`'s. Tracked as **#1579**.
- **`verify-deployments.yml`'s two Vercel jobs fail on every push to `main`** — they look for a
  deployment the integration used to create. The two jobs broke ~6.5 hours apart, one per project,
  which is how the unlink itself is dated:

  | Job | Last green run | First failing run |
  | --- | --- | --- |
  | `verify-vercel-landing` | #427, `2bf143b`, 2026-09-01T20:19:18Z | #428, `7f94528`, 2026-09-01T20:28:41Z |
  | `verify-vercel-web` | #436, `0372c6d`, 2026-09-02T02:41:42Z | #437, `b62a142`, 2026-09-02T03:04:00Z |

  Every run from #428 on has `verify-vercel-landing = failure`; `verify-vercel-web` kept succeeding
  through #436, i.e. for six and a half hours after landing broke. **Only the verify step fails.**
  `scripts/ci/ensure-vercel-staging-alias.mjs` is *not* failing and emits nothing to grep for: its
  step is a plain sequential step after the verify step in the same job with no `if:` guard, so a
  failed verify ends the job before it runs — measured `skipped` on both Vercel jobs of runs #437
  and #443. (Run on its own it would exit 0 as a skip.) Tracked as **#1579** with the guardrail
  above.
- **`scripts/ci/deploy-vercel-production.mjs` is presumed broken**, because its `gitSource` argument
  requires the integration. Presumed rather than measured, and structurally so rather than by
  accident of scheduling: the `assertVercelProductionBranch` preflight in the bullet above fails
  first, so `deploy-production.yml` never reaches this step — the `gitSource` path **cannot be
  exercised at all until #1579 lands**. That is also the sequencing constraint on the replacement:
  **#1579 has to land before #1578's production path can be tested at all.**
- **Nothing deploys staging web or landing on merge any more.** Both staging hosts are frozen at
  the freeze points named above, and stay there until stage 7 (**#1578**) exists.

**A superseded auto-filed diagnosis: #1564.** The daily guardrails run auto-filed **#1564**
("Production deploy guardrails have drifted") on 2026-09-02; it is open and P1. Its body reads the
red run as Vercel falling back to "the repository default branch (main)", so that "every merge to
main would become a production deployment", and tells the reader to fix it by setting a Production
Branch in the dashboard. That was correct while the project was linked. It is **impossible** now —
with `link: null` Vercel is not watching the repository at all — and its remedy would mean
re-linking Git, reversing this ADR. **Do not act on #1564 as written**; the repair is **#1579**, the
inversion described below.

Against those four: the **Vercel half** of the fail-open risk ADR-19 and ADR-20 mitigated is now
removed at the source rather than asserted after the fact. While the projects stay unlinked there is
no Production Branch to point at `main` and no push path to deploy from. But *staying unlinked* is
itself unversioned dashboard state — exactly the shape of thing this repo does not trust — so the
guardrail is not moot, it is **pointed the other way**: #1579's fix is to **invert**
`assertVercelProductionBranch` so that a **present** Git link is the violation, not to delete the
assertion. An audit of Vercel keeps an item; the item is now "both projects are still unlinked".
The Render half is untouched — `assertRenderService` still runs in the same daily job and the same
`deploy-production.yml` preflight, and is why `production-guardrails.mjs` still exists. That
Vercel-side removal is the durable gain, and it is why the breakages are worth carrying rather than
undoing by re-linking. Repairing them is CI work, tracked separately in **#1579** (the guardrails)
and **#1578** (the replacement deploys); this ADR records the state and changes no workflow and no
script.

**Amendment (2026-09-02) — two of the four breakages are repaired (#1579).** The bullets under
*Consequences* above stand as the record of what the unlink left broken. Two of them no longer
describe current state:

- **The guardrail.** `assertVercelProductionBranch` was **inverted**, not deleted, exactly as this
  ADR and #1579 called for. It is now `assertVercelNoGitLink` in
  `scripts/ci/production-guardrails.mjs`: a **present** Git link is the violation, and an absent one
  is the pass. The daily 07:15 run and the `deploy-production.yml` preflight therefore no longer
  fail on the intended post-ADR-21 state.

  Inverting flipped *absent* from meaning "violation" to meaning "pass", which converts a
  fail-closed check into a fail-open one unless something else holds the line: an error envelope, an
  empty body, or a future response shape has no `link` either, and would otherwise read as
  unlinked-and-green on the only path to production. `looksLikeVercelProject` is that line — a
  response that is not recognisably a project object is a violation. It is the load-bearing half of
  the change, and is unit-tested separately from the assertion so the two cannot collapse into one
  answer.

- **The verify jobs.** `verify-vercel-web` and `verify-vercel-landing` were **removed** from
  `verify-deployments.yml`. Nothing creates a Vercel deployment for a pushed SHA, so polling for one
  could not detect a problem — only manufacture a red check, which is how a red `main` stops meaning
  anything. `verify-vercel-deploy.mjs` and `ensure-vercel-staging-alias.mjs` are **kept**, referenced
  by no workflow, for **#1578** to re-wire against a deployment CI creates; the alias script
  mitigates a real Vercel behaviour (the staging hostname lagging a READY deployment) that returns
  with it. Re-add the jobs keyed on the deployment id that workflow creates, not on the pushed SHA.

The other two bullets are unchanged and still live: `deploy-vercel-production.mjs`'s `gitSource` call
remains **presumed broken** (#1579 removed the preflight that blocked it, so it is now reachable and
can finally be measured — but nothing has measured it yet), and **nothing deploys staging web or
landing on merge**. Both wait on #1578.

This amendment also supersedes the future-tense repair language left in ADR-19's 2026-09-02
amendment and in the *Consequences* and closing paragraphs above ("#1579's fix is to invert…",
"Repairing them is CI work, tracked separately in #1579"): that work has landed. #1578 has not.

**Amendment (2026-09-04) — the remaining two breakages are repaired (#1578).** The replacement this
ADR called *designed, not built* is built. All four *Consequences* bullets are now historical.

- **Staging deploys exist again.** `.github/workflows/deploy-vercel-staging.yml` runs after CI
  succeeds on `main` and deploys web and then landing: `vercel pull --environment=preview`,
  `vercel build`, `vercel deploy --prebuilt`, then `ensure-vercel-staging-alias.mjs` to point
  `app.staging.frapp.live` and `staging.frapp.live` at the new deployments. It is gated on
  `workflow_run` rather than `push` for the reason `deploy-api.yml`'s header gives — a push-triggered
  deploy ships a commit whose CI has not finished — which is also why #1578's acceptance criterion
  naming `verify-deployments.yml` was met **in this workflow instead**: it holds the deployment id it
  created, so it verifies by id rather than searching for a deployment by SHA, and
  `verify-deployments.yml` stays the push-triggered Render observer.
- **`gitSource` is gone.** `scripts/ci/deploy-vercel-production.mjs` was **replaced** by
  `scripts/ci/deploy-vercel.mjs`, parameterised by target rather than production-only: after this ADR
  both channels are CI's job, and carrying the difference in one argument keeps them from drifting
  into two implementations. It never measured the old `gitSource` call — the call was removed rather
  than exercised, since ADR-21 already establishes it cannot work without the integration.

Two consequences this ADR's own requirements produce, recorded here because this is where they are decided rather than merely implemented:

- **Every CI-created deployment is stamped `--meta githubCommitSha` (and `githubCommitRef`).** A
  `--prebuilt` upload carries no git metadata at all, and three things read it back: ADR-19's
  named-commit guarantee, `ensure-vercel-staging-alias.mjs`'s lookup, and
  `verify-vercel-deploy.mjs`'s per-branch supersession test. Without the flag the alias step would
  silently find nothing and skip.
- **`git.deploymentEnabled` and `ignoreCommand: "exit 1"` remain in both `vercel.json` files and are
  now inert**, exactly as this ADR requires. The CLI path does not consult either: `ignoreCommand` is
  the Git integration's Ignored Build Step, and `--prebuilt` has already built. They stay because
  they are the versioned form of dashboard-only settings. #1376's premise is unchanged by this.

**Not done, and not doable by CI:** the Definition of Done's final clause — one production deploy
dispatched successfully through the new path — needs the `production` environment's required-reviewer
approval. The CLI deploy has unit coverage but has **never run against the live projects**, so the
first `full` dispatch is its first real exercise. `deploy-production.yml`'s `dry_run_only` stops
before the Vercel step and so does not cover it either.

**Trigger to revisit:** CI-driven deploys prove unworkable and re-linking Git is considered. That
supersedes this ADR rather than amending it — and re-linking restores both Vercel settings, the
Production Branch and auto-deploy from push, along with the integration.

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
  - Two things this decision does **not** cover. `check:migration-safety` rejects any change set touching `supabase/migrations/` without a matching update to `docs/internal/ops/DB_PROMOTION_RUNBOOK.md` or `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md` — budget for that doc update in the corpus migration PR. And **neither pgvector version is pinned by this decision**: the landmark asserts the extension is *available*, never which version, so the PGlite-side build moves with any `@electric-sql/pglite-pgvector` bump and the hosted Supabase build moves independently of both. Treat the 0.8.1 above as "what was measured on the day", not a guarantee — if a corpus migration ever depends on version-gated pgvector behavior, read the version on both sides rather than inferring either from this gate passing.
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

The Expo app opens directly into chat and holds real-time parity with web on reactions, inline cards, voice memos, and presence. The hot-path client and realtime manager are shared across platforms as `@repo/chat-core`, with the platform-specific layers injected through its adapter ports (`KeyValueStore`, `NetworkState`, `OutboxStore`) rather than forked; the rich-message renderer registry is shared as a contract (`@repo/chat-integrations`) with framework-bound renderers per app.

### Storage layer (the Dexie analogue)

Web persists composer state in IndexedDB via Dexie (ADR-05); mobile uses the native equivalents behind the same storage interface (the `OutboxStore` port in `@repo/chat-core`):

- **Drafts + outbound send/action queue:** AsyncStorage. Persist between cold launches so a force-quit mid-compose never loses input, and a queued message flushes in order on reconnect (idempotent on `client_message_id`, same dedupe index as web).
- **Inbound message cache:** SQLite (`op-sqlite` or `expo-sqlite`) — last N messages per channel for offline reads and fast cold-start render.

The same TanStack Query mutations and Supabase Realtime subscriptions run on both platforms; only the storage seam differs.

### App lifecycle and presence

- **Foreground:** resubscribe Realtime and REST-backfill since the last cursor **before** rendering the channel, so the user never sees a stale thread.
- **Background:** persist per-channel cursors.
- **Presence states:** active → `online`; backgrounded → `idle`; force-quit → `offline`. Presence is Supabase Realtime Presence on the channel topic (ADR-10), consistent with web.

### Push delivery

Burst bundling and presence-aware suppression match the web push rules (ADR-04, ADR-09). What the
app actually declares and sends is owned by [`../ui/mobile/patterns.md`](../ui/mobile/patterns.md)
§ Push notifications and [`../behavior/notifications.md`](../behavior/notifications.md) — and it is
narrower than this section used to claim: there is **one** Android channel (`default`), no
per-category iOS or Android grouping, and **no silent/background push at all** (`UIBackgroundModes`
is deliberately unset, so there is no background-sync handler to wake).

### Voice memos

**Specified, not built.** `audio` is not in `CHAT_MESSAGE_KINDS`, so a send with that kind is rejected at the DTO today; [`../behavior/chat/README.md`](../behavior/chat/README.md) § Message Kinds and Actions marks it as specified-but-unbuilt and is the owner of that status. As designed: the mobile composer records a voice memo, uploads it to Supabase Storage (pre-signed upload, same flow as other attachments), and sends it as `kind="audio"` with waveform metadata in `payload`. Web renders the `audio` card with waveform playback — the renderer is shared, so a memo recorded on mobile plays back on web.
