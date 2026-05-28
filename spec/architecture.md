# Architecture Specification: Frapp

---

## 1. High-Level Stack

| Layer          | Technology                                   | Notes                                                                                                                 |
| -------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Monorepo       | Turborepo + npm workspaces                   | Single repo, task orchestration, caching.                                                                             |
| Landing        | Next.js (App Router)                         | `apps/landing` at frapp.live. Static/SSG for speed.                                                                   |
| Web App        | Next.js (App Router), Tailwind, ShadCN UI    | `apps/web` at app.frapp.live. Admin dashboard.                                                                        |
| Mobile App     | Expo (React Native), Expo Router, NativeWind | `apps/mobile`. Member experience. iOS + Android.                                                                      |
| Developer docs | Markdown in-repo                             | [`docs/guides/`](../docs/guides/README.md) + `spec/`. No deployed docs web app; a public site may return post-launch. |
| API            | NestJS 11, TypeScript (strict)               | `apps/api`. REST + WebSocket gateway.                                                                                 |
| Database       | PostgreSQL (via Supabase)                    | Supabase-hosted Postgres. Migrations via Supabase CLI.                                                                |
| Auth           | Supabase Auth                                | Email/password, magic link, OAuth.                                                                                    |
| Storage        | Supabase Storage                             | Private buckets for Backwork and chat files. Signed URLs.                                                             |
| Realtime       | Supabase Realtime                            | Postgres changes for chat. Broadcast for typing indicators. Presence for online status.                               |
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

**Implementation status (Phase 2):** Events (CRUD), Event Attendance (check-in, list, update status), Points (me, leaderboard, per-member summary, adjust, **chapter-wide transaction list**), and Polls (create in channel, get, vote / remove vote, **chapter-wide list**) are implemented and included in the OpenAPI spec.

**Dashboard list surfaces (permissions):** `GET /v1/points/transactions` is gated by `points:view_all` (same permission as `GET /v1/points/members/:userId` for another member’s summary). `GET /v1/polls` requires `members:view` (controller baseline) plus `polls:view_all` on the list route; it is **not** part of the default Member role seed. Treasurer includes `points:view_all` and `polls:view_all` alongside billing and points tools. Vice President and Secretary system roles include `members:view` and `polls:view_all` so the polls dashboard matches `PollController` guards (see seeded role matrix in [`behavior.md`](behavior.md)). Full query parameters, pagination, and invariants: Points ledger section and **Polls and Voting** in [`behavior.md`](behavior.md).

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
- Examples of this pattern include `get_points_report` which aggregates point transactions by user and category, and `get_poll_vote_option_totals` / `get_poll_user_votes_for_messages` which aggregate poll votes for the chapter poll list.

## Refactoring Note: TaskStatus Enum

The `TaskStatus` type, originally implemented as a string literal union, has been promoted to a TypeScript string `enum`.
This ensures greater type safety and consistency across `apps/api` DTOs, service transition logic (`VALID_ASSIGNEE_TRANSITIONS`), and other modules utilizing task statuses. This does not change runtime behavior but improves compile-time checks and API documentation generation.

## Security Note (2024-03-26)

Rate limiting is enforced globally via `ThrottlerGuard` in `AppModule`.

---

## 12. Chat Hot-Path Architecture (ADRs — Chunk 02)

### ADR-01: Why we split chat to Supabase Edge Functions

**Decision:** Chat hot-path writes (send message, add reaction, action/RSVP) go to Supabase Edge Functions (Deno), not NestJS.

**Rationale:** NestJS runs on a single Render instance (US-East). Edge Functions run at the CDN edge closest to the user, reducing p50 latency from ~150ms (single-region) to <50ms. The hot path is also the highest volume path — routing it past NestJS removes that single point of contention. Cold reads (history backfill, config, reports) stay in NestJS where guards, DTOs, and test infrastructure already live.

**Consequences:** Two write paths to maintain. Zod schemas in `packages/validation` must be importable from both Node.js and Deno (enforced by keeping validation dependency-light: `zod` only).

### ADR-02: Why Supabase Realtime Broadcast for presence/typing

**Decision:** Typing indicators and presence (online/offline) use Supabase Realtime Broadcast, not Postgres Changes.

**Rationale:** Broadcast is ephemeral (not persisted to DB), avoiding write amplification on every keystroke. A 200-member chapter where everyone is typing would generate ~200 rows/second to `presence` if DB-backed. Broadcast routes through the Realtime server without touching Postgres. On disconnect, the presence state naturally evaporates — no cleanup job needed.

**Consequences:** Presence/typing state is lost on server restart. This is acceptable; reconnecting clients re-emit their state within 1s. Persistent state (last-seen cursor, notification preferences) stays in DB.

### ADR-03: Why optimistic + idempotent client UUIDs

**Decision:** Every outbound message carries a client-generated UUID (`client_message_id`). The UI renders the message optimistically before the server confirms. The Edge Function dedupes on `(channel_id, sender_id, client_message_id)`.

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
- **Outbox** rows are enqueued _before_ the `chat-send` invoke; the row's `clientId` doubles as `chat_messages.client_message_id`, which the Edge Function dedupes on (ADR-03). On success the row is dequeued; on a `4xx` it moves to `failed` with an inline Retry/Discard affordance; on network/5xx it stays `queued`. The flush loop iterates `queued` rows oldest-first and **sequentially** so message order is preserved end-to-end.

**Channel-attach ordering (subscribe-then-backfill):** every channel attach — both the **initial join** for a freshly-subscribed channel and every **reconnect** after `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` — runs through the same `SUBSCRIBED` callback in the realtime manager. The callback (a) re-attaches the Postgres Changes subscription first, then (b) calls `GET /v1/channels/{id}/messages?since=<lastSeenMessageId>` via the api-sdk. Gating both paths on the single `SUBSCRIBED` callback guarantees the Realtime listener is genuinely attached before the REST backfill HTTP fires, so any row that lands during the overlap is still caught by the live subscription. The last-seen id is persisted per channel in `localStorage` (`chat:lastSeen:{channelId}`) and advanced only from confirmed tail rows. Subscribe-then-backfill tolerates a harmless overlap (deduped by `mergeServerRow` keyed on both `client_message_id` and server `id`) instead of risking a gap. Backoff between failed resubscribes is 1→2→4→8→16→30s capped.

**Rationale:** Mobile/laptop networks drop; without persistence, a 30-second offline window costs the user their draft and any messages they typed but didn't send. With Dexie + the idempotency index from ADR-03, the user can compose offline, reload the tab, come back online minutes later, and see their messages flush in order with zero duplicates.

**Consequences:** Dexie is web-only; the Expo mobile client uses AsyncStorage/SQLite for the analogue (Chunk 11). The reaction subscription is one **global** `chat_message_actions` channel (the table has no `channel_id` column to filter on); reactions on not-yet-loaded messages are intentionally dropped and recovered on next backfill. Reaction _removals_ go to the row directly under RLS (`chat_message_actions_delete` scopes to own rows) rather than extending `chat-react` with a remove path — keeps the merged security-hardened Edge Function untouched.

### ADR-06: `chat_notification_preferences` is a new table, not a column on `notification_preferences` (Chunk 05)

**Decision:** Chat per-channel + per-kind preferences live in a dedicated table `chat_notification_preferences (user_id, chapter_id, scope text in ('channel','kind'), scope_id uuid|null, scope_kind text|null, level text in ('all','mentions','off'), updated_at)` with a unique index over `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))`.

**Rationale:** The existing `notification_preferences` table is boolean (`is_enabled`) and category-keyed. Chat needs a tri-state level (`all` / `mentions` / `off`) and two scope arms: per-channel (default for muting one channel) and per-kind (default for muting all `system_audit` messages globally). Squatting on `category` to encode `channel:<uuid>` or `kind:system_audit` loses type safety, complicates indexes, and would force a brittle string-parsing layer in the worker. **Alternatives considered:** (a) extend `notification_preferences` with a level column — would orphan every existing row's semantics; (b) inline preferences in `users.metadata` JSON — no DB-enforced uniqueness, hard to query at scale. Migration path: when chat is the last preference producer, a follow-up PR consolidates both tables behind a single view.

**Consequences:** Two preference tables until consolidation. The push worker queries both arms in a single `eq(user_id).eq(chapter_id)` load per recipient and resolves precedence locally (channel-pref ▶ kind-pref ▶ channel-name default). The defaults `(announcements → all, chapter-audit → off, system_audit kind → off, otherwise mentions)` live in `apps/api/src/modules/chat-push-worker/push-rules.ts:defaultLevelFor` so the rule chain is unit-testable without DB seeds.

### ADR-07: `chat-react` UPSERT semantics for poll vote-change (Chunk 05)

**Decision:** When `action_type === 'vote'` and the unique index `(message_id, user_id, action_type)` rejects the INSERT, `chat-react` performs an UPDATE on the existing row — overwriting `payload` (the new `option_id`) and refreshing `created_at` — and returns `{ action, deduplicated:false, updated:true }`. The unique index stays in place; only `action_type='vote'` takes the UPDATE branch. Emoji reactions (`action_type` starts with `reaction:`) keep the 23505 → select-existing dedup path unchanged.

**Rationale:** A poll lets a user change their vote (Mon → Tue). The brief calls vote-change idempotent, but a second INSERT would either duplicate the row or fail; an UPDATE on the existing row keeps "one vote per user per message" enforced by the DB constraint while still letting the option_id move. Distinguishing insert vs UPDATE in the response shape lets the optimistic client merge the new payload onto the same row (`applyActionUpdate` in `apps/web/lib/chat/cache.ts`) without re-inserting into the action list. **Alternatives considered:** (a) per-option `action_type='vote:<option_id>'` — multiplies the action surface and means vote-change is "delete old + insert new", two round-trips; (b) a separate `chat_poll_votes` table — duplicates the dedup index and forks the renderer's data source.

**Consequences:** The `chat_message_actions` row id stays stable across vote-changes, so Postgres Changes broadcasts the new payload as a single UPDATE event. Realtime listeners that only handle INSERT must be extended (the web manager already routes UPDATE through the same path). Poll renderers read tallies from `message.actions` (raw rows with payloads), not from `message.reactions` (aggregated user lists by action_type), because the per-option breakdown is in the payload.

### ADR-08: Audit→chat bridge via NestJS Realtime subscriber (Chunk 05)

**Decision:** The `#chapter-audit` system message is posted by `ChatBridgeWorkerService` (an `OnApplicationBootstrap` lifecycle on a NestJS module) which subscribes to `postgres_changes` on `chapter_audit_log` INSERT via the service-role Supabase client. The previous inline `postAuditMessage` call in `chapter-config.service.ts` is removed; future audit-writing services do nothing chat-related.

**Rationale:** The bridge needs exactly one owner so the format of `system_audit` messages (`payload: { action, actor_user_id, diff }`) doesn't drift across services. **Alternatives considered:** (a) Postgres `AFTER INSERT` trigger calling a PL/pgSQL function — works but is harder to test/deploy/version in lockstep with the NestJS image, and Supabase migrations don't surface trigger failures the way NestJS logs do; (b) inline calls from every audit-writing service — fan-out makes drift inevitable (each new caller copies the prior code, drops a field, forgets the channel lookup). The Realtime subscriber pattern matches how the push worker (ADR-09) ingests `chat_messages` events, so the operational surface is consistent.

**Consequences:** A bootstrap failure (no service-role key, network) means audit rows are written but `#chapter-audit` doesn't mirror — caught by `OnApplicationBootstrap` logging and never throws. Older chapters without a `chapter-audit` channel are tolerated (debug log, skip). Unit tests invoke `handleAuditRow` directly so the row→message mapping is verified without spinning up Realtime.

### ADR-09: Push worker host is the in-process NestJS API, with a documented scaling watermark (Chunk 05)

**Decision:** `ChatPushWorkerService` runs in the same NestJS process as the REST API, subscribing to `chat_messages` INSERT via `OnApplicationBootstrap`. It reuses `NotificationService.notifyUser` (preference-aware + quiet-hours-aware Expo fanout) and the existing `notification_preferences` / `user_settings` tables. The worker is split into a standalone service when **either** `p99 fanout latency > 1s` for sustained periods **or** `worker-loop CPU > 40%` of the API instance. The watermark is enforced via dashboards, not code.

**Rationale:** Standalone deployments cost an extra Render instance, a separate deploy pipeline, and a second source of secrets. At MVP scale (~50 active chapters) the fanout cost is tiny vs the REST request mix, so in-process is the right default. Putting the trigger ahead of time in the ADR means no one has to re-derive when to split. **Alternatives considered:** (a) cron-pull every 10s — adds latency and can miss bursts; (b) standalone Render worker from day one — operational overhead with no payoff at current scale.

**Consequences:** API restarts drop the Realtime subscription for the restart window — the missed messages do not retroactively push (acceptable: cold-path notifications are best-effort). Burst bundling, presence skipping, and preference resolution all run in the same memory space as the REST app; future scaling moves the entire `ChatPushWorkerModule` out without API code changes. Documented in `docs/DEPLOYMENT.md`.

### ADR-10: Supabase Realtime Presence is the presence source — no custom broadcast topic (Chunk 05)

**Decision:** Presence on `chat:channel:<id>` uses Supabase Realtime's built-in Presence API: the web client calls `channel.track({ userId, ts })` from the `SUBSCRIBED` callback in `realtime-manager.ts`; the push worker opens a service-role subscription on the same topic and reads `presenceState()` per channel before fanout.

**Rationale:** A bespoke broadcast topic (e.g. `presence:channel:<id>` with manual heartbeats) would re-implement what Realtime Presence already does — connect/disconnect tracking, a state aggregator, automatic cleanup on socket drop — and create a second source of truth that can drift from the actual subscription state. Presence on the chat channel topic is automatic; we already pay the realtime cost for messages on the same topic. **Alternatives considered:** (a) custom broadcast topic with periodic `still-here` pings — duplicates Presence with more bugs; (b) a global presence map maintained by the API via REST heartbeats — loses ephemerality, creates DB write amplification (ADR-02 anti-pattern); (c) skip presence and always push — trains users to mute notifications (ADR-04 anti-pattern).

**Consequences:** The web client now joins Presence on every active channel — small additional cost on the same socket. The push worker opens a presence subscription per channel it sees a message for (cached for the process lifetime); presence reads are synchronous (`presenceState()`) so the rule chain stays cheap. False negatives (recipient briefly offline) are acceptable; false positives (recipient actively reading) are worse — the rule order skips presence first.

### ADR-11: Agent dev stack — chat hot path moves to in-process NestJS; PGlite for local DB validation (#401)

**Decision:** Two changes, paired to close the cloud-agent testing gap that #401 escalated to a program-level risk.

1. **Chat hot-path writes (`chat-send`, `chat-react`) move from Supabase Edge Functions into the existing NestJS API**, extending `ChatController` (`apps/api/src/interface/controllers/chat.controller.ts`) and mirroring the in-process pattern established by ADR-09's push worker. The Deno surface under `supabase/functions/` retires; `_shared/chat-authz.ts` is replaced by the shared `canAccessChannel` predicate already exported from `@repo/validation`. This reverses the half of ADR-01 that scoped chat writes to Edge — cold reads were already in NestJS and stay there.
2. **A PGlite-backed harness lands under `tools/pglite-harness/`** as a supplemental always-on layer. It applies every `supabase/migrations/*.sql` to a fresh in-process Postgres-in-WASM instance (~323 ms for the current 12-migration set) and asserts the schema landmarks reviewers care about (chat dedupe partial unique index, `chat_message_actions` unique index, `chapter_audit_log` no-update/no-delete RLS, generated `search_vector`). It runs in CI alongside `edge-fn-tests` and from any cloud-agent sandbox without privileged tooling.

The chosen path is Path D + Path C from #401. Path A (per-session Supabase branches) and Path B (rootless Supabase stack inside the sandbox) were investigated and rejected — see Alternatives.

**Rationale:** Four chunks (02, 04, 05) shipped with `Runtime checks BLOCKED — see #235` in `docs/internal/redesign/STATUS.md`. The auth bugs from #233/#234 landed because nobody could runtime-verify the Edge Function. ADR-01's original framing ("edge proximity reduces p50 from ~150ms to <50ms") did not condition on geography: Frapp's user base today is US-centric Greek-life chapters, where the realistic delta between Render US-East and Supabase Edge's US POP is ~15–30ms p50 — fully hidden by ADR-03's optimistic UI. The latency case for Edge does not survive contact with the actual user base. Meanwhile, the testability case for NestJS is overwhelming: Jest + supertest + the existing `SupabaseAuthGuard` (`apps/api/src/interface/guards/supabase-auth.guard.ts`) + the Realtime-capable service-role `SUPABASE_CLIENT` provider (proven by ADR-09's push worker) cover the move with no new infrastructure. PGlite then makes migration validation a 323-millisecond unit-test problem instead of a "spin up Docker" problem, and runs identically in CI and in any sandbox.

**Alternatives considered:**

- **Path A — Supabase branches per agent session** ([#411 comment](https://github.com/pdcarlson/Frapp/issues/411#issuecomment-4559934654)). Architecturally compatible but relocates #401's blocker: the very Supabase MCP tools needed (`create_branch`, `apply_migration`, `deploy_edge_function`) are denied at the sandbox permission layer, and `deploy_edge_function`'s `files[]` has no monorepo awareness (every deploy would have to inline `packages/validation`'s 372 lines). Documented provisioning latency exceeds 60s (Supabase's own Health step waits up to 120s). Cost is fine ($0.01344/hr Micro) but the spike could not run live to confirm.
- **Path B — rootless Supabase stack in the sandbox** ([#412 comment](https://github.com/pdcarlson/Frapp/issues/412#issuecomment-4559937215)). Edge Runtime is Docker-only, Realtime requires Elixir/Erlang with ~daily release cadence, Supabase Postgres ships ~30 extensions with no tarball distribution. Estimated 15–25 maintenance hours/month steady-state, spiking past 40h on PG-major / breaking-auth releases. Maintenance cost prohibitive.
- **Path C alone — PGlite + Deno handler tests** ([#413 comment](https://github.com/pdcarlson/Frapp/issues/413#issuecomment-4559942991)). Covers migration validation and function SQL behavior, but explicitly misses Realtime, Presence, and GoTrue with real JWTs. Not sufficient as the primary path; adopted as supplemental.
- **Path D alone — move chat to NestJS without PGlite** ([#414 comment](https://github.com/pdcarlson/Frapp/issues/414#issuecomment-4559944971)). Closes the integration-test gap but leaves migration validation slow (requires a real Postgres). Pairing with C is cheap and finishes the job.
- **Keep ADR-01 as-is.** Documented elsewhere (every "BLOCKED in sandbox" STATUS row since Chunk 02).

**Consequences:**

- `supabase/functions/chat-send`, `supabase/functions/chat-react`, `supabase/functions/_shared/chat-authz.ts`, the Deno test suite under `supabase/functions/_tests/`, and the `edge-fn-tests` CI job retire once the move ships. The 716 LOC of Deno tests is replaced by Jest tests living next to the moved code.
- Web/mobile clients stop calling `supabase.functions.invoke('chat-send'|'chat-react', …)` and use the existing `packages/api-sdk` `ChatApi` namespace; the SDK regenerates from the extended controller.
- The Realtime broadcast emit currently in `chat-send` (`channel.send`) moves to the NestJS service. ADR-09's push worker already proves the service-role client there can do this.
- ADR-01 is **superseded for the hot path** but stays in this file as historical context (it's still right for the cold-path / Chunk-02 split rationale; the change is "no Edge Functions today" not "no Edge Functions ever").
- PGlite adds one npm dep (`@electric-sql/pglite`, WASM, no native code, no Docker). It does not replace integration testing against the hosted Supabase project — it complements unit + integration tiers.
- Chunks after the move ships drop the "Runtime checks BLOCKED — see #235" disclaimer from `STATUS.md`. #235 scopes down to "PGlite migration-apply check in CI" or closes-as-subsumed.

**Trigger to revisit:**

- **Geography shift.** If Frapp's user base meaningfully expands outside US-East — measured by ≥15% of monthly active chapters resolving to a non-US-East region — re-evaluate moving the hot path back to Edge.
- **New hot path emerges that genuinely benefits from <50ms global p50.** If a future chunk identifies one, that chunk lands its own Edge Function with the testability problem solved per-case (likely a thin function calling NestJS, so most logic stays testable).
- **PGlite drops support for an extension we adopt** (e.g. if we add `pg_cron` or `pg_net` to a migration that PGlite can't load), the harness falls back to a documented "schema-only assertion" mode and the migration's runtime behavior gets a real Postgres in CI.
- **Sandbox unblocks Supabase MCP write tools** (`create_branch`, `apply_migration`, `deploy_edge_function`). Path A becomes runnable; revisit only if we've grown a need for a real Realtime/Edge-Runtime substrate in-loop that PGlite + NestJS unit tests don't cover.
