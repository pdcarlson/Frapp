# UX Writing

> Voice, microcopy patterns, and the approved per-surface state copy for Signet — one vocabulary across the web dashboard, the mobile app, and the landing site.

---

## 1. Voice and tone

Signet copy MUST be:

- **Direct, clear, and operational.** Say what happened and what to do, in the fewest words that stay clear.
- **Confident without marketing fluff.** Product surfaces state facts; the landing page persuades, the app does not.
- **Supportive under failure states.** A failure names the problem and hands the user a next step.

Vague copy is banned: never ship "Something happened" or "Please try again later" without context.

## 2. CTA conventions

CTAs MUST name the action they perform.

| Do | Don't |
|---|---|
| `Get Started` | `Submit` |
| `Create Event` | `Continue` (when the action is specific) |
| `Adjust Points` | |
| `Invite Member` | |

## 3. Error copy pattern

Every user-facing error follows the three-part pattern:

1. What failed
2. Why (if known)
3. What to do next

Template:

`<Action> couldn't be completed. <Reason>. <Next step>.`

Example:

`Unable to load members. This view requires an authenticated chapter context. Sign in and retry.`

## 4. Empty state pattern

Every empty state MUST include:

- A clear title
- A short explanation
- A next-step CTA when possible

Example (the Events surface, from the tables below):

`No events yet`
`Create your first chapter event to unlock attendance and point automation.`
`[Create first event]`

The skeleton/empty/error state variants themselves — layout, structure, when each renders — are component-level and owned by [components.md](components.md). This document owns the words inside them.

## 5. Status labels

Status terms MUST match backend domain language:

- `ACTIVE`
- `PAID`
- `OPEN`
- `OVERDUE`
- `PENDING`
- `FAILED` (for transient action states)

Do not invent alternate terms for the same state on different platforms. Status labels render with the semantic status colors defined in [foundations.md](foundations.md) — status color is never decorative.

**Render the server's own token, not a re-cased version of it.** `OVERDUE` put through `.toLowerCase()` and a `capitalize` class comes out as "Overdue", which is an alternate term for the same state by another route — and `/billing` was doing exactly that in its member-facing table while the admin card one file over rendered the token. The web mapping from state to badge kind lives in one place, [`apps/web/components/billing/invoice-status.ts`](../../../apps/web/components/billing/invoice-status.ts), for both invoice and subscription state; `DRAFT` is the one state that takes the Hairline kind rather than a semantic one, because it is the absence of a status rather than a status.

**One mapper per domain vocabulary, not one mapper.** Billing's two states share a file because both are billing's; Chapter Ops added four more vocabularies — attendance, service review, study-session close and study-zone enablement — with no overlapping members, so each has its own module rather than one widened to `string`. Where a vocabulary needs a *label* as well as a kind is decided by this section: states §5 names above render their token (`PENDING` stays `PENDING`), and a vocabulary with no row here maps to plain language **once**, in its mapper, which is why `attendance-status.ts` carries `attendanceStatusLabel` and `service-status.ts` deliberately does not.

## 6. Trust copy rules

Billing, legal, and data-sensitive surfaces MUST:

- Use concrete language
- Avoid overpromising
- Explicitly indicate preview/demo data when shown

Examples:

- `Showing preview billing data`
- `Sign in to load live chapter subscription and invoice records`

## 7. Approved state microcopy

The tables below are the canonical strings for high-frequency state messages, so members and admins see consistent language across surfaces.

- Do not rewrite equivalent state text ad hoc per screen unless the workflow intent is materially different.
- On the web dashboard, the shared subset is implemented in `apps/web/lib/state-microcopy.ts`; the remaining strings live inline at their surface component and MUST match these tables.
- The chat catch-up pulse deliberately does **not** use these states: a section that fails to read is omitted, never rendered as a zero or a generic error row. See [catch-up.md](../../behavior/chat/catch-up.md).

### Connection banner (global)

| State | Title | Description |
|---|---|---|
| Degraded | — | `Slow connection. Some features may be delayed.` |
| Offline | — | `You're offline. Showing cached data. Changes will sync when you reconnect.` |

The offline string MUST keep its closing clause — a member who edited or posted while offline needs to be told the work is queued, not lost. [resilience.md](../resilience.md) carries the connection-state indicator strings alongside the detection thresholds and banner behavior; where the two differ, the wording above is approved.

### Permission check offline (global)

| State | Title | Description |
|---|---|---|
| Offline (permission check), control slot | — | `Offline — can't check your access.` |
| Offline (permission check), whole surface | `Can't confirm your access` | `Reconnect to check whether you can <do the thing the surface does>.` |

A paused permission check is **not** the surface being unavailable, and must not borrow that row's copy. "Polls unavailable offline" states a fact about the polls; here we do not know whether this member may see them at all, and saying otherwise promises access on reconnect that may not arrive. Both strings therefore report the *check*, and the second names the surface's verb rather than its noun. The per-surface descriptions are in the five tables below.

Implementation: `PermissionsOffline` (`apps/web/components/shared/async-states.tsx`) carries the first string; the second is passed to `<Can offlineFallback>` at each screen-level gate. Behaviour is [README.md](README.md) §4.

### Members (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter members...` |
| Loading (supporting queries) | — | `Loading chapter members...` — the roles-and-points load uses the *same* string. A second, differently-worded loading state for one screen is what this table exists to prevent. |
| Empty | `No members match this view` | `Try a broader search or invite your first members to populate this directory.` |
| Error | `Unable to load live member records` | `The members workflow no longer falls back to preview data. Verify your chapter access and API health, then retry.` |
| Offline | `Members directory unavailable offline` | `Reconnect to load live membership records and role updates.` |

### Events (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter events...` |
| Empty | `No events yet` | `Create your first chapter event to unlock attendance and point automation.` |
| Error | `Couldn't load chapter events` | `The events workflow needs a healthy API response. Verify your chapter access and retry.` |
| Offline | `Events workspace unavailable offline` | `Reconnect to load event schedules and attendance updates.` |

### Attendance (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading attendance...` |
| Empty | `No attendance records yet` | `Once members check in — or you record attendance manually — they'll show up here.` |
| Error | `Attendance unavailable` | `Couldn't load attendance for this event. Retry or confirm you have events:update or permission to view attendance.` |

### Points (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading points ledger...` |
| Empty leaderboard | `No leaderboard entries` | `Point activity will populate after attendance, study, or admin adjustments.` |
| Empty transactions | `No transactions in this window` | `Your attendance, study sessions, and adjustments will appear here.` |
| Error | `Couldn't load the points ledger` | `Standings and transactions are unavailable, so none are shown. Verify your chapter access and API health, then retry.` |
| Offline | `Points ledger unavailable offline` | `Reconnect to refresh leaderboard standings and transaction history.` |

### Points — Audit tab (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading audit transactions...` |
| Empty (flagged only) | `No flagged transactions in this window` | `Large single adjustments (\|amount\| ≥ 100) will appear here automatically.` |
| Empty (filtered) | `No transactions match this filter` | `Try relaxing the category or member filter.` |
| Error | `Audit unavailable` | `Couldn't load chapter transactions. Retry or confirm your points:view_all access.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can view the chapter's transaction log.` |

### Roles & Permissions (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading roles and permissions...` |
| Empty | `No roles yet` | `Chapters always start with default system roles. Refresh to reload or create a new custom role.` |
| Error | `Couldn't load roles` | `Retry in a moment. This view requires the roles:manage permission.` |
| Permission denied | `Roles & Permissions` | `Managing roles requires the roles:manage permission. Ask your chapter president to grant access.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can manage roles.` |

### Settings (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter settings...` |
| Error | `Couldn't load chapter settings` | `Confirm your chapter access and retry. Changes you make here update every surface in the dashboard.` |
| No chapter | `Chapter settings` | `Select an active chapter to edit its branding, semester state, or billing configuration.` |
| Semester empty | `No archived semesters yet` | `After you run your first rollover, the history appears here.` |

### Tasks (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter tasks...` |
| Empty | `No tasks yet` | `Admins can create the first chapter task to assign ownership and award points.` |
| Error | `Couldn't load tasks` | `Confirm your chapter access and retry. Assignees see only their own tasks; admins need tasks:manage to see every task.` |
| Offline | `Tasks unavailable offline` | `Reconnect to load the chapter board and move tasks through it.` |

### Service Hours (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading service entries...` |
| Empty queue | `No pending entries` | `Approved or rejected entries appear in the History card below.` |
| Empty history | `No service activity yet` | `Log your first service entry to build up chapter service hours.` |
| Error | `Couldn't load service entries` | `Members see only their own entries; admins need service:approve to see every entry.` |
| Offline | `Service hours unavailable offline` | `Reconnect to log hours and review the approval queue.` |

### Chapter Documents (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter documents...` |
| Empty | `No documents here yet` | `Upload chapter files like bylaws, agendas, and meeting minutes so everyone can find them.` |
| Error | `Couldn't load documents` | `Confirm your chapter access and retry.` |
| Offline | `Documents unavailable offline` | `Reconnect to browse the chapter library and download files.` |

### Notifications (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading notifications...` |
| Empty | — | `No notifications yet. Chapter activity, billing alerts, and point changes will appear here.` |
| Error | — | `Couldn't load notifications. Retry in a moment.` |

### Reports & Export (dashboard)

| State | Title | Description |
|---|---|---|
| Idle | `No report generated yet` | `Generate a report to see a preview here.` |
| Loading | — | `Generating report...` |
| Empty filter | `Report returned no rows` | `The filters matched nothing in the active chapter.` |
| Error | `Couldn't generate <kind> report` | the API's own message, or `The API rejected the request. Confirm reports:export and retry.` |
| Truncated | `Incomplete report` (badge) | `<cap summary> This preview and the CSV built from it are not a complete record of the chapter.` |
| Permission denied | `Reports & Export` | `Exporting chapter data requires the reports:export permission. Ask your chapter president to grant access.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can export chapter data.` |

**This table had no Error row until the Resources & Reporting slice, and that is why the screen had no error state.** A failed run reported a toast and never touched `preview`, so the panel fell through to the Idle copy — a failure rendering as "nothing has happened yet", against [README.md](README.md) §4's requirement of an error state with a retry path on every async view. The Idle and Empty-filter titles were added in the same pass: [components.md](components.md) §10's state family needs a title and a description, and the approved sentences are kept verbatim as the descriptions rather than rewritten.

**The Truncated row is a state, not a toast.** [`../../behavior/reports.md`](../../behavior/reports.md) caps a report at 5,000 rows and requires that truncation is never silent; the toast fires once and then a partial table sits on screen claiming to be the whole report, and the CSV built from it carries that claim into a file. The badge is [components.md](components.md) §5's Semantic warning kind, which needs no §1 lift on its own tint.

### Backwork (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading backwork...` |
| Empty | `No backwork matches this view` | `Loosen the filters, or upload the first resource to build the library.` |
| Error | `Couldn't load backwork` | `Confirm your chapter access and retry.` |
| Offline | `Backwork unavailable offline` | `Reconnect to browse the coursework archive and download a resource.` |

### Study session (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading study zones...` |
| Empty zones | `No active study zones` | `Ask a chapter admin with geofences:manage to add one.` |
| Empty history | `No sessions logged yet` | `Start a tracked session inside a study zone to start earning study points.` |
| Error | `Couldn't load study data` | `Confirm your chapter access and retry.` |
| Offline | `Study hours unavailable offline` | `Reconnect to start a session — tracking needs a live location check.` |
| Paused (tab hidden) | `Paused (tab hidden)` (badge) | Surfaced live while the timer is paused by the Page Visibility API. |

### Study session (mobile, s10)

The dashboard rows above are officer-flavoured — "Ask a chapter admin with
`geofences:manage`" and "Create your first invoice" are admin next steps, and a
member reading their own study screen cannot act on either. Per §"Do not rewrite
equivalent state text ad hoc per screen unless the workflow intent is materially
different", the member surface gets its own rows rather than inline strings.

| State | Title | Description |
|---|---|---|
| Loading | — | Skeleton (`components/state-block.tsx`); no loading copy. |
| Module off | `Study hours are turned off` | `Your chapter isn't tracking study hours right now. An officer can turn the module back on.` The same sentence is what a failed Start renders when the server refuses with `chapter.module.disabled` — the empty state is unreachable while #805 keeps `useCurrentChapter` disabled, so the error path has to carry the member-facing wording rather than relaying the guard's officer instructions ("Re-enable it in Settings → Modules"). |
| No zones | `No study zones yet` | `Sessions are tracked inside a zone. An officer with geofences:manage can add one.` |
| Error (sessions) | `Couldn't load study hours` | `Your sessions are still recorded — this was a problem fetching them.` |
| Error (zones) | `Couldn't load study zones` | `A session has to start inside a zone, so this has to load first.` |
| Paused (backgrounded) | `<zone> · paused` (status row) | `Paused while Frapp was in the background. It resumes on its own — your credited time is safe until the grace window runs out.` |
| Session closed by grace | — (notice) | `Session closed while the app was in the background. You kept the time you studied before it paused.` |
| Session expired | — (notice) | `Session ended: you left the study zone, or the app stopped reporting for 10 minutes. No points were awarded.` |
| Location primer | `Location check` | `Frapp confirms you're in the study zone when you start, and again every five minutes while you study. That check is what turns your time into chapter points.` Declining is `Not now`. |

A close that **awards** points (`COMPLETED`, `PAUSED_EXPIRED`) must never read as
a loss, and one that awards nothing (`EXPIRED`, `LOCATION_INVALID`) must say so —
see [`../../behavior/study-sessions.md`](../../behavior/study-sessions.md)
§ Points Award.

### Study zones (admin)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading study zones...` |
| Empty | `No study zones yet` | `Create your first zone to let members start tracked study sessions for points.` |
| Error | `Couldn't load study zones` | `Confirm your chapter access and retry.` |
| Offline | `Study zones unavailable offline` | `Reconnect to draw a zone or change its reward rate.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can manage study zones.` |
| Permission denied | `Study zones` | `Managing study zones requires the geofences:manage permission. Ask your chapter president to grant access.` |

### Polls (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter polls...` |
| Empty | `No polls match this view` | `Create a poll inside a chat channel and it will appear here. Loosen the filters if you're expecting results.` |
| Error | `Couldn't load polls` | `Confirm your chapter access and retry.` |
| Offline | `Polls unavailable offline` | `Reconnect to load the chapter's polls and cast a vote.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can see the chapter's polls.` |

### Chat (dashboard)

| State | Title | Description |
|---|---|---|
| Loading channels | — | `Loading chapter channels...` |
| Loading messages | — | `Loading messages...` |
| No channels | `No channels yet` | `New chapters seed #general, #announcements, and #chapter-audit during onboarding. Ask an admin if none appear.` |
| Empty timeline | `Nothing in this channel yet` | `Be the first to post — everyone in the channel sees it right away.` |
| Error | `Couldn't load channels` / `Couldn't load messages` | `Confirm your chapter access and retry.` |
| Read-only channel | — | `This channel is read-only. Posting requires the announcements:post permission.` |
| No chapter selected | `No chapter selected` | `Pick an active chapter to load its channels and messages.` |
| Offline (composer) | — | `You're offline — messages send when you reconnect.` |

The empty-timeline line used to end "messages render live with Supabase
Realtime." It named the vendor and the transport to a member who wants to know
whether it is safe to type, which §1's plain-language rule rules out — the
promise worth making is that other people will see it.

The composer's offline line is a **label, not a warning**: the send path queues
before it touches the network, so the composer stays usable and says what will
happen. Never reword it into an error — [resilience.md](../resilience.md) §2 owns
that rule and the string is shared with mobile.

Channel seeding happens at chapter onboarding and has no billing prerequisite; [onboarding.md](../../behavior/onboarding.md) owns the seeding flow.

### Billing (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading billing overview...` |
| Empty | `No invoices yet` | `Create your first invoice to start chapter dues collection.` |
| Preview/unauthenticated | `Showing preview billing data` | `Sign in to load live chapter subscription and invoice records.` |
| Error | `Couldn't load invoices` | `Verify your chapter access and API health, then retry.` |
| Empty (filtered) | `No invoices match this filter` | `Try a different status, or clear the filter to see every invoice.` |

### Dues (mobile, s11)

A member's dues screen, not the treasurer's billing overview — and **never the
word "subscription"**, which is the chapter's own bill with a different payer
([`../mobile/patterns.md`](../mobile/patterns.md) § Dues payment).

| State | Title | Description |
|---|---|---|
| Loading | — | Skeleton (`components/state-block.tsx`); no loading copy. |
| Empty | `No dues yet` | `Your chapter hasn't billed you. Anything they send will show up here.` |
| Error | `Couldn't load your dues` | `Your invoices are still on record — this was a problem fetching them.` |
| Nothing owed | `You're all paid up` (balance label) | — |
| Payment captured, unsettled | — (notice) | `Payment received, confirmation pending. This updates as soon as your chapter's records catch up.` |
| Payment settled | — (notice) | `Paid. Your chapter has it — thanks.` |
| Stripe unavailable (Expo Go) | — (disabled CTA reason) | `Paying in the app needs the installed Frapp build — Expo Go can't open the payment sheet. Your treasurer can still take payment another way.` |
| No publishable key | — (disabled CTA reason) | `Card payments aren't switched on for this build yet. Ask your treasurer how to pay this invoice.` |
| Trust footer | — | `Payments run through your chapter's Stripe account.` |

The due chip says **`Past due <date>`**, not `Overdue`: `OVERDUE` is the server's
flagged state and includes the chapter's `wf_dues_grace` window, which a member's
client cannot read (`GET /v1/invoices/overdue` is `billing:view`-only). §Status
labels reserves the backend's own labels for states the client can actually
confirm.

### Alumni (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading alumni directory...` |
| Empty | `No alumni match this view` | `Ask alumni to fill in their graduation year, city, and company on their profile, or loosen the filters above.` |
| Error | `Couldn't load alumni` | `Confirm your chapter access and retry. Alumni visibility respects the same permission checks as the member directory.` |
| Offline | `Alumni directory unavailable offline` | `Reconnect to load alumni records and filters.` |
| No chapter selected | `Alumni directory` | `Select an active chapter to browse alumni records.` |

### Profile (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading your profile...` |
| Error | `Couldn't load your profile` | `Sign in succeeded but we couldn't reach the API. Retry in a moment.` |

## 8. Mobile reliability labels

Use these exact labels for operational state pills:

- `Synced`
- `Pending`
- `Retry needed`
- `Cached`

Never replace these with alternate synonyms on one surface only. Message-level delivery indicators (sending / sent / failed) are specified in [resilience.md](../resilience.md).
