# UI/UX Specification: Web Dashboard (app.frapp.live)

> The web dashboard is the command center for chapter admins. It must be information-dense without feeling cluttered, responsive down to tablet, and resilient on slow connections. In the chat-first product it is **secondary to chat** — every ops capability exists first as an inline chat artifact, and the dashboard page is the longer-form view.

**Cross-app identity:** Motifs, color semantics, motion budget, and trust rules live in **[brand-identity.md](../brand-identity.md)** (palette, typography, radii, theming model). This document set specifies the dashboard shell, screens, components, and data behavior.

## Document map

| Doc | Scope |
| --- | ----- |
| [README.md](README.md) (this file) | Overview, layout shell, sidebar/nav, header bar |
| [layout.md](layout.md) | Design system foundation, dashboard typography, responsive strategy |
| [components.md](components.md) | ShadCN install set + custom component library |
| [screens.md](screens.md) | Per-screen specs (chat, members, events, points, billing, settings) + auth/onboarding wizard |
| [state.md](state.md) | TanStack Query patterns, network resilience, offline handling, accessibility |

---

## Layout Shell

### Structure

```
┌──────────────────────────────────────────────────────┐
│ [Sidebar]  │  [Header Bar]                           │
│            │─────────────────────────────────────────│
│ [Lockup]   │  [Page Content]                         │
│            │                                         │
│ [Nav]      │                                         │
│            │                                         │
│            │                                         │
│            │                                         │
│ [BETA]     │                                         │
│ [User]     │                                         │
└──────────────────────────────────────────────────────┘
```

### Sidebar

**Background:** `--side-bg` (always dark ink, regardless of light/dark mode) per the chat-first product. The sidebar palette never inverts; light/dark mode only swaps the content surfaces. Companion tokens (`--side-bg-hi`, `--side-fg`, `--side-fg-hi`, `--side-muted`, `--side-divider`, `--side-accent`) live in [`packages/theme/src/globals.css`](../../../packages/theme/src/globals.css).

**Text:** `--side-fg`; active item: `--side-fg-hi` with a `--side-accent` left border.

The sidebar tint, accent, and divider are driven by the chapter's derived palette via `useChapterTheme()` — the always-dark base mixes 70% chapter-dark toward neutral ink for legibility (see [brand-identity.md](../brand-identity.md) "Theming model").

**Chapter Lockup (top of sidebar).** The sidebar **leads with the chapter**, not the product. [`apps/web/components/layout/chapter-lockup.tsx`](../../../apps/web/components/layout/chapter-lockup.tsx) renders a small Greek-letters crest on an accent square, the chapter name, and the designation + school short (from `chapters.branding`). This replaces the legacy "Frapp / Operations Console" header.

**BETA badge.** [`apps/web/components/layout/beta-badge.tsx`](../../../apps/web/components/layout/beta-badge.tsx) supports four styles — `sidebar_pill` (default, shown at the foot of the sidebar), `breadcrumb_pill`, `top_banner`, `corner_badge`. The shell defaults to `{enabled: true, style: "sidebar_pill"}`; the active style is sourced from `chapters.beta_config` and is editable from the Settings → Beta tab (with a live preview). See [screens.md](screens.md#settings-settings).

**Navigation sections (source of truth: [`apps/web/components/layout/nav-config.ts`](../../../apps/web/components/layout/nav-config.ts)):**

Items are grouped under short uppercase section labels so the sidebar reads as an
operations console, not a single scrolling list. Each item declares either a
`requirePermission` string or a `requireAnyOf` list; the shell hides items the
caller cannot access and disables items that are on the roadmap but not yet wired
to a route. The caller's effective permission set is loaded once via
`GET /v1/users/me/permissions` and cached with TanStack Query.

**Module gating.** Each nav item also carries a `module` field. `<ProtectedNavItem>` reads `useOrgConfig().isModuleEnabled(item.module)` and **hides** items whose module is disabled (never disabled-greyed). Permission gating and module gating coexist — an item shows only when the caller has the permission *and* the module is enabled. Disabling a module from Settings → Modules immediately removes its sidebar item, strips its slash commands from the chat palette, and mutes its system channel; data is preserved and re-enabling restores everything.

| Section | Item | Route | Permission |
| --- | --- | --- | --- |
| Overview | Chat | `/chat` | — (send gated by channel permissions) |
| Overview | Profile | `/profile` | — |
| People | Members | `/members` | `members:view` |
| People | Alumni | `/alumni` | `members:view` |
| People | Roles | `/roles` | `roles:manage` |
| Operations | Events | `/events` | — |
| Operations | Points | `/points` | — |
| Operations | Tasks | `/tasks` | — (filtered to own tasks unless `tasks:manage`) |
| Operations | Service Hours | `/service` | — (log/approve gated inline via `service:log` / `service:approve`) |
| Communications | Polls | `/polls` | `polls:view_all` (chapter list + tallies; vote/create remain channel-scoped) |
| Resources | Backwork | `/backwork` | — (upload gated by `backwork:upload`) |
| Resources | Documents | `/documents` | — (upload gated by `chapter_docs:upload`, delete by `chapter_docs:manage`) |
| Resources | Study session | `/study` | — |
| Resources | Study Zones | `/geofences` | `geofences:manage` |
| Finance | Billing | `/billing` | `billing:view` |
| Finance | Reports | `/reports` | `reports:export` |
| Settings | Settings | `/settings` | — |

**Web study hours** is a deliberate adaptation of the mobile foreground
enforcement rule. The `/study` timer uses the `Page Visibility API` — when
the tab is hidden (or the member hits the manual pause button) the client
calls `POST /v1/study-sessions/pause`, so the **server** stops crediting
time and starts the grace clock; returning calls `/resume` with fresh
coordinates. The pause is server-owned on purpose: a client that only
stopped its own heartbeat left the server unable to tell "backgrounded"
from "heartbeat in flight", and the gap was credited as study time. If the
member does not come back within the study zone's `pause_grace_minutes`,
the session ends as `PAUSED_EXPIRED`, keeping only the minutes banked
before the pause; the page surfaces that outcome as a toast. A `pagehide`
listener still best-effort stops the session when the tab closes, and the
server additionally expires sessions after 10 minutes of stale heartbeats.
Members who need uninterrupted tracking should use the mobile app once its
study screen exists. This divergence is called out in-copy on `/study` so
there are no surprises. Full rules: [`spec/behavior/study-sessions.md`](../../behavior/study-sessions.md).

**Study Zones** (`/geofences`, `geofences:manage`) configures each zone's
polygon plus its points rate, minimum session length, and **pause grace
(min)** — the window above, per zone.

**Default route.** Chat is the default landing surface for the chat-first
chat-first rework. The unauthenticated landing page lives at `/` and redirects to
`/chat` once a Supabase session is present. `/dashboard` is a legacy alias
that also redirects to `/chat`. The dashboard route group includes
`app/(dashboard)/page.tsx`, which redirects to `/chat` as well, so the
`(dashboard)` tree always has an index page for parity with bookmarks and
internal tooling that expect a segment root. The standalone `/home` overview
was removed in the chat-first rework.

Roadmap entries render disabled with a `Soon` chip (soft-disabled via
`aria-disabled="true"` + `tabIndex={-1}`) so the full footprint of the
dashboard is discoverable even before every route ships. Users with zero
permissions can land on `/no-access`, which explains how to request a role
without dumping them back to the sign-in page.

**User section (bottom of sidebar):**

```
┌──────────────────────┐
│ [Avatar] Admin Name   │
│          President     │
│ [Chapter selector ▼]  │
└──────────────────────┘
```

- Chapter selector dropdown (for users in multiple chapters). On chapter switch, `useChapterTheme()` rewrites the CSS variables on `:root`.
- Click avatar → dropdown: Profile, Sign Out.

Nav rows that change client state are semantic `<button type="button">`; rows that navigate use the framework's `Link`. No `<div onClick>` for nav.

### Header Bar

**Height:** 56px. Fixed at top of content area.

```
[Breadcrumb: Dashboard > Events]          [🔍 Search]  [🔔 Notifications]  [🌙 Theme]
```

- Breadcrumb: auto-generated from route segments.
- Search: opens the command palette (⌘K / Ctrl+K). Searches across members, events, backwork. The trigger's `aria-label` spells out the shortcut ("Command K") for screen readers.
- Notifications: bell icon with a live unread badge count. Click opens the notification drawer (slide from right). The drawer polls `/v1/notifications` via TanStack Query and subscribes to Supabase Realtime INSERT events on `public.notifications` filtered by the current user so new notifications appear without a manual refresh. Tapping a notification deep-links to the relevant surface (events, points, billing, tasks, service, profile) and marks it read via `PATCH /v1/notifications/{id}/read`. Web push is intentionally out of scope for this phase per [`../../behavior/notifications.md`](../../behavior/notifications.md).
- Theme: toggle (sun / moon / system cycle).
