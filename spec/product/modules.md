# Core Domains and Module Catalog

## Identity & Access (IAM)

**Auth provider:** Supabase Auth (email/password, magic link, OAuth).

- **Multi-tenancy:** Every user belongs to one or more chapters (tenants). All data access is strictly scoped by `chapter_id`.
- **RBAC:** Permissions are open-ended strings. Frapp publishes a system permissions catalog that the API enforces; chapters can define additional custom permission strings for channel gating and organizational use. **Custom permission strings are chapter-scoped — they cannot grant system-level or cross-chapter capabilities.** A chapter's custom `admin:all` (or any other string) applies only inside that chapter; the API never consults a chapter's custom permissions when authorizing platform or cross-chapter operations. Roles are chapter-scoped and fully customizable. Seven system roles are seeded on chapter creation with sensible defaults; [`spec/behavior/rbac.md`](../behavior/rbac.md) § Role Lifecycle names them and their exact seeded permission sets. Full permission catalog and check algorithm: [`spec/behavior/rbac.md`](../behavior/rbac.md).
- **Permissions guard:** API middleware fetches the user's roles for the active chapter, flattens permissions, and checks against the `@RequirePermissions()` decorator on each endpoint.
- **Fail-safe:** A user with no roles has zero permissions. The President system role holds the wildcard (`*`) granting all permissions.
- **Presidency transfer:** Atomic operation — current President assigns the role to another member and removes it from themselves in a single transaction.

## Backwork (Academic Library)

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

## Financials

### SaaS Billing (revenue)

- **Customer:** The chapter (organization).
- **Provider:** Stripe.
- **Model:** Fixed monthly subscription, flat per chapter. The price is a commercial commitment pinned in [`spec/product/positioning.md`](positioning.md) § Paid tier (Chapter Pro), which the public site sells; it is not restated here.
- **Enforcement:** Subscription state gates **writes**, applied by `ChapterGuard` at the request boundary. Its refusals are **403** — the API returns no 402 anywhere — though `BillingService` layers its own **400** refusals on top (a duplicate checkout while a live subscription exists, or a portal session for a chapter with no Stripe customer yet). A free-tier wedge (the `@FreeTier()` routes — chat / members / **invites** among them) keeps writing while a chapter is `incomplete`, so a chapter fresh out of the onboarding wizard can invite before it has ever paid. A `past_due` chapter gets a 3-day grace window in which invite _minting_ is blocked while its other free-tier writes continue; after that window, and for `canceled`, **guarded** writes are blocked. Two things deliberately survive that lock, so "read-only" describes the guarded surface rather than the whole API: `@SubscriptionExempt()` billing-recovery routes, so a lapsed chapter can pay its way back; and routes carrying no `ChapterGuard` at all — invite redeem, notification preferences, analytics events — which were never subscription-gated in the first place. Full matrix, including the exact codes and the `GET`/`HEAD`/`OPTIONS` definition of a read: [`docs/guides/api-architecture.md`](../../docs/guides/api-architecture.md) § Subscription enforcement (ChapterGuard).

### Internal Ledger (House Points)

- Every point change is recorded as a transaction in `point_transactions`. The web dashboard **Audit** tab loads a chapter-wide, cursor-paginated slice of those rows for officers with `points:view_all` (API: `GET /v1/points/transactions`; full rules in [`spec/behavior/points.md`](../behavior/points.md)).
- Positive amount = reward; negative amount = fine/correction.
- Categories: ATTENDANCE, ACADEMIC, SERVICE, FINE, MANUAL, STUDY.
- A member's balance is the sum of their transactions.
- Admins can manually adjust points with a required reason. Audit trail tracks which admin made the adjustment.
- Anti-fraud: rate limiting on adjustments, anomaly flagging for large transactions, no self-award (enforced on `points:adjust`, task confirmation and service-hour approval — see [`points.md`](../behavior/points.md) § Anti-Fraud).
- Leaderboard with configurable time windows (all-time, semester, month).

### Member Invoices (Dues)

- Admins create invoices for members (e.g. semester dues).
- Invoices have statuses: DRAFT, OPEN, PAID, VOID.
- Payments tracked via Stripe PaymentIntents; members pay their own open invoices in-app and the webhook confirms payment (moves the invoice to PAID). Behavior details: [`spec/behavior/billing.md`](../behavior/billing.md).
- Financial transactions log all payments, refunds, and adjustments.
- Overdue tracking with notifications.

## Communications

### Real-time Chat

- Messages are persisted in Postgres (`chat_messages`).
- Realtime delivery via Supabase Realtime (Postgres changes subscription).
- **Channels:** PUBLIC, PRIVATE, ROLE_GATED (gated by any permission string, including custom), DM (1-on-1), GROUP_DM (up to 10 members).
- **Channel categories:** Named groups for organizing channels (display-only, like Discord).
- **Default channels:** #general (public), #announcements (admin-post, all-read), #chapter-audit (public, read-only — the system-write audit feed), #alumni (role-gated to Alumni + active members). Full seeded definitions: [`spec/behavior/chat/README.md`](../behavior/chat/README.md) § Channels.
- **Messages support:** Markdown formatting, emoji reactions, file/image uploads (25MB limit), reply threads (reply-with-quote), edit, delete (soft), pinned messages (up to 50 per channel).
- **Typing indicators** and **online/offline presence** via Supabase Realtime.
- **Read receipts:** Last-read timestamp per channel per user.
- **Mentions:** `@user` triggers a push notification.
- **Search:** Full-text search within or across channels.

### Push Notifications

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

## Location & Study Hours

- **Mode:** Active, opt-in tracking only.
- **Geofences:** Admin draws polygon coordinates for approved study locations (e.g. campus library).
- **Session flow:**
  1. User selects a geofence and taps "Start Studying."
  2. API validates that the user's GPS coordinates are inside the polygon.
  3. App enters dedicated **study mode screen** (timer, location status, progress, streak).
  4. Client sends a heartbeat every 5 minutes with updated GPS (foreground only).
  5. If the app goes to the background, the client tells the server and the session **pauses** — time stops accruing at that instant. Grace window (`pause_grace_minutes`, per study zone, default 5 minutes) before it auto-expires as `PAUSED_EXPIRED`, keeping only the minutes studied before the pause.
  6. Server validates each heartbeat (point-in-polygon). Departure or GPS spoofing expires the session.
  7. User stops session. Server calculates `total_foreground_minutes` and awards points via the Points service.
- **Reward logic:** Chapter-configurable (e.g. 1 point per 30 minutes). Minimum session length required (e.g. 15 minutes).

## Events & Attendance

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

## Polls and Voting

- Users with `polls:create` permission can create polls in any accessible channel.
- Polls have a question, 2-10 options, optional expiration time, and single-choice or multi-choice mode.
- Members in the channel vote; results visible in real-time.
- Polls are a special message type within chat.
- Chapter-wide poll **listing** with aggregate results (web dashboard) is a separate surface from channel voting: it requires `polls:view_all` in addition to baseline chapter read permissions. Default seeds place that permission on Treasurer, Vice President, and Secretary (President has `*`); it is not on the default Member role. See [`spec/behavior/polls.md`](../behavior/polls.md) and [`spec/ui/web-dashboard/README.md`](../ui/web-dashboard/README.md).

## Member Directory

- Searchable member list per chapter with profile cards (name, role, points, join date, bio, photo).
- Members edit their own profile. Admins can view all profiles.
- Tap a member to view profile or start a DM.

## Activity Feed

- Unified feed showing recent chapter activity — the item set is owned by [`../behavior/activity-feed.md`](../behavior/activity-feed.md) and not restated here. **Specified, not built on any surface today** — the web home screen was removed in the chat-first redesign, and mobile's `(tabs)/index.tsx` is no longer a Home tab at all: the Signet rebuild ([#937](https://github.com/pdcarlson/Frapp/issues/937)) made it `ChatHomeScreen`, chat's own home route. Web's chat catch-up surfaces a separate, action-oriented pulse card instead ([`spec/behavior/chat/catch-up.md`](../behavior/chat/catch-up.md)).
- Read-only aggregation from existing data sources.

## Global Search

- Single search bar accessible from the top of mobile and web.
- Searches across Backwork, chat messages, events, and members.
- Results grouped by domain. All results respect chapter scoping and permissions.

## Service Hours

- Dedicated tracker for community service and philanthropy hours (separate from study hours).
- Members log entries: date, duration, description, optional proof file upload.
- Admin approval workflow: PENDING → APPROVED / REJECTED with optional comment.
- Approved hours auto-generate point transactions (category: SERVICE) at a chapter-configurable rate.
- Service leaderboard and per-member history.

## Tasks

- Lightweight task management for chapter operations.
- Admins create tasks with title, description, assignee, due date, and optional point reward.
- Assignee moves task through statuses: TODO → IN_PROGRESS → COMPLETED.
- Admin confirms completion (awards points if attached). Can reject and revert to IN_PROGRESS.
- Overdue tasks flagged automatically. Notifications sent to assignee and admin.

## Chapter Documents

- "Chapter Files" storage area for organizational documents (bylaws, constitutions, agendas, etc.).
- Separate from Backwork (no academic metadata).
- Optional flat folder structure (one level deep). Folders are first-class records: officers create, rename, reorder and delete them from the dashboard, and naming a new folder during upload still registers it. Renaming re-files the documents in it; deleting moves them to the root rather than deleting them.
- Documents are searchable by title, combinable with the folder filter.
- All members can view/download. Upload requires `chapter_docs:upload`; management requires `chapter_docs:manage`.

## Semester Rollover

- Admins archive the current leaderboard period with a label (e.g. "Fall 2025") and start a new one.
- Points continue to accumulate (no data deleted). Leaderboard defaults to the new period; historical periods remain selectable.
- Optional bulk role promotion (e.g. "New Member" → "Member").
- Study session configs carry forward.

## Reports & Export

- Admins export data as CSV or PDF: attendance, points, member roster, service hours.
- Exported PDFs use a branded template with chapter name, logo, and Frapp footer.
- API generates the file and returns a signed download URL.

## Alumni

- Alumni is a system role with limited permissions: read chat, view member directory. The seeded set, and why the restrictions are enforced in the domain services rather than by the permission guard, are owned by [`../behavior/alumni.md`](../behavior/alumni.md).
- **Alumni directory:** Searchable list with optional self-reported fields (graduation year, current city, current company).
- **Alumni channel:** Default `#alumni` channel seeded on chapter creation.
- **Donation link:** Optional external URL in chapter settings. "Support the Chapter" button shown to alumni.

## Chapter Branding

- Chapters upload a logo (displayed in app header, directory, PDF reports, onboarding).
- Chapters set a custom accent color (hex) for buttons, links, and highlights.
- Default accent: several distinct "defaults" are in play and they are **not** interchangeable — the value a chapter *holds* until an accent is chosen (the `chapters.accent_color` column default), the value a client *paints* when the stored one is absent or illegible, and the seed a no-accent chapter's palette is generated from. [`spec/behavior/branding.md`](../behavior/branding.md) owns the first two and [`spec/ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md) owns the seed; this file restates none of them.
- Chapter branding applies only within the chapter context; Frapp branding is unaffected.

---

# Module Catalog

The module catalog governs which features chapters can enable.

## Modules are chat integrations, not nav tabs

Chat is the spine of the app (see [`spec/product/positioning.md`](./positioning.md)), so an ops module does not primarily get a top-level nav tab. When a module is enabled it gets:

1. **A slash command** in chat (`/event`, `/task`, `/poll`, `/dues`, `/points`, `/hours`).
2. **A rich message renderer** that turns the artifact into an inline card with primary actions (RSVP / Done / Vote / Pay / Confirm / Submit).
3. **A system channel** where the module's notifications land (`#events`, `#dues`, etc.) so the firehose does not drown `#general`.
4. **Optionally, a dashboard page** for the longer-form view (calendar, ledger, kanban). The dashboard page is secondary to the chat experience, not primary.

Example: a treasurer types `/dues remind overdue` in `#general`; a rich card summarizes overdue members with a per-row "Send DM reminder" button that DMs each member a templated message with a Pay button — no tab-switching, no separate workflow.

Every paid module ships with: slash command(s), rich renderer, system channel, and an optional dashboard surface.

## Tiers

## Always-on (free tier — cannot be disabled)

| Module | Key | Description |
|--------|-----|-------------|
| Chat | `chat` | Channels, DMs, reactions, pins, threads |
| Members | `members` | Roster, profiles, custom fields, alumni status |
| Announcements | `announcements` | Exec-write, member-read broadcast channel |
| Audit Log | `audit-log` | Member-visible officer action history |
| Chapter Settings | `chapter-settings` | Archetype, branding, modules, roles, workflows, dues |

## Paid integrations (gated by subscription)

| Module | Key | Description |
|--------|-----|-------------|
| Events | `events` | Calendar, RSVP, QR check-in, post-event points |
| Tasks | `tasks` | Assignments, confirmations, points-on-completion |
| Points | `points` | Earn/spend ledger, leaderboard |
| Service Hours | `hours` | Time tracking with approval queue |
| Dues | `dues` | Invoices, payment plans, scholarships, Stripe |
| Polls | `polls` | Chapter votes, anonymous or named |
| Recruitment | `rush` | Candidate funnel, voting, bid management |
| Backwork | `backwork` | Document library + academic archive |
| Documents | `documents` | Chapter-level docs (bylaws, minutes, policies) |
| Reports | `reports` | Health dashboard, nationals export, advisor digest |
| Onboarding | `onboarding` | Structured new-member pathway |
| Geofences | `geofences` | Geo-fenced check-in zones |
| Meetings | `meetings` | Audio transcription + AI summary + single-template per type ([`spec/behavior/meetings.md`](../behavior/meetings.md)) |
| Vault | `vault` | Encrypted private storage for risk / standards content ([`spec/behavior/vault.md`](../behavior/vault.md)) |
| AI Q&A | `ai` | Ask-anything over meeting minutes, documents, structured data, announcements ([`spec/behavior/ai.md`](../behavior/ai.md)) |

## Archetype-specific extras (prototype extras carried forward)

`billing`, `academics`, `philanthropy`, `risk`, `lines`, `networking`, `standards`, `serviceFirst` — these are in the catalog for archetype presets and future feature scoping. They are paid-tier and opt-in.

## Ops-setup nudges

Enabling paid ops modules is never a gate — it is surfaced as a dismissible inline nudge in chat once a chapter is settled there ([`spec/product/positioning.md`](./positioning.md)). **One nudge per module**, shown in the fixed priority order **Dues > Events > Tasks > Points**, so a chapter is never asked two things at once. Nudge copy renders the chapter's terms through the vocabulary helper rather than hardcoding "rush" or "pledge". The dismissed state is persisted **per user per chapter**: one officer dismissing a nudge neither hides it from the rest of the exec board nor carries across their other chapters. Clicking a nudge opens the Settings → Modules surface on the module it names ([`spec/behavior/settings/README.md`](../behavior/settings/README.md)).

## Module disabling behavior

The control surface is **Settings → Modules**, driven by the `@repo/org-archetypes` `MODULE_CATALOG`. Toggling a paid module writes `chapter_config.enabled_modules[key]` through `usePatchOrgConfig()` (optimistic cache update + audited PATCH).

Disabling a paid module: removes its slash commands from the chat palette (`filterSlashCommands`), hides its dashboard nav item (module-gated `ProtectedNavItem` reading `useOrgConfig().isModuleEnabled`), hides its entry from the Cmd+K command menu (which resolves each command's module from `DASHBOARD_NAV_BY_HREF` so the two surfaces cannot drift), and mutes its system channel (no new messages, unread badge suppressed). A module is treated as enabled unless `enabled_modules[key]` is explicitly `false`. Data is preserved — re-enabling restores access.

**Server-side enforcement.** Hiding a surface is not the same as closing it: a direct API call bypasses every client-side gate above. Controllers for paid modules therefore carry `@RequireModule(key)` (`apps/api/src/interface/decorators/module.decorator.ts`), and `ChapterGuard` rejects **writes** to a disabled module with `403 chapter.module.disabled`. Two rules follow from the guarantee that data is preserved:

- **Reads are never gated.** The toggle hides and freezes a surface; it must not strand the chapter's existing data behind it, or re-enabling could not restore access.
- **Enabled unless explicitly `false`**, matching the client's `isModuleEnabled` contract — a chapter created before a module existed has no key for it and must not be locked out of something it never turned off.

Free always-on modules (chat, members, announcements, audit-log, chapter-settings) are never gated, since they cannot be toggled off. Billing and member-invoice routes are also ungated: paying dues is the recovery path for a locked chapter, so it stays reachable — the same reason `/billing` carries no `module` key in the dashboard nav.

> The toggle UI lists the modules present in `MODULE_CATALOG` today. `meetings`, `vault`, and `ai` are catalogued above for roadmap/scoping but are not yet in the toggle set; they join Settings → Modules when those features ship.

## AI feature pricing

The AI Q&A and Meetings modules are bundled into the paid tier with a monthly **AI allowance** included; usage past the allowance is **at-cost passthrough** with treasurer visibility and a configurable hard cap. See [`spec/behavior/billing.md`](../behavior/billing.md) for the allowance + overage rules. The intent: members never see a meter at the point of using AI; treasurers see usage but only see a real overage bill when the chapter is outlier-heavy.
