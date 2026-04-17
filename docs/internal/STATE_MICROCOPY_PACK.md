# State Microcopy Pack

> Last updated: 2026-03-08  
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

## Billing (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading billing overview...` |
| Empty | `No invoices yet` | `Create your first invoice to start chapter dues collection.` |
| Preview/unauthenticated | `Showing preview billing data` | `Sign in to load live chapter subscription and invoice records.` |

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
