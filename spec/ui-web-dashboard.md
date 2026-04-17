# UI/UX Specification: Web Dashboard (app.frapp.live)

> The web dashboard is the command center for chapter admins. It must be information-dense without feeling cluttered, responsive down to tablet, and resilient on slow connections.

**Cross-app identity:** Motifs, color semantics, motion budget, and trust rules: **[spec/ui-brand-identity.md](ui-brand-identity.md)**. Dashboard density and shell layout remain specified below.

---

## 1. Design System

### Foundation

Inherits `@repo/theme` (Tailwind config + CSS variables). Uses ShadCN UI as the component library (installed into `apps/web` via CLI, customized to match the Frapp palette).

Semantic tokens match [packages/theme/src/globals.css](packages/theme/src/globals.css) (source of truth). ShadCN `Button` default variant uses `bg-primary` → **royal blue**, not emerald.

| Token       | Light (CSS vars)                 | Dark (CSS vars)             | Usage                            |
| ----------- | -------------------------------- | --------------------------- | -------------------------------- |
| Background  | `--background` (slate-50 family) | `--background` (navy)       | Page bg                          |
| Card        | `--card`                         | `--card`                    | Cards, panels                    |
| Primary     | `--primary` (royal blue)         | `--primary` (brighter blue) | Buttons, links, focus ring       |
| Success     | `--success` (emerald)            | `--success`                 | Positive badges, success states  |
| Muted       | `--muted`                        | `--muted`                   | Secondary surfaces, subdued text |
| Destructive | `--destructive`                  | `--destructive`             | Delete, danger actions           |
| Border      | `--border`                       | `--border`                  | Dividers, inputs                 |

See [spec/ui-brand-identity.md](ui-brand-identity.md) for Frapp-wide color roles and chapter accent vs product chrome.

### Typography (Dashboard)

Dashboard uses compact, high-density typography per the product spec.

| Element         | Size | Weight | Line Height |
| --------------- | ---- | ------ | ----------- |
| Page Title      | 24px | 700    | 1.2         |
| Section Heading | 18px | 600    | 1.3         |
| Table Header    | 13px | 600    | 1.4         |
| Table Cell      | 14px | 400    | 1.5         |
| Body            | 14px | 400    | 1.5         |
| Label           | 13px | 500    | 1.4         |
| Small/Caption   | 12px | 400    | 1.4         |

### Responsive Strategy

The dashboard targets **desktop-first** with a **tablet breakpoint** at 768px. Below 768px, the sidebar collapses to a slide-out drawer.

| Breakpoint  | Sidebar                                          | Content Area    |
| ----------- | ------------------------------------------------ | --------------- |
| ≥1280px     | 256px fixed                                      | Remaining width |
| 1024–1279px | 240px fixed                                      | Remaining width |
| 768–1023px  | 64px collapsed (icons only), expandable on hover | Remaining width |
| <768px      | Hidden, hamburger → slide-out overlay            | Full width      |

Content area max-width: `1200px` with `px-6` padding.

---

## 2. Layout Shell

### Structure

```
┌──────────────────────────────────────────────────────┐
│ [Sidebar]  │  [Header Bar]                           │
│            │─────────────────────────────────────────│
│ [Logo]     │  [Page Content]                         │
│            │                                         │
│ [Nav]      │                                         │
│            │                                         │
│            │                                         │
│            │                                         │
│            │                                         │
│ [User]     │                                         │
└──────────────────────────────────────────────────────┘
```

### Sidebar

**Background:** `slate-900` (light mode), `slate-950` (dark mode) — always dark for contrast.
**Text:** `slate-300`, active: `white` with `primary` left border accent.

**Navigation sections (source of truth: [`apps/web/components/layout/nav-config.ts`](../apps/web/components/layout/nav-config.ts)):**

Items are grouped under short uppercase section labels so the sidebar reads as an
operations console, not a single scrolling list. Each item declares either a
`requirePermission` string or a `requireAnyOf` list; the shell hides items the
caller cannot access and disables items that are on the roadmap but not yet wired
to a route. The caller's effective permission set is loaded once via
`GET /v1/users/me/permissions` and cached with TanStack Query.

| Section | Item | Route | Permission |
| --- | --- | --- | --- |
| Overview | Home | `/home` | — |
| Overview | Profile | `/profile` | — |
| People | Members | `/members` | `members:view` |
| People | Alumni | `/alumni` | `members:view` |
| People | Roles | `/roles` | `roles:manage` |
| Operations | Events | `/events` | — |
| Operations | Points | `/points` | — |
| Operations | Tasks | `/tasks` | — (filtered to own tasks unless `tasks:manage`) |
| Operations | Service Hours | *(planned)* | any of `service:log`, `service:approve` |
| Communications | Chat | *(planned)* | — |
| Communications | Polls | *(planned)* | any of `polls:create`, `channels:manage` |
| Resources | Backwork | *(planned)* | — |
| Resources | Documents | *(planned)* | — |
| Resources | Study Zones | *(planned)* | `geofences:manage` |
| Finance | Billing | `/billing` | `billing:view` |
| Finance | Reports | *(planned)* | `reports:export` |
| Settings | Settings | `/settings` | — |

The unauthenticated landing page lives at `/` and redirects to `/home` once a
Supabase session is present. `/dashboard` is a legacy alias that also redirects
to `/home`.

Roadmap entries render disabled with a `Soon` chip so the full footprint of the
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

- Chapter selector dropdown (for users in multiple chapters)
- Click avatar → dropdown: Profile, Sign Out

### Header Bar

**Height:** 56px. Fixed at top of content area.

```
[Breadcrumb: Dashboard > Events]          [🔍 Search]  [🔔 Notifications]  [🌙 Theme]
```

- Breadcrumb: auto-generated from route segments
- Search: Opens command palette (⌘K / Ctrl+K). Searches across members, events, backwork.
- Notifications: Bell icon with unread badge count. Click opens notification drawer (slide from right).
- Theme: Toggle (sun/moon/system cycle)

---

## 3. Screen Specifications

### 3.1 Dashboard Home (`/home`)

**Purpose:** Chapter health at a glance. The first thing an admin sees.

**Layout:**

```
┌──────────────────────────────────────────────────┐
│ Welcome back, {firstName}                         │
│ {chapterName} • {university}                      │
├──────────┬──────────┬──────────┬─────────────────┤
│ Active   │ Upcoming │ Sub      │ Points          │
│ Members  │ Events   │ Status   │ This Month      │
│   47     │    3     │ Active ✓ │  1,240          │
├──────────┴──────────┴──────────┴─────────────────┤
│                                                    │
│ Recent Activity                    Quick Actions   │
│ ┌────────────────────────┐  ┌──────────────────┐ │
│ │ New member: John D.    │  │ [+ Create Event] │ │
│ │ Event: Chapter Meeting │  │ [+ Invite Member]│ │
│ │ Backwork: CS 101 Exam  │  │ [View Points]    │ │
│ │ Points: +10 to Sarah   │  │ [Manage Roles]   │ │
│ └────────────────────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Stat cards (top row):**

- 4 cards in a row (2x2 on tablet, stacked on mobile)
- Each: icon + number + label
- Number animates with count-up on load
- Subscription status card: green badge for active, yellow for past_due, red for canceled

**Activity feed:**

- List of recent chapter events (last 10)
- Each item: icon + description + relative timestamp ("2 hours ago")
- Click navigates to relevant screen

**Quick actions:**

- Vertical stack of buttons
- Most-used admin actions

### 3.2 Members (`/members`)

**Layout:**

```
┌──────────────────────────────────────────────────┐
│ Members                          [+ Invite Member]│
├──────────────────────────────────────────────────┤
│ [🔍 Search members...]  [Filter by role ▼]       │
├──────────────────────────────────────────────────┤
│ ┌─────┬──────────┬────────┬────────┬───────────┐ │
│ │     │ Name     │ Role   │ Points │ Joined    │ │
│ ├─────┼──────────┼────────┼────────┼───────────┤ │
│ │ [📷]│ John Doe │ Member │  142   │ Jan 2026  │ │
│ │ [📷]│ Jane S.  │ Pres.  │  310   │ Sep 2025  │ │
│ │ ...                                           │ │
│ └───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Table features:**

- Sortable columns (click header to sort)
- Row click → slide-out member detail panel (right side)
- Bulk select with checkboxes (for bulk role assignment)
- Pagination: 25 per page, page controls at bottom

**Member detail panel (slide-out):**

```
┌─────────────────────────┐
│ [Close X]               │
│                         │
│ [Large Avatar]          │
│ John Doe                │
│ Member                  │
│ john@example.com        │
│                         │
│ Bio: "Junior, CS major" │
│ Joined: Jan 15, 2026    │
│ Points: 142             │
│                         │
│ Roles: [Member ▼]       │
│ [+ Add Role]            │
│                         │
│ ─────────────────────── │
│ [Remove from Chapter]   │
└─────────────────────────┘
```

**Invite modal:**

- Role selector dropdown
- "Generate Link" button → shows copyable invite URL
- "Batch Invite" tab: number input + role → generates N links
- Toast notification on copy

### 3.3 Events (`/events`)

**Two views:** List view (default) and Calendar view (toggle).

**List view:**

```
┌──────────────────────────────────────────────────┐
│ Events                [📅 Calendar] [+ New Event] │
├──────────────────────────────────────────────────┤
│ [Upcoming] [Past] [Recurring]                     │
├──────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐ │
│ │ Chapter Meeting                    Feb 28    │ │
│ │ 📍 Chapter House  ⏰ 6:00 PM  🎯 10 pts    │ │
│ │ [Mandatory] [Weekly]  👥 42/47 checked in   │ │
│ ├──────────────────────────────────────────────┤ │
│ │ Philanthropy Event                 Mar 1     │ │
│ │ 📍 Student Center  ⏰ 2:00 PM  🎯 15 pts   │ │
│ │ [Optional]  👥 12 checked in                │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Event detail (click to expand or navigate):**

- Full event info + attendance list
- Attendance table: member name, status (PRESENT/ABSENT/EXCUSED/LATE), check-in time
- Admin actions: Mark Excused, Mark Absent, Mark Late (dropdown per row)
- "Auto-Mark Absent" button (calls auto-absent endpoint after grace period)
- Meeting minutes: Markdown editor below attendance
- "Download .ics" button

The attendance roster is **live**: the web client subscribes to Supabase
Realtime Postgres changes on `event_attendance` filtered by `event_id` and
invalidates the corresponding TanStack query cache on every INSERT/UPDATE.
Admins watching one tab see self check-ins from other devices without
refreshing. The realtime primitive that powers this — `useRealtimeTable` in
`apps/web/lib/realtime/use-realtime-table.ts` — is also reused by the events
list itself (new events propagate immediately) and will back chat and
notifications in later slices. A single shared browser Supabase client
multiplexes every subscription over one websocket (see
[`apps/web/lib/realtime/supabase-realtime.ts`](../apps/web/lib/realtime/supabase-realtime.ts)).

**Create/Edit Event form (modal or full page):**

- Name, description, location (text inputs)
- Start date/time, end date/time (date-time pickers)
- Point value (number input, default 10)
- Mandatory toggle
- Recurrence rule: None | Weekly | Biweekly | Monthly (radio)
- Required roles: multi-select dropdown (optional)
- Form validation with inline errors

**Calendar view:**

- Full monthly calendar grid (FullCalendar or custom)
- Events shown as colored bars
- Click day to see events, click event to navigate to detail
- Month/week/day toggle

### 3.4 Points Ledger (`/points`)

```
┌──────────────────────────────────────────────────┐
│ Points                    [All Time ▼] [+ Adjust] │
├──────────────────────────────────────────────────┤
│ Leaderboard                    Transaction Log    │
│ ┌─────┬───────────┬───────┐   ┌────────────────┐│
│ │ #1  │ Jane S.   │  310  │   │ +10 John D.    ││
│ │ #2  │ Mike R.   │  256  │   │ Attendance:    ││
│ │ #3  │ Sarah L.  │  198  │   │ Chapter Mtg    ││
│ │ ...                     │   │                ││
│ └─────────────────────────┘   │ -5 Mike R.     ││
│                               │ FINE: Late to  ││
│ [⚠️ Flagged Transactions]     │ meeting        ││
│                               └────────────────┘│
└──────────────────────────────────────────────────┘
```

**Leaderboard:**

- Time window selector: All Time | This Semester | This Month
- Rank, avatar, name, total points
- Click row → shows member's full transaction history

**Transaction log:**

- Chronological list, newest first
- Each: amount (+/-), member name, category badge (ATTENDANCE, SERVICE, MANUAL, FINE, STUDY), description, timestamp
- Flagged transactions: yellow warning icon, filterable

**Audit tab:** chapter-wide transaction log with a "Show flagged only" toggle
and category + member filters. Backed by `GET /v1/points/transactions` which
requires `points:view_all`. Members without that permission see an explanatory
card pointing at their chapter president. Flags are raised automatically when
`|amount| ≥ 100` on a manual adjustment (see `spec/behavior.md §4`).

**Adjust modal:**

- Member selector (searchable dropdown)
- Amount (positive for reward, negative for fine)
- Category: MANUAL or FINE (radio)
- Reason (required text field)
- Confirmation dialog: "Award +25 points to John Doe? Reason: Perfect attendance"

### 3.5 Billing (`/billing`)

```
┌──────────────────────────────────────────────────┐
│ Billing                                           │
├──────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐       │
│ │ Subscription: Active ✓                 │       │
│ │ Plan: $XX/month per chapter            │       │
│ │ Next billing: March 1, 2026            │       │
│ │ [Manage Subscription →]                │       │
│ └────────────────────────────────────────┘       │
│                                                   │
│ Member Invoices          [+ Create Invoice]       │
│ ┌────────────────────────────────────────────┐   │
│ │ Fall Dues - John D.    $150  OPEN   Due 9/1│   │
│ │ Fall Dues - Jane S.    $150  PAID   Sep 1  │   │
│ │ Fall Dues - Mike R.    $150  OVERDUE ⚠️    │   │
│ └────────────────────────────────────────────┘   │
│                                                   │
│ [DRAFT] [OPEN] [PAID] [VOID] [OVERDUE]  filters │
└──────────────────────────────────────────────────┘
```

### 3.6 Settings (`/settings`)

**Tabs:** General | Branding | Notifications | Semester | Danger Zone

**General tab:**

- Chapter name (text input)
- University (text input)
- Donation URL (optional URL input)

**Branding tab:**

- Logo upload: dropzone with preview. Shows current logo or placeholder.
- Accent color: hex input + color picker + live preview swatch. WCAG contrast indicator (green check or red X).

**Semester tab:**

- Current semester label + date range
- "Start New Semester" button with confirmation dialog
- Past semesters list

**Danger Zone tab:**

- "Transfer Presidency" — member selector + confirmation
- "Cancel Subscription" — confirmation with consequences explained

### 3.7 – 3.15 (Remaining Screens Summary)

| Screen              | Key Components                                                                     | Layout Pattern  |
| ------------------- | ---------------------------------------------------------------------------------- | --------------- |
| Roles & Permissions | Role list with drag-reorder, permission checklist modal, color picker              | List + modal    |
| Chat Admin          | Channel list, create/edit channel modal, category management                       | List + modal    |
| Backwork Admin      | Filter sidebar + resource grid, department/professor management                    | Filter + grid   |
| Study Geofences     | Map (Mapbox/Google Maps) + geofence list, config panel                             | Map + sidebar   |
| Tasks               | Kanban columns (TODO, IN_PROGRESS, COMPLETED, OVERDUE) or table view               | Kanban or table |
| Service Hours       | Review queue (pending entries), approve/reject actions, stats                      | Queue + table   |
| Documents           | Folder tree + document list, upload modal                                          | Tree + list     |
| Reports             | Report type selector, date range picker, format toggle (JSON/CSV), download button | Form + preview  |
| Polls               | Poll list, create poll form, results bar chart                                     | List + chart    |

---

## 4. Component Library (ShadCN + Custom)

### ShadCN Components to Install

```
button, input, select, textarea, label, card, dialog, sheet,
dropdown-menu, command, popover, toast, badge, avatar, separator,
table, tabs, tooltip, skeleton, switch, checkbox, radio-group,
calendar, date-picker, accordion, alert, progress, scroll-area
```

### Custom Components to Build

| Component            | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `StatCard`           | Dashboard stat display (icon + number + label + trend) |
| `MemberRow`          | Table row with avatar, name, role badge, points        |
| `ActivityItem`       | Feed item (icon + text + timestamp)                    |
| `PermissionCheckbox` | Permission name + description + toggle                 |
| `RoleBadge`          | Colored badge matching role color                      |
| `StatusBadge`        | Status indicator (active/paid/overdue/absent)          |
| `FileDropzone`       | Drag-and-drop file upload area                         |
| `EmptyState`         | Illustrated empty state with action button             |
| `LoadingSkeleton`    | Shimmer loading placeholder matching each page layout  |
| `ErrorBoundary`      | Graceful error display with retry button               |
| `OfflineBanner`      | Network status banner (see §6)                         |

---

## 5. State Management & Data Fetching

### Stack

- **TanStack Query v5** — server state (API data)
- **Zustand** (if needed) — client state (sidebar open, active filters, UI preferences)
- **`@repo/api-sdk`** — typed API client
- **`@repo/hooks`** — TanStack Query wrappers per domain

### Query Patterns

Every data-fetching hook follows this pattern:

```typescript
function useMembers(chapterId: string) {
  return useQuery({
    queryKey: ["members", chapterId],
    queryFn: () =>
      client.GET("/v1/members", { headers: { "x-chapter-id": chapterId } }),
    staleTime: 30_000, // 30s before refetch
    gcTime: 5 * 60_000, // 5 min cache
    retry: 3, // retry on failure
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
  });
}
```

### Mutation Patterns

Mutations use optimistic updates where appropriate:

```typescript
function useUpdateMemberRoles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => client.PATCH('/v1/members/{id}/roles', { ... }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['members'] });
      const prev = queryClient.getQueryData(['members']);
      queryClient.setQueryData(['members'], (old) => /* optimistic update */);
      return { prev };
    },
    onError: (err, vars, ctx) => {
      queryClient.setQueryData(['members'], ctx?.prev); // rollback
      toast.error('Failed to update roles. Please try again.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['members'] }),
  });
}
```

### Loading States

Every page/section has three states:

1. **Loading (first load):** Skeleton placeholders matching the exact layout shape. Never show a blank white screen.
2. **Error:** Error boundary with retry button + message. Never show raw error strings.
3. **Empty:** Illustrated empty state with action CTA ("No events yet. Create your first event →").

Background refetches (stale data refresh) are invisible to the user — stale data stays visible while the fresh data loads.

---

## 6. Network Resilience & Offline Handling

### Design Principles

1. **Never lose user work.** If a network request fails, the UI must inform the user and provide recovery options.
2. **Optimistic by default.** Show the result of the action immediately; roll back on failure.
3. **Degrade gracefully.** Show cached data when offline; disable write actions with clear messaging.
4. **Retry transparently.** Failed requests retry automatically with exponential backoff.

### Offline Detection

```typescript
// Global network status provider
const [isOnline, setIsOnline] = useState(navigator.onLine);
useEffect(() => {
  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return () => {
    /* cleanup */
  };
}, []);
```

**Offline banner:** When `isOnline === false`, show a persistent banner at the top of the content area:

```
⚠️ You're offline. Showing cached data. Changes will sync when you reconnect.
```

- Yellow background, amber text
- Slides down smoothly (200ms)
- Auto-dismisses when connection restores

### TanStack Query Resilience Config

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: "always",
      networkMode: "offlineFirst", // serve cache, then refetch
    },
    mutations: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      networkMode: "offlineFirst",
    },
  },
});
```

### Optimistic Update Strategy by Domain

| Domain   | Action            | Optimistic?       | Rollback Strategy                    |
| -------- | ----------------- | ----------------- | ------------------------------------ |
| Members  | Update roles      | Yes               | Revert role_ids, show toast          |
| Members  | Remove member     | No (destructive)  | Wait for confirmation                |
| Events   | Create event      | Yes               | Remove from list, show toast         |
| Events   | Delete event      | No (destructive)  | Wait for confirmation                |
| Points   | Adjust points     | Yes               | Revert transaction, show toast       |
| Chat     | Send message      | Yes               | Mark message as "failed", show retry |
| Chat     | Delete message    | Yes               | Restore message, show toast          |
| Invoices | Create invoice    | Yes               | Remove from list, show toast         |
| Invoices | Transition status | No (irreversible) | Wait for confirmation                |
| Tasks    | Update status     | Yes               | Revert status, show toast            |
| Service  | Approve/Reject    | No (irreversible) | Wait for confirmation                |

### Mutation Queue for Offline

When the user is offline and attempts a mutation:

1. Show toast: "You're offline. This action will be saved when you reconnect."
2. Queue the mutation in `localStorage` (key: `frapp_mutation_queue`)
3. On reconnect: process queue in order, show progress toast

This is a **future enhancement** — for v1, mutations while offline show a blocking toast: "You're offline. Please reconnect to make changes."

### Error Recovery Patterns

**Transient errors (5xx, network timeout):**

- Auto-retry with exponential backoff (built into TanStack Query)
- After 3 retries, show: "Something went wrong. [Retry] [Dismiss]"

**Auth errors (401):**

- Redirect to login page
- Preserve the current URL for post-login redirect

**Validation errors (400):**

- Show field-level errors inline in forms
- Never auto-retry (user must fix input)

**Rate limit (429):**

- Show: "Too many requests. Please wait a moment."
- Disable the button for `Retry-After` duration
- Auto-retry after the wait period

**Conflict (409):**

- Show specific message (e.g., "This invite has already been used")
- Refresh the relevant data

---

## 7. Authentication Flow

### Sign Up

```
frapp.live → [Get Started] → app.frapp.live/signup

┌──────────────────────┐
│                      │
│   Create your        │
│   account            │
│                      │
│   [Email]            │
│   [Password]         │
│   [Sign Up]          │
│                      │
│   or continue with   │
│   [Google]           │
│                      │
│   Already have an    │
│   account? Log in    │
└──────────────────────┘
```

### Login

```
┌──────────────────────┐
│                      │
│   Welcome back       │
│                      │
│   [Email]            │
│   [Password]         │
│   [Log In]           │
│                      │
│   [Forgot password?] │
│   [Magic link]       │
│   [Google]           │
└──────────────────────┘
```

### Post-Auth Flow

1. Auth → check if user has any chapters
2. If no chapters → Chapter Creation wizard
3. If one chapter → load dashboard
4. If multiple chapters → chapter selector

### Chapter Creation Wizard

```
Step 1: Chapter Info     → Step 2: Accept Terms     → Step 3: Payment
[Chapter Name]             [✓ Terms of Service]        [Stripe Checkout]
[University]               [✓ Privacy Policy]
```

---

## 8. Accessibility

| Requirement         | Implementation                                                                  |
| ------------------- | ------------------------------------------------------------------------------- |
| Keyboard navigation | All interactive elements focusable, visible focus rings (`ring-2 ring-primary`) |
| Screen reader       | Semantic HTML, ARIA labels on icons, `role` attributes on custom widgets        |
| Color contrast      | WCAG AA (4.5:1 text, 3:1 large text). Tested with the theme tokens.             |
| Focus management    | Modal open → focus first input. Modal close → focus trigger.                    |
| Reduced motion      | `prefers-reduced-motion` → disable animations                                   |
| Skip to content     | Hidden "Skip to main content" link, visible on focus                            |
| Form errors         | Associated `aria-describedby` with error messages, `aria-invalid` on fields     |
| Command triggers    | Command menu triggers must spell out shortcuts in `aria-label` (e.g., "Command K") |

### 2024-03-20 - Adding Accessibility Attributes to Command Menu Triggers

**Learning:** Command menu triggers often rely on visual cues (like "⌘K") to indicate their functionality. Without an explicit `aria-label`, screen readers may simply read the button text "Search (⌘K)" which can be confusing or lack full context, particularly if the user relies on a keyboard.

**Action:** When adding command menu triggers or other shortcut-bound buttons, ensure they have a descriptive `aria-label` that clarifies the action and spells out the keyboard shortcut in a readable format for AT users (e.g., "Command K").

## Checkbox Component Handlers

- Checkbox handlers for lists of data (such as the My Transactions table in the points page) should avoid inline `onChange` function definitions to reduce nesting depth.
- Instead, extract handlers into dedicated functions inside the component (e.g., `toggleAllTransactions` and `toggleTransaction`) and pass them to the checkbox.

## Code Health Notes

### Events Table Refactoring

- The deeply nested inline `onChange` event handlers for the checkboxes in the events table (in `apps/web/app/(dashboard)/events/page.tsx`) have been extracted into named functions (`toggleAllVisibleEvents` and `toggleEventSelection`) to improve maintainability and readability without altering UI functionality.
