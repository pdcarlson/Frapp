# Surfaces

## Landing — frapp.live

A standalone marketing site (`apps/landing`). Deployed independently from the app.

- Hero section with value proposition.
- Feature highlights (Backwork, Chat, Points, Study Hours).
- Pricing (single plan: flat monthly per chapter).
- Stats row and testimonial quotes are included in the marketing build and **must** reflect verified metrics and real customers, or be clearly labeled as illustrative until validated (see [`spec/ui/brand-identity.md`](../ui/brand-identity.md)).
- CTA: "Get Started" (redirects to `app.frapp.live/sign-up`) and "Log In" (redirects to `app.frapp.live/sign-in`). These must match the web app's actual auth routes — there is no `/signup` or `/login` route.
- **Legal pages:** Terms of Service (`/terms`), Privacy Policy (`/privacy`), FERPA Notice (`/ferpa`). Linked from the site footer.

## Web App — app.frapp.live

The admin console (`apps/web`). Next.js App Router, Tailwind, ShadCN UI.

**Screens:**

- **Onboarding Tutorial** — Guided walkthrough on first sign-in, skippable and revisitable from settings (`components/onboarding/onboarding-tutorial.tsx`). The slides and their order are owned by [`spec/behavior/onboarding.md`](../behavior/onboarding.md) § Onboarding Tutorial. There is no mobile equivalent — mobile's first-run screen is s03.
- **Chat (member view)** — The post-sign-in landing (`/chat`) and the app's primary surface: channel list by category, DMs, real-time messaging with reactions, replies, uploads, and inline rich-message cards. There is no standalone dashboard home — `/dashboard` redirects here, and `/` does too once a Supabase session exists (signed-out visitors get the landing page). Chapter health at a glance is re-homed as an inline chat artifact, the pulse card — see [`spec/behavior/chat/catch-up.md`](../behavior/chat/catch-up.md). Subscription status lives in the dashboard shell and the Billing screen below.
- **Members** — Searchable member directory with profile cards (name, role, points, join date, bio). Role assignment, invite generation, remove/deactivate.
- **Roles & Permissions** — View/create/edit roles with open-ended permissions; assign display order and color; manage system role permissions. Presidency transfer UI.
- **Billing** — Subscription status, invoices, payment history (Stripe Customer Portal link).
- **Financial Invoices** — Create/send invoices to members (dues); track payment status; overdue alerts.
- **Events** — Create/edit events with configurable point values, mandatory flags, location, and recurrence rules. View attendance per event. Calendar view.
- **Backwork Admin** — Browse uploaded resources with rich filters (department, course, professor, semester, year, assignment type, document variant). Manage departments and professors. View redacted vs. original indicators.
- **Points Ledger** — Leaderboard (all-time, semester, month). Full transaction log with audit trail (who adjusted, reason). Manual point adjustments. Anomaly flagging and audit tab (chapter-wide list via `GET /v1/points/transactions`, gated by `points:view_all`; see [`spec/behavior/points.md`](../behavior/points.md)).
- **Study Geofences** — Draw/manage geofence polygons for study locations. Configure reward rates and minimum session lengths.
- **Chat (admin view)** — Channel management: create/edit/delete channels, organize into categories, set permission requirements. Manage pinned messages. View #announcements posting.
- **Polls** — Chapter-wide poll list with aggregate tallies on the web app (`GET /v1/polls`, gated by `polls:view_all`; see [`spec/behavior/polls.md`](../behavior/polls.md) and [`spec/ui/web-dashboard/README.md`](../ui/web-dashboard/README.md)). Create polls and vote in channels per chat permissions.
- **Tasks** — Create/assign tasks to members. Track status (TODO, IN_PROGRESS, COMPLETED, OVERDUE). Confirm completion and award points. Filter by assignee, status, due date.
- **Service Hours** — Admin review queue for submitted service entries. Approve/reject with optional comments. Chapter-wide service report. Configure points-per-hour rate.
- **Chapter Documents** — Upload, organize, and manage chapter files (bylaws, constitutions, agendas). Flat folder structure. All members can view/download.
- **Reports & Export** — Generate and download CSV/PDF reports: attendance, points, member roster, service hours. Select date range and scope. Branded PDF templates with chapter logo.
- **Settings** — Chapter profile (name, university). Chapter branding (upload logo, set accent color). Default role configuration. Notification defaults. Semester rollover action ("Start New Semester"). Danger zone (cancel subscription, transfer presidency).

## Mobile App (iOS + Android)

The member experience (`apps/mobile`). Expo with Expo Router.

**Screens:**

- **First-run (s03)** — Mobile's onboarding surface (`app/(auth)/welcome.tsx`), reached when the auth gate reads `has_completed_onboarding` as false. It is a single first-run screen, **not** the web modal slideshow; both are owned by [`spec/behavior/onboarding.md`](../behavior/onboarding.md) § Onboarding Tutorial, which is where the per-surface split is stated.
- **Home / Activity Feed** — Unified feed: upcoming events, recent announcements, new Backwork uploads, point milestones, new members. Point balance summary at the top.
- **Chat** — Channel list organized by categories (respecting permission gates). Direct Messages tab (1-on-1 and group DMs). Real-time messaging with reactions, replies, file/image uploads, typing indicators, online presence. Pinned messages panel. Full-text search within and across channels.
- **Backwork** — Browse by department, course, professor, semester/year, assignment type, document variant, and tags. Upload flow: select file, fill metadata (all optional), optionally redact (v2), confirm. Download with signed URL. Full-text search.
- **Events** — Upcoming events list with calendar view. Self-service check-in (during event time window). Past events with attendance status. "Add to Calendar" action generating .ics file. Recurring event indicators.
- **Study Hours** — Select geofence, view map with polygon overlay. Start session — enters dedicated study mode screen (large timer, location status, progress toward next point, streak indicator). Foreground enforcement with pause/resume. Stop session. Session history with points earned.
- **My Points** — Current balance, recent transactions (with reasons for adjustments), leaderboard (chapter rank). Time-window selector (all-time, semester, month).
- **Notifications** — In-app notification center with deep linking. Mark as read. Filter by category. Quiet hours configuration.
- **Profile** — Display name, profile photo, bio (editable). Push notification preferences (per-category). Quiet hours setting. Dark mode toggle. Account info. Sign out.
- **Member Directory** — Searchable list of chapter members with profile cards. Tap to view profile or start DM.
- **Tasks** — View tasks assigned to the user. Update status (IN_PROGRESS, COMPLETED). See due dates, point rewards, and confirmation status.
- **Service Hours** — Log service entries (date, duration, description, optional proof upload). View own history and approval status. Chapter service leaderboard.
- **Chapter Documents** — Browse and download chapter files organized by folder. Search by title.
- **Alumni Directory** — Searchable list of alumni members. Filter by graduation year, city, company. View alumni profile cards.
- **Polls** — Vote on active polls. View results. Create polls (if permitted).

## Documentation (repo markdown today)

Developer documentation: canonical markdown in [`docs/guides/`](../../docs/guides/README.md) and product detail in **`spec/`**. There is **no** separate public docs website in the monorepo for now; contributors read on GitHub (or locally). A polished public docs site (and possibly changelog, feedback, etc.) is a **post-launch** candidate.

- Getting started and engineering guides: `docs/guides/`.
- Product behavior and architecture: `spec/`.
- Audience: contributors and operators; chapter-admin-facing help may grow separately.
