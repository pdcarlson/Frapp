# Frapp — Application Rollout Strategy

> **Historical (2026-02-27 snapshot).** For current documentation layout, see [`docs/README.md`](../../README.md), [`docs/guides/`](../../guides/README.md), and [`spec/`](../../../spec/README.md). Mentions of `apps/docs` or `docs.frapp.live` here reflect the old plan, not the current repo.

> Master plan for completing and launching the Frapp platform.
> Generated from a full codebase audit on 2026-02-27.

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Priority Determination](#2-priority-determination)
3. [Phase 1 — Complete the API](#3-phase-1--complete-the-api)
4. [Phase 2 — Landing Page (Sales-Ready)](#4-phase-2--landing-page-sales-ready)
5. [Phase 3 — Web Dashboard (Admin Experience)](#5-phase-3--web-dashboard-admin-experience)
6. [Phase 4 — Mobile App (Member Experience)](#6-phase-4--mobile-app-member-experience)
7. [Phase 5 — Integration, Polish, and Launch Prep](#7-phase-5--integration-polish-and-launch-prep)
8. [Consistency Audit Findings](#8-consistency-audit-findings)
9. [What Has Been Done So Far](#9-what-has-been-done-so-far)
10. [Risk Register](#10-risk-register)

---

## 1. Current State Assessment

### 1.1 API (`apps/api`) — ~38% Complete

**Implemented (8 domains):**

| Domain         | Controllers              | Services                                     | Repositories                       | Tests | Notes                                                     |
| -------------- | ------------------------ | -------------------------------------------- | ---------------------------------- | ----- | --------------------------------------------------------- |
| Auth/User Sync | — (interceptor)          | AuthService                                  | SupabaseUserRepository             | 3     | JWT validation, user sync from Supabase                   |
| Users          | UserController           | UserService                                  | SupabaseUserRepository             | 3     | GET/PATCH /users/me                                       |
| Chapters       | ChapterController        | ChapterService                               | SupabaseChapterRepository          | 5     | Create, get current, update settings                      |
| Members        | MemberController         | MemberService                                | SupabaseMemberRepository           | 4     | List, role update, onboarding, remove                     |
| Roles/RBAC     | RbacController           | RbacService                                  | SupabaseRoleRepository             | 10    | CRUD, presidency transfer, permissions catalog            |
| Invites        | InviteController         | InviteService                                | SupabaseInviteRepository           | 12    | Generate, batch, redeem with atomic validation            |
| Events         | EventController          | EventService                                 | SupabaseEventRepository            | 8     | CRUD with recurrence, role targeting                      |
| Attendance     | AttendanceController     | AttendanceService                            | SupabaseAttendanceRepository       | 11    | Check-in, grace period, excuse workflow                   |
| Points         | PointsController         | PointsService                                | SupabasePointTransactionRepository | 10    | Leaderboard, time windows, admin adjust, anomaly flagging |
| Health         | HealthController         | —                                            | —                                  | 0     | GET /health                                               |
| Observability  | — (interceptors/filters) | —                                            | —                                  | 1     | RequestId, Logging, AllExceptionsFilter                   |
| Infrastructure | —                        | StripeBillingService, SupabaseStorageService | —                                  | 0     | Stripe + Storage adapters (no endpoints)                  |

**Total: 9 controllers, 9 services, 8 repositories, 84 passing tests.**

**Not implemented (12 domains):**

| Domain                                          | Spec Reference              | Complexity | Priority |
| ----------------------------------------------- | --------------------------- | ---------- | -------- |
| Backwork (Academic Library)                     | product §3.2, behavior §3   | High       | P1       |
| Chat (Channels, Messages, Reactions)            | product §3.4, behavior §6   | Very High  | P2       |
| Notifications (Push, In-App)                    | product §3.4, behavior §7   | High       | P2       |
| Study Hours (Geofences, Sessions)               | product §3.5, behavior §8   | High       | P3       |
| Financials (Billing endpoints, Member Invoices) | product §3.3, behavior §5   | Medium     | P1       |
| Service Hours (Log, Approve)                    | product §3.11, behavior §20 | Medium     | P2       |
| Tasks (Create, Assign, Confirm)                 | product §3.12, behavior §21 | Medium     | P2       |
| Chapter Documents (Upload, Browse)              | product §3.13, behavior §22 | Low        | P3       |
| Semester Rollover                               | product §3.14, behavior §23 | Low        | P3       |
| Reports & Export (CSV/PDF)                      | product §3.15, behavior §24 | Medium     | P3       |
| Global Search                                   | product §3.10, behavior §14 | Medium     | P3       |
| Polls & Voting                                  | product §3.7, behavior §11  | Low        | P3       |

### 1.2 Web Dashboard (`apps/web`) — ~1% Complete

- Next.js App Router scaffolded with Tailwind config
- Single placeholder page: "Authentication and dashboard coming soon"
- No auth, no routes, no components, no API integration
- Dependencies installed (Supabase SSR, TanStack Query, api-sdk, ShadCN ready)
- .env.local configured with Supabase + API URLs

### 1.3 Mobile App (`apps/mobile`) — ~5% Complete

- Expo Router scaffolded with NativeWind
- 4-tab navigation (Home, Chat, Events, Profile) — all "Coming soon" placeholders
- Auth layout with placeholder sign-in screen
- No API integration, no real components, no data fetching

### 1.4 Landing Page (`apps/landing`) — ~5% Complete

- Next.js scaffold with basic hero (title + subtitle + 2 CTA buttons)
- No feature highlights, pricing, testimonials, legal pages, or footer
- Inline styles only — no design system applied

### 1.5 Shared Packages — ~75% Complete

| Package                   | Status      | Notes                                                |
| ------------------------- | ----------- | ---------------------------------------------------- |
| `@repo/api-sdk`           | ✅ Complete | Auto-generated types from OpenAPI spec               |
| `@repo/hooks`             | ⚠️ Partial  | `useFrappClient` works; data hooks are stubs         |
| `@repo/ui`                | ⚠️ Minimal  | 3 placeholder components (Button, Card, Code)        |
| `@repo/theme`             | ✅ Complete | Full Tailwind config with emerald palette, dark mode |
| `@repo/validation`        | ✅ Complete | Zod schemas for all implemented domains              |
| `@repo/eslint-config`     | ✅ Complete | Base, Next.js, React Internal configs                |
| `@repo/typescript-config` | ✅ Complete | Base, Next.js, React Library configs                 |

### 1.6 Database Schema — ✅ Complete

- `supabase/migrations/00000000000000_initial_schema.sql` defines ALL tables from the architecture spec
- All 25+ tables created with correct columns, types, constraints, and triggers
- RLS enabled on all tables (policies rely on API service role)
- Schema is ahead of the API — tables exist for domains not yet implemented

---

## 2. Priority Determination

**Verdict: The API is NOT fully implemented.** 12 of 21 spec domains are missing. Before building production frontends, the API must be completed.

**Strategic priority order:**

```
Phase 1: Complete the API (backend-first)
    ↓
Phase 2: Landing Page (drive sales, minimal logic)
    ↓
Phase 3: Web Dashboard (admin experience)
    ↓
Phase 4: Mobile App (member experience)
    ↓
Phase 5: Integration, Polish, Launch Prep
```

**Rationale:**

- The API is the foundation. Frontend work without API endpoints produces throw-away code.
- The landing page is "sales-first" — it needs no backend and can ship concurrently with API completion.
- The web dashboard is simpler than mobile (fewer interaction patterns, no native concerns) and unlocks admin workflows.
- The mobile app is the most complex frontend and needs the most API surface to be useful.

---

## 3. Phase 1 — Complete the API

**Goal:** Every domain in `spec/behavior.md` has working endpoints, tests, and updated OpenAPI spec.

**Duration estimate:** 4–6 sprints (2-week sprints)

### Sprint 1: Financials & Backwork (P1 — Core Value)

#### 1A. Billing Endpoints

Stripe infrastructure exists (`StripeBillingService`, `SupabaseStorageService`) but has no controllers.

- [ ] `POST /v1/billing/checkout` — Generate Stripe Checkout URL for chapter subscription
- [ ] `GET /v1/billing/status` — Get chapter subscription status
- [ ] `POST /v1/billing/portal` — Generate Stripe Customer Portal URL
- [ ] `POST /v1/webhooks/stripe` — Stripe webhook handler (checkout.session.completed, invoice.paid, customer.subscription.updated/deleted)
- [ ] Webhook signature verification guard
- [ ] Idempotency check (Stripe event ID)
- [ ] Timestamp ordering (newer events win)
- [ ] Tests: webhook scenarios, checkout flow, subscription status transitions

#### 1B. Member Invoices (Dues)

- [ ] `POST /v1/invoices` — Create invoice for a member
- [ ] `GET /v1/invoices` — List chapter invoices (admin) or own invoices (member)
- [ ] `PATCH /v1/invoices/:id` — Update invoice (status transitions, void)
- [ ] Stripe PaymentIntent integration for invoice payments
- [ ] Overdue tracking logic
- [ ] Tests: invoice lifecycle, payment confirmation

#### 1C. Backwork

- [ ] Domain: `BackworkResource`, `BackworkDepartment`, `BackworkProfessor` entities
- [ ] Repos: `IBackworkRepository`, `IBackworkDepartmentRepository`, `IBackworkProfessorRepository`
- [ ] `POST /v1/backwork/upload-url` — Generate signed upload URL
- [ ] `POST /v1/backwork` — Confirm upload with metadata
- [ ] `GET /v1/backwork` — Browse/search with filters (department, course, professor, semester, year, type, variant, tags)
- [ ] `GET /v1/backwork/:id` — Get resource detail with signed download URL
- [ ] `DELETE /v1/backwork/:id` — Delete resource (admin)
- [ ] `GET /v1/backwork/departments` — List departments
- [ ] `GET /v1/backwork/professors` — List professors
- [ ] Auto-vivification of departments/professors
- [ ] File hash duplicate prevention (409 on duplicate)
- [ ] Tests: upload flow, browse/filter, auto-vivification, duplicates

### Sprint 2: Chat Foundation (P2 — Core Value)

#### 2A. Channel Management

- [ ] `POST /v1/channels` — Create channel (PUBLIC, PRIVATE, ROLE_GATED)
- [ ] `GET /v1/channels` — List channels (respecting permissions)
- [ ] `PATCH /v1/channels/:id` — Update channel settings
- [ ] `DELETE /v1/channels/:id` — Delete channel
- [ ] `POST /v1/channels/dm` — Create or get existing DM channel
- [ ] `POST /v1/channels/group-dm` — Create group DM
- [ ] Channel category CRUD
- [ ] Default channel seeding (already partially in ChapterService — verify/extend)
- [ ] Tests: channel types, permission gating, DM deduplication

#### 2B. Messaging

- [ ] `POST /v1/channels/:id/messages` — Send message
- [ ] `GET /v1/channels/:id/messages` — Get message history (paginated)
- [ ] `PATCH /v1/messages/:id` — Edit message (own only)
- [ ] `DELETE /v1/messages/:id` — Soft-delete message
- [ ] `POST /v1/messages/:id/pin` / `DELETE /v1/messages/:id/pin` — Pin/unpin
- [ ] Reactions: `POST /v1/messages/:id/reactions`, `DELETE /v1/messages/:id/reactions/:emoji`
- [ ] Read receipts: `POST /v1/channels/:id/read`
- [ ] File attachment support (signed URL generation for chat uploads)
- [ ] Tests: message CRUD, reactions toggle, read receipts, pins limit (50)

### Sprint 3: Notifications & Service/Tasks (P2)

#### 3A. Notification System

- [ ] Domain: `Notification`, `NotificationPreference`, `PushToken`, `UserSettings` entities
- [ ] `NotificationService` — `notifyUser()`, `notifyChapter()` (decoupled architecture per spec)
- [ ] `POST /v1/push-tokens` — Register push token
- [ ] `DELETE /v1/push-tokens/:id` — Remove push token
- [ ] `GET /v1/notifications` — List in-app notifications
- [ ] `PATCH /v1/notifications/:id/read` — Mark as read
- [ ] `GET /v1/notifications/preferences` — Get notification preferences
- [ ] `PATCH /v1/notifications/preferences` — Update preferences
- [ ] `GET /v1/settings` / `PATCH /v1/settings` — User settings (quiet hours, theme)
- [ ] Expo Push Service integration (`expo-server-sdk`)
- [ ] Quiet hours logic, priority levels (URGENT/NORMAL/SILENT)
- [ ] Tests: notification delivery flow, quiet hours, preferences, token management

#### 3B. Service Hours

- [ ] `POST /v1/service-entries` — Log service entry
- [ ] `GET /v1/service-entries` — List entries (own or all for admin)
- [ ] `PATCH /v1/service-entries/:id/review` — Approve/reject (admin)
- [ ] `DELETE /v1/service-entries/:id` — Delete own pending entry
- [ ] Points auto-award on approval (chapter-configurable rate)
- [ ] Proof file upload (signed URL)
- [ ] Tests: approval workflow, points award, double-award prevention

#### 3C. Tasks

- [ ] `POST /v1/tasks` — Create task (admin)
- [ ] `GET /v1/tasks` — List tasks (own or all for admin)
- [ ] `PATCH /v1/tasks/:id/status` — Update task status (assignee)
- [ ] `POST /v1/tasks/:id/confirm` — Confirm completion (admin, awards points)
- [ ] `POST /v1/tasks/:id/reject` — Reject completion (admin, reverts to IN_PROGRESS)
- [ ] Overdue auto-flagging
- [ ] Tests: task lifecycle, completion confirmation, point awards

### Sprint 4: Study Hours, Documents, Remaining Domains (P3)

#### 4A. Study Hours

- [ ] `GET /v1/geofences` — List chapter geofences
- [ ] `POST /v1/geofences` — Create geofence (admin)
- [ ] `PATCH /v1/geofences/:id` — Update geofence
- [ ] `DELETE /v1/geofences/:id` — Delete geofence
- [ ] `POST /v1/study-sessions/start` — Start study session
- [ ] `POST /v1/study-sessions/heartbeat` — Send heartbeat with GPS
- [ ] `POST /v1/study-sessions/stop` — Stop session, calculate points
- [ ] `GET /v1/study-sessions` — List own sessions
- [ ] Point-in-polygon validation
- [ ] Heartbeat timeout (10 min), grace window, pause logic
- [ ] GPS accuracy validation (reject >100m accuracy)
- [ ] Tests: session lifecycle, heartbeat validation, point calculation, edge cases

#### 4B. Chapter Documents

- [ ] `POST /v1/documents/upload-url` — Generate signed upload URL
- [ ] `POST /v1/documents` — Confirm upload with metadata
- [ ] `GET /v1/documents` — List documents (with folder filter)
- [ ] `GET /v1/documents/:id` — Get document with download URL
- [ ] `DELETE /v1/documents/:id` — Delete document (admin)
- [ ] Folder management: `POST /v1/documents/folders`, `DELETE /v1/documents/folders/:name`
- [ ] Tests: upload, browse, folder operations

#### 4C. Polls

- [ ] `POST /v1/channels/:id/polls` — Create poll (special message type)
- [ ] `POST /v1/polls/:id/vote` — Cast vote
- [ ] `DELETE /v1/polls/:id/vote` — Remove vote
- [ ] `GET /v1/polls/:id` — Get poll with results
- [ ] Expiration logic, single-choice vs multi-choice
- [ ] Tests: poll lifecycle, voting rules, expiration

#### 4D. Semester Rollover

- [ ] `POST /v1/chapters/current/rollover` — Trigger rollover
- [ ] `GET /v1/semesters` — List archived semesters
- [ ] Archive current period, reset leaderboard window
- [ ] Optional bulk role promotion
- [ ] Monthly cooldown (409 if rolled over within same month)
- [ ] Tests: rollover flow, cooldown, historical data preservation

#### 4E. Reports & Export

- [ ] `POST /v1/reports/attendance` — Generate attendance report
- [ ] `POST /v1/reports/points` — Generate points report
- [ ] `POST /v1/reports/roster` — Generate member roster
- [ ] `POST /v1/reports/service` — Generate service hours report
- [ ] CSV + PDF generation (branded template with chapter logo)
- [ ] Signed download URL response
- [ ] Tests: report generation, date range filtering

#### 4F. Global Search

- [ ] `GET /v1/search?q=...` — Cross-domain search
- [ ] Search across: Backwork, chat messages, events, members
- [ ] Results grouped by domain, respecting permissions
- [ ] Postgres full-text search (tsvector/to_tsquery)
- [ ] Tests: cross-domain search, permission scoping

### Sprint 5: API Hardening

- [ ] Rate limiting on write endpoints (30 req/min default, 50/hour on points/adjust)
- [ ] Atomic check-in transaction (Supabase RPC/SQL function for attendance + points)
- [ ] Auto-absent logic for mandatory/role-targeted events (post grace period)
- [ ] Recurring event instance generation
- [ ] Calendar .ics file generation
- [ ] Meeting minutes (notes field on events — PATCH endpoint)
- [ ] WCAG AA contrast validation for chapter accent colors
- [ ] File MIME type validation on uploads
- [ ] OpenAPI spec regeneration and api-sdk rebuild
- [ ] Validation package updates (Zod schemas for all new domains)
- [ ] E2E test suite expansion
- [ ] All tests passing, type-check clean

---

## 4. Phase 2 — Landing Page (Sales-Ready)

**Goal:** A visually compelling marketing site that drives sign-ups.
**Can start in parallel with Phase 1 Sprint 2** (no API dependency).

**Duration estimate:** 1–2 sprints

### Design Principles

- **"Modern Ivy"** — prestige meets clean SaaS. Navy + Royal Blue + Emerald palette.
- **Inspiration:** Linear.app, Stripe.com, Vercel.com — refined, confident, kinetic.
- **Mobile-first responsive.** Most prospects will first see the site on mobile.
- **Performance:** Static/SSG via Next.js. Target < 2s LCP, 100 Lighthouse performance.

### Pages and Sections

#### Home Page (frapp.live)

- [ ] **Hero Section** — Bold headline ("The Operating System for Greek Life"), subheadline explaining the value prop, CTA buttons ("Get Started" → app.frapp.live, "Watch Demo" → scroll to demo), hero image/mockup of the app
- [ ] **Social Proof Bar** — Logos or stats ("Trusted by X chapters", "Y+ members")
- [ ] **Feature Highlights** — 4–6 feature cards with icons/illustrations:
  - Backwork (academic library)
  - Real-time Chat (Discord-like)
  - Events & Attendance (automatic tracking)
  - Points System (gamified engagement)
  - Study Hours (geofenced tracking)
  - Member Management (roles, invites, directory)
- [ ] **How It Works** — 3-step visual: 1) Create your chapter 2) Invite members 3) Run your chapter
- [ ] **App Showcase** — Interactive or animated screenshots showing the mobile + web experience
- [ ] **Pricing Section** — Single plan, flat monthly per chapter. Clean pricing card. FAQ toggle under pricing.
- [ ] **Testimonials** — Quote cards (placeholder content until real testimonials available). Can use chapter name + role.
- [ ] **Final CTA** — Full-width section: "Ready to modernize your chapter?" with "Get Started Free" button
- [ ] **Footer** — Links to Terms, Privacy, FERPA, Contact, social media. Frapp branding.

#### Legal Pages

- [ ] `/terms` — Terms of Service (content from spec §25)
- [ ] `/privacy` — Privacy Policy (content from spec §25)
- [ ] `/ferpa` — FERPA Notice (content from spec §25)

#### Global Elements

- [ ] **Header/Nav** — Logo, nav links (Features, Pricing, Docs), "Log In" and "Get Started" buttons
- [ ] **Dark mode support** — System preference detection, toggle in header
- [ ] **Animations** — Subtle scroll-triggered animations (Framer Motion or CSS)
- [ ] **SEO** — Meta tags, Open Graph, structured data, sitemap

### Technical Implementation

- [ ] Install ShadCN UI components in landing app
- [ ] Apply `@repo/theme` (tailwind config)
- [ ] Add Geist or Inter font
- [ ] Responsive breakpoints (mobile, tablet, desktop)
- [ ] Image optimization (Next.js Image component)
- [ ] Analytics integration (Plausible or PostHog — privacy-first)

---

## 5. Phase 3 — Web Dashboard (Admin Experience)

**Goal:** Fully functional admin dashboard for chapter management.
**Depends on:** Phase 1 API completion (most endpoints).

**Duration estimate:** 3–4 sprints

### Foundation Sprint (Sprint 1)

#### Auth & Layout Shell

- [ ] Supabase Auth integration (sign-up, sign-in, magic link, OAuth)
- [ ] Next.js middleware for protected routes
- [ ] Session management with `@supabase/ssr`
- [ ] Chapter selection (for multi-chapter users)
- [ ] Sidebar navigation layout (collapsible, with icons)
- [ ] Header with user avatar, chapter name, search bar
- [ ] TanStack Query provider setup
- [ ] FrappClient provider with auth token forwarding
- [ ] Error boundary and loading states
- [ ] Dark mode toggle (system + manual)
- [ ] Breadcrumb navigation

#### Dashboard Home

- [ ] Active members count
- [ ] Upcoming events list
- [ ] Subscription status badge
- [ ] Recent activity feed (events, new members, announcements)
- [ ] Quick action buttons (Create Event, Invite Member, View Points)

### Screen Sprints (Sprint 2–4)

Ordered by admin workflow priority:

#### Sprint 2: Core Admin Screens

**Members Screen**

- [ ] Searchable member directory with profile cards
- [ ] Role badges and point display
- [ ] Role assignment (multi-select dropdown)
- [ ] Invite generation modal (single + batch)
- [ ] Remove/deactivate member action
- [ ] Member profile detail panel

**Roles & Permissions**

- [ ] Role list with drag-to-reorder (display_order)
- [ ] Create/edit role modal (name, permissions checklist, color picker)
- [ ] System role indicator (cannot delete)
- [ ] Presidency transfer UI (confirmation dialog)
- [ ] Permission catalog reference

**Events Screen**

- [ ] Event list (upcoming + past tabs)
- [ ] Calendar view (FullCalendar or similar)
- [ ] Create/edit event form (all fields from spec)
- [ ] Recurrence rule builder
- [ ] Attendance list per event with status management
- [ ] Excuse/absent/late marking
- [ ] Meeting minutes editor (Markdown)
- [ ] Point value configuration per event

#### Sprint 3: Engagement & Content Screens

**Points Ledger**

- [ ] Leaderboard table with rank, name, points
- [ ] Time window selector (All-time, Semester, Month)
- [ ] Full transaction log with filters
- [ ] Manual point adjustment modal (target member, amount, reason)
- [ ] Anomaly flagging indicators
- [ ] Audit tab (flagged transactions)

**Backwork Admin**

- [ ] Resource browser with rich filters (department, course, professor, semester, year, type, variant)
- [ ] Search bar (full-text)
- [ ] Resource detail with download link
- [ ] Delete resource action
- [ ] Department management (list, edit names)
- [ ] Professor management (list, edit names)

**Chat Admin**

- [ ] Channel list with types (PUBLIC, PRIVATE, ROLE_GATED)
- [ ] Create/edit channel form (name, description, type, permissions, category)
- [ ] Category management (create, reorder, delete)
- [ ] Pinned messages view per channel
- [ ] Channel member management (for PRIVATE channels)

#### Sprint 4: Operations & Settings Screens

**Billing**

- [ ] Subscription status card (active, past_due, canceled)
- [ ] Payment history timeline
- [ ] "Manage Subscription" button → Stripe Customer Portal
- [ ] Upgrade/downgrade prompts

**Financial Invoices**

- [ ] Invoice list with status filters (DRAFT, OPEN, PAID, VOID)
- [ ] Create invoice form (select member, amount, description, due date)
- [ ] Send invoice action (DRAFT → OPEN)
- [ ] Void invoice action
- [ ] Overdue indicators

**Tasks**

- [ ] Task list with status filters
- [ ] Create task form (title, description, assignee, due date, point reward)
- [ ] Completion confirmation workflow
- [ ] Overdue indicators

**Service Hours**

- [ ] Admin review queue (PENDING entries)
- [ ] Approve/reject with optional comment
- [ ] Chapter-wide service report table
- [ ] Points-per-hour configuration

**Study Geofences**

- [ ] Map view with polygon drawing tool (Google Maps or Mapbox)
- [ ] Geofence list with configuration (name, minutes per point, min session)
- [ ] Create/edit/delete geofences
- [ ] Active session indicators

**Chapter Documents**

- [ ] Document browser with folder navigation
- [ ] Upload form (file + title + description + folder)
- [ ] Folder management
- [ ] Download links

**Reports & Export**

- [ ] Report type selection
- [ ] Date range picker
- [ ] Scope selector (chapter-wide or per-member)
- [ ] Generate and download (CSV/PDF)

**Polls**

- [ ] Poll list with status (active, expired)
- [ ] Create poll form
- [ ] Results visualization (bar chart)

**Settings**

- [ ] Chapter profile form (name, university)
- [ ] Chapter branding (logo upload, accent color picker with contrast preview)
- [ ] Notification defaults
- [ ] Default role configuration
- [ ] "Start New Semester" button (rollover)
- [ ] Danger zone: cancel subscription, transfer presidency

---

## 6. Phase 4 — Mobile App (Member Experience)

**Goal:** Full member experience on iOS + Android.
**Depends on:** Phase 1 API and Phase 3 web dashboard (for admin setup of data).

**Duration estimate:** 3–4 sprints

### Foundation Sprint

- [ ] Supabase Auth integration (email/password, magic link, OAuth with AsyncStorage)
- [ ] API client setup (FrappClient with auth token)
- [ ] TanStack Query provider
- [ ] Navigation structure (Expo Router tabs + stacks)
- [ ] Dark mode support (NativeWind)
- [ ] Pull-to-refresh pattern
- [ ] Loading/error/empty state components
- [ ] Haptic feedback utilities
- [ ] Push notification registration (expo-notifications)

### Screen Sprints

#### Sprint 2: Core Member Screens

**Home / Activity Feed**

- [ ] Point balance summary card
- [ ] Unified feed (events, announcements, backwork, milestones, new members)
- [ ] Pull-to-refresh
- [ ] Tap-to-navigate (deep links to relevant screens)

**Events**

- [ ] Upcoming events list
- [ ] Event detail screen
- [ ] Check-in button (with time window validation)
- [ ] Past events with attendance status
- [ ] Calendar view
- [ ] "Add to Calendar" action (.ics generation)

**My Points**

- [ ] Current balance display
- [ ] Recent transactions list (with category icons and descriptions)
- [ ] Leaderboard (chapter rank, top members)
- [ ] Time window selector

**Profile**

- [ ] Display name, photo, bio (editable)
- [ ] Push notification preferences
- [ ] Quiet hours configuration
- [ ] Dark mode toggle
- [ ] Sign out
- [ ] "Replay Tutorial" link

**Member Directory**

- [ ] Searchable member list
- [ ] Profile cards (name, role, points, join date)
- [ ] Tap to view profile or start DM

#### Sprint 3: Communication

**Chat**

- [ ] Channel list organized by categories
- [ ] DMs tab (1-on-1 and group)
- [ ] Message input with Markdown support
- [ ] Message list with replies, reactions, pins
- [ ] File/image upload
- [ ] Typing indicators
- [ ] Online presence indicators
- [ ] Pinned messages panel
- [ ] Search within and across channels
- [ ] Swipe gestures (reply, archive DM)
- [ ] #announcements special handling (read-only for non-admins)

**Notifications**

- [ ] In-app notification center
- [ ] Deep linking to relevant content
- [ ] Mark as read
- [ ] Category filter
- [ ] Badge count management

#### Sprint 4: Remaining Screens

**Backwork**

- [ ] Browse by filters (department, course, professor, semester, year, type)
- [ ] Upload flow (file picker → metadata form → confirm)
- [ ] Download with signed URL
- [ ] Full-text search

**Study Hours**

- [ ] Geofence selection (map with polygon overlays)
- [ ] Study mode screen (timer, location status, progress, streak)
- [ ] Foreground enforcement (AppState API)
- [ ] Pause/resume on background/foreground
- [ ] Session history with points earned

**Tasks**

- [ ] Task list (own tasks)
- [ ] Status updates (IN_PROGRESS, COMPLETED)
- [ ] Due date and point reward display

**Service Hours**

- [ ] Log entry form (date, duration, description, proof upload)
- [ ] Own history with status
- [ ] Service leaderboard

**Chapter Documents**

- [ ] Browse and download
- [ ] Folder navigation
- [ ] Search

**Polls**

- [ ] Vote on active polls
- [ ] View results
- [ ] Create polls (if permitted)

**Alumni Directory**

- [ ] Searchable alumni list
- [ ] Filter by graduation year, city, company
- [ ] "Support the Chapter" donation link

**Onboarding Tutorial**

- [ ] Swipeable card walkthrough (7 screens)
- [ ] Skip button
- [ ] Revisitable from settings
- [ ] `has_completed_onboarding` flag management

---

## 7. Phase 5 — Integration, Polish, and Launch Prep

**Duration estimate:** 1–2 sprints

### Cross-Platform Integration

- [ ] API SDK regeneration from final OpenAPI spec
- [ ] Shared hooks (`@repo/hooks`) — TanStack Query wrappers for all endpoints
- [ ] Consistent error handling across web + mobile
- [ ] Supabase Realtime integration (chat messages, reactions, typing, presence)

### Quality & Testing

- [ ] API: ≥80% test coverage across all modules
- [ ] Web: Component tests for critical flows (Playwright or Cypress)
- [ ] Mobile: Detox or Maestro E2E tests for critical flows
- [ ] Performance audit (Lighthouse for web/landing, React Native performance monitor)
- [ ] Accessibility audit (WCAG AA compliance)
- [ ] Security audit (OWASP top 10, rate limiting verification, SQL injection prevention)

### Documentation (`apps/docs`)

- [ ] Getting Started guide (create chapter, invite members)
- [ ] Feature guides for each domain (Backwork, Events, Points, Chat, Study Hours, etc.)
- [ ] FAQ and troubleshooting
- [ ] Admin guide (roles, billing, settings)
- [ ] Update docs with all new features

### CI/CD

- [ ] GitHub Actions workflow: lint, typecheck, test, contract check
- [ ] Vercel deployment config for web, landing, docs
- [ ] API Docker image + deployment pipeline
- [ ] EAS build profiles (development, staging, production)
- [ ] Database migration strategy for staging/production

### Launch Checklist

- [ ] Stripe live mode setup (KYC verification)
- [ ] Custom domains: frapp.live, app.frapp.live, docs.frapp.live
- [ ] SSL certificates
- [ ] Sentry error tracking setup
- [ ] Monitoring dashboards and alerts
- [ ] Terms of Service and Privacy Policy legal review
- [ ] App Store and Google Play submissions (EAS Submit)
- [ ] Analytics (Plausible/PostHog)
- [ ] Seed demo chapter for marketing screenshots

---

## 8. Consistency Audit Findings

### Positive Patterns (Keep Doing)

1. **Clean layered architecture** in the API: Domain → Application → Interface → Infrastructure
2. **Repository pattern** with interfaces — all 8 repositories follow the same contract pattern
3. **Consistent naming** — entities, DTOs, services, controllers all follow NestJS conventions
4. **Test co-location** — spec files next to service files
5. **Permissions catalog** — centralized in `domain/constants/permissions.ts`
6. **Validation dual-layer** — class-validator on API + Zod in shared package
7. **Guard chain** — consistent AuthGuard → ChapterGuard → PermissionsGuard pattern
8. **Swagger decorators** — all controllers have ApiTags, ApiOperation, ApiResponse

### Issues to Address

| Issue                               | Location                                                | Severity | Recommendation                                                                                 |
| ----------------------------------- | ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| Minor TS error in invite test       | `invite.service.spec.ts:129`                            | Low      | Add non-null assertion or type guard for `expires_at`                                          |
| Theme color mismatch                | `@repo/theme` uses emerald; spec says Navy + Royal Blue | Medium   | Align theme with "Modern Ivy" spec palette (Navy #0F172A, Royal Blue #2563EB, Emerald #10B981) |
| `useMembers` hook is a stub         | `packages/hooks/src/use-members.ts`                     | Low      | Replace when web dashboard is built                                                            |
| `@repo/ui` placeholder components   | `packages/ui/src/`                                      | Medium   | Replace with ShadCN UI components during Phase 3                                               |
| No OpenAPI spec committed           | `apps/api/openapi.json` not in git                      | Medium   | Commit or add CI step to generate                                                              |
| Missing eslint configs              | `packages/validation`, `packages/api-sdk`               | Low      | Add eslint configs or exclude from monorepo lint                                               |
| No seed data                        | `supabase/seed.sql` is empty                            | Low      | Add development seed data for local testing                                                    |
| E2E tests only check auth rejection | `test/attendance-points.e2e-spec.ts`                    | Medium   | Add tests with mocked auth for positive flows                                                  |

---

## 9. What Has Been Done So Far

### Development Timeline (from git history)

| Phase                      | Scope                                                             | Key Commits          | Status        |
| -------------------------- | ----------------------------------------------------------------- | -------------------- | ------------- |
| **Infrastructure**         | NestJS scaffold, Drizzle (later replaced), Clerk (later replaced) | Initial commits      | ✅ Superseded |
| **Ground-Up Rebuild**      | Supabase migration, spec-driven architecture                      | `731029b`            | ✅ Complete   |
| **Phase 1: Foundation**    | Auth, Users, Chapters, Members, Roles, Invites, Health            | Multiple commits     | ✅ Complete   |
| **Phase 2: Events/Points** | Events, Attendance, Points, OpenAPI/SDK                           | `22c83a2`, `b3e589f` | ✅ Complete   |
| **Spec Hardening**         | Behavior spec, architecture spec, environment spec                | Various docs commits | ✅ Complete   |
| **Audit & Integration**    | Phase 2 audit, branch integration, next steps planning            | `040838e`, `4549691` | ✅ Complete   |

### Key Artifacts Produced

- 4 comprehensive spec documents (`spec/product.md`, `behavior.md`, `architecture.md`, `environments.md`)
- 84 passing unit tests
- OpenAPI export script and auto-generated TypeScript SDK
- Supabase migration covering all 25+ tables
- Shared packages: theme, validation, eslint-config, typescript-config
- Phase 2 audit document (`../audits/PHASE2_AUDIT.md`)
- `AGENTS.md` for development environment
- Pull request template with docs/spec impact section

### Key Decisions Made

1. **Supabase over Clerk** — Auth migrated to Supabase Auth (unified platform)
2. **Supabase over Drizzle ORM** — Direct Supabase JS client (no ORM layer)
3. **Repository pattern** — Clean abstractions for future provider changes
4. **Billing adapter pattern** — `IBillingProvider` interface (Stripe implementation, future flexibility)
5. **Spec-driven development** — Spec is source of truth; implementation follows

---

## 10. Risk Register

| Risk                                    | Impact | Likelihood | Mitigation                                                                 |
| --------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------- |
| Chat complexity underestimated          | High   | Medium     | Start with basic messaging; add reactions/typing/presence incrementally    |
| Supabase Realtime limitations           | Medium | Low        | Socket.io fallback documented in architecture spec                         |
| Stripe KYC delays                       | High   | Medium     | Start KYC process during Phase 1; use test mode until approved             |
| Mobile app review delays (Apple/Google) | Medium | Medium     | Submit early beta builds; use EAS OTA for JS-only updates                  |
| Study hours GPS accuracy on mobile      | Medium | Medium     | Generous accuracy threshold; clear user feedback on location status        |
| Performance at scale (many chapters)    | Medium | Low        | Database indexing, connection pooling, query optimization in Phase 5       |
| Legal content (Terms, Privacy)          | Medium | High       | Draft content early; get legal review before public launch                 |
| Landing page design quality             | High   | Medium     | Consider hiring a designer or using a premium template for initial version |

---

## Appendix: Decision Log

| Date       | Decision                         | Rationale                                                                             |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| 2026-02-27 | API-first rollout strategy       | 12/21 domains not implemented; frontend without API produces throwaway work           |
| 2026-02-27 | Landing page can run in parallel | No API dependency; sales-critical for launch                                          |
| 2026-02-27 | Web before mobile                | Simpler to develop, unlocks admin workflows needed for mobile testing                 |
| 2026-02-27 | 4-sprint API plan                | Ordered by value: Financials/Backwork → Chat → Notifications/Tasks → Study/Docs/Polls |
