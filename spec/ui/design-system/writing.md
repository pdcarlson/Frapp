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
| Leaderboard search matched nothing | `No members match that search` | `Check the spelling, or clear the search to see the full leaderboard.` |
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
| Offline | `Roles unavailable offline` | `Reconnect to load the chapter's roles and edit their permissions.` |
| Delete role confirmation | `Delete <name>?` | `Members assigned this role lose its permissions immediately. This cannot be undone.` · confirm `Delete role` |
| Transfer presidency confirmation | `Transfer presidency?` | `The President role moves to the selected member immediately and is removed from you. Only the current president can undo it.` · confirm `Transfer presidency` |
| Custom roles offline | `Custom roles unavailable offline` | `Reconnect to load this chapter's custom roles and edit their capabilities.` |
| Custom roles empty | `No custom roles yet` | `Create one below to extend the permission matrix.` |
| Custom roles error | `Couldn't load custom roles` | `Retry to fetch this chapter's custom roles.` |

The confirmation rows below and under Roles & Permissions are the five `window.confirm` strings the Settings & Roles slice converted to [`confirm-dialog.tsx`](../../../apps/web/components/shared/confirm-dialog.tsx). A browser dialog's text was never in this table because it was never the product's; an in-product one is, and `writing.md` §2's verb-plus-object CTA rule governs the button. The rollover is the one that is **not** destructive-toned — it archives rather than deletes, and a red button would state a loss the API does not perform.

### Settings (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter settings...` |
| Error | `Couldn't load chapter settings` | `Confirm your chapter access and retry. Changes you make here update every surface in the dashboard.` |
| No chapter | `Chapter settings` | `Select an active chapter to edit its branding, semester state, or billing configuration.` |
| Semester empty | `No archived semesters yet` | `After you run your first rollover, the history appears here.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can start a new semester.` |
| Accent label illegible | — | `Label text on this color reads at <n>:1, under the 4.5:1 minimum. Buttons and name tags using it will be hard to read — pick a lighter or darker shade.` |
| Accent server contrast disclosure | — | `<Accent text on the app background\|Accent text on its own tinted background\|Text on the accent's solid fill> reads at <n>:1, under the 4.5:1 minimum. Try a lighter or darker shade of this hue and save again.` |
| Rollover confirmation | `Start a new semester labelled "<label>"?` | `The current leaderboard period is archived and a new one begins. Points already awarded are kept — only the leaderboard's default window moves.` · confirm `Start new semester` |
| Delete field confirmation | `Delete the field "<label>"?` | `Members lose the values they have entered for it, and the column disappears from the directory. This cannot be undone.` · confirm `Delete field` |
| Delete custom role confirmation | `Delete the custom role "<label>"?` | `Members holding it lose its capabilities on their next request. This cannot be undone.` · confirm `Delete custom role` |

The **Accent label illegible** row answers a different question from the existing fallback warning beside it, and the pair is easy to collapse by mistake. The fallback fires when the accent is unreadable *as text on the card*, which is what `resolveChapterAccentColor` checks. This one fires when text is unreadable *on the accent* — which is what a primary button is, and what that card's own description promises the colour will be used for. They diverge: `#0080FD` passes the first and fails the second at 4.191:1, so without this row an admin ships unreadable button labels having just been told the colour was fine.

The **Accent server contrast disclosure** row is a third, independent question from both of the above. Those two are client-side checks of the *unsaved draft* against one fixed backdrop each. This one is the server's own §8 verdict on the colour actually saved, generated through the real Signet pipeline (`accent-engine.md` §8), and it is disclosure rather than correction — a failing save still succeeds, since §8 forbids a runtime substitution on engine output. It clears on the officer's next edit, since a stale verdict describing a colour they have already changed away from would be actively misleading (#1183).

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
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can review submitted hours.` |

### Chapter Documents (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter documents...` |
| Empty | `No documents here yet` | `Upload chapter files like bylaws, agendas, and meeting minutes so everyone can find them.` |
| Empty (search, all files) | `No documents match that search` | `Nothing in the chapter library has "{query}" in its title.` |
| Empty (search, inside a folder) | `No documents match that search` | `No match in this folder. Try "All files" to search the whole library.` |
| Error | `Couldn't load documents` | `Confirm your chapter access and retry.` |
| Offline | `Documents unavailable offline` | `Reconnect to browse the chapter library and download files.` |
| Offline (search active) | `Search needs a connection` | `Clear the search to browse the documents already on this device.` |
| Folder list failed (inline, under the rail) | — | `Couldn't load the folder list, so these are read from the documents shown. Empty folders and folder management are unavailable until it loads.` |

Three of these exist to keep one state from impersonating another:

- A search that matched nothing is not an empty library. The default empty copy
  invites an upload, which is the wrong instruction for a member who mistyped a
  title.
- Search is served by the API, so each query is a cache key that an offline
  member has never fetched. Falling to the plain offline card would replace a
  library they still have cached; naming the search as the thing that needs a
  connection keeps the recovery in the member's hands.
- The folder rail is its own request and can fail while the documents load
  fine. It degrades to names derived from the loaded documents rather than
  rendering as a chapter with no folders — so the notice reports what is
  actually missing (empty folders and management), not a false absence.

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
| Alumni-restricted channel | — | `Alumni can read this channel but not post. Alumni may post in #alumni and direct messages.` |
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
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can manage chapter invoices.` |

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
| Offline | `Your profile is unavailable offline` | `Reconnect to load your directory entry and notification preferences.` |
| Preferences card — loading | — | `Loading your preferences...` |
| Preferences card — error | `Couldn't load your preferences` | `Quiet hours couldn't be read, so saving them would overwrite what's stored. Retry in a moment.` |
| Preferences card — offline | `Quiet hours unavailable offline` | `Reconnect to load and change when notifications are silenced.` |

**There is deliberately no Empty row**, and saying so is the point of the line: the viewer always exists, so `/profile` has no empty branch to write. The Resources & Reporting slice's rule is about states that exist and were never written down, not a mandate to invent one — without this sentence the next reader "completes" the table with copy no code can reach.

The Preferences card is a **second query** on the same screen (`GET /v1/settings` beside `GET /v1/users/me`), which is why it has its own three rows rather than borrowing the screen's. It had no states at all until the Profile & pre-auth slice, so a failed fetch rendered empty fields beside a live Save button that then reported success.

### Sign in (pre-auth)

| State | Title | Description |
|---|---|---|
| Idle | `Signet` | `Ask your chapter anything.` — s01's wordmark and tagline are the screen's heading and body, not decoration above one. |
| Submitting | — | The primary reads `Continue` throughout and disables; no separate copy. |
| Auth error | `Unable to sign in` | The Supabase message, verbatim. It is deliberately non-enumerating ("Invalid login credentials" whether or not the address exists), so passing it through leaks nothing and says more than a generic line would. |
| Magic link sent | `Magic link sent` | `Check your inbox to continue signing in.` |
| Magic link, no email | `Email required` | `Enter your email address to request a magic link.` |

### Sign up (pre-auth)

| State | Title | Description |
|---|---|---|
| Idle | `Create your account` | `One account, then join your chapter or start one.` |
| Created, session issued | `Account created` | `You are signed in and ready to continue.` |
| Created, confirmation required | `Check your inbox` | `Confirm your email to finish setting up your account.` |
| Error | `Unable to create account` | The Supabase message, verbatim, for the reason above. |

### Join chapter (pre-auth)

| State | Title | Description |
|---|---|---|
| Idle | `Join your chapter` | `Enter the invite your officer sent. Invites expire after 24 hours and work once.` |
| Invite-link hint | — | `Got an invite link? Open it and this page fills itself in.` |
| Checking the session | — | `Verifying your session…` (announced, not drawn) |
| Session check failed, offline | `Can't check your session` | `Reconnect to confirm you're signed in, then redeem the invite.` |
| Session check failed, error | `Couldn't check your session` | `We couldn't reach the API to confirm you're signed in. Retry in a moment.` |
| Redeemed | `Chapter joined` | `You're in. Opening chat.` |
| **410** — expired, used, or missing | — | `This invite has expired or already been used. Ask an officer for a new one.` |
| **409** — already a member | — | `You're already a member of this chapter. Open it from your chapter list.` |
| Any other failure | — | The server's message, else `Couldn't join that chapter. Check the invite and try again.` |

The two status rows are the reason this table exists. Both are routine, both were rendering one generic toast, and they need **opposite** next actions — one says fetch a new invite, the other says you already have what you came for. `spec/behavior/onboarding.md` §Invite Token Rules fixes the codes; the strings are shared verbatim with [`apps/mobile/lib/onboarding/join-errors.ts`](../../../apps/mobile/lib/onboarding/join-errors.ts) and [`apps/web/components/auth/join-errors.ts`](../../../apps/web/components/auth/join-errors.ts), and this table is the one place they are written down, since neither app can import the other's module.

410 covers three distinct server messages (`Invite not found` / `Invite already used` / `Invite expired`). They collapse to one string on purpose: a member cannot act on the difference, and naming which one it was would tell an unauthenticated caller whether a token exists.

### No access (pre-auth)

| State | Title | Description |
|---|---|---|
| Signed in, no chapter role | `You don't have access yet` | `Your account is signed in, but no chapter role has been assigned. A chapter admin needs to invite you or grant a role before you can use the dashboard.` plus the three recovery paths (ask an officer, reopen the invite link, sign out and back in). |

### Onboarding wizard (dashboard overlay)

| State | Title | Description |
|---|---|---|
| Directory search, idle | — | `Type at least 2 characters to search.` |
| Directory search, loading | — | `Searching the directory…` |
| Directory search, no results | — | `We couldn't find "<query>" in our directory.` with `Enter chapter details manually` |
| Directory search, error | `Couldn't reach the directory` | `Retry the search, or enter your chapter's details by hand.` |
| Progress | — | `Step N of 4`, stated in words beside the bars and never only by them |

### App error boundary (`global-error`)

| State | Title | Description |
|---|---|---|
| Unrecoverable render error | `The dashboard hit an unrecoverable error` | `The page couldn't finish loading, and the error has been reported. Reloading usually clears it.` with `Reload the dashboard` |

This one replaces `Something went wrong` / `Try again`, which is §1's banned shape with none of §3's three parts — and it had shipped unstyled, since the boundary replaces the root layout and so loads neither the stylesheet nor the typeface unless it asks for them itself.

## 8. Mobile reliability labels

Use these exact labels for operational state pills:

- `Synced`
- `Pending`
- `Retry needed`
- `Cached`

Never replace these with alternate synonyms on one surface only. Message-level delivery indicators (sending / sent / failed) are specified in [resilience.md](../resilience.md).
