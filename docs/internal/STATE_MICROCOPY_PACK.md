# State Microcopy Pack

> Last updated: 2026-04-17  
> Scope: dashboard and mobile state messaging

This pack defines approved copy for high-frequency state messages so members and admins see consistent language across surfaces.

## Members (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter members...` |
| Empty | `No members match this view` | `Try a broader search or invite your first members to populate this directory.` |
| Preview/unauthenticated | `Showing preview member data` | `Sign in to load live chapter member records.` |

## Events (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter events...` |
| Empty | `No events yet` | `Create your first chapter event to unlock attendance and point automation.` |
| Error | `Couldn't load chapter events` | `The events workflow needs a healthy API response. Verify your chapter access and retry.` |
| Offline | `Events workspace unavailable offline` | `Reconnect to load event schedules and attendance updates.` |

## Attendance (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading attendance...` |
| Empty | `No attendance records yet` | `Once members check in — or you record attendance manually — they'll show up here.` |
| Error | `Attendance unavailable` | `Couldn't load attendance for this event. Retry or confirm you have events:update or permission to view attendance.` |

## Points (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading points ledger...` |
| Empty leaderboard | `No leaderboard entries` | `Point activity will populate after attendance, study, or admin adjustments.` |
| Empty transactions | `No transactions in this window` | `Your attendance, study sessions, and adjustments will appear here.` |
| Preview/unauthenticated | `Showing preview points data` | `Sign in to load live leaderboard and transaction records.` |

## Points — Audit tab (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading audit transactions...` |
| Empty (flagged only) | `No flagged transactions in this window` | `Large single adjustments (|amount| ≥ 100) will appear here automatically.` |
| Empty (filtered) | `No transactions match this filter` | `Try relaxing the category or member filter.` |
| Error | `Audit unavailable` | `Couldn't load chapter transactions. Retry or confirm your points:view_all access.` |

## Roles & Permissions (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading roles and permissions...` |
| Empty | `No roles yet` | `Chapters always start with default system roles. Refresh to reload or create a new custom role.` |
| Error | `Couldn't load roles` | `Retry in a moment. This view requires the roles:manage permission.` |
| Permission denied | `Roles & Permissions` | `Managing roles requires the roles:manage permission. Ask your chapter president to grant access.` |

## Settings (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter settings...` |
| Error | `Couldn't load chapter settings` | `Confirm your chapter access and retry. Changes you make here update every surface in the dashboard.` |
| No chapter | `Chapter settings` | `Select an active chapter to edit its branding, semester state, or billing configuration.` |
| Semester empty | `No archived semesters yet` | `After you run your first rollover, the history appears here.` |

## Tasks (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter tasks...` |
| Empty | `No tasks yet` | `Admins can create the first chapter task to assign ownership and award points.` |
| Error | `Couldn't load tasks` | `Confirm your chapter access and retry. Assignees see only their own tasks; admins need tasks:manage to see every task.` |

## Service Hours (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading service entries...` |
| Empty queue | `No pending entries` | `Approved or rejected entries appear in the History card below.` |
| Empty history | `No service activity yet` | `Log your first service entry to build up chapter service hours.` |
| Error | `Couldn't load service entries` | `Members see only their own entries; admins need service:approve to see every entry.` |

## Billing (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading billing overview...` |
| Empty | `No invoices yet` | `Create your first invoice to start chapter dues collection.` |
| Preview/unauthenticated | `Showing preview billing data` | `Sign in to load live chapter subscription and invoice records.` |

## Alumni (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading alumni directory...` |
| Empty | `No alumni match this view` | `Ask alumni to fill in their graduation year, city, and company on their profile, or loosen the filters above.` |
| Error | `Couldn't load alumni` | `Confirm your chapter access and retry. Alumni visibility respects the same permission checks as the member directory.` |
| Offline | `Alumni directory unavailable offline` | `Reconnect to load alumni records and filters.` |
| No chapter selected | `Alumni directory` | `Select an active chapter to browse alumni records.` |

## Home / activity feed (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter activity...` |
| No chapter selected | `Recent activity` | `Select an active chapter to load chapter events, members, and point activity.` |
| Empty feed | `Recent activity` | `Activity will appear here as events are scheduled, members join, and points change.` |
| Error | `Activity feed unavailable` | `Couldn't reach the API for events or members. Retry in a moment or confirm your chapter access.` |

## Profile (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading your profile...` |
| Error | `Couldn't load your profile` | `Sign in succeeded but we couldn't reach the API. Retry in a moment.` |

## Mobile reliability labels

Use these exact labels for operational state pills:

- `Synced`
- `Pending`
- `Retry needed`
- `Cached`

Never replace these with alternate synonyms on one surface only.
