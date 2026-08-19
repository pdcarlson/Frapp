# Architecture Specification: Frapp

---

## 1. High-Level Stack

| Layer          | Technology                                   | Notes                                                                                                                 |
| -------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Monorepo       | Turborepo + npm workspaces                   | Single repo, task orchestration, caching.                                                                             |
| Landing        | Next.js (App Router)                         | `apps/landing` at frapp.live. Static/SSG for speed.                                                                   |
| Web App        | Next.js (App Router), Tailwind, ShadCN UI    | `apps/web` at app.frapp.live. Admin dashboard.                                                                        |
| Mobile App     | Expo (React Native), Expo Router, NativeWind | `apps/mobile`. Member experience. iOS + Android.                                                                      |
| Developer docs | Markdown in-repo                             | [`docs/guides/`](../../docs/guides/README.md) + `spec/`. No deployed docs web app; a public site may return post-launch. |
| API            | NestJS 11, TypeScript (strict)               | `apps/api`. REST + WebSocket gateway.                                                                                 |
| Database       | PostgreSQL (via Supabase)                    | Supabase-hosted Postgres. Migrations via Supabase CLI.                                                                |
| Auth           | Supabase Auth                                | Email/password, magic link, OAuth.                                                                                    |
| Storage        | Supabase Storage                             | Seven private buckets (§7), all declared in migrations. Signed URLs only — no public access.                          |
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
  packages/
    api-sdk/        # Generated API client + TypeScript types
    chat-core/      # Platform-neutral chat hot path (cache, send client, realtime manager) behind injected adapters
    hooks/          # Shared React hooks (use-members, use-frapp-client, etc.)
    ui/             # Shared React components (button, card, etc.)
    theme/          # Tailwind config + global styles (light + dark mode)
    validation/     # Shared Zod schemas (used by API + web + mobile)
    eslint-config/  # Shared ESLint configuration
    typescript-config/ # Shared tsconfig
  spec/             # Product spec, behavior spec, architecture, environments
  supabase/         # Supabase project config, migrations, seed files
```

---

## 3. Applications

### 3.1 API (`apps/api`)

- **Framework:** NestJS 11 (Node.js, TypeScript strict).
- **Role:** REST API + WebSocket gateway. All business logic lives here.
- **Architecture pattern:** Layered — Interface (controllers, DTOs, guards) -> Application (services/use-cases) -> Infrastructure (repositories, Supabase client, external adapters) -> Domain (entities, interfaces, business rules).
- **Database access:** Supabase JS client (`@supabase/supabase-js`) for Postgres queries, storage operations, and auth admin operations. No ORM; raw SQL or query builder via Supabase.
- **Security:**
  - `SupabaseAuthGuard`: Validates JWT from Supabase Auth on every request.
  - `ChapterGuard`: Verifies the `x-chapter-id` header matches a chapter the user belongs to.
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

- **Framework:** Expo (~54), React Native, Expo Router, NativeWind.
- **Auth:** Supabase Auth (React Native client with `AsyncStorage` persistence).
- **Data fetching:** TanStack Query + `@repo/api-sdk`.
- **Push notifications:** Registers push token with API on login; receives via Expo Push.
- **Study mode:** Uses Expo `AppState` API for foreground/background detection. Heartbeat timer stops on background.
- **Haptics:** Expo Haptics for tactile feedback on key actions.
- **Dark mode:** Supported via NativeWind with system preference detection and manual override.
- **Offline:** Future consideration (WatermelonDB or similar for chat caching). Not in scope for v1.

### 3.4 Landing (`apps/landing`)

- **Framework:** Next.js (App Router), Tailwind.
- **Role:** Marketing, pricing, CTA. No auth state. Links to app.frapp.live for sign-up/log-in.
- **Deployment:** Vercel, independent from the web app.

### 3.5 Documentation (no `apps/docs` web app)

- **Authoring:** Developer guides in **[`docs/guides/`](../../docs/guides/README.md)**; product and architecture in **`spec/`**. Read and edit in GitHub or your editor; there is no separate Next.js documentation deployment in this repo for now.
- **Spec rendering:** Previously the removed docs app rendered `spec/*.md` in a browser. Today, use the repo view on GitHub (or a local markdown preview). A future public docs site may restore styled rendering.
- **Sync rule:** When behavior, architecture, or workflows change, update **`docs/`** and/or **`spec/`** in the same change set. Divergence is a bug.
  - **Enforcement:** CI fails PRs that change product code without also updating **`docs/`** or **`spec/`**. See [`docs/internal/ci-cd/DOCS_CI.md`](../../docs/internal/ci-cd/DOCS_CI.md).
  - **Workflow:** The PR template requires a “Docs / Spec impact” section; treat “None” as an explicit claim that reviewers should challenge.

---

## 4. Shared Packages

| Package                   | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `@repo/api-sdk`           | Auto-generated TypeScript client from OpenAPI spec. Used by web + mobile. |
| `@repo/chat-core`         | Platform-neutral chat hot path — normalized cache, optimistic send client, realtime manager, shared topic registry — behind injected `KeyValueStore` / `NetworkState` / `OutboxStore` ports. Web today; mobile with Signet Phase 2 (#937). |
| `@repo/hooks`             | Shared React hooks wrapping api-sdk with TanStack Query.                  |
| `@repo/ui`                | Shared UI components (buttons, cards, inputs). Used by web + landing.     |
| `@repo/theme`             | Tailwind config presets, global CSS, light/dark mode color tokens.        |
| `@repo/validation`        | Shared Zod schemas for form/request validation (used by API + clients).   |
| `@repo/eslint-config`     | Shared ESLint rules.                                                      |
| `@repo/typescript-config` | Shared tsconfig presets.                                                  |

---

## 5. Data Model (Supabase Postgres)

All tables use `uuid` primary keys (generated by `gen_random_uuid()`). Timestamps default to `now()`. Nearly every table carries `chapter_id` for tenant scoping.

### Core Tables

**users** — `id`, `supabase_auth_id` (unique), `email`, `display_name`, `avatar_url` (nullable), `bio` (nullable), `graduation_year` (int, nullable — for alumni directory), `current_city` (text, nullable — for alumni directory), `current_company` (text, nullable — for alumni directory), `created_at`, `updated_at`.

**chapters** — `id`, `name`, `university`, `stripe_customer_id` (unique, nullable), `subscription_status` (incomplete | active | past_due | canceled), `subscription_id` (unique, nullable), `accent_color` (text, nullable — hex string for chapter branding, default `#2563EB`), `logo_path` (text, nullable — Supabase Storage path for chapter logo), `donation_url` (text, nullable — external donation link for alumni), `created_at`, `updated_at`.

**members** — `id`, `user_id` (FK users), `chapter_id` (FK chapters), `role_ids` (text[]), `custom_role_ids` (uuid[], default `{}` — assigned `chapter_custom_roles`; capabilities flatten into the permission set per the bridge model in `spec/behavior/rbac.md`), `has_completed_onboarding` (bool, default false — controls onboarding tutorial display), `created_at`, `updated_at`. Unique on (user_id, chapter_id).

**roles** — `id`, `chapter_id` (FK chapters), `name`, `system_key` (text, nullable — rename-proof identity for seeded system roles, null for custom roles; see [`behavior/rbac.md`](../behavior/rbac.md#role-lifecycle)), `permissions` (text[]), `is_system` (bool), `display_order` (int), `color` (text, nullable, hex string), `created_at`. Unique on (chapter_id, name); partial unique on (chapter_id, system_key) where `system_key is not null`.

**invites** — `id`, `token` (unique), `chapter_id` (FK chapters), `role`, `expires_at`, `created_by` (FK users), `used_at` (nullable), `created_at`.

### Backwork

**backwork_departments** — `id`, `chapter_id` (FK chapters), `code` (e.g. "CS"), `name` (nullable, e.g. "Computer Science"), `created_at`. Unique on (chapter_id, code).

**backwork_professors** — `id`, `chapter_id` (FK chapters), `name`, `created_at`. Unique on (chapter_id, name).

**backwork_resources** — `id`, `chapter_id` (FK chapters), `department_id` (FK backwork_departments, nullable), `course_number` (text, nullable), `professor_id` (FK backwork_professors, nullable), `uploader_id` (FK users), `title` (nullable), `year` (int, nullable), `semester` (text, nullable — Spring | Summer | Fall | Winter), `assignment_type` (text, nullable — Exam | Midterm | Final Exam | Quiz | Homework | Lab | Project | Study Guide | Notes | Other), `assignment_number` (int, nullable), `document_variant` (text, nullable — Student Copy | Blank Copy | Answer Key), `storage_path` (Supabase Storage path), `file_hash` (SHA-256), `is_redacted` (bool, default false), `tags` (text[]), `created_at`. Unique on (chapter_id, file_hash).

### Points & Events

**point_transactions** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `amount` (int), `category` (text — ATTENDANCE | ACADEMIC | SERVICE | FINE | MANUAL | STUDY), `description` (text), `metadata` (jsonb — may contain `event_id`, `study_session_id`, `adjusted_by`, `flagged`), `created_at`.

**events** — `id`, `chapter_id` (FK chapters), `name`, `description` (nullable), `location` (text, nullable), `start_time`, `end_time`, `point_value` (int, default 10), `is_mandatory` (bool, default false), `recurrence_rule` (text, nullable — e.g. "WEEKLY", "BIWEEKLY", "MONTHLY"), `parent_event_id` (FK events, nullable — for recurring instances), `required_role_ids` (text[], nullable — roles required to attend; null = open to all), `notes` (text, nullable — markdown meeting minutes, editable by admins post-event), `created_at`.

**event_attendance** — `id`, `event_id` (FK events), `user_id` (FK users), `status` (PRESENT | EXCUSED | ABSENT | LATE), `check_in_time` (nullable), `excuse_reason` (text, nullable — admin-provided reason when marking EXCUSED), `marked_by` (FK users, nullable — admin who set EXCUSED/ABSENT/LATE), `created_at`. Unique on (event_id, user_id).

### Communications

**chat_channel_categories** — `id`, `chapter_id` (FK chapters), `name`, `display_order` (int), `created_at`.

**chat_channels** — `id`, `chapter_id` (FK chapters), `name`, `description` (nullable), `type` (PUBLIC | PRIVATE | ROLE_GATED | DM | GROUP_DM), `required_permissions` (text[], nullable — for ROLE_GATED channels, any permission strings), `member_ids` (uuid[], nullable — for DM and GROUP_DM channels), `category_id` (FK chat_channel_categories, nullable), `is_read_only` (bool, default false — for channels like #announcements where only permitted users can post), `created_at`.

**chat_messages** — `id`, `channel_id` (FK chat_channels), `sender_id` (FK users), `content` (text), `type` (TEXT | POLL), `reply_to_id` (FK chat_messages, nullable), `metadata` (jsonb — attachments, link previews, poll data), `mentions` (uuid[], default `{}` — `users.id` of everyone mentioned, resolved server-side at send time; see [`../behavior/chat/README.md`](../behavior/chat/README.md) § Mentions), `is_pinned` (bool, default false), `pinned_at` (timestamp, nullable), `edited_at` (timestamp, nullable), `is_deleted` (bool, default false), `created_at`.

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
- `branding jsonb not null default '{}'` — `{ greek_letters, designation, school_short, founded_at, colors: { dark, accent } }`.
- `theme_palette jsonb not null default '{}'` — derived token map, regenerated server-side whenever `branding.colors` changes (see *Theming Model* below).
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
- **chapter_audit_log** — `(id, chapter_id, actor_user_id, action, target_type, target_id, scope, diff jsonb, created_at, member_visible boolean)`. Append-only; mirrored into the `#chapter-audit` channel via the audit→chat bridge (ADR-08). Indexed on `(chapter_id, created_at desc)` and `(actor_user_id, created_at desc)`.

Seed materialization deep-clones the shared archetype seeds (`ARCHETYPES`, `MODULE_CATALOG`, `ROLE_PACKS`, `CUSTOM_FIELDS_SEED`, `WORKFLOWS_SEED`, `VOCABULARY_DEFAULTS`) into the chapter's rows so per-chapter edits never mutate the shared reference (see [`engineering.md`](../engineering.md)).

### Chat Hot-Path Schema Extensions

The existing chat tables (above) are extended for the high-volume, offline-tolerant hot path:

- `chat_messages` gains `kind text not null default 'text'` (`text | event | task | poll | dues | points | hours | system_audit | audio | loading`), `payload jsonb` (inline-card data), `client_message_id text` (client-generated idempotency key), and `deleted_at timestamptz` (soft-delete; hard delete is admin-only cold path).
- **chat_message_actions** — `(id, message_id, user_id, action_type, payload jsonb, created_at)`. Per-user action history per message (RSVP, vote, pay, confirm, emoji reaction). Indexed on `(message_id, user_id)` and `(user_id, action_type, created_at desc)`; unique on `(message_id, user_id, action_type)` for the dedupe / vote-change path (ADR-07).
- **Idempotency index (non-negotiable):** `UNIQUE (chapter_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL` so retries after a dropped connection never duplicate a message (ADR-03).
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

1. Client sends request with `Authorization: Bearer <supabase_jwt>` and `x-chapter-id: <uuid>`.
2. `SupabaseAuthGuard` validates the JWT and extracts the user identity.
3. `ChapterGuard` verifies the user is a member of the requested chapter.
4. `PermissionsGuard` checks required permissions for the endpoint against the user's flattened permission set (freshly resolved per request).
5. Request proceeds to the controller.

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

**Access control:** All buckets are private. All access goes through API-generated signed URLs (upload and download). No public access. `IStorageProvider` (`apps/api/src/domain/adapters/storage.interface.ts`) has no `getPublicUrl` method, so the API cannot express a public read even by accident.

**Declaration (IaC).** All seven buckets are declared in `supabase/migrations/`, so a fresh project, a preview branch, or a restore reproduces them with the same privacy and limits:

| Bucket | Migration |
| -- | -- |
| `service` | `20260803231500_service_proof_bucket.sql` |
| `reports` | `20260805133000_reports_bucket.sql` |
| `branding`, `profiles`, `documents`, `backwork`, `chat` | `20260808204500_declare_dashboard_created_buckets.sql` |

Each declaration pins `public = false`, an `allowed_mime_types` list, and `file_size_limit` (26214400 = 25MB, matching `supabase/config.toml`). The MIME list mirrors that bucket's API-side allowlist and is **load-bearing, not documentation**: a signed upload URL cannot pin a content type — the uploader sets its own header on the PUT — so the API's check gates only URL *issuance*, and these bucket columns are the only thing enforced on the upload itself. Without them a member with upload permission can store `text/html` under a valid key and be served attacker-controlled markup from the storage origin. Add the bucket declaration in the same change set as any new bucket; never create one from the dashboard alone.

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

`GET /health` — No authentication required. Returns:

```json
{
  "status": "ok",
  "database": "connected",
  "supabase": "connected",
  "uptime": 3600
}
```

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

Configurable alerts via the monitoring provider:

- Error rate exceeds threshold (e.g. >5% 5xx in 5 minutes).
- API downtime (health check fails for >1 minute).
- Database connection pool exhaustion.
- Stripe webhook processing failures.
- Push notification delivery failure spike.

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

- **Testing:** TDD encouraged. Minimum 80% line coverage for API modules.
- **Linting:** ESLint (shared config), Prettier for formatting.
- **Type safety:** TypeScript strict mode across all apps and packages.
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
- Per-channel / per-kind notification preferences (`all | mentions | off`), defaulted by channel kind: `#announcements → all`, `#chapter-audit / system_audit → off`, otherwise `mentions`.

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

**Consequences:** The UI must handle the "sent → confirmed" state transition (swap optimistic message for server-confirmed one). TanStack Query `onMutate`/`onError` handles this. Dedup index on `chat_messages` is non-negotiable: `UNIQUE (channel_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL`.

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

**Consequences:** Two preference tables until consolidation. The push worker queries both arms in a single `eq(user_id).eq(chapter_id)` load per recipient and resolves precedence locally (channel-pref ▶ kind-pref ▶ channel-name default). The defaults `(announcements → all, chapter-audit → off, system_audit kind → off, otherwise mentions)` live in `apps/api/src/modules/chat-push-worker/push-rules.ts:defaultLevelFor` so the rule chain is unit-testable without DB seeds.

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

### ADR-13: Repository visibility — public → private on GitHub Pro (2026-05-31)

**Decision:** The `pdcarlson/Frapp` repository moved from **public** to **private**, on a **GitHub Pro** plan. Frapp is a commercial multi-tenant SaaS; the source, the issue backlog/roadmap, and implementation details are no longer publicly visible.

**Rationale:** Protect proprietary source (multi-tenant RLS model, Stripe billing, business logic); stop publicly exposing the roadmap (the issue backlog mirrored to GitHub was world-readable); reduce the source-disclosure attack surface. The project is effectively solo (one human collaborator + AI agents), so the open-source/community upside given up is negligible.

**Consequences:**

- **Branch protection and repository-level Actions secrets are unaffected** — both are available on private repos with Pro. The deploy pipeline resolves runtime secrets from Infisical at workflow time and uses only repo-level bootstrap secrets, so it keeps working.
- **The `production` environment's manual-approval pause is gone.** Required-reviewer **environment** protection rules are GitHub **Enterprise-only** on private repos. On Pro+private the `migrate-production` / `deploy-production` jobs no longer pause; the human gate is now solely the `main` → `production` promotion PR (branch protection: CI + an approving review + conversation resolution). Acceptable while solo. Docs updated: `deploy-api.yml`, `docs/internal/ops/DEPLOYMENT.md`, `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`, `docs/internal/ci-cd/AGENT_INFRA.md`, `spec/environments/README.md`.
- **GitHub Actions minutes are now metered** (public repos are unlimited; private on Pro includes 3,000 min/month, then per-minute overage). The CI suite is heavy. A dedicated CI-cost/efficiency audit is **deferred to its own effort** — intentionally not done in this change.
- **GitHub-native secret scanning, push protection, and code scanning stop** (public-repo-only / otherwise require paid GitHub Advanced Security). Mitigation: a local `gitleaks` pre-commit + CI check replaces the lost push protection — **implemented in ADR-17** ([`docs/internal/ci-cd/SECRET_SCANNING.md`](../../docs/internal/ci-cd/SECRET_SCANNING.md)).
- **The repository's past is already disclosed.** One public fork existed at flip time; GitHub detaches it into its own network (it is not retracted), and any prior clone retains the public history. A full-history secret scan on 2026-05-31 (provider-pattern + assignment-pattern across all 50 commits, plus a committed-file check) found **no leaked secrets**, so nothing required rotation — but treat all pre-2026-05-31 history as potentially public regardless.
- **CodeRabbit's free OSS tier no longer applies** — a private repo needs a paid CodeRabbit plan. Other integrations authenticate via the GitHub App / deploy hooks (Vercel, Render, EAS, Infisical, Claude Code on the web) and are unaffected by visibility.
- **Stars/watchers were erased** by the visibility change (cosmetic; the project had ~1 of each).

**Trigger to revisit:**

- The project open-sources again for adoption/marketing (would restore free Actions + GitHub Advanced Security and the public-tier integrations).
- Metered Actions cost exceeds budget (drives the deferred CI-efficiency audit).
- Additional human collaborators are added — reconsider real approval gates (and whether GitHub Enterprise's private-repo environment protection is worth a true production-deploy approval pause).

### ADR-14: Code review — CodeRabbit → self-hosted Claude review GitHub Action (2026-06-01)

**Decision:** Replace CodeRabbit with a self-hosted automated PR review that runs `anthropics/claude-code-action@v1` in a GitHub Actions workflow (`.github/workflows/claude-review.yml`), authenticated with a Claude Pro/Max **subscription OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN`). It runs **two tiers** — an in-depth **Opus 4.8** pass on PR open/reopen/ready, and a lighter **Sonnet 4.6** pass on each push (`synchronize`) — doing a unified **security + general** review that posts inline comments plus a summary. *(Superseded by the 2026-06-03 amendment below: now Opus-only, once on open + on-demand `@claude review`, never on push.)* A separate **`claude-review-gate`** job makes it a **required check that blocks merge only when the review reports an Important finding**; the `claude-review-override` label bypasses a false positive, and bot/draft/fork/no-token runs pass. Repo-specific lessons accumulate in `.github/claude-review/learnings.md` (read every run). CodeRabbit (`.coderabbit.yaml` + the GitHub App) is removed.

**Rationale:** On private + Free, CodeRabbit posts summary/rate-limited reviews only; its assertive line-by-line config (apps/api auth-guard/permission coverage, migration RLS) needs paid Pro (~$24/dev/mo). Frapp already pays for Claude (Max), so an OAuth-token Action gives an Anthropic-native reviewer with **no new per-token bill** (it draws on existing subscription quota) and full control of the review rubric. The dedicated `claude-code-security-review` action is API-key-only, so the OAuth path uses the general `claude-code-action` with a custom security+general prompt. This reuses the same engine as the local `/code-review` skill the `/next` flow already mandates pre-PR.

**Consequences:**

- Review usage consumes **metered GitHub Actions minutes** (ADR-13: 3,000/mo on Pro) on top of the existing heavy CI suite — reviewing **every push** (Sonnet) plus every open (Opus) makes the deferred CI-cost audit more pressing — and **Claude Max subscription quota** (Opus burns quota fastest; heavy PR bursts can throttle interactive Claude use). Mitigations: Sonnet (not Opus) on pushes, concurrency auto-cancel, scoped read-only + comment tools, and one-line knobs to drop `synchronize` or add a `paths:` filter.
- Inline line-level comments are posted via the action's `github_inline_comment` MCP tool and work under OAuth auth.
- **The gate decouples blocking from the action's flaky exit code.** The review emits a `--json-schema` `structured_output` (plus a `<!-- claude-review-verdict: important=N -->` marker as fallback); a separate `gate` job fails only when `important > 0`. The gate **always reports a conclusion** (so a required check never hangs "pending") and passes for bot/draft/fork/no-token/skipped runs — avoiding the action's known permanent-red-required-check failure mode (`claude-code-action#1299`) and spurious non-zero exits (`#846`). It becomes required via `scripts/configure-branch-protection.mjs`, applied **after** the workflow is merged and verified green.
- **`enforce_admins: true`** means even the solo author cannot bypass a required check except via the `claude-review-override` label — so "Important" is reserved for genuinely merge-blocking issues, and the label is the deliberate, auditable escape hatch.
- **Trusted-PRs-only:** the action runs with `pull-requests: write` and is not hardened against prompt injection, so the workflow skips draft and fork PRs. Revisit if external contributors are added (and enable Actions' "require approval for all external contributors").
- Review rubric lives in `.github/claude-review/review-guidelines.md` (ports the old `.coderabbit.yaml` path instructions). Runbook: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md` (replaces `CODERABBIT_RUNBOOK.md`). Requires a one-time `CLAUDE_CODE_OAUTH_TOKEN` repo secret and uninstalling the CodeRabbit GitHub App.
- **Dependency audit** remains uncovered (CodeRabbit never did it; tracked separately). **Secret scanning is now implemented** via gitleaks — see ADR-17 (per the ADR-13 mitigation).
- **Amendment (2026-06-01, #599) — the gate no longer fails open on an *incomplete* review.** A `claude-review` job that was *expected* to run (token present; not draft/fork/bot) but produced **no fresh verdict for the current head SHA** now **blocks** merge ("review didn't complete — re-run, or add `claude-review-override`"), closing the hole where a transient action/API failure left a green required check with no review actually performed. A *fresh* verdict still passes even if the action process exits non-zero (preserving the #846 decoupling): the verdict marker now carries `sha=<head_sha>` and the gate accepts only a SHA-matched marker (or the per-run `structured_output`), so a prior commit's verdict can't mask a failed run. Intentional skips (no token, draft, fork, bot, override) still pass. The decision logic moved from inline shell to the unit-tested `scripts/ci/evaluate-review-gate.mjs` (covered by the `ci-scripts-tests` job). **Trade-off:** a transient review failure now blocks merge until the review is re-run or the `claude-review-override` label is applied. A structural consequence: a PR that *edits `claude-review.yml`* fails `claude-code-action`'s workflow-validation guard (it requires the workflow file to be identical to the default branch) → no token → no verdict → the gate blocks it; land such changes behind the override label or merge them before the gate is required.

- **Amendment (2026-06-03) — review once on open + on-demand `@claude review`; drop per-push (`synchronize`) reviews; Opus-only.** The per-push Sonnet tier created an open-ended *review→fix→push→review* loop that drained both Actions minutes and subscription quota (acute with the imminent Max-5× → Pro downgrade, ~80% less quota). A 2026-06-03 market scan found no external tool clearly better under the constraints (free or ≤$10/mo flat, ~100 private PR reviews/mo, CodeRabbit-like UX): CodeRabbit Pro (~$24–30/mo) is over budget and free-on-private is summary-only (the original ADR-14 rationale still holds); Gemini Code Assist's free GitHub reviewer is genuinely free + on Google infra but its free tier is reportedly sunsetting (~2026-07-17); Greptile/Cursor BugBot are per-PR; Qodo/PR-Agent self-host still spends Actions minutes + per-token. So we kept the in-house reviewer and **reconfigured it**: a single full **Opus 4.8** review on `opened`/`reopened`/`ready_for_review`, **no `synchronize` trigger**, and an on-demand re-review when a collaborator comments **`@claude review`** (added `issue_comment` trigger, gated by `author_association ∈ {OWNER, MEMBER, COLLABORATOR}` because that event runs with base-repo secrets). The Sonnet/incremental tier is removed. **Gate mechanics changed:** because an `issue_comment`-triggered run's implicit check-run attaches to the default-branch head (not the PR head), the gate (job renamed **`claude-review-gate-runner`**) now **posts an explicit `claude-review-gate` commit status to the resolved PR head SHA** — a commit status satisfies a required-check context ([about status checks](https://docs.github.com/articles/about-status-checks)), and the job is *not* named `claude-review-gate` so a same-named check-run + status don't *both* become required. A new `claude-review-context` job resolves PR number / head SHA / override label uniformly across both event shapes, and `evaluate-review-gate.mjs`'s `main()` now emits `gate_state`/`gate_desc` and always exits 0 (the posted status, not the exit code, is the signal). **Trade-off / UX:** pushing fixes is free but leaves the new head SHA with no gate status (branch protection shows "Expected") — to merge, run `@claude review` on the final commit or apply `claude-review-override`. Runbook: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

- **Amendment (2026-06-04) — the CI Claude review is removed entirely; review moves to a local pre-push gate.** The GitHub Actions reviewer (`.github/workflows/claude-review.yml`), the `claude-review-gate` required check (and its `claude-review-gate-runner` job + `evaluate-review-gate.mjs` decision logic and tests), the `.github/claude-review/` rubric + learnings, and the `CLAUDE_CODE_OAUTH_TOKEN` dependency are **all deleted**. Even reconfigured to Opus-once-on-open, the CI reviewer was not working as designed and carried disproportionate machinery (gate status plumbing across two event shapes, the override label, fork/draft/no-token special-casing, branch-protection coupling). **Replacement:** a local Claude Code **PreToolUse hook** (`.claude/hooks/pre-push-review-gate.sh`, wired in `.claude/settings.json`) gates `git push` — the first push of each branch HEAD is blocked with guidance to run the built-in **`/code-review`** skill in-session on the diff; a HEAD-keyed, session-scoped sentinel makes it deny-once-then-allow (no loop), and a new HEAD (after committing fixes) re-gates so the review always covers what is pushed. This is now the **single** pre-PR review gate (the `/next` flow no longer runs `/code-review` as a separate step — the push hook drives it once). Review sub-agents inherit the session model (Opus): the `CLAUDE_CODE_SUBAGENT_MODEL` Sonnet pin is also removed from `.claude/settings.json`. **Trade-offs:** review now happens on the author's machine before the PR exists (no server-side enforcement on merge, and no inline GitHub review comments) — acceptable for a solo project where every PR is authored by an agent that runs the gate; and a PreToolUse hook can only *instruct* Claude to run `/code-review` (it cannot invoke a skill), so the gate reliably interrupts the first push per HEAD rather than hard-blocking. `claude-review-gate` is removed from `scripts/configure-branch-protection.mjs` and de-required via `npm run configure:branch-protection`. Runbook updated: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

- **Amendment (2026-07-30) — the gate is satisfied by `/diff-review`, a project skill.** ⚠️ **The premise stated in this amendment was measured wrong; see the 2026-08-01 amendment below for the corrected rule. The conclusion — keep `/diff-review` — still holds, for different reasons.** The 2026-06-04 amendment above assumed the hook could "instruct Claude to run `/code-review`". It cannot: `/code-review` is **author-locked against model invocation**. It has no file on disk — it is a native command compiled into the Claude Code binary with `disableModelInvocation` hardcoded at its registration site, and that lock resolves *before* user settings, clamping the skill to `user-invocable-only` at best. The sole escape hatch is the runtime `userTypedThisTurn` condition, so ~~only a human physically typing `/code-review` can run it~~ (**wrong — see below**); a `skillOverrides` entry is a verified no-op. In practice every agent session stalled at the gate waiting for a keystroke. **Replacement:** [`.claude/skills/diff-review/SKILL.md`](../../.claude/skills/diff-review/SKILL.md) — a project skill that is model-invocable (it simply omits `disable-model-invocation`) and reproduces the bundled workflow: scope the diff, fan out parallel finder subagents per angle, run **one independent verifier subagent per candidate** (`CONFIRMED`/`PLAUSIBLE`/`REFUTED`), then report once via `ReportFindings`. It additionally encodes repo-specific invariants as first-class angles — `chapter_id` scoping and chapter-scoped role lookups (load-bearing given ADR-13's application-layer-only isolation: RLS is enabled with no permissive policies and the API holds the `service_role` key that bypasses it), permission decorators, the PGlite migration gate, the doc-sync mandate, Linear-not-GitHub, and verification honesty. Deliberately **not** named `code-review` (precedence against a native command is untraced, and a silent shadowing failure would make the gate look satisfied while nothing ran) and deliberately **not** `context: fork` (which would move `ReportFindings` into a subagent where the host UI cannot render it). **Trade-offs:** the gate is now self-certifying — the same agent writes the code and triggers its review — so the per-candidate verifier pass is what keeps it honest and must not be weakened; and we no longer inherit upstream improvements to the bundled reviewer. Humans should still prefer `/code-review`, which is richer (cloud `ultra` mode, `--fix`, `--comment`).

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
- The required checks (the eight CI jobs + `docs-spec-sync`, and `branch-policy` on production) are never path-gated and keep reporting on every PR; branch protection is untouched. *(ADR-14's `claude-review-gate` was removed in the 2026-06-04 amendment. The "never path-gated" half no longer holds — see the 2026-08-19 amendment.)*
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

### ADR-16: Project management — retire the in-repo backlog, adopt Linear as canonical (2026-06-01)

**Decision:** Adopt **Linear** as Frapp's canonical project-management system and **retire the in-repo markdown backlog** (`docs/backlog/`) and its "GitHub issues mirror the backlog; repo wins" doctrine. Linear becomes the source of truth for planning and work status; **GitHub issues remain the executable layer**, linked two-way to Linear via Linear's GitHub integration (PRs/branches link by issue ID; `Closes`/`Fixes`/`Resolves ABC-123` auto-transitions the Linear issue on merge; comments/status/assignee sync both ways). All three actors reach it: **Claude Code and Cursor via Linear's hosted MCP server** (`https://mcp.linear.app/mcp`, OAuth 2.1), **GitHub via the native integration**, and **automations via Linear's GraphQL API** (`https://api.linear.app/graphql`). This **reverses** the decision recorded in `docs/backlog/_meta/conventions.md` ("no GitHub Projects board; the backlog is the single source of truth"). The integration design, state/label mapping, ownership boundary, and provisioning runbook lived in `docs/internal/ci-cd/LINEAR_PM.md` (deleted 2026-08-08 with the Linear retirement — see amendment 5; successor: [`GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md), history in git).

**Rationale:** The flat-file backlog is diff-able and agent-readable but a poor *human* PM surface — no board, no prioritization UI, manual `/triage` reconciliation, and it goes stale as fast as the code. GitHub Projects was rejected before and is **unreachable from the cloud agent** (no Projects MCP tool; no `gh` CLI in the web sandbox). Linear is the one option **all three actors can natively use**: an official remote MCP server usable by both Claude and Cursor, best-in-class two-way GitHub sync, and first-class AI-agent support. It gives the human a real board without cutting agents off from status.

**Consequences:**

- **Staged, not flip-the-switch.** This decision ships as *rails only* (this ADR + `LINEAR_PM.md` + the Cursor-automation maintenance evolution + config scaffolding). **The in-repo backlog stays operational and authoritative until the cut-over** — retiring it before Linear is live would strand the project with no tracker. The cut-over (provision Linear, install the GitHub app, OAuth the MCP into Claude + Cursor, import issues, repoint `/triage` `/status` `/next-task`, freeze/delete `docs/backlog/`) is a tracked follow-up issue, driven by the user because it needs external accounts/OAuth a sandbox can't perform.
- **MCP-availability risk, mitigated.** Making Linear canonical means agents depend on the Linear MCP, which (like any MCP server) can drop mid-session. Mitigation: **GitHub issues stay the synced, always-available read/execute surface** — when Linear MCP is down, agents fall back to GitHub issues (kept in sync by the integration) and PRs still close work via `Closes #N`.
- **Cursor's suggestion automation is unchanged for now** — it keeps filing/maintaining GitHub `suggestion` issues (its intake surface), which Linear ingests via sync. Its ownership boundary (only touch `suggestion`-labeled issues) is reaffirmed and carries into the Linear world. Whether Cursor should file directly into Linear post-cut-over is a separate follow-up.
- **Tooling churn at cut-over.** `/triage`, `/status`, `/next-task`, the SessionStart hook, and the `docs/backlog/` doctrine in `AGENTS.md` / `DOCUMENTATION_CONVENTIONS.md` all change when Linear becomes canonical; that work lands in the cut-over PR, not here.
- **Cost.** Linear is paid SaaS (a free tier exists); a workspace + the GitHub integration + one API key for automation are required. Provisioning steps are in `LINEAR_PM.md`.

**Trigger to revisit:**

- Linear's MCP/API reliability proves too flaky for agent workflows → reconsider keeping a generated in-repo snapshot as the agent-facing read surface, or revert to the flat-file backlog.
- Cost or team changes make a different tool (or self-hosted Plane) preferable.
- The cut-over follow-up surfaces a blocker (e.g. GitHub↔Linear sync can't preserve the `suggestion`/`area`/`severity` taxonomy) that makes full retirement unwise → keep the hybrid (Linear for humans, GitHub/backlog for agents) instead of retiring.

#### ADR-16 amendment — cut-over executed (2026-06-02)

The cut-over (originally tracked as the rails-only follow-up) has shipped. This amendment records the
choices made; the original decision above stands. Details + policy lived in
`docs/internal/ci-cd/LINEAR_PM.md` (now [`GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md) — amendment 5).

- **Access model corrected to native MCP only.** Both Claude Code and Cursor reach Linear through the
  **native Linear MCP** (the web environment injects it for cloud Claude; Cursor is natively integrated).
  **No Linear API key** is minted, used, or committed — the original ADR's "automations via the GraphQL
  API key" path is **dropped**. If a background automation can't reach the MCP, that is a hard blocker to
  surface and solve, not to work around with a key.
- **No GitHub read-fallback.** The original "GitHub issues are the always-available fallback read surface"
  hedge is **retired**: `/next` stops when the MCP is down rather than reading a stale tracker. Sync is
  **unidirectional GitHub→Linear** (the GitHub App is installed); new issues are born in Linear.
- **Model chosen:** epics = Linear **Projects**; imported `[Epic]` parents stay as parent issues with
  sub-issues; **Triage inbox ON** as intake; **no Initiatives, no Cycles**.
- **Lean taxonomy:** `severity:*` → native **Priority**; `area:*` stays a label group; keep `suggestion`
  + `stale`; **drop** `agent-ready`; `blocked` → blocked-by **relations**; `enhancement` → `Improvement`.
- **Deleted:** the `docs/backlog/` tree and the `/triage` `/status` `/next-task` commands (replaced by
  `/next`); the SessionStart hook no longer summarizes a backlog. Git history is the archive.
- **Free-tier cap policy:** active issues are capped at 250; only **auto-archive** (a Team Setting)
  reclaims slots; cap remediation is confirm-then-act and reversible. *(Superseded by amendment 3: the 250
  cap is on **active = Started+Unstarted**, not non-archived/Backlog — so Backlog growth never trips it.)*
- **Cursor automation migration is gated on a capability probe.** The suggestion automation keeps filing
  GitHub `suggestion` issues (which sync in) until a probe verifies what a Cursor **background** automation
  can do against Linear; the target is a **two-automation** (creation + triage) system writing via native
  MCP. See [`docs/internal/ci-cd/ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md) *(named
  `CURSOR_AUTOMATIONS.md` at the time; renamed in amendment 4)*.

#### ADR-16 amendment 2 — probe results; Cursor is key-led; cap/sync corrections (2026-06-02)

The capability probe (amendment 1) has run and corrects three things in amendment 1:

- **Cursor automations are NOT keyless.** The probe proved a Cursor **headless background** agent has **no
  Linear MCP and no Linear credentials**. So amendment 1's "native MCP only / no API key" is wrong for
  Cursor: the two automations authenticate with a **`LINEAR_API_KEY`** (a Cursor cloud-agent secret)
  against Linear's **GraphQL API**. (Claude-web still uses its injected native MCP; that part of amendment
  1 stands.) The original ADR's "automations via the GraphQL API key" path is **reinstated** for Cursor.
- **Cursor migration is no longer "gated on a probe" — it is built.** Two **Linear-native** automations
  replace the single GitHub `gh` flow: a **curator** (creates + maintains `suggestion` issues in Linear)
  and a **triage** pass (prioritize/bucket/promote). **Hard rule: all issues are opened in Linear, never
  GitHub; work is closed via GitHub PRs and the integration syncs.**
- **Cap policy corrected:** auto-archive is **automatic and free by default** (Done ~28d, Canceled ~7d;
  tunable under *Team Settings → Issue statuses & automations*), and **archived issues don't count toward
  the 250**. Amendment 1's "only auto-archive, a Team Setting the maintainer must enable" overstated it.
- **Sync:** treat Linear↔GitHub as kept in sync by the integration (issues open in Linear, close via PRs);
  the "strictly unidirectional" framing in amendment 1 is relaxed to that workflow description.
- **Estimates/Triage:** team uses Fibonacci estimates and **requires an explicit Priority to leave Triage**
  (promotions set Priority). See `LINEAR_PM.md` (now [`GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md) — amendment 5)
  and [`ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md) *(then `CURSOR_AUTOMATIONS.md`)*.

#### ADR-16 amendment 3 — the 250 cap binds on *active* (Started+Unstarted), not Backlog (2026-06-03)

Corrects the loose use of "active" in amendments 1–2 (which read it as "non-archived"). Linear's Free
plan caps **active** issues at **250**, and Linear defines **active = Started + Unstarted** (In Progress +
Todo) — explicitly **not Backlog, Completed, or Canceled**
([Default team pages](https://linear.app/docs/default-team-pages)). So **Backlog and archived issues do
*not* count toward the 250.**

- **Verified empirically (`/next`, 2026-06-03):** this workspace holds **276 non-archived** issues — **260
  Backlog**, ~2 active — and **new-issue creation still succeeds** (FRA-280 was filed at 276). Being well
  over 250 non-archived with creation working proves the cap is **active**-scoped, not total/Backlog.
- **Impact on the curator:** its cap-guard must count **active** (`state:{type:{in:["started","unstarted"]}}`),
  **not** the open-`suggestion` set (which includes Backlog and reads ~250+ even when active is ~2) — else
  it needlessly refuses to file. The Backlog stays lean by **choice** (signal quality for `/next`), not by
  platform limit. Auto-archive (am. 2) still tidies the board but is **not** load-bearing for the cap.
- Policy + the corrected guard lived in `LINEAR_PM.md` § *Free-tier cap and auto-archive* —
  retired with Linear (amendment 5; original text in git history). GitHub Issues has no
  active-issue cap: see [`GITHUB_PM.md` § No platform caps](../../docs/internal/ci-cd/GITHUB_PM.md#no-platform-caps).

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
  opportunistically when refreshed.

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

### ADR-17: Secret scanning — gitleaks pre-commit + CI gate (2026-06-03)

**Decision:** Implement the ADR-13 secret-scanning mitigation with [`gitleaks`](https://github.com/gitleaks/gitleaks) at three layers that share **one pinned binary and one `/.gitleaks.toml`** (`[extend] useDefault = true` + a tight allowlist), all routed through `scripts/scan-secrets.mjs`: (1) a **pre-commit hook** (`.githooks/pre-commit`, wired via `core.hooksPath` by the root `prepare` script `scripts/setup-git-hooks.mjs` — zero new npm deps) scanning staged changes; (2) **`npm run ci:local-gate`**, which now range-scans the branch's commits; and (3) a **`secret-scan` CI job** in `ci.yml` — fast and standalone (no `npm ci`; fetches the pinned binary via the checksum-verified `scripts/install-gitleaks.sh`), scanning only the PR/push commit range and registered as a **required check** in `scripts/configure-branch-protection.mjs`. The adoption-time claim that a full-history audit found no existing leaks, so no baseline ships, **no longer holds**: the 2026-08-15 audit (#851) found five historical findings — all triaged as false positives, none rotatable — so **a `/.gitleaks-baseline.json` now ships** with those five accepted fingerprints, generated `--redact` (no secret values). Without it the audit command exits non-zero on every run. Do not delete it as a stray artifact; regenerate it only alongside a new audit-record entry, and only from a clone with the full ref set. Runbook: [`docs/internal/ci-cd/SECRET_SCANNING.md`](../../docs/internal/ci-cd/SECRET_SCANNING.md).

**Rationale:** ADR-13 removed GitHub-native secret scanning + push protection (GHAS-only on private), and ADR-14's Claude review is not a reliable secret scanner. gitleaks is the de-facto OSS scanner: a single static binary, no service or per-token bill, with a maintained default ruleset for common provider/assignment patterns. **CI is the real server-side enforcement** that replaces push protection (a pre-commit hook alone is bypassable with `--no-verify`); the hook is the fast local primary that keeps most secrets from ever being committed. A **raw pinned binary** is used over `gitleaks/gitleaks-action` so local and CI run the identical version + config (no drift), stay license-free, and match the repo's hand-rolled `run:`-step CI. Scanning only the **commit range** (not full history every run) respects the ADR-13/ADR-15 metered-minutes budget — the job needs no `npm ci` and adds well under a minute.

**Consequences:**

- A new **required** `secret-scan` check, rollout-gated like the ADR-14 review gate: codified in `configure-branch-protection.mjs` but enforced only once the job exists on the target branch and has run green (applying branch protection is a manual PAT step). Until applied it still runs and surfaces failures, just non-blocking.
- Devs get the hook automatically on `npm install` (the `prepare` script sets `core.hooksPath`). The binary lands in a gitignored `.cache/gitleaks/` on first scan, or any `gitleaks` on `PATH` (e.g. Homebrew) is used. Offline, the hook/local-gate degrade to a warning (`--soft-missing`); CI is the hard gate. Emergency bypass: `git commit --no-verify`.
- False positives are managed via inline `gitleaks:allow`, a tight `/.gitleaks.toml` `[allowlist]`, or `/.gitleaks-baseline.json` (auto-detected) — the baseline is no longer hypothetical: one ships, with five accepted fingerprints, and deleting it turns the audit command red. The pinned version lives once in `scripts/install-gitleaks.sh` (`GITLEAKS_VERSION`); bumping it updates all three layers.

**Trigger to revisit:**

- The repo re-opens or adopts GitHub Advanced Security → native push protection returns and the CI job can become redundant.
- Recurring false positives or a need for shared org config → tune `.gitleaks.toml`, re-baseline (a baseline is already adopted), or move to a managed scanner.
- Metered-minute pressure → the job is already minimal, but it can be folded into an existing job or made `paths`-aware.

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
  - **The sparse half is new work — it does not exist yet.** `apps/api/src/application/services/search.service.ts` (global search) is four parallel `ILIKE '%q%'` scans with no ranking or scoring, and the repo's only `tsvector`/GIN index is on `chapter_directory` (the global onboarding autocomplete), not on chapter content. A content-side `tsvector` is part of the corpus work.
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
  - Two things this decision does **not** cover. `check:migration-safety` rejects any change set touching `supabase/migrations/` without a matching update to `docs/internal/ops/DB_PROMOTION_RUNBOOK.md`, `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`, or `spec/environments/` — budget for that doc update in the corpus migration PR. And **neither pgvector version is pinned by this decision**: the landmark asserts the extension is *available*, never which version, so the PGlite-side build moves with any `@electric-sql/pglite-pgvector` bump and the hosted Supabase build moves independently of both. Treat the 0.8.1 above as "what was measured on the day", not a guarantee — if a corpus migration ever depends on version-gated pgvector behavior, read the version on both sides rather than inferring either from this gate passing.
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

Chapter theming runs deeper than an accent chip — it themes the entire experience (sidebar, headers, chat bubble accents, message highlights, mention pills, reaction highlights). A chapter picks **two colors only**: `branding.colors = { dark, accent }`. The product-facing description is in [`product/positioning.md`](../product/positioning.md); the derivation is canonical here.

### Palette derivation

`derivePalette({ dark, accent })` (in `packages/chapter-theme/`) returns the full CSS-variable token map the client writes onto `:root` per active chapter:

- `--side-bg` — chapter dark tinted toward ink for legibility (mix 70% chapter-dark + 30% neutral ink).
- `--side-accent` — the accent.
- `--brand-band` — accent at low saturation, for header strips.
- `--mention-bg`, `--mention-fg` — derived from the accent with contrast guarantees.
- `--chat-self-bubble` — accent at 8% over bone.
- `--reaction-active` — accent.
- `--ring` — accent.

### WCAG validation and fallback

Every derived token is WCAG-validated against **both** the bone (light) and ink (dark) backgrounds. If a token fails AA 4.5:1 against either, it falls back to bronze **for that token specifically** — never the whole palette. Validation reuses `packages/theme/src/accent.ts`.

### Computation and caching

The palette is rebuilt **server-side** whenever `branding.colors` changes (via `POST /chapters/:id/theme-palette`, also triggered automatically by a config PATCH that touches colors) and cached in `chapters.theme_palette`. Clients read it through `useChapterTheme()` and write the CSS variables on `:root` on each chapter switch — no client-side recomputation on read. The Theme settings tab computes a live preview from the controlled form state (not a cached value) before save.

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

### Background sync on silent push

A silent push handler wakes the app to sync new messages when the websocket isn't alive, keeping unread counts honest without a foreground session. Native channel categorization splits announcements / mentions / DMs into separate iOS Notification Center groups and Android channels. Burst bundling and presence-aware suppression match the web push rules (ADR-04, ADR-09).

### Voice memos

The mobile composer records a voice memo, uploads it to Supabase Storage (pre-signed upload, same flow as other attachments), and sends it as `kind="audio"` with waveform metadata in `payload`. Web renders the `audio` card with waveform playback — the renderer is shared, so a memo recorded on mobile plays back on web.
