# Web Dashboard — Screens

> Per-surface specifications for the dashboard route group. The shell (sidebar, header, nav) is in [README.md](README.md); foundation tokens and breakpoints are in [layout.md](layout.md); shared components in [components.md](components.md); data and resilience behavior in [state.md](state.md).

Chat is the spine of the product and the default landing surface; every ops surface below exists first as an inline chat artifact and second as a longer-form dashboard page. Screens that read or write chapter config flow through `useOrgConfig()` / `usePatchOrgConfig()`; screens that need the chapter palette read `useChapterTheme()`.

---

## Chat (`/chat`)

The post-sign-in landing surface and the spine of the chat-first product.

**Layout — Slack-grade 3-pane (`md:grid-cols-[260px_1fr_300px]`):**

- **Left pane — channel list.** Grouped **Channels / Direct messages / System** (system = `#chapter-audit` and similar system feeds), sorted alphabetically inside each group; pinned channels float to the top. A search box filters across all groups. Every row is a semantic `<button>` (client-side open) with `aria-current="page"` for the active channel. Unread badge + mute pill render when the data is available. The empty channel set renders an explicit "All caught up — start a channel" placeholder rather than a blank card.
- **Center pane — timeline + composer.** The header carries the channel name + description, the **"Reconnecting…" pill** (hidden when the realtime stream is live, amber while reconnecting, red when fully offline), and the **pinned-messages popover**. The body is a `react-virtuoso` virtualized list with consecutive-author grouping (5-minute window): a same-author message within 5 minutes collapses its header. Each row renders `_status: pending | confirmed | failed` (spinner + clock for pending; red banner + Retry/Discard for failed). Hover reveals the reaction quick-pick (👍 🙏 ✅ 🔥), the emoji-picker popover (`frimousse`), and Reply. Reaction chips are `<button aria-pressed>` reflecting whether the viewer is in the reaction set. Empty → "Be the first to post"; loading → spinner; load error → ErrorState with retry. A jump-to-unread affordance scrolls to the first unread row.
- **Right pane — thread / details.** Collapsible. When a Reply is opened, it renders the parent + replies (filtered by `reply_to_id`); a deleted or not-yet-loaded parent renders a graceful fallback rather than dereferencing `undefined`. When no thread is open, it shows a Details placeholder ("Open a message thread to see replies."). Pinned messages live in the popover above the timeline, not the right pane.

**Composer:**

- Full WYSIWYG built on **Tiptap** (StarterKit + Placeholder). `Shift+Enter` inserts a hard break, `Enter` submits, `Cmd+/` opens the slash palette. Live `@`-mention and `#`-channel suggestion popovers are scaffolded (the Mention extension is installed) but the data-backed suggestion renderers land alongside the rich-message renderers.
- Buttons: emoji insert (`frimousse` popover), file attach (pre-signed Supabase Storage upload via `useRequestChatUploadUrl`), open slash palette, send.
- The slash palette is a `cmdk`-backed dialog reading the catalog from `@repo/chat-integrations`, filtered by `useOrgConfig().isModuleEnabled(requiredModule)`. It **fails closed** while the chapter-config query is pending or errored — opening it during the initial load renders an explicit "Loading commands…" panel; on error it renders a "Modules unavailable" panel with a Retry action. Only once the query resolves does it show the filtered command list (empty match → "No matching command.").
- Drafts persist to **Dexie** (`drafts(channelId, body, updatedAt)`) and are restored on reload.

**Rich-message renderers.** `message-item.tsx` dispatches `message.kind` through `components/chat/renderers/` (`MessageRenderer`). Every renderer is keyed off the same `kind` field; unknown kinds fall back to the text renderer.

- **Text** — bone or accent-tinted bubble (self-message uses `--chat-self-bubble`), whitespace-preserved; deleted messages italicized as `[message deleted]`.
- **Announcement card** — accent-left-border block on a `--mention-bg` tint, mono uppercase eyebrow "Announcement" with a megaphone glyph. Body comes from `payload.body` (fallback to `message.content`). No primary CTA — announcement reads are passive.
- **Poll card** — mono eyebrow "Poll" (+ "· Closed" when `payload.closes_at` has elapsed). Pre-vote: every option is a full-width semantic `<button>` with the option label and a `0 · 0%` tally tag. Post-vote: the same buttons stay tappable so the user can change their vote, the viewer's choice highlights with `aria-pressed`, and a 1px accent progress bar shows the per-option share. Footer: `<n> vote[s] · your vote is highlighted` or `No votes yet · be the first to vote`.
- **System-audit card** — mono-style card with a `ShieldAlert` eyebrow, a `font-mono` action header (`chapter_config_updated by 7f9a0e`), and a "Changed: <keys>" line listing the diff field names. A malformed payload falls back to the prose `content`.
- **Loading card** — animated spinner with the message's `content` ("Computing overdue list…"), used by heavy slash commands while the server replaces the row's `kind` + `payload` via a Realtime UPDATE.
- **Coming-soon card** — dashed-border stub for `event` / `task` / `dues` / `points` / `hours` kinds, swapped to a concrete renderer per kind as those surfaces ship.

Cards live in the message body slot; reaction chips and the Reply affordance still render below per the row layout.

Theme is applied via `useChapterTheme()` — sidebar tint, mention pills, self-bubble, and reaction-active read the chapter's derived palette. See [brand-identity.md](../brand-identity.md) "Theming model" and [state.md](state.md) for the hot-path cache, reconnect, and offline-queue behavior.

---

## Members (`/members`)

The directory is built around the always-on `members` module. Custom fields render per chapter, respecting visibility.

**Layout — table view with a card-view toggle:**

```text
┌──────────────────────────────────────────────────┐
│ Members                          [+ Invite Member]│
├──────────────────────────────────────────────────┤
│ [🔍 Search]  [Role ▼] [Cohort ▼] [Status ▼] [▦/▤]│
├──────────────────────────────────────────────────┤
│ ┌─────┬──────────┬────────┬────────┬───────────┐ │
│ │     │ Name     │ Role   │ Points │ Joined    │ │
│ ├─────┼──────────┼────────┼────────┼───────────┤ │
│ │ [📷]│ John Doe │ Member │  142   │ Jan 2026  │ │
│ │ [📷]│ Jane S.  │ Pres.  │  310   │ Sep 2025  │ │
│ └───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

- **Table / card toggle.** Table view is the default (sortable columns — click a header to sort); a card view presents the same roster as avatar cards.
- **Search** spans name + email + custom-field values, scoped to the viewer's visibility.
- **Filters:** role, class/line/cohort (labelled via the chapter's `vocab()` term), and status.
- Row click → slide-out member detail panel (right side). Bulk select with checkboxes for bulk role assignment. Pagination: 25 per page.

**Member detail slideout:**

```text
┌─────────────────────────┐
│ [Close X]               │
│ [Large Avatar]          │
│ John Doe                │
│ Member · john@x.com     │
│                         │
│ Joined: Jan 15, 2026    │
│ Points: 142             │
│ [Custom fields…]        │
│                         │
│ Roles: [Member ▼]       │
│ Custom role: [—  ▼]     │
│ [+ Add Role]            │
│ ─────────────────────── │
│ [Remove from Chapter]   │
└─────────────────────────┘
```

- Core fields (name, email, role, joined date) plus **custom fields rendered per chapter**, each gated by its visibility setting (self / chapter / exec / president). Visibility is enforced on the server query as well as the client — `sensitive` fields are never trusted to client-only filtering.
- Custom-role assignment dropdown sources its options from the chapter's custom roles (defined in Settings → Roles).

**Invite flow:**

- Single email plus bulk CSV upload (a number-of-links batch mode is also available). "Generate Link" produces a copyable `/join?token=…` URL with a copy-confirmation toast; a role selector sets the invitee's starting role.
- On send: writes a member-visible row to `chapter_audit_log`, which posts a `#chapter-audit` message via the audit bridge.
- On accept: the inviter receives a DM (`chat-send` with `kind="system_audit"` to the inviter's DM channel) — "Alex Chen accepted your invite."

---

## Events (`/events`)

**Two views:** List view (default) and Calendar view (toggle).

**List view** groups Upcoming / Past / Recurring and renders each event as a card with location, time, point value, mandatory/recurrence chips, and a check-in count.

**Event detail** (expand or navigate) shows full event info plus a **live** attendance roster: member name, status (PRESENT / ABSENT / EXCUSED / LATE), and check-in time. Admin actions per row: Mark Excused / Absent / Late. An "Auto-Mark Absent" button calls the auto-absent endpoint after the grace period. Meeting minutes render as a Markdown editor below attendance; a "Download .ics" button exports the event.

The roster is live: the web client subscribes to Supabase Realtime Postgres changes on `event_attendance` filtered by `event_id` and invalidates the corresponding TanStack query on every INSERT/UPDATE, so admins watching one tab see self check-ins from other devices without refreshing. The shared realtime primitive (`useRealtimeTable` in `apps/web/lib/realtime/use-realtime-table.ts`) also backs the events list itself (new events propagate immediately), and a single shared browser Supabase client multiplexes every subscription over one websocket (`apps/web/lib/realtime/supabase-realtime.ts`).

**Create / edit event** form (modal or full page): name, description, location; start/end date-time pickers; point value (number, default 10); mandatory toggle; recurrence (None | Weekly | Biweekly | Monthly); optional required-roles multi-select. Inline validation.

**Calendar view:** monthly grid with events as colored bars; click a day to list its events, click an event to navigate to detail; month / week / day toggle.

---

## Points Ledger (`/points`)

```text
┌──────────────────────────────────────────────────┐
│ Points                    [All Time ▼] [+ Adjust] │
├──────────────────────────────────────────────────┤
│ Leaderboard                    Transaction Log    │
│ ┌─────┬───────────┬───────┐   ┌────────────────┐ │
│ │ #1  │ Jane S.   │  310  │   │ +10 John D.    │ │
│ │ #2  │ Mike R.   │  256  │   │ Attendance     │ │
│ └─────────────────────────┘   │ -5 Mike R. FINE│ │
│ [⚠️ Flagged Transactions]     └────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Leaderboard:** time-window selector (All Time | This Semester | This Month); rank, avatar, name, total points; click a row for that member's full transaction history.

**Transaction log:** chronological, newest first. Each row: amount (+/-), member name, category badge (ATTENDANCE, SERVICE, MANUAL, FINE, STUDY), description, timestamp. Flagged transactions show a yellow warning icon and are filterable.

**Audit tab:** chapter-wide transaction log with a "Show flagged only" toggle and category + member filters. Backed by `GET /v1/points/transactions`, which requires `points:view_all`; the optional `limit` query parameter is validated to 1–200 at the API boundary (default 50). Members without that permission see an explanatory card pointing at their chapter president. Flags are raised automatically when `|amount| ≥ 100` on a manual adjustment.

**Adjust modal:** searchable member selector; amount (positive reward / negative fine); category (MANUAL or FINE); required reason; confirmation dialog ("Award +25 points to John Doe? Reason: Perfect attendance").

---

## Billing (`/billing`)

```text
┌──────────────────────────────────────────────────┐
│ Billing                                           │
│ ┌────────────────────────────────────────┐       │
│ │ Subscription: Active ✓                 │       │
│ │ Next billing: March 1, 2026            │       │
│ │ [Manage Subscription →]                │       │
│ └────────────────────────────────────────┘       │
│ Member Invoices          [+ Create Invoice]       │
│ ┌────────────────────────────────────────────┐   │
│ │ Fall Dues - John D.  $150  OPEN    Due 9/1 │   │
│ │ Fall Dues - Mike R.  $150  OVERDUE ⚠️      │   │
│ └────────────────────────────────────────────┘   │
│ [DRAFT][OPEN][PAID][VOID][OVERDUE]  filters       │
└──────────────────────────────────────────────────┘
```

A subscription summary card sits above an `InvoiceAdminCard` that lists every member invoice with inline status transitions (DRAFT → OPEN → PAID / VOID), a dedicated OVERDUE filter backed by `/v1/invoices/overdue`, and a Create-invoice dialog. The admin section is gated behind `billing:manage` via `<Can>`; members see only their own invoices in the table above.

---

## Settings (`/settings`)

A vertical **tab rail of 9 tabs**, rebuilt for the chat-first product. Order: **Organization | Modules | Roles | Fields | Workflows | Dues | Theme | Beta | Audit.** Tabs are semantic interactives (`<button>` when the active tab is client state, `Link` when URL-routed) — never `<div onClick>`.

Config reads/writes go through `GET/PATCH /chapters/:id/config` via the `useOrgConfig()` / `usePatchOrgConfig()` hooks (optimistic cache update + rollback on error). **Every config PATCH writes a `chapter_audit_log` row**, which the audit bridge mirrors to `#chapter-audit`. Edit controls require `chapter-config:manage` (President holds `*`); reads require `chapter-config:view`.

### Organization tab

- _Chapter profile_ (core chapter record): chapter name, university, donation URL — saved via the chapter-update path.
- _Identity & founding_ (config `branding`): Greek letters, designation, school short, founded year (guard-parsed; 1776–next year). Saved through the audited config PATCH.
- _Archetype picker_: cards for all 8 archetypes, resolved through the guarded `getArchetype()` helper (fallback `ifc` — never a bare `ARCHETYPES[key]`). Switching opens a confirm dialog and PATCHes `org_archetype` plus a reset of `vocabulary` and `enabled_modules` to the new archetype's defaults (the role pack follows server-side); identity, branding, and custom fields are preserved.
- _Vocabulary_: three inputs — recruitment term, new-member term, cohort term — with archetype-default placeholders, written to config `vocabulary`.
- Semester rollover (gated `semester:rollover`) and a billing + danger card (Stripe portal, gated `billing:manage`; deactivation is support-assisted) live here.

### Modules tab

- Driven by the `MODULE_CATALOG` in `@repo/org-archetypes`. Always-on modules are locked with a **Free** badge; paid modules show a **Chapter Pro** badge and an on/off toggle writing `enabled_modules[key]`. There is a single paid tier — no per-module price.
- `enabled_modules` is a boolean map; a module is enabled unless explicitly `false` (matching `useOrgConfig().isModuleEnabled`). Writes go through `usePatchOrgConfig()`, never a direct table update.
- Disabling a module immediately hides its **sidebar item** (via `NavItem.module` + `ProtectedNavItem`), removes its **slash commands** from the chat palette, and mutes its **system channel** (without deleting it). Data is preserved; re-enabling restores everything.
- Sub-features render as an informational expandable list.

### Theme tab

- Two color pickers: **dark** (sidebar / headers) and **accent** (chat self-bubble / mentions / CTAs).
- A **live preview** panel computes from the current form state (never a window global) via `derivePalette({dark, accent})` and renders swatches for the sidebar, chat bubble, mention pill, and primary button.
- **Inline WCAG warnings** surface when a token fails AA 4.5:1 against bone or ink (using `packages/theme/src/accent.ts`); a failing token falls back to bronze for that token specifically, and the save still succeeds.
- Save → `POST /chapters/:id/theme-palette` → the server recomputes `theme_palette` → the client refetches via `useChapterTheme()` and applies the CSS variables immediately, with no full reload.

### Roles tab — 4 sub-tabs

- **Pack** (read-only): the active archetype's role-pack table, resolved via `getRolePack(getArchetype(key).rolePack)` (guarded fallback to `ifc_standard`).
- **Matrix**: a capabilities × roles permission matrix. Columns derive from the active role pack at render time (`pack.roleKeys`, with a guarded fallback to archetype-default keys) plus the live `chapter_custom_roles` keys — adding a custom role extends the columns without a code change.
- **Custom**: create/edit `chapter_custom_roles`. Inputs: label, rank, capabilities (native multi-select from the permission catalog), core (boolean — if false, the role can be deleted). Persisted via the dedicated CRUD endpoints below (audit-logged), not the config blob.
- **Live roles**: the RBAC manager folded in from the former standalone `/roles` page — edit the live `roles` table (system-role permissions, create/delete custom RBAC roles, presidency transfer, assignment). The standalone `/roles` route now redirects to `/settings?tab=roles`; the Settings rail is the single home for role IA.

The custom-role rows live in `chapter_custom_roles` and are served by dedicated endpoints (read gated by `chapter-config:view`; write by `chapter-config:manage`): `GET /custom-roles`, `POST /custom-roles`, `PATCH /custom-roles/:id`, `DELETE /custom-roles/:id`. Each write appends a `chapter_audit_log` row (mirrored to `#chapter-audit`) like every other settings save; a `core` role cannot be deleted (`403`), and a duplicate `(chapter_id, key)` is rejected (`409`). These rows are presentation-only today — wiring `chapter_custom_roles` into permission enforcement and member assignment is tracked as a follow-up.

### Fields tab

- An editable table over `chapter_custom_fields`. Columns: label, type, required, visibility (self / chapter / exec / president), sensitive.
- An "Add field" modal with type-specific config (text → max length; select → options; date → no extra; …). Option lists deep-clone when added so editing one chapter's options never mutates another's.

### Workflows tab

- A toggle list per `chapter_workflows`. Each enabled workflow exposes a numeric threshold input (guard-parsed — `NaN` is never stored).

### Dues tab

- Cadence picker (monthly / per-semester / per-quarter — three buttons).
- Amounts grid: active member / new member / alumni.
- Conditional sections: installments allowed (toggle + count), grace period (days), late fee (cents), scholarship pool (cents). All numeric inputs guard-parse against negative / non-finite values.
- Writes to `chapter_dues_config` (one singleton row per chapter).

### Beta tab

- A build-channel selector (stable / beta) that affects which `BetaBadge` style is shown.
- A style picker for the BETA badge (`sidebar_pill | breadcrumb_pill | top_banner | corner_badge`) with a **live preview**; the active style is sourced from `chapters.beta_config` and applies to the real sidebar badge on save, without a reload. See [README.md](README.md#sidebar) for the badge in the shell.
- A caveats table of known beta-build limitations and a simple feedback form.

### Audit tab

- A paginated table of `chapter_audit_log` rows with actor, action-type, and date-range filters.
- Per-row expansion renders the `diff` JSON in a readable format.
- A `member_visible` toggle per row (president-only); toggling re-posts or retracts the corresponding `#chapter-audit` message.

### Ops-setup nudge

A dismissible card (on `/chat` or as a banner in `#general`) nudges officers toward enabling paid ops modules once they're settled in chat: "Want to track dues? Enable Dues for a 14-day trial." One per module, shown in priority order (Dues > Events > Tasks > Points), with copy that respects the chapter's `vocab()` terms. The dismissed state persists per user per chapter. Clicking opens the Modules tab scrolled to — and highlighting — the relevant row.

---

## Remaining screens (summary)

| Screen | Key components | Layout pattern |
| ------ | -------------- | -------------- |
| Roles & Permissions | Role list with drag-reorder, permission checklist modal, color picker | List + modal |
| Chat Admin | Channel list, create/edit channel modal, category management | List + modal |
| Backwork Admin | Filter sidebar + resource grid, department/professor management | Filter + grid |
| Study Geofences | Map (Mapbox/Google Maps) + geofence list, config panel | Map + sidebar |
| Tasks | Kanban columns (TODO, IN_PROGRESS, COMPLETED, OVERDUE) or table view | Kanban or table |
| Service Hours | Review queue (pending entries), approve/reject actions, stats | Queue + table |
| Documents | Folder tree + document list, upload modal | Tree + list |
| Reports | Report-type selector, date-range picker, format toggle (JSON/CSV), download | Form + preview |
| Polls | Poll list, create-poll form, results bar chart | List + chart |

The standalone `/home` overview dashboard was removed in the chat-first product; the post-sign-in landing is `/chat` (a chat catch-up). Chapter health and quick actions are re-homed as inline chat artifacts.

---

## Authentication & onboarding

### Sign up / log in

```text
frapp.live → [Get Started] → app.frapp.live/sign-up

Create your account            Welcome back
[Email]                        [Email]
[Password]                     [Password]
[Sign Up]                      [Log In]
or continue with [Google]      [Forgot password?] [Magic link] [Google]
Already have an account? Log in
```

### Post-auth flow

1. Sign-in / sign-up redirects to `/chat` (the default dashboard landing).
2. The dashboard shell mounts `<ChapterWizardGate>`, which reads `GET /v1/chapters`. If the signed-in user has **zero** chapter memberships, the onboarding wizard opens as a full-screen overlay. Once opened it owns its lifecycle (the membership count flips to 1 mid-flow), so it never auto-closes from the gate.
3. If the user already has chapters, the wizard does not fire and the chat landing renders normally.

> Free tier: chapter creation no longer requires Stripe. The old terms/payment wizard is replaced by the directory-autofill wizard below; billing is a separate, later activation for paid ops modules.

### Chapter onboarding wizard

A skippable-where-safe, full-screen wizard at `apps/web/components/onboarding/chapter-wizard.tsx`. Goal: "I just signed up" → "I'm in `#general` with my chapter set up" in under 90 seconds for a chapter in the directory. It must render without horizontal scroll down to **375px** mobile width. Five conceptual steps (sign-up is step 1, already complete):

1. **Sign up** — done before the wizard mounts.
2. **Find chapter** — a directory combobox → `GET /v1/chapter-directory/search` (debounced 250ms), with explicit idle / loading / no-results / error states; result rows show org letters + chapter designation + university. "Not in our directory?" is always available and routes to manual entry.
3. **Pick archetype** — a 4-up card grid (all 8 archetypes); pre-selected from a directory match.
4. **Confirm identity** — Greek letters, designation, school short, founded year (guard-parsed, ≥ 1776), and two color pickers (dark + accent) — all editable, pre-filled from the directory match or blank for manual entry.
5. **Invite members** — generates a copyable `/join?token=…` link (share-link primary; skippable) with an explicit "generate link" empty state and a copy-confirmation state. Bulk-email invites are deferred (no mail service).

All interactives are semantic (`<button>`, native form controls, the `cmdk` combobox) with labels; no step renders a blank pane.

**Submit** calls `POST /v1/chapters/onboard` (cold path):

- Creates the `chapters` row with branding + archetype + `directory_id` (when matched). `enabled_modules` / `vocabulary` / `theme_palette` are materialized **server-side** from the archetype seed (`buildChapterConfigFromArchetype`, which `structuredClone`s) — the client never supplies the module map.
- Seeds default channels (`#general`, `#announcements`, `#chapter-audit`) and the creator's President membership.
- Posts a one-time welcome `system_audit` message into `#general`.
- For manual entry (no `directory_id`), writes a `chapter_directory_requests` row so the seed can be backfilled.
- Navigates to `/chat?channel=general`.

**Trigger:** the user has no chapter memberships. A wizard-created membership is written with `has_completed_onboarding=true` and the chapters-list endpoint does not expose `enabled_modules`, so "no chapters" is the robust re-trigger signal.

Users with zero permissions but an existing chapter can land on `/no-access`, which explains how to request a role without dumping them back to the sign-in page.
