# Product Specification: Frapp

> **"The Operating System for Greek Life."**

Frapp is a multi-tenant SaaS platform that replaces the disjointed tools fraternity chapters rely on (Discord, OmegaFi, Life360) with a single, unified mobile and web experience.

---

## 1. Users and Personas

| Persona                 | Primary surface          | Description                                                                                                                                                     |
| ----------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prospect**            | Landing (frapp.live)     | An officer researching tools for their chapter. Sees pricing, features, and signs up.                                                                           |
| **President / Admin**   | Web app (app.frapp.live) | Chapter leader. Creates chapter, manages members, roles, events, billing, Backwork config, and settings.                                                        |
| **Treasurer**           | Web app (app.frapp.live) | Manages billing, dues/invoices, and the points ledger.                                                                                                          |
| **Member**              | Mobile app               | Active brother. Uses chat, browses Backwork, checks into events, logs study hours, views points.                                                                |
| **New Member (Pledge)** | Mobile app               | Limited-permission member during the new-member period.                                                                                                         |
| **Alumni**              | Mobile app (read-mostly) | Graduated member with read access to chat and Backwork. Alumni directory, `#alumni` channel, optional donation link. No points, event check-in, or study hours. |

---

## 2. Surfaces

### 2.1 Landing — frapp.live

A standalone marketing site (`apps/landing`). Deployed independently from the app.

- Hero section with value proposition.
- Feature highlights (Backwork, Chat, Points, Study Hours).
- Pricing (single plan: flat monthly per chapter).
- Stats row and testimonial quotes **ship in the marketing build** today; copy must either reflect **verified** metrics and real customers or be **explicitly labeled** as illustrative until validated (see [spec/ui-brand-identity.md](ui-brand-identity.md)).
- CTA: "Get Started" (redirects to app.frapp.live sign-up) and "Log In" (redirects to app.frapp.live).
- **Legal pages:** Terms of Service (`/terms`), Privacy Policy (`/privacy`), FERPA Notice (`/ferpa`). Linked from the site footer.

### 2.2 Web App — app.frapp.live

The admin console (`apps/web`). Next.js App Router, Tailwind, ShadCN UI.

**Screens:**

- **Dashboard home** — Chapter health at a glance: active members, upcoming events, subscription status, recent activity feed.
- **Members** — Searchable member directory with profile cards (name, role, points, join date, bio). Role assignment, invite generation, remove/deactivate.
- **Roles & Permissions** — View/create/edit roles with open-ended permissions; assign display order and color; manage system role permissions. Presidency transfer UI.
- **Billing** — Subscription status, invoices, payment history (Stripe Customer Portal link).
- **Financial Invoices** — Create/send invoices to members (dues); track payment status; overdue alerts.
- **Events** — Create/edit events with configurable point values, mandatory flags, location, and recurrence rules. View attendance per event. Calendar view.
- **Backwork Admin** — Browse uploaded resources with rich filters (department, course, professor, semester, year, assignment type, document variant). Manage departments and professors. View redacted vs. original indicators.
- **Points Ledger** — Leaderboard (all-time, semester, month). Full transaction log with audit trail (who adjusted, reason). Manual point adjustments. Anomaly flagging and audit tab.
- **Study Geofences** — Draw/manage geofence polygons for study locations. Configure reward rates and minimum session lengths.
- **Chat (admin view)** — Channel management: create/edit/delete channels, organize into categories, set permission requirements. Manage pinned messages. View #announcements posting.
- **Polls** — Create and manage polls. View results.
- **Tasks** — Create/assign tasks to members. Track status (TODO, IN_PROGRESS, COMPLETED, OVERDUE). Confirm completion and award points. Filter by assignee, status, due date.
- **Service Hours** — Admin review queue for submitted service entries. Approve/reject with optional comments. Chapter-wide service report. Configure points-per-hour rate.
- **Chapter Documents** — Upload, organize, and manage chapter files (bylaws, constitutions, agendas). Flat folder structure. All members can view/download.
- **Reports & Export** — Generate and download CSV/PDF reports: attendance, points, member roster, service hours. Select date range and scope. Branded PDF templates with chapter logo.
- **Settings** — Chapter profile (name, university). Chapter branding (upload logo, set accent color). Default role configuration. Notification defaults. Semester rollover action ("Start New Semester"). Danger zone (cancel subscription, transfer presidency).

### 2.3 Mobile App (iOS + Android)

The member experience (`apps/mobile`). Expo with Expo Router.

**Screens:**

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
- **Onboarding Tutorial** — Guided walkthrough on first launch: Welcome, Chat, Events, Backwork, Study Hours, Profile Setup, Done. Skippable and revisitable from settings.
- **Polls** — Vote on active polls. View results. Create polls (if permitted).

### 2.4 Documentation — docs.frapp.live

User-facing documentation (`apps/docs`). Audience: chapter admins learning how to use Frapp.

- Getting started (create chapter, invite members).
- Feature guides (Backwork, events, points, chat, study hours, billing, roles).
- FAQ and troubleshooting.
- (Future) API reference for power users / integrations.

Design inspiration: Stripe Docs, Vercel Docs, Tailwind Docs. Clean sidebar navigation, search, dark mode, polished typography.

---

## 3. Core Domains

### 3.1 Identity & Access (IAM)

**Auth provider:** Supabase Auth (email/password, magic link, OAuth).

- **Multi-tenancy:** Every user belongs to one or more chapters (tenants). All data access is strictly scoped by `chapter_id`.
- **RBAC:** Permissions are open-ended strings. Frapp publishes a system permissions catalog that the API enforces; chapters can define additional custom permission strings for channel gating and organizational use. Roles are chapter-scoped and fully customizable. System roles (President, Treasurer, Member, New Member, Alumni) are seeded on chapter creation with sensible defaults.
- **Permissions guard:** API middleware fetches the user's roles for the active chapter, flattens permissions, and checks against the `@RequirePermissions()` decorator on each endpoint.
- **Fail-safe:** A user with no roles has zero permissions. The President system role holds the wildcard (`*`) granting all permissions.
- **Presidency transfer:** Atomic operation — current President assigns the role to another member and removes it from themselves in a single transaction.

### 3.2 Backwork (Academic Library)

**Storage:** Supabase Storage (private bucket, signed URLs for upload and download).

**Upload flow:**

1. Client requests upload slot (filename, content type).
2. API validates permissions, generates a Supabase Storage signed upload URL.
3. Client uploads directly to Storage (bypasses API bandwidth).
4. Client notifies API "upload complete" with metadata.
5. API stores metadata in Postgres.

**Metadata:** department, course number, professor name, year, semester, assignment type, assignment number, document variant, tags, file hash. All optional except the file itself.

**Auto-vivification:** If a provided department or professor name doesn't exist for the chapter, the system creates the record automatically, keeping dropdown menus fresh without manual admin entry.

**Duplicate prevention:** Unique constraint on (chapter_id, file_hash). Same file cannot be uploaded twice to the same chapter.

**PDF redaction (v2):** In-app viewer with draggable black rectangles for redacting personal info. Rasterized output stored (original never uploaded).

**AI metadata extraction (v3+):** Optional AI parses the PDF and pre-fills metadata fields. User reviews before confirming.

### 3.3 Financials

#### SaaS Billing (revenue)

- **Customer:** The chapter (organization).
- **Provider:** Stripe.
- **Model:** Fixed monthly subscription (e.g. $150/mo flat).
- **Enforcement:** If the chapter's subscription is not active, the "Invite Member" endpoint returns 402 Payment Required.

#### Internal Ledger (House Points)

- Every point change is recorded as a transaction in `point_transactions`.
- Positive amount = reward; negative amount = fine/correction.
- Categories: ATTENDANCE, ACADEMIC, SERVICE, FINE, MANUAL.
- A member's balance is the sum of their transactions.
- Admins can manually adjust points with a required reason. Audit trail tracks which admin made the adjustment.
- Anti-fraud: rate limiting on adjustments, anomaly flagging for large transactions, no self-adjustment.
- Leaderboard with configurable time windows (all-time, semester, month).

#### Member Invoices (Dues)

- Admins create invoices for members (e.g. semester dues).
- Invoices have statuses: DRAFT, OPEN, PAID, VOID.
- Payments tracked via Stripe PaymentIntents.
- Financial transactions log all payments, refunds, and adjustments.
- Overdue tracking with notifications.

### 3.4 Communications

#### Real-time Chat

- Messages are persisted in Postgres (`chat_messages`).
- Realtime delivery via Supabase Realtime (Postgres changes subscription).
- **Channels:** PUBLIC, PRIVATE, ROLE_GATED (gated by any permission string, including custom), DM (1-on-1), GROUP_DM (up to 10 members).
- **Channel categories:** Named groups for organizing channels (display-only, like Discord).
- **Default channels:** #general (public), #announcements (admin-post, all-read), #alumni (role-gated to Alumni + active members).
- **Messages support:** Markdown formatting, emoji reactions, file/image uploads (25MB limit), reply threads (reply-with-quote), edit, delete (soft), pinned messages (up to 50 per channel).
- **Typing indicators** and **online/offline presence** via Supabase Realtime.
- **Read receipts:** Last-read timestamp per channel per user.
- **Mentions:** `@user` triggers a push notification.
- **Search:** Full-text search within or across channels.

#### Push Notifications

- **Provider:** Expo Push Service (via `expo-server-sdk`).
- **Deep linking:** Every notification links to the relevant screen/content in the app.
- **Priority levels:** URGENT, NORMAL, SILENT.
- **Quiet hours:** Per-user configurable time window; NORMAL notifications silenced during quiet hours.
- **Grouping:** Multiple notifications from the same source collapsed into one.
- **Per-channel mute:** Users can mute individual chat channels.
- **Badge count:** Total unread across notifications and chat.
- **Triggers:** Chat mentions, DMs, announcements, event reminders, point changes, study session events, billing alerts, admin notifications.
- **In-app history:** All notifications stored in `notifications` table; viewable and dismissable.
- **Preferences:** Per-category opt-in/opt-out.

### 3.5 Location & Study Hours

- **Mode:** Active, opt-in tracking only.
- **Geofences:** Admin draws polygon coordinates for approved study locations (e.g. campus library).
- **Session flow:**
  1. User selects a geofence and taps "Start Studying."
  2. API validates that the user's GPS coordinates are inside the polygon.
  3. App enters dedicated **study mode screen** (timer, location status, progress, streak).
  4. Client sends a heartbeat every 5 minutes with updated GPS (foreground only).
  5. If the app goes to the background, the session **pauses**. Grace window (default 5 minutes) before auto-expiration.
  6. Server validates each heartbeat (point-in-polygon). Departure or GPS spoofing expires the session.
  7. User stops session. Server calculates `total_foreground_minutes` and awards points via the Points service.
- **Reward logic:** Chapter-configurable (e.g. 1 point per 30 minutes). Minimum session length required (e.g. 15 minutes).

### 3.6 Events & Attendance

- Admins create events with name, description, location, start/end time, point value, mandatory flag, and optional recurrence rule.
- **Recurring events:** Weekly, biweekly, or monthly. Auto-generates individual event instances.
- **Role-based required attendance:** Events can target specific roles (e.g. exec meeting for officers only). Only members with matching roles are required; others can optionally attend.
- Members check in via the mobile app (self-service, during event time window + grace period). For role-targeted events, only members with required roles can check in.
- Check-in atomically creates an attendance record AND awards the event's point value.
- **Excuse workflow (admin-only):** Admins mark members as EXCUSED with an optional reason. Members cannot self-submit excuses. Excused members are not penalized.
- Admins can view full attendance for any event and mark EXCUSED/ABSENT/LATE after the fact.
- **Auto-absent:** For mandatory or role-targeted events, required members who did not check in and were not excused are auto-marked ABSENT.
- **Meeting minutes:** Events have an optional notes field (markdown) editable by admins after the event. Visible to all members with access to the event.
- Unique constraint: one attendance record per (event, user).
- **Calendar integration:** "Add to Calendar" generates .ics file or deep-links to device calendar.

### 3.7 Polls and Voting

- Users with `polls:create` permission can create polls in any accessible channel.
- Polls have a question, 2-10 options, optional expiration time, and single-choice or multi-choice mode.
- Members in the channel vote; results visible in real-time.
- Polls are a special message type within chat.

### 3.8 Member Directory

- Searchable member list per chapter with profile cards (name, role, points, join date, bio, photo).
- Members edit their own profile. Admins can view all profiles.
- Tap a member to view profile or start a DM.

### 3.9 Activity Feed

- Unified feed on the home screen showing recent chapter activity: new events, Backwork uploads, point milestones, new members, latest announcement.
- Read-only aggregation from existing data sources.

### 3.10 Global Search

- Single search bar accessible from the top of mobile and web.
- Searches across Backwork, chat messages, events, and members.
- Results grouped by domain. All results respect chapter scoping and permissions.

### 3.11 Service Hours

- Dedicated tracker for community service and philanthropy hours (separate from study hours).
- Members log entries: date, duration, description, optional proof file upload.
- Admin approval workflow: PENDING → APPROVED / REJECTED with optional comment.
- Approved hours auto-generate point transactions (category: SERVICE) at a chapter-configurable rate.
- Service leaderboard and per-member history.

### 3.12 Tasks

- Lightweight task management for chapter operations.
- Admins create tasks with title, description, assignee, due date, and optional point reward.
- Assignee moves task through statuses: TODO → IN_PROGRESS → COMPLETED.
- Admin confirms completion (awards points if attached). Can reject and revert to IN_PROGRESS.
- Overdue tasks flagged automatically. Notifications sent to assignee and admin.

### 3.13 Chapter Documents

- "Chapter Files" storage area for organizational documents (bylaws, constitutions, agendas, etc.).
- Separate from Backwork (no academic metadata).
- Optional flat folder structure (one level deep).
- All members can view/download. Upload requires `chapter_docs:upload`; management requires `chapter_docs:manage`.

### 3.14 Semester Rollover

- Admins archive the current leaderboard period with a label (e.g. "Fall 2025") and start a new one.
- Points continue to accumulate (no data deleted). Leaderboard defaults to the new period; historical periods remain selectable.
- Optional bulk role promotion (e.g. "New Member" → "Member").
- Study session configs carry forward.

### 3.15 Reports & Export

- Admins export data as CSV or PDF: attendance, points, member roster, service hours.
- Exported PDFs use a branded template with chapter name, logo, and Frapp footer.
- API generates the file and returns a signed download URL.

### 3.16 Alumni

- Alumni is a system role with limited permissions: read chat, view Backwork, view member directory.
- **Alumni directory:** Searchable list with optional self-reported fields (graduation year, current city, current company).
- **Alumni channel:** Default `#alumni` channel seeded on chapter creation.
- **Donation link:** Optional external URL in chapter settings. "Support the Chapter" button shown to alumni.

### 3.17 Chapter Branding

- Chapters upload a logo (displayed in app header, directory, PDF reports, onboarding).
- Chapters set a custom accent color (hex) for buttons, links, and highlights.
- Default accent: Frapp Royal Blue `#2563EB`.
- Chapter branding applies only within the chapter context; Frapp branding is unaffected.

---

## 4. Onboarding Flow

### Chapter Creation

1. Prospect visits frapp.live, clicks "Get Started."
2. Redirected to app.frapp.live sign-up (Supabase Auth).
3. After authentication, enters chapter details (name, university).
4. **Accepts Terms of Service and Privacy Policy** (required checkbox).
5. API creates chapter with `subscription_status: incomplete`.
6. API creates a Stripe Customer, stores `stripe_customer_id` on the chapter.
7. API generates a Stripe Checkout URL (with `chapter_id` in metadata).
8. User completes payment on Stripe.
9. Stripe webhook (`checkout.session.completed`) fires; API activates chapter (`subscription_status: active`).
10. Default system roles and default channels (#general, #announcements, #alumni) are seeded.

### Chapter Lifecycle

| Status       | Meaning                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `incomplete` | Created but not yet paid.                                                       |
| `active`     | Subscription current. Full access.                                              |
| `past_due`   | Payment failed. 3-day grace period (soft lock — can still read, cannot invite). |
| `canceled`   | Subscription ended. Data preserved, read-only (hard lock).                      |

### Invite System

1. Admin generates an invite token (valid for 24 hours, assigned a role).
2. Token is shared as a link (e.g. `app.frapp.live/join?token=abc123`).
3. New user signs up (Supabase Auth) and enters the token.
4. API validates the token (not expired, not used), links user to chapter with the token's role.
5. Token is marked as used.

---

## 5. Visual Identity: "Modern Ivy"

Frapp balances the prestige of traditional Greek life with the clean feel of modern SaaS.

### Color Palette

| Role                   | Color                         | Hex       |
| ---------------------- | ----------------------------- | --------- |
| Primary (Navy)         | Professional, trustworthy     | `#0F172A` |
| Secondary (Royal Blue) | Action-oriented               | `#2563EB` |
| Success (Emerald)      | Growth, positive transactions | `#10B981` |
| Background (Slate)     | Clean, focused                | `#F8FAFC` |

Dark mode variants defined in `@repo/theme`. Dark mode respects system preference with manual override.

### Typography

- **Primary font:** Geist or Inter (clean sans-serif).
- **Web dashboards:** High density, compact spacing.
- **Mobile:** Generous spacing, touch-friendly targets (minimum 44x44px).

### Mobile Design

- Unified codebase (Expo/React Native) for iOS and Android.
- System-adaptive design via NativeWind. No platform-specific UI forks.
- Haptic feedback on key actions (check-in, point award, reactions).
- Swipe gestures for chat (swipe to reply, swipe to archive DM).
