# Next Steps: Frapp Development Roadmap

> Last updated: 2026-02-27

## Current State

The project has a solid foundation (~15-20% complete):

| Area | Status |
|------|--------|
| Database schema | Done — all tables, indexes, constraints, RLS |
| API architecture | Done — NestJS layered architecture, guards, interceptors, pipes, Swagger |
| IAM modules | Done — Auth, User, Chapter, Member, RBAC, Invite |
| Infrastructure adapters | Done — Supabase repos, Stripe billing service, Storage service, Expo Push provider |
| Unit tests | Done — 55 tests covering existing API services |
| Web / Mobile / Landing / Docs | Scaffolded — no feature screens or content |

---

## Phase 1 — Foundation Completion

These items unblock end-to-end flows. Nothing else is usable without them.

### 1.1 Stripe Webhook Controller

**Why first:** Chapters stay in `incomplete` status forever without webhook processing. The entire onboarding flow is broken past the Stripe Checkout redirect.

**Scope:**
- `POST /webhooks/stripe` controller (no auth guard, signature verification via Stripe SDK)
- Handle `checkout.session.completed` — activate chapter (`subscription_status: active`), store `subscription_id`
- Handle `customer.subscription.updated` — sync status changes (`active` → `past_due`, etc.)
- Handle `customer.subscription.deleted` — mark chapter `canceled`
- Idempotency: deduplicate by Stripe event ID
- Timestamp ordering: reject stale events that would overwrite newer status

**Files to create/modify:**
- `apps/api/src/modules/billing/interface/webhook.controller.ts`
- `apps/api/src/modules/billing/application/webhook.service.ts`
- `apps/api/src/modules/billing/billing.module.ts` (register controller)
- Unit tests for webhook service

---

### 1.2 Web App Authentication

**Why second:** Admins need to log in before they can do anything on the dashboard.

**Scope:**
- Supabase Auth integration using `@supabase/ssr`
- Sign-up page (`/signup`) — email/password, magic link
- Sign-in page (`/signin`)
- Auth middleware (Next.js middleware for session management)
- Protected route layout (redirect to `/signin` if unauthenticated)
- Session token forwarding to API (Authorization header)

**Files to create/modify:**
- `apps/web/src/lib/supabase/` — server + browser client utilities
- `apps/web/src/middleware.ts` — auth session refresh
- `apps/web/src/app/(auth)/signin/page.tsx`
- `apps/web/src/app/(auth)/signup/page.tsx`
- `apps/web/src/app/(dashboard)/layout.tsx` — protected layout shell

---

### 1.3 Web Dashboard Shell + Chapter Setup

**Why third:** After auth, the admin needs to create or view their chapter.

**Scope:**
- Dashboard layout: sidebar navigation, header with chapter name/logo
- Chapter creation flow (name, university, ToS checkbox → Stripe Checkout redirect)
- Dashboard home page: chapter health at a glance (member count, subscription status, recent activity)
- Settings page: chapter profile (name, university, branding)
- Members list page: basic table with role badges, invite button

**Files to create/modify:**
- `apps/web/src/app/(dashboard)/` — dashboard route group
- `apps/web/src/components/` — sidebar, header, data table components
- `apps/web/src/app/(dashboard)/members/page.tsx`
- `apps/web/src/app/(dashboard)/settings/page.tsx`
- `apps/web/src/app/(onboarding)/create-chapter/page.tsx`

---

## Phase 2 — Core Feature Modules (API)

These deliver the highest-value features. Each module follows the established layered architecture pattern.

### 2.1 Points Module

**Why first in Phase 2:** Points are referenced by Events, Study Hours, Service Hours, and Tasks. Building it first unblocks all downstream modules.

**Scope:**
- `POST /points/adjust` — manual adjustment (requires reason, no self-adjustment)
- `GET /points/leaderboard` — ranked members with time-window filter (all-time, semester, month)
- `GET /points/ledger` — transaction history (admin: all members; member: own)
- `GET /points/balance` — current user's balance
- Anti-fraud: rate limiting (50 adjustments/hr), anomaly flagging, no self-adjustment
- Semester archive integration for leaderboard periods

**Permissions:** `points:adjust`, `points:view_all`

---

### 2.2 Events Module

**Scope:**
- Full CRUD: `POST /events`, `GET /events`, `GET /events/:id`, `PATCH /events/:id`, `DELETE /events/:id`
- `POST /events/:id/check-in` — atomic attendance + point award (same transaction)
- `PATCH /events/:id/attendance/:userId` — admin marks EXCUSED / ABSENT / LATE
- `GET /events/:id/attendance` — full attendance list
- Recurring event instance generation (weekly, biweekly, monthly)
- Role-based required attendance (`required_role_ids`)
- Auto-absent: cron or on-demand marking after grace period
- Meeting minutes (`notes` field, admin-editable post-event)

**Permissions:** `events:create`, `events:update`, `events:delete`

---

### 2.3 Backwork Module

**Scope:**
- `POST /backwork/upload-url` — generate signed upload URL
- `POST /backwork` — create resource metadata (after upload completes)
- `GET /backwork` — browse with filters (department, course, professor, semester, year, assignment type, tags)
- `GET /backwork/:id/download-url` — generate signed download URL
- `DELETE /backwork/:id` — admin remove resource
- Auto-vivification: create department/professor records on the fly
- Duplicate prevention: reject on matching `(chapter_id, file_hash)` with 409

**Permissions:** `backwork:upload`, `backwork:admin`

---

## Phase 3 — Communication & Engagement

### 3.1 Chat Module

**Scope:**
- Channel CRUD: `POST /channels`, `GET /channels`, `PATCH /channels/:id`, `DELETE /channels/:id`
- Channel categories: `POST /channel-categories`, `GET /channel-categories`, etc.
- Messages: `POST /channels/:id/messages`, `GET /channels/:id/messages`, `PATCH /messages/:id`, `DELETE /messages/:id`
- Reactions: `POST /messages/:id/reactions`, `DELETE /messages/:id/reactions/:emoji`
- Pin/unpin: `POST /messages/:id/pin`, `DELETE /messages/:id/pin`
- Read receipts: `POST /channels/:id/read`
- Supabase Realtime subscriptions for live message delivery
- Typing indicators via Supabase Broadcast
- Presence tracking via Supabase Presence
- File attachments (signed upload URLs, metadata in message)
- Full-text search

**Permissions:** `channels:create`, `channels:manage`, `announcements:post`

---

### 3.2 Push Notifications

**Scope:**
- `POST /notifications/token` — register device push token
- `DELETE /notifications/token/:tokenId` — unregister token
- `GET /notifications` — in-app notification history
- `PATCH /notifications/:id/read` — mark as read
- `GET /notifications/preferences` / `PATCH /notifications/preferences` — per-category opt-in/opt-out
- Delivery logic: preference check → quiet hours check → persist → push via Expo
- Invalid token cleanup on delivery failure
- Quiet hours enforcement
- Trigger integration points in Events, Points, Chat, Billing modules

---

## Phase 4 — Advanced Feature Modules (API)

### 4.1 Study Hours Module

- Geofence CRUD (`POST /study/geofences`, etc.)
- Session lifecycle (`POST /study/sessions/start`, `/heartbeat`, `/stop`)
- Point-in-polygon validation
- Foreground enforcement (heartbeat timeout, pause/expire logic)
- Points award on completion (min session length, configurable rate)

### 4.2 Service Hours Module

- `POST /service/entries` — log service entry
- `GET /service/entries` — list (own or all for admin)
- `PATCH /service/entries/:id/approve` / `reject` — admin approval workflow
- Auto-award points on approval at chapter-configured rate

### 4.3 Tasks Module

- Full CRUD for tasks
- Status transitions: TODO → IN_PROGRESS → COMPLETED → confirmed by admin
- Admin confirmation + point award
- Overdue flagging

### 4.4 Chapter Documents Module

- Upload/download via signed URLs
- Folder management (flat, one level deep)
- Browse and search by title

### 4.5 Financial Invoices (Member Dues)

- Invoice CRUD (DRAFT → OPEN → PAID → VOID)
- Stripe PaymentIntent integration
- Overdue tracking and notifications
- Financial transaction log

### 4.6 Semester Rollover

- `POST /semester/rollover` — archive current period, start new one
- Bulk role promotion (New Member → Member)
- Once-per-month guard

---

## Phase 5 — Frontend Feature Screens

### 5.1 Web Dashboard Screens

Build each screen as the corresponding API module is completed:

- Roles & Permissions management UI
- Billing dashboard + Stripe Customer Portal link
- Financial Invoices UI
- Events management + attendance viewer + calendar view
- Backwork admin (browse, filter, manage departments/professors)
- Points ledger + leaderboard + audit tab
- Study geofences management (map + polygon drawing)
- Chat admin (channel management, pinned messages)
- Polls management
- Tasks board
- Service hours review queue
- Chapter documents file manager
- Reports & export UI
- Settings (branding, semester rollover, danger zone)

### 5.2 Mobile App Screens

Build in parallel with or after web screens:

- Auth screens (sign-up, sign-in)
- Onboarding tutorial (swipeable walkthrough)
- Home / Activity feed
- Chat (channels, DMs, real-time messaging, reactions)
- Backwork browser + upload flow
- Events list + calendar + check-in
- Study mode screen (timer, geofence map, progress)
- My Points (balance, transactions, leaderboard)
- Notifications center
- Profile + settings
- Member directory
- Tasks view
- Service hours logger
- Chapter documents browser
- Alumni directory
- Polls

---

## Phase 6 — Polish & Infrastructure

### 6.1 Landing Page Content

- Hero section, feature highlights, pricing, testimonials
- Legal pages: Terms of Service, Privacy Policy, FERPA Notice
- CTA links to app.frapp.live

### 6.2 Documentation Content

- Getting started guide (create chapter, invite members)
- Feature guides for each domain
- FAQ and troubleshooting

### 6.3 Observability

- Sentry integration for error tracking
- Structured logging improvements
- Metrics export for dashboards
- Alerting rules

### 6.4 API SDK Generation Pipeline

- `npm run openapi:export` → `openapi.json`
- `npm run generate -w packages/api-sdk` → TypeScript client
- CI step to verify SDK is up to date

### 6.5 Reports & Export

- PDF generation with branded templates (chapter logo, name, Frapp footer)
- CSV export for all report types
- Signed download URLs

---

## Recommended Immediate Next Step

**Start with Phase 1.1: Stripe Webhook Controller.**

It is a small, self-contained, high-impact change that unblocks the entire chapter activation flow. The billing adapter and Stripe service already exist — only the HTTP endpoint and event-handling logic are needed.
