# Architecture Specification: Frapp

---

## 1. High-Level Stack

| Layer         | Technology                                   | Notes                                                                                                                                                                  |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo      | Turborepo + npm workspaces                   | Single repo, task orchestration, caching.                                                                                                                              |
| Landing       | Next.js (App Router)                         | `apps/landing` at frapp.live. Static/SSG for speed.                                                                                                                    |
| Web App       | Next.js (App Router), Tailwind, ShadCN UI    | `apps/web` at app.frapp.live. Admin dashboard.                                                                                                                         |
| Mobile App    | Expo (React Native), Expo Router, NativeWind | `apps/mobile`. Member experience. iOS + Android.                                                                                                                       |
| Developer docs | Markdown in-repo                         | [`docs/guides/`](../docs/guides/README.md) + `spec/`. No deployed docs web app; a public site may return post-launch. |
| API           | NestJS 11, TypeScript (strict)               | `apps/api`. REST + WebSocket gateway.                                                                                                                                  |
| Database      | PostgreSQL (via Supabase)                    | Supabase-hosted Postgres. Migrations via Supabase CLI.                                                                                                                 |
| Auth          | Supabase Auth                                | Email/password, magic link, OAuth.                                                                                                                                     |
| Storage       | Supabase Storage                             | Private buckets for Backwork and chat files. Signed URLs.                                                                                                              |
| Realtime      | Supabase Realtime                            | Postgres changes for chat. Broadcast for typing indicators. Presence for online status.                                                                                |
| Billing       | Stripe                                       | Subscriptions, checkout, webhooks, invoices.                                                                                                                           |
| Push          | Expo Push Service                            | Mobile push notifications via `expo-server-sdk`.                                                                                                                       |
| Observability | Sentry + structured logging                  | Error tracking, request tracing, metrics.                                                                                                                              |
| CI/CD         | GitHub Actions + Vercel + EAS                | Lint, typecheck, test, deploy.                                                                                                                                         |

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

- **Authoring:** Developer guides in **[`docs/guides/`](../docs/guides/README.md)**; product and architecture in **`spec/`**. Read and edit in GitHub or your editor; there is no separate Next.js documentation deployment in this repo for now.
- **Spec rendering:** Previously the removed docs app rendered `spec/*.md` in a browser. Today, use the repo view on GitHub (or a local markdown preview). A future public docs site may restore styled rendering.
- **Sync rule:** When behavior, architecture, or workflows change, update **`docs/`** and/or **`spec/`** in the same change set. Divergence is a bug.
  - **Enforcement:** CI fails PRs that change product code without also updating **`docs/`** or **`spec/`**. See [`docs/internal/DOCS_CI.md`](../docs/internal/DOCS_CI.md).
  - **Workflow:** The PR template requires a “Docs / Spec impact” section; treat “None” as an explicit claim that reviewers should challenge.

---

## 4. Shared Packages

| Package                   | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `@repo/api-sdk`           | Auto-generated TypeScript client from OpenAPI spec. Used by web + mobile. |
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

**members** — `id`, `user_id` (FK users), `chapter_id` (FK chapters), `role_ids` (text[]), `has_completed_onboarding` (bool, default false — controls onboarding tutorial display), `created_at`, `updated_at`. Unique on (user_id, chapter_id).

**roles** — `id`, `chapter_id` (FK chapters), `name`, `permissions` (text[]), `is_system` (bool), `display_order` (int), `color` (text, nullable, hex string), `created_at`. Unique on (chapter_id, name).

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

**chat_messages** — `id`, `channel_id` (FK chat_channels), `sender_id` (FK users), `content` (text), `type` (TEXT | POLL), `reply_to_id` (FK chat_messages, nullable), `metadata` (jsonb — attachments, link previews, poll data), `is_pinned` (bool, default false), `pinned_at` (timestamp, nullable), `edited_at` (timestamp, nullable), `is_deleted` (bool, default false), `created_at`.

**message_reactions** — `id`, `message_id` (FK chat_messages), `user_id` (FK users), `emoji` (text), `created_at`. Unique on (message_id, user_id, emoji).

**channel_read_receipts** — `id`, `channel_id` (FK chat_channels), `user_id` (FK users), `last_read_at` (timestamp), `updated_at`. Unique on (channel_id, user_id).

### Polls

**poll_votes** — `id`, `message_id` (FK chat_messages, where type = POLL), `user_id` (FK users), `option_index` (int — index into the poll options array in message metadata), `created_at`. Unique on (message_id, user_id) for single-choice polls; unique on (message_id, user_id, option_index) for multi-choice.

### Notifications

**push_tokens** — `id`, `user_id` (FK users), `token` (unique), `device_name` (nullable), `created_at`.

**notifications** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `title`, `body`, `data` (jsonb — includes `target` for deep linking, `priority`), `read_at` (nullable), `created_at`.

**notification_preferences** — `id`, `user_id` (FK users), `chapter_id` (FK chapters), `category` (text), `is_enabled` (bool, default true), `updated_at`. Unique on (user_id, chapter_id, category).

**user_settings** — `id`, `user_id` (FK users), `quiet_hours_start` (time, nullable), `quiet_hours_end` (time, nullable), `quiet_hours_tz` (text, nullable — timezone offset), `theme` (text, default 'system' — light | dark | system), `updated_at`. Unique on (user_id).

### Location & Study

**study_geofences** — `id`, `chapter_id` (FK chapters), `name`, `coordinates` (jsonb — array of {lat, lng}), `is_active` (bool, default true), `minutes_per_point` (int, default 30), `points_per_interval` (int, default 1), `min_session_minutes` (int, default 15), `created_at`.

**study_sessions** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `geofence_id` (FK study_geofences), `status` (ACTIVE | COMPLETED | EXPIRED | PAUSED_EXPIRED | LOCATION_INVALID), `start_time`, `end_time` (nullable), `last_heartbeat_at`, `total_foreground_minutes` (int, default 0), `points_awarded` (bool, default false), `created_at`.

### Financials

**financial_invoices** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `title`, `description` (nullable), `amount` (int, cents), `status` (DRAFT | OPEN | PAID | VOID), `due_date`, `paid_at` (nullable), `stripe_payment_intent_id` (nullable), `created_at`.

**financial_transactions** — `id`, `chapter_id` (FK chapters), `invoice_id` (FK financial_invoices, nullable), `amount` (int), `type` (PAYMENT | REFUND | ADJUSTMENT), `stripe_charge_id` (nullable), `created_at`.

### Service Hours

**service_entries** — `id`, `chapter_id` (FK chapters), `user_id` (FK users), `date` (date), `duration_minutes` (int), `description` (text), `proof_path` (text, nullable — Supabase Storage path), `status` (PENDING | APPROVED | REJECTED), `reviewed_by` (FK users, nullable), `review_comment` (text, nullable), `points_awarded` (bool, default false), `created_at`.

### Tasks

**tasks** — `id`, `chapter_id` (FK chapters), `title` (text), `description` (text, nullable), `assignee_id` (FK users), `created_by` (FK users), `due_date` (date), `status` (TODO | IN_PROGRESS | COMPLETED | OVERDUE), `point_reward` (int, nullable), `points_awarded` (bool, default false), `completed_at` (timestamp, nullable), `confirmed_at` (timestamp, nullable), `created_at`.

### Chapter Documents

**chapter_documents** — `id`, `chapter_id` (FK chapters), `title` (text), `description` (text, nullable), `folder` (text, nullable — single-level folder name), `storage_path` (text — Supabase Storage path), `uploaded_by` (FK users), `created_at`.

### Semester Archives

**semester_archives** — `id`, `chapter_id` (FK chapters), `label` (text — e.g. "Fall 2025"), `start_date` (date), `end_date` (date), `created_at`.

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

**Access control:** All buckets are private. All access goes through API-generated signed URLs (upload and download). No public access.

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
- **Contract freshness check (CI):** `npm run check:api-contract` uses `git diff` to verify that any PR touching `apps/api/src/` also includes updated `openapi.json` and `api-sdk/types.ts`. This avoids bootstrapping the NestJS application in CI, so no Supabase/Stripe credentials are needed.
- **Developer workflow:** After changing an API endpoint: (1) run `npm run openapi:export -w apps/api`, (2) run `npm run generate -w packages/api-sdk`, (3) commit both generated files alongside the source changes.

**Implementation status (Phase 2):** Events (CRUD), Event Attendance (check-in, list, update status), and Points (me, leaderboard, members, adjust) are implemented and included in the OpenAPI spec.

---

## 11. Quality Standards

- **Testing:** TDD encouraged. Minimum 80% line coverage for API modules.
- **Linting:** ESLint (shared config), Prettier for formatting.
- **Type safety:** TypeScript strict mode across all apps and packages.
- **Validation:** Global ValidationPipe (class-validator) on API; Zod schemas shared to clients.
- **Security:** No hardcoded secrets. Input validation on all endpoints. SQL injection prevented by parameterized queries. CORS configured per environment. Rate limiting per user per endpoint (100 req/min read, 30 req/min write). File upload MIME type validation.

## Database Performance

- For complex aggregations, computation should be pushed down to the Postgres database via RPC functions using `this.supabase.rpc('func_name')`.
- This approach avoids querying large amounts of raw data into application memory just to group and calculate totals.
- Examples of this pattern include `get_points_report` which aggregates point transactions by user and category.

## Refactoring Note: TaskStatus Enum

The `TaskStatus` type, originally implemented as a string literal union, has been promoted to a TypeScript string `enum`.
This ensures greater type safety and consistency across `apps/api` DTOs, service transition logic (`VALID_ASSIGNEE_TRANSITIONS`), and other modules utilizing task statuses. This does not change runtime behavior but improves compile-time checks and API documentation generation.
