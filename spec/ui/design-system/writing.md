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

CTAs MUST name the action they perform, and MUST be written in **sentence case**.

| Do | Don't |
|---|---|
| `Get started` | `Submit` |
| `Create event` | `Continue` (when the action is specific) |
| `Adjust points` | `Get Started` (title case) |
| `Invite member` | |

**The case half of that rule is new here, and it settles a question this table was answering wrongly**
(2026-09-18). The `Do` column read `Get Started` / `Create Event` / `Adjust Points` / `Invite Member`
until the landing reskin's decision D5 ([#2364](https://github.com/pdcarlson/Frapp/issues/2364)) took
sentence case and required the losing document to be amended rather than leaving two cases in the repo.
Three things already pointed the same way:

- **Both committed design-system references draw sentence case** — `Create an event`, `Start session`,
  `Join chapter`, `Create task`, `Pay now`, `Submit for approval`, `Continue with Apple`. No Title Case
  control label appears on either.
- **Those four exact strings ship nowhere.** `Get Started`, `Create Event`, `Adjust Points` and
  `Invite Member` appear in no file under `apps/`, while their sentence-case forms do.
- **The rest of this document never followed them.** Every other control string it approves — `Retry`,
  `Reload`, `Try again`, `Back to chat`, `Transfer presidency`, `Start new semester` — is sentence
  case. These four rows were the document's only Title Case strings.

**What this rule does NOT already describe, stated so nobody reads it as settled everywhere.** One
Title Case control ships on the web dashboard today — `Open Documents`
(`apps/web/components/layout/ask-pill.tsx`); `/events`' `New Event` became `New event` in November
2026 — and
[`../web-dashboard/reference/web-framework.dc.html`](../web-dashboard/reference/web-framework.dc.html),
which outranks written docs on the web surface
([`../web-dashboard/README.md` § Sources and precedence](../web-dashboard/README.md#sources-and-precedence)),
draws Title Case on some of its controls. That is real drift against this rule rather than an exception to it, it is tracked as
[#2386](https://github.com/pdcarlson/Frapp/issues/2386), and that issue carries the question the
drift actually turns on: whether a board outranks this document on a control's *words* as well as on
its looks. Do not "fix" it by re-widening this rule.

Out of scope here either way: **nav labels, page and screen titles, segmented-control options, and
the proper name of a document are not CTAs** and this section has never governed them — which is why
`Study Zones`, `Chat Admin`, `Discord Import`, `All Time`, `Terms of Service` and `Privacy Policy`
are not on that list. A link is a CTA when it asks for an action (`Open billing`) and is not one when
it names a thing (`Privacy Policy`); case follows that, not the element.

The verb-plus-object rule above is unchanged, and it is the half this section is cited for elsewhere.

## 3. Error copy pattern

Every user-facing error follows the three-part pattern:

1. What failed
2. Why (if known)
3. What to do next

Template:

`<Action> couldn't be completed. <Reason>. <Next step>.`

Example:

`Unable to load members. This view requires an authenticated chapter context. Sign in and retry.`

**One map for failures (2026-11-06).** A failed call reaches the member through one shared map, never as the server's own text: `errorCopy` in `@repo/hooks` (web's `getErrorMessage` and mobile both call it), over the strings in [`packages/validation/src/error-copy.ts`](../../../packages/validation/src/error-copy.ts), which `@repo/chat-core` uses for chat refusals too. The screen's toast title says what failed; the map says why and what next. A server sentence shows only when the map rewrites it (`Role name already exists in this chapter` becomes `A role with that name already exists. Pick another name.`); anything else falls back to what the status means (`403`: `Your role can't do this. Ask an officer if you need it.`) or the screen's own sentence. A message client code wrote for members is thrown as `MemberFacingError`; a plain `Error`'s message is never shown. The one exception is a screen whose routes already write for the officer (the Discord import): it opts in with `serverWritesForMembers`, and an unmapped 400, 403, 409 or 503 sentence then shows when it names no permission key or route. A new API refusal a member can act on gets a line in the map in the same change.

Copy never shows a permission key such as `roles:manage`. A permission-denied line names what the role can't do (`Your role can't manage roles.`) and who can change that; an error that may be an access problem says `Confirm your chapter access and retry.`; a toast with no server message says `Try again in a moment.` Where a screen has to name a permission, it uses the words in [`permission-labels.ts`](../../../apps/web/lib/permission-labels.ts) (2026-11-05).

## 3a. Form copy

*(Added 2026-11-06, from the mobile Edit profile sheet, whose bio placeholder asked for "Major, year, anything brothers should know." directly above a Graduation year field.)*

- **A placeholder never asks for what another field holds.** If the form has a field for it, the placeholder doesn't mention it; if it doesn't and the information matters, the form gets the field.
- **A placeholder never repeats its label.** "Your password" under Password, "Your full name" under Name: say something the label doesn't ("First and last name"), or draw no placeholder.
- **A placeholder is a hint, not a value.** A format (`YYYY`) or an `e.g.` example reads as a hint; a bare plausible value ("2027") reads as already filled in.
- **Purpose shared by several fields is said once,** as a group heading or hint, not in each placeholder (components.md § Text input, "Grouping and spacing in a form").
- **A placeholder is the only label only for a sheet's one primary field** whose purpose the sheet title already names: a composer, a search, a task title, a code entry. Any other field has a visible label.
- **Free-text prompts can be light.** The bio is a member talking to their chapter, so its placeholder invites rather than instructs: "Hometown, hidden talent, go-to late-night order."
- **Shared forms share their copy.** Where web and mobile draw the same form, the labels and placeholders come from one constant (`PROFILE_FIELD_COPY` in `@repo/validation` for the profile), so a wording fix lands on both.

## 4. Empty state pattern

Every empty state MUST include:

- A clear title, except a state inside a list or panel that already sits under its own heading, which may say what is missing in its explanation alone: [§ Arrange the channel list](#arrange-the-channel-list-mobile-and-web)'s `Filtered to nothing` row, the [Notifications (dashboard)](#notifications-dashboard) drawer's `Empty` row and [Discord Import](#discord-import-dashboard)'s `Empty (channel panel)` row
- A short explanation **only when it tells the member something the title doesn't**: why the view is empty, or what to do next. Never one that restates what the screen is for; without one the title stands alone.
- A next-step CTA when possible

Example (the Events surface, from the tables below):

`No events yet`
`Create your first chapter event to unlock attendance and point automation.`
`[Create first event]`

**Amended 2026-11-05**, after the owner's review of the Android build (2026-11-04): "we don't need to narrate stuff". The explanation used to be required on every empty state, which is how empty cards came to describe their own screen ("Documents the chapter uploads show up here.", "Members appear here once they join the chapter."). The rule above governs new and changed copy, for the reason [`../mobile/patterns.md` § Screen headers](../mobile/patterns.md#screen-headers) took the line under each screen title away: the member is already on the screen. The change that amended it removed those lines from the mobile screens it touched: Documents (s12), Directory (s13) and the notifications inbox (s14). Chat home's no-channels card (s04) swapped its line for what to do next: `No channels yet` / `Ask an admin to add one.` (mobile has no way to create one). A line that carries a fact stays: a search names its query, a filtered view says how to widen it, and the no-chapter state says where to pick a chapter.

Lines that still narrate are follow-up ([#3429](https://github.com/pdcarlson/Frapp/issues/3429)), not changed by the amendment: the second sentence of mobile Dues' empty body, `Anything they send will show up here.` ([Dues (mobile, s11)](#dues-mobile-s11)); and on web the empty rows of [Members](#members-dashboard) (`Actives appear here once they join.`), [Alumni](#alumni-dashboard) (`Graduated members appear here.`), [Notifications](#notifications-dashboard) (`… will appear here.`) and [Points](#points-dashboard)' empty transactions (`Your attendance, study sessions, and adjustments will appear here.`).

The skeleton/empty/error state variants themselves — layout, structure, when each renders — are component-level and owned by [components.md](components.md). This document owns the words inside them.

## 5. Status labels

Status terms MUST match backend domain language, and render as words, not tokens:

- `ACTIVE` → Active
- `PAID` → Paid
- `OPEN` → Open
- `OVERDUE` → Overdue
- `PENDING` → Pending
- `FAILED` → Failed (for transient action states)

Do not invent alternate terms for the same state on different platforms. Status labels render with the semantic status colors defined in [foundations.md](foundations.md) — status color is never decorative.

**One label map (amended 2026-11-06).** Every stored status's word lives once, in `STATUS_LABELS` ([`packages/validation/src/status-labels.ts`](../../../packages/validation/src/status-labels.ts)): tasks, service entries, attendance, study sessions and invoices. Web and mobile both read it, and `statusLabel(vocabulary, token)` words a token the map doesn't know yet (`NEW_STATE` → "New state") instead of printing it. A surface that needs its own phrasing builds it from the map (the chat hours card's "Pending review").

This replaces the rule that §5's tokens render as the server sends them (`PENDING`, `OVERDUE` in capitals). That rule was how the web Service hours history came to print `APPROVED` while mobile said "Approved" for the same entry, and a list that reads `PENDING` beside "Approved" looks broken (principles.md P2.1). The words above are still the only terms; only the casing changed.

**Badge colour stays per app.** The mapping from state to badge kind is the design system's, so it stays in each app: on web, [`apps/web/components/billing/invoice-status.ts`](../../../apps/web/components/billing/invoice-status.ts) for billing, and one module per domain vocabulary for the rest (attendance, service review, study-session close, study-zone enablement). `DRAFT` is the one state that takes the Hairline kind rather than a semantic one, because it is the absence of a status rather than a status.

## 6. Trust copy rules

Billing, legal, and data-sensitive surfaces MUST:

- Use concrete language
- Avoid overpromising
- Explicitly indicate preview/demo data when shown

Example (the event detail sheet's preview notice):

- `Showing preview event details. Sign in to edit and delete live events.`

The events pair that used to sit here (`Showing preview event data` /
`Sign in to load live event scheduling and attendance records`) had no reader
left and was deleted from `stateMicrocopy.events` (2026-11-05).

The billing pair that used to sit here (`Showing preview billing data` /
`Sign in to load live chapter subscription and invoice records`) went with the
greenfield Finance lane: an error on that route now degrades per read rather
than through one page-wide preview banner, and a banner telling a signed-in
member to sign in was the wrong sentence for the state it fired in.

## 7. Approved state microcopy

The tables below are the canonical strings for high-frequency state messages, so members and admins see consistent language across surfaces.

- Do not rewrite equivalent state text ad hoc per screen unless the workflow intent is materially different.
- On the web dashboard, the shared subset is implemented in `apps/web/lib/state-microcopy.ts`; the remaining strings live inline at their surface component and MUST match these tables.
- **Loading rows on web are announcements, not captions** (2026-11-05). Dashboard loading states are skeletons shaped like their page, and a skeleton shows no text; its string is the screen-reader status line, written without the trailing `...` (`Loading chapter tasks`). Mobile follows the same rule for screen-level loading states (2026-11-05): each screen's skeleton shows no text, and the row's string without the ellipsis is the skeleton's accessible name (`SkeletonRegion`'s `label`); a mobile state with no row here (event details, the chapter picker, the joined-channels card) names what loads in the same form, such as `Loading your chapters`. A loading line drawn in place beside content that is already up (`Loading earlier messages…` above a thread, a settings row's own loading line) stays visible, since nothing else on screen says what that spot is doing. The rows below keep their visible-caption form only for the few web regions inside a loaded page still on the generic loading state ([`components.md`](components.md) §10).
- The chat catch-up pulse deliberately does **not** use these states: a section that fails to read is omitted, never rendered as a zero or a generic error row. See [catch-up.md](../../behavior/chat/catch-up.md).

### Connection banner (global)

| State | Title | Description | Mobile pill (drawn) |
|---|---|---|---|
| Degraded | — | `Slow connection. Some features may be delayed.` | `Slow connection` |
| Offline | — | `You're offline. Showing cached data.` | `Offline` |

Mobile's floating pill draws the last column so it fits over a header, and its accessible name is the Description (2026-11-06, `connectionPillLabel` in `apps/mobile/lib/connection/state.ts`).

**The closing clause was removed in #1707 and MUST NOT be re-added to the global banner.** The rule it replaces read: *"The offline string MUST keep its closing clause — a member who edited or posted while offline needs to be told the work is queued, not lost."* The intent was right and the placement was wrong. Only the chat composer has an outbox, so "changes will sync" was true on exactly one surface and false on every other route this global banner renders on — dashboard writes are queueless and now reject rather than pausing. Promising a queue that does not exist is the §1 principle 1 violation ("actions must never appear to succeed when they haven't") that the clause was meant to prevent.

**The promise moves to the control that can keep it**, which is where a member acting on it is looking: the composer renders `You're offline — messages send when you reconnect.` and the chat header pill `Offline — messages will send when you reconnect`. Queue-backed surfaces MUST still say so at the control. [resilience](../resilience/README.md) carries the connection-state indicator strings alongside the detection thresholds and banner behavior; where the two differ, the wording above is approved.

### Permission check offline (global)

| State | Title | Description |
|---|---|---|
| Offline (permission check), control slot | — | `Offline — can't check your access.` |
| Offline (permission check), whole surface | `Can't confirm your access` | `Reconnect to check whether you can <do the thing the surface does>.` |

A paused permission check is **not** the surface being unavailable, and must not borrow that row's copy. "Polls unavailable offline" states a fact about the polls; here we do not know whether this member may see them at all, and saying otherwise promises access on reconnect that may not arrive. Both strings therefore report the *check*, and the second names the surface's verb rather than its noun. The per-surface descriptions are the `Offline (permission check)` rows in the surface tables below.

Implementation: `PermissionsOffline` (`apps/web/components/shared/async-states.tsx`) carries the first string; the second is passed to `<Can offlineFallback>` at each screen-level gate. Behaviour is [README.md](README.md) §4.

### Rate limited (global)

| State | Title | Description |
|---|---|---|
| Any API request the throttler refuses with a 429 (the body's `message`) | the surface's own | `Too many requests in a short time. Wait a minute, then try again.` |
| A points adjustment past the per-chapter hourly cap (429, the body's `message`) | the surface's own | `You've made {N} point adjustments in this chapter in the last hour, the most allowed. Try again later.` |

The API's throttler sets this sentence (`THROTTLED_MESSAGE`, `custom-throttler.guard.ts`, #3142); before it, a throttled write toasted the framework's `ThrottlerException: Too Many Requests`. Both buckets reset within a minute, so "a minute" is the longest wait; `Retry-After` carries the exact seconds. The points cap is the one other 429 and keeps its own sentence, because its window is an hour, not a minute ([points.md § Anti-Fraud](../../behavior/points.md#anti-fraud)). Chat's upload mints on web and mobile show this sentence for any 429, whatever its body (`RATE_LIMITED_COPY`, `packages/chat-core`), because their own "in a moment" retry sentence understates a block that lasts the whole minute. A chat send shows it for any 429 too, so an intermediary's text can't stand in, under `Message not sent` rather than `Message rejected`: the pace was refused, not the message. The send fails rather than waiting in the outbox, which flushes on boot and when a channel's connection goes live but never on a timer, so the row's Retry is the member's way back ([Chat (dashboard)](#chat-dashboard)). A `/points` command refused 429 on its first attempt adds the body's sentence to `Couldn't adjust points — nothing was recorded.`, so the officer learns whether to wait a minute or the cap's hour.

### Members (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter members...` |
| Loading (supporting queries) | — | `Loading chapter members...` — the roles-and-points load uses the *same* string. A second, differently-worded loading state for one screen is what this table exists to prevent. |
| Empty | `No actives yet` | `Actives appear here once they join.` |
| No results (filters) | `No actives match the filters` | `Clear a filter to see more.` |
| No results (search) | `No match for “<query>”` | `Check the spelling, or widen the filters.` |
| Error | `Couldn't load members` | `Confirm your chapter access and retry.` |
| Error (roles and points) | `Couldn't load roles and points` | `Filtering, sorting and assignment need both.` |
| Offline | `Members unavailable offline` | `Reconnect to load the roster.` |

**Rewritten by the greenfield Directory lane ([#2146](https://github.com/pdcarlson/Frapp/issues/2146)), and the row count is the change.** Five rows became seven for two reasons, both from the framework board's state rule (`3b`): *"Empty = accent tile + tinted CTA. No results = neutral tile, names the query"*, under a section eyebrow that budgets a status line at **six words**.

- **Empty and no-results were one row doing two jobs.** `No members match this view` / `Try a broader search or invite your first members to populate this directory.` had to cover a chapter with no roster *and* a search that matched nothing, so it asserted neither and instructed the reader in both. The split is the one the Points table below already makes between an empty leaderboard and a search that matched nothing, for the same reason: a filtered view that matches nothing is not a claim about the data.
- **The descriptions state a fact instead of giving an instruction**, except in the no-results hint slot, where the board's own drawn hint is an instruction (`Check the spelling`).
- **`actives`, not `members`,** in the two titles about the list itself: it is the word the tab and the section label above the list already use, and the shipped mobile Directory's empty title is the same `No actives yet` (`apps/mobile/app/(tabs)/directory.tsx`). Mobile draws that title alone, without this row's description, under §4 as amended 2026-11-05 *(corrected 2026-11-05: this said mobile renders the same state, which stopped being true of the description)*. Mobile's Actives tab has no filters, so the filters row has no mobile twin. The error and offline rows keep `members`, because those are about the *records*, not about the tab.
- **The old error string named a concept that no longer exists.** "The members workflow no longer falls back to preview data" described the removal of a preview mode to a member who never saw one; `stateMicrocopy.members.preview*` had already lost both its readers.

Implementation: `apps/web/lib/state-microcopy.ts`. The no-results title is assembled at the call site because it quotes the live query.

### Events (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter events...` |
| Empty | `No events yet` | `Create your first chapter event to unlock attendance and point automation.` |
| Empty (filtered) | `No events match the filters` | `Clear a filter to see more.` |
| Empty (search) | `No match for “{query}”` | `Check the spelling, or widen the filters.` |
| Error | `Couldn't load chapter events` | `Confirm your chapter access and retry.` |
| Offline | `Events workspace unavailable offline` | `Reconnect to load event schedules and attendance updates.` |

`No events yet` shows only when the chapter has no events at all. Under a filter that hides every event (the default Upcoming, once every event is past), the page says the filters matched nothing instead (2026-11-05).

### Attendance (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading attendance...` |
| Empty | `No attendance records yet` | `Once members check in, or you record attendance manually, they'll show up here.` |
| Error | `Attendance unavailable` | `Couldn't load attendance for this event. Confirm your chapter access and retry.` |

### Points (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading points ledger...` |
| Everyone at 0 | — | `Everyone is tied at 0. The first points earned take the lead.` (one line under the board) |
| Empty leaderboard | — | `Nobody has points in this period.` (one line) |
| Leaderboard search matched nothing | — | `No members match that search.` then a **Clear search** link (one line) |
| Empty transactions | — | `No points in this period yet.` (one line) |
| Transaction filters matched nothing | — | `No transactions match these filters.` then a **Clear filters** link (one line) |
| Error | `Couldn't load the points ledger` | `Standings and transactions are unavailable, so none are shown. Confirm your chapter access and retry.` |
| Offline | `Points ledger unavailable offline` | `Reconnect to refresh leaderboard standings and transaction history.` |

The board lists the whole roster, at 0 until a member earns points ([`points.md` § Leaderboard](../../behavior/points.md#leaderboard)), so a new chapter sees its members tied for first with the one line above rather than a card. The empty and no-match states are single lines (`InlineNote`, `apps/web/components/shared/inline-note.tsx`) where the rows would be, not cards; error and offline keep theirs (2026-11-06).

### Points — Audit tab (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading audit transactions...` |
| Empty (flagged only) | `No flagged transactions in this window` | `Single adjustments of \|amount\| ≥ {threshold} are flagged here automatically.`, or `Large single adjustments are flagged here automatically.` when the chapter's threshold can't be read |
| Empty (filtered) | `No transactions match this filter` | `Try relaxing the category or member filter.` |
| Error | `Audit unavailable` | `Couldn't load chapter transactions. Confirm your chapter access and retry.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can view the chapter's transaction log.` |
| Permission denied | `Audit` (the section label) | `Your role can't see every transaction.` |

### Roles & Permissions (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading roles and permissions...` |
| Empty | `No roles yet` | `Chapters always start with default system roles. Refresh to reload or create a new custom role.` |
| Error | `Couldn't load roles` | `Confirm your chapter access and retry.` |
| Permission denied | — | `Your role can't manage roles. Ask your chapter president for access.` |
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
| Accent hex needed | — | `Enter a hex code like #5AA9E6 to save an accent color.` (muted on an empty field, warning once something unsavable is typed) |
| Accent preview fallback | — | `This color is hard to read on the card, so the preview shows <hex> instead. Saving stores the color you entered, and the palette is derived from it.` |
| Accent label illegible | — | `Label text on this preview reads at <n>:1, under the 4.5:1 minimum. Saving picks a label color that clears it.` |
| Accent server contrast disclosure | — | `<Accent text on the app background\|Accent text on its own tinted background\|Text on the accent's solid fill\|Text on the accent's hover shade> reads at <n>:1, under the 4.5:1 minimum. Try a lighter or darker shade of this hue and save again.` |
| Rollover confirmation | `Start a new semester labelled "<label>"?` | `The current leaderboard period is archived and a new one begins. Points already awarded are kept — only the leaderboard's default window moves.` · confirm `Start new semester` |
| Delete field confirmation | `Delete the field "<label>"?` | `Members lose the values they have entered for it, and the column disappears from the directory. This cannot be undone.` · confirm `Delete field` |
| Delete custom role confirmation | `Delete the custom role "<label>"?` | `Members holding it lose its capabilities on their next request. This cannot be undone.` · confirm `Delete custom role` |
| Number field refused at save | `<Field> needs a number` (empty) · `<Field> starts at <min>` (under its floor) | `Enter a whole number of <min> or more.` Dues grace days and installment count, a workflow threshold. `<Field>` is the input's own label, or `The threshold for “<workflow>”` for a workflow threshold. |
| Dues amount refused at save | `<Field> needs an amount` | `Enter an amount in dollars, like 425 or 42.50.` Amounts are typed in dollars and stored in cents (2026-11-05; they were typed in cents). |

The **Accent label illegible** row answers a different question from the **Accent preview fallback** row above it, and the pair is easy to collapse by mistake. The fallback fires when the accent is unreadable *as text on the card*, which is what `resolveChapterAccentColor` checks. This one fires when text is unreadable *on the accent* — which is what a primary button is, and what that card's own description promises the colour will be used for. They diverge: `#0086FE` passes the first and fails the second (both figures pinned in [`settings-contrast.spec.ts`](../../../apps/web/components/settings/settings-contrast.spec.ts)). Both are about the draft preview only, and each ends by saying what a save does instead, because saving differs from the preview in both cases: the entered color is stored rather than the substitute, and the saved palette's label (`on-primary`) always clears 4.5:1 ([`accent-engine.md`](accent-engine.md) §8; [#2543](https://github.com/pdcarlson/Frapp/issues/2543)). Neither says what the saved accent paints, which the engine derives (the row's "the palette is derived from it"). The **Accent hex needed** example, `#5AA9E6`, clears both checks, so following it raises neither.

The **Accent server contrast disclosure** row is independent of every row above it. Those are client-side checks of the *unsaved draft*: its format, and the two contrast questions against one fixed backdrop each. This one is the server's own §8 verdict on the colour actually saved, generated through the real Signet pipeline (`accent-engine.md` §8), and it is disclosure rather than correction — a failing save still succeeds, since §8 forbids a runtime substitution on engine output. It clears on the officer's next edit, since a stale verdict describing a colour they have already changed away from would be actively misleading (#1183).

### Tasks (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter tasks...` |
| Empty | `No tasks yet` | `Admins can create the first chapter task to assign ownership and award points.` |
| Error | `Couldn't load tasks` | `Confirm your chapter access and retry.` |
| Offline | `Tasks unavailable offline` | `Reconnect to load the chapter board and move tasks through it.` |

### Service Hours (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading service entries...` |
| Empty queue | `No pending entries` | `Approved or rejected entries appear under History.` |
| Empty history | `No service activity yet` | `Log your first service entry to build up chapter service hours.` |
| Error | `Couldn't load service entries` | `Confirm your chapter access and retry.` |
| Offline | `Service hours unavailable offline` | `Reconnect to log hours and review the approval queue.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can review submitted hours.` |

### Chapter Documents (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter documents...` |
| Empty | `No documents here yet` | `Upload chapter files like bylaws, agendas, and meeting minutes so everyone can find them.` |
| Empty (search, all files) | `No documents match that search` | `Nothing in the chapter library has "{query}" in its title.` |
| Empty (search, inside a folder) | `No documents match that search` | `No match in this folder. Try "All files" to search the whole library.` |
| Empty (search, all files), mobile s12 | `No matches` | `No document title matches “{query}”.` |
| Empty (search, inside a folder), mobile s12 | `No matches` | `Nothing in {folder} matches “{query}”.` Mobile's search stays inside the picked folder chip, so the line names the folder it searched |
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
| Error | `Couldn't generate <kind> report` | the API's own message, or `Confirm your chapter access and retry.` |
| Truncated | `Incomplete report` (badge) | `<cap summary> This preview and the CSV built from it are not a complete record of the chapter.` |
| Permission denied | — | `Your role can't export chapter data. Ask your chapter president for access.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can export chapter data.` |

**This table had no Error row until the Resources & Reporting slice, and that is why the screen had no error state.** A failed run reported a toast and never touched `preview`, so the panel fell through to the Idle copy — a failure rendering as "nothing has happened yet", against [README.md](README.md) §4's requirement of an error state with a retry path on every async view. The Idle and Empty-filter titles were added in the same pass: [components.md](components.md) §10's state family needs a title and a description, and the approved sentences are kept verbatim as the descriptions rather than rewritten.

**The Truncated row is a state, not a toast.** [`../../behavior/reports.md`](../../behavior/reports.md) caps a report at 5,000 rows and requires that truncation is never silent; the toast fires once and then a partial table sits on screen claiming to be the whole report, and the CSV built from it carries that claim into a file. The badge is [components.md](components.md) §5's Semantic warning kind, which needs no §1 lift on its own tint.

### Backwork (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading backwork` (the skeleton's status line) |
| Empty (no files at all) | `No backwork yet` | `Upload the first exam, homework or study guide to start the library.` |
| Empty (search or filters match nothing) | `No files match` | `Try fewer words, or clear a filter.` Action: `Clear search and filters` |
| Truncated (the list hit the server's 1,000-row cap, #3525) | — | `Showing the newest 1,000 files. Search and filters look only at these for now.` |
| Error | `Couldn't load backwork` | `Confirm your chapter access and retry.` |
| Offline | `Backwork unavailable offline` | `Reconnect to browse the coursework archive and download a resource.` |

### Study session (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading study zones...` |
| Empty zones | `No active study zones` | `Ask an officer who manages study zones to add one.` |
| Empty history | `No sessions logged yet` | `Start a tracked session inside a study zone to start earning study points.` |
| Error | `Couldn't load study data` | `Confirm your chapter access and retry.` |
| Offline | `Study hours unavailable offline` | `Reconnect to start a session. Tracking needs a live location check.` |
| Paused (tab hidden) | `Paused (tab hidden)` (badge) | Surfaced live while the timer is paused by the Page Visibility API. |

### Subscription refused (mobile, cross-surface)

Every mobile paid-ops write can be refused by `ChapterGuard` when the chapter's
subscription is not active — the founder case is a brand-new chapter, which is
`incomplete` until checkout ([#2297](https://github.com/pdcarlson/Frapp/issues/2297)).
The strings live in `apps/mobile/lib/subscription-refusal.ts`, apart from a
chat card's that web shows too, which lives beside the card's rules in
`@repo/hooks` (the rush candidate row below). All of them are asserted against
these rules in `apps/mobile/lib/subscription-refusal.spec.ts`. Two constraints
bind every one of them, and both are the point rather than style:

- **No price, plan, purchase path or link.** The constraint itself is owned by
  `apps/mobile/store/README.md` (the submitted App Store Connect answers) — read
  it there rather than trusting this restatement, which exists only to say that
  the rule reaches copy. Point at a chapter officer, the actor a member has.
- **No retry.** The refusal cannot be retried into success, so the copy must
  not invite one and the control is withdrawn alongside it.

| Surface | Description |
|---|---|
| New event (sheet from the tab bar's +) | `Your chapter's subscription isn't active, so new events can't be saved. An officer can sort this out for the chapter.` |
| New task (s19) | `Your chapter's subscription isn't active, so new tasks can't be saved. An officer can sort this out for the chapter.` |
| Task status (s08 toggle, chat task card) | `Your chapter's subscription isn't active, so task updates can't be saved. An officer can sort this out for the chapter.` Shown on the board, and on a mobile chat task card for Start, Mark complete, Confirm and Reject (one copy for both, `taskStatusGateRefusal` in `apps/mobile/lib/tasks/status-refusal.ts`). On either, the controls stay withdrawn until the member comes back to the screen or to the app ([#2710](https://github.com/pdcarlson/Frapp/issues/2710), [#3185](https://github.com/pdcarlson/Frapp/issues/3185)). |
| Event check-in | `Your chapter's subscription isn't active, so check-in isn't available. An officer can sort this out for the chapter.` |
| Log service hours (s20) | `Your chapter's subscription isn't active, so service hours can't be logged. An officer can sort this out for the chapter.` |
| Upload document (s21) | `Your chapter's subscription isn't active, so documents can't be uploaded. An officer can sort this out for the chapter.` |
| Rush candidate (chat card, web and mobile) | `Your chapter's subscription isn't active, so votes and bids can't be saved. An officer can sort this out for the chapter.` A refused Vote or Extend bid: the line under a mobile card, whose controls stay withdrawn until the member comes back to the thread or the app, and the description of web's failure toast. One copy for both, `RUSH_CARD_REFUSAL_COPY` and `rushCardGateRefusal` in `packages/hooks/src/rush-card.ts` ([#3383](https://github.com/pdcarlson/Frapp/issues/3383)). Web's card also shows its `SubscriptionNotice` before a press, as the task card does. |
| Study | See the two rows in *Study session (mobile, s10)* below — start and in-session differ, and the difference is load-bearing. |

### Module off (mobile, cross-surface)

`ChapterGuard` refuses a write to a module an officer has switched off with a
sentence addressed to that officer ("Re-enable it in Settings → Modules to make
changes"). A member can't follow it, so a mobile surface that would relay the
server's message matches the refusal with `moduleRefusalOf`
(`apps/mobile/lib/module-refusal.ts`), or, for a chat card web shares, with its
rules' own reader in `@repo/hooks` (`rushCardGateRefusal`), and shows its own
row instead. The same
two rules as the subscription refusal apply: point at an officer, and withdraw
the control rather than invite a retry, since only an officer can turn the
module back on ([#2393](https://github.com/pdcarlson/Frapp/issues/2393),
[#2718](https://github.com/pdcarlson/Frapp/issues/2718)).

The two *Polls check* rows are not refusals. They are the poll card's reason
for holding its Vote while the client's own read of whether Polls is on hasn't
answered. Their Retry re-runs that read, never the vote. Both clients derive
the state with `pollsGateOf` in `@repo/chat-core/polls`.

| Surface | Description |
|---|---|
| New event (sheet from the tab bar's +) | `Events are turned off for your chapter right now, so new events can't be saved. An officer can turn events back on.` |
| New task (s19) | `Tasks are turned off for your chapter right now, so new tasks can't be saved. An officer can turn tasks back on.` |
| Task status (s08 toggle, chat task card) | `Tasks are turned off for your chapter right now, so task updates can't be saved. An officer can turn tasks back on.` Shown on the board and on a mobile chat task card, and withdrawn for as long, like the subscription row for the same writes ([#2710](https://github.com/pdcarlson/Frapp/issues/2710), [#3185](https://github.com/pdcarlson/Frapp/issues/3185)). |
| Event check-in | `Check-in is turned off for your chapter right now. An officer can turn events back on.` |
| Log service hours (s20) | `Service hours are turned off for your chapter right now, so new hours can't be logged. An officer can turn service hours back on.` |
| Upload document (s21) | `Documents are turned off for your chapter right now, so new documents can't be uploaded. An officer can turn documents back on.` |
| Rush candidate (chat card, web and mobile) | `Recruitment is turned off for your chapter right now, so votes and bids can't be saved. An officer can turn recruitment back on.` Names the module as Settings → Modules labels it, whatever the chapter's own word for recruitment is. Seen only when a vote or bid gets past a stale client gate: while the member view says Recruitment is off, the card offers neither and keeps its tally, with no line, since a timeline of cards repeating it would be noise. Same copy and lifetime as the subscription row ([#3383](https://github.com/pdcarlson/Frapp/issues/3383)). |
| Poll (chat card, web and mobile) | `Polls are turned off for your chapter right now. An officer can turn them back on.` The withdrawn Vote's reason: while Polls is off, a poll card keeps its question, options and tally, disables its options and shows this line under them, with no Retry ([#3012](https://github.com/pdcarlson/Frapp/issues/3012)). It also replaces the guard's sentence when a vote cast past a stale client gate, or such a `/poll`, is refused ([#2993](https://github.com/pdcarlson/Frapp/issues/2993)). `@repo/chat-core` holds it once (`POLLS_OFF_COPY`; `memberFacingRefusal` maps the refusal to it), so it reaches every surface that shows the server's message: the web toast, a failed poll row's inline error, and mobile's thread action-error banner. |
| Poll (chat card, Polls check loading) | `Checking whether polls are on for your chapter…` The Vote's reason while the chapter read the gate needs is running with nothing cached. The options stay disabled until it answers, and there is no Retry, because the read is already running. |
| Poll (chat card, Polls check failed) | `Couldn't check whether polls are on for your chapter, so voting is paused.` · `Retry` The Vote's reason when nothing is cached and the read isn't running: it failed, it is paused offline, or it is disabled for want of a chapter. "Checking…" would never resolve there, and the Vote fails closed rather than open (README §4, "Idle with nothing cached still fails closed"). Retry re-reads it. Not the *Polls are turned off* line, because the module may well be on. A pending or failed poll row shows neither line: it takes no vote either way, and its delivery chrome already says why. |
| Study | The *Module off* rows in *Study session (mobile, s10)* below. |

### Study session (mobile, s10)

The member's study screen has states the dashboard's *Study session* rows
above don't cover (a session running on a phone, a pause, the location check,
a refused write), and its error rows say which read failed rather than the
dashboard's "Confirm your chapter access and retry".
Per §"Do not rewrite equivalent state text ad hoc per screen unless the
workflow intent is materially different", the member surface gets its own rows
rather than inline strings. Where a state is the same for both, the row says
so and uses web's line, as *No zones* does.

| State | Title | Description |
|---|---|---|
| Loading | — | Skeleton (`components/card-list-skeleton.tsx` around `StartCardSkeleton`, the start card and the list it becomes); no visible copy, and `Loading study zones` as its accessible name. |
| Module off | `Study hours are turned off` | `Your chapter isn't tracking study hours right now. An officer can turn the module back on.` The same sentence is what a failed Start renders when the module gate refuses it — recognised by the guard's exact message, because `code: chapter.module.disabled` didn't reach a client until #1020, which left a code-keyed path dead until #2393 (moving to the code first is #2995) — the empty state is unreachable while `useCurrentChapter` is disabled (no claim on the token), so the error path has to carry the member-facing wording rather than relaying the guard's officer instructions ("Re-enable it in Settings → Modules"). |
| Module off (session running) | — | `Your chapter isn't tracking study hours right now, so that didn't save. An officer can turn the module back on — study time tracked now may not be credited.` Rendered when an officer switches `hours` off under a running session: pause, resume, heartbeat and stop are refused by the same gate. It hedges for the reason the *Subscription refused (session running)* row gives. Seen until the member's cached chapter payload catches up: the refusal itself refetches it, and once it says off, the screen below replaces the session. With no payload (no chapter claim on the token) the screen fails open, and this line stays the explanation. |
| Module off (session running, screen) | `Study hours are turned off` | `Your chapter isn't tracking study hours right now, so your running session can't be updated or ended. An officer can turn the module back on — study time tracked now may not be credited.` The *Module off* empty state's body when a session is still running under it. The screen replaces the session's card, because every write on it is refused while the module is off and nothing expires a stale session in the meantime, so this line is the only place the member learns the session exists. No failure line is stacked above it. A session write that gets through under it (an officer turned `hours` back on) refetches the payload. Within ten minutes of an unpaused session's last banked heartbeat (or a paused one's grace window) that brings the card back; past that, the write settles the session (`EXPIRED` with nothing credited, or `PAUSED_EXPIRED` with its pre-pause time) and the screen goes to Start ([#2718](https://github.com/pdcarlson/Frapp/issues/2718)). |
| Subscription refused (start) | — | `Your chapter's subscription isn't active, so study sessions can't be recorded. An officer can sort this out for the chapter.` Rendered when `POST /study-sessions` is refused by the subscription gate; the two rules binding it are in § *Subscription refused (mobile, cross-surface)* above. |
| Subscription refused (session running) | — | `Your chapter's subscription isn't active, so that didn't save. An officer needs to sort it out — study time tracked now may not be credited.` Deliberately **not** the row above. Pause, resume, heartbeat and stop all leave the session active server-side and the End button on screen, so telling the member study "can't be recorded" would be false and would cost them the banked time if they walked away. It must not promise the time is safe either: `stop` is refused too, and a session whose heartbeats are refused goes stale and closes as `EXPIRED` with no points after 10 minutes. The reasoning is kept on `SUBSCRIPTION_REFUSAL_COPY.studySession`. *(Corrected 2026-09-27: this row still quoted the earlier "its time is safe" string after the code dropped it.)* |
| No zones | `No study zones yet` | `Ask an officer who manages study zones to add one.` Web's *Empty zones* line, word for word. *(Corrected 2026-11-05: the earlier body quoted the `geofences:manage` permission key to a member, who can't act on it, [#3422](https://github.com/pdcarlson/Frapp/issues/3422).)* |
| Location off, OS won't ask again | `Location check` (primer) | `Location is turned off for Frapp. Turn it on in <path>, then start your session.` · `Open Settings` The button opens the app's own settings page. `<path>` is the member's own OS's and OS version's, from `locationSettingsPath` (`apps/mobile/lib/study/location-settings-path.ts`): `Settings → Frapp → Location` below iOS 18, `Settings → Apps → Frapp → Location` from iOS 18 (which put app pages under an Apps row; the app installs from iOS 16.4), `Settings → Apps → Frapp → Permissions → Location` on Android. Never another OS's or iOS version's path, which sends the member looking for a row that isn't there. |
| Location off, web build | `Location check` (primer) | `Location is turned off for Frapp. Allow location for this site in your browser, then start your session.` No button: a browser has no settings page an app can open, and location there is the site's permission, not a Settings path. The Start card's failure line ends the same way: `… so it needs location while you study. Allow location for this site in your browser.` |
| Location refused or unreadable (Start) | — (Start card failure line) | `Frapp confirms you're in the study zone, so it needs location while you study. Turn it on in <path>.` The same `<path>` as the row above, from the same helper; this line has no button, so the path is the whole way forward. |
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
| Permission denied | — | `Your role can't manage study zones. Ask your chapter president for access.` |

### Polls (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading chapter polls...` |
| Empty | `No polls match this view` | `Create a poll inside a chat channel and it will appear here. Loosen the filters if you're expecting results.` |
| Error | `Couldn't load polls` | `Confirm your chapter access and retry.` |
| Offline | `Polls unavailable offline` | `Reconnect to load the chapter's polls and cast a vote.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can see the chapter's polls.` |
| Permission denied | `Polls` (the page title) | `Your role can't see every poll. You can still vote in chat.` |

### Chat (dashboard)

| State | Title | Description |
|---|---|---|
| Loading channels | — | `Loading channels...` (corrected 2026-11-05: both apps announce `Loading channels`, the dashboard since its chat shell and chat admin skeleton shipped, so this row followed them) |
| Loading messages | — | `Loading messages...` |
| Loading older messages (above the oldest row, #1571) | — | `Loading earlier messages...` (mobile, #2772: `Loading earlier messages…`, its own ellipsis convention) |
| Older messages failed | — | `Couldn't load earlier messages.` · `Retry` |
| Older messages may exist, no read running (mobile, above the oldest row, #2772) | — | `Load earlier messages` (a control: a page the block list holds entirely adds nothing to scroll past) |
| Start of the channel's history reached | — | The channel start (below), above the oldest message, on both clients. Mobile's bare caption `This is the start of the conversation.` (#2772) remains only for a thread whose row hasn't loaded |
| Jump looking for its target (newer rows first, then older pages) | — | `Finding that message...` · `Dismiss` |
| Jump target past the paging bound | — | `That message is further back than the history loaded here. Scrolling up loads more, and it opens once it loads.` · `Dismiss` |
| Jump target not in the channel's history | — | `That message isn't in this channel anymore.` · `Dismiss` |
| Jump could not load a page it needed (newer or older) | — | `Couldn't load the messages needed to reach that message.` · `Dismiss` |
| Jump into a channel whose messages failed to load | — | `Couldn't load this channel's messages to reach that message.` · `Dismiss` |
| Jump to latest (mobile: a `↓` over the thread once the reader is back in history; `components/chat/jump-to-latest-button.tsx`, `jumpToLatestLabel`) | — | Read `Jump to latest`, or `New messages. Jump to latest` once something new lands out of sight |
| Setup checklist (web, top of the channel rail; mobile, chat home under UP NEXT; officers only, [`modules.md` § Setup checklist](../../product/modules.md#setup-checklist)) | `Set up your chapter` · `<done> of <total>` | One line per step: `Invite members`, `Schedule the first event`, `Add a study zone`, `Upload the bylaws`, `Send the first dues`; a done line is struck through and muted. The hide control is an icon, labelled `Hide the setup list`. On mobile (no dues line) a line the phone can't do ends in a muted `Web`, has the hint `Opens this step in the web app.`, and if the browser won't open shows `Couldn't open the web app` / `Sign in at <web host> on a computer to finish this step.` |
| No channels | `No channels yet` | `Onboarding seeds them. Ask an admin.` It names no channel: which ones a new chapter gets is [`chat/README.md` § Channels](../../behavior/chat/README.md#channels). |
| Channel start (both clients, `@repo/hooks/channel-start`; an empty channel draws it just above the composer, and a channel with history draws it above its oldest message) | `Welcome to #<name>`; a DM's is the other member's name | `This is the start of #<name>.`, or `This is the start of the private #<name> channel.` for a private one (a role-gated channel takes the plain line, since who reads it depends on its permissions and the seeded `#alumni` is open to every member), `This is the start of your conversation with <name>.` for a DM and `This is the start of your group conversation.` for a group DM; then the channel's own description, when it has one. Web officers (`channels:manage`) get `Edit channel`, or `Add a description` when it is blank, opening Chat admin on that channel |
| Channel header (web: `# <name> • <description>` on one line, the description muted and truncated; mobile: the description on a muted line under the name) | — | The channel's own description. The four default channels start with `The whole chapter. Plans, questions, whatever's going on.` (#general), `News from officers. Everyone gets notified.` (#announcements), `Officer changes to dues, roles and settings, posted automatically.` (#chapter-audit) and `Alumni and actives keeping in touch.` (#alumni), from `DEFAULT_CHANNELS` |
| Error | `Couldn't load channels` / `Couldn't load messages` | `Confirm your chapter access and retry.` |
| Read-only channel | — | `This channel is read-only for your role.` (mobile still quotes the permission key, [#3422](https://github.com/pdcarlson/Frapp/issues/3422)) |
| Alumni-restricted channel | — | `Alumni can read this channel but not post. Alumni may post in #alumni and direct messages.` |
| Archived conversation (mobile only: a Group DM everyone else left, #348; web's channel list leaves archived channels out) | — | `This conversation is archived because everyone else left. You can still read it.` |
| No chapter selected | `No chapter selected` | `Pick an active chapter to load its channels and messages.` |
| Composer placeholder (mobile; `app/(tabs)/chat-thread.tsx`) | — | `Message <title>`, the header's title (`Message #general`, `Message Casey`); plain `Message` while the title is blank or falls back to `Thread`. The input's accessible name is the same string |
| Offline (composer) | — | `You're offline — messages send when you reconnect.` |
| Composer mounted before the channels resolve (#2176); visible after Enter, announced from the first render | — | `Still opening your channels. You can keep typing.` |
| Send refused by the outbox, message put back (toast, #1728) | `Message not sent` | `It couldn't be queued for delivery. It's back in the composer.` |
| Send refused by the outbox, composer changed since (toast, #1728) | `Message not sent` | `It couldn't be queued for delivery and was discarded. Re-enter it to try again.` |
| Send throttled (429; web toast and the failed row's error, beside its Retry, #3061) | `Message not sent` | `Too many requests in a short time. Wait a minute, then try again.` |

An empty channel had a timeline line until 2026-11-05, when the channel start
replaced it. Before that it once ended "messages render live with Supabase
Realtime.", which named the vendor and the transport to a member who wants to
know whether it is safe to type, and §1's plain-language rule rules that out.

The composer's offline line is a **label, not a warning**: the send path queues
before it touches the network, so the composer stays usable and says what will
happen. Never reword it into an error — [resilience/connection-state.md](../resilience/connection-state.md) owns
that rule and the string is shared with mobile.

The two refusal toasts differ because the composer restores a refused message
all or nothing: its text, files and reply come back together, or not at all if
the member has typed, attached, staged another reply or left the channel since.
The second toast therefore says the message is gone, rather than implying it
will retry (`apps/web/components/chat/composer.tsx`, `submit`).

Channel seeding happens at chapter onboarding and has no billing prerequisite; [onboarding.md](../../behavior/onboarding.md) owns the seeding flow.

### Chat Admin — channels and categories (dashboard)

The channel structure below the report queue on `/chat-admin`. Its states stand where both of its sections would be, so they name channels, not the page: the report queue above them reads and fails on its own.

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading channels...` |
| Empty (channels) | `No channels yet` | `Create the first channel to get chapter chat structured.` |
| Empty (categories) | `No categories yet` | `Channels without a category show up as uncategorized.` |
| Nothing selected (edit pane) | `No channel selected` | `Pick a channel to edit its details, notifications and pins.` |
| Loading (pins) | — | `Loading pins...` |
| Empty (pins) | `Nothing pinned` | `Officers can pin key messages from the channel timeline.` |
| Stale (pins) | — | `Couldn't refresh the pins. These are the last ones that loaded.` · `Try again` (a background refresh failed; the loaded pins stay) |
| Error (pins) | `Couldn't load pins` | `Confirm your chapter access and retry.` (never `Nothing pinned`: a failed read is not an empty list) |
| Offline (pins) | `Pins unavailable offline` | `Reconnect to load this channel's pins.` (whether the read paused or failed while offline) |
| Loading (permission grid) | — | `Loading permissions…` |
| Unavailable (permission grid) | — | `Couldn't load the permission list, which needs a role that can see the full directory. Your current selections are unaffected.` (nothing loaded; a failed refresh keeps the loaded grid) |
| Offline (permission grid) | — | `Can't load the permission list while offline. Existing selections are unaffected; reconnect to change them.` |
| Error | `Couldn't load channels` | `Confirm your chapter access and retry.` |
| Stale | — | `Couldn't refresh the channels. These are the last ones that loaded.` · `Try again` (a background refresh failed; the loaded channels and categories stay) |
| Offline | `Channels unavailable offline` | `Reconnect to manage channels, categories and pins.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can manage chat channels.` |
| Permission denied | — | `Your role can't manage channels. Ask your chapter president for access.` |

The permission grid is the role-gated channel's, shared with the import wizard's channel step, which shows the same three lines.

Implementation: inline in `apps/web/components/chat-admin/chat-admin-page.tsx`; the permission grid's in `apps/web/components/shared/permission-checkbox-grid.tsx`.

### Chat Admin — reported messages (dashboard)

The officer report queue ([`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Report and block). One empty row per status tab, because each tab is a different claim about the chapter.

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading reports...` |
| Empty (Open) | `No open reports` | `When a member reports a message, it lands here for officers to review.` |
| Empty (Reviewed / Actioned / Dismissed) | `No reviewed reports` · `No actioned reports` · `No dismissed reports` | `Reports marked reviewed are kept here.` · `Reports whose message was removed are kept here.` · `Reports you dismiss are kept here.` |
| Error | `Couldn't load reports` | `Confirm your chapter access and retry.` |
| Stale | — | `Couldn't refresh the reports. These are the last ones that loaded.` · `Try again` (a background refresh failed; the loaded reports stay, and so does an empty tab, which says it too) |
| No chapter | `No chapter selected` | `Pick an active chapter to review its reports.` |
| Offline | `Reports unavailable offline` | `Reconnect to review reported messages.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can review reported messages.` |
| Permission denied | `Reported messages` | `Reviewing reported messages needs a role that can see the full directory and manage channels and pins. Ask your chapter president for access.` |
| Nothing to remove | — | `This message no longer exists, so there's nothing to remove. Mark actioned to close the report.` (hard-deleted; the row offers `Mark actioned` in place of `Remove message`) |
| Attachments (open report) | — | `1 attachment` / `<n> attachments`, then `Kept while this report is open, even if the sender deletes the message.`, each file's name (`Unnamed file` for none) and size, and `Show attachments` to load them (#2481). Loading: `Loading attachments...`. Failed: `Couldn't load the attachments.` with `Retry`. Fewer loaded than the report holds: `1 attachment couldn't be loaded.` / `<n> attachments couldn't be loaded.` |
| Attachments (resolved report) | — | `1 attachment` / `<n> attachments`, then `Attachments are kept only while a report is open.` and the file names, with nothing to open |
| Remove confirmation | `Remove the message from <author>?` | `It reads “<first 40 characters>”. This removes this one message for everyone and marks the report actioned. Nothing else in the conversation changes, and a direct message stays private: officers can't open it. The sender will see this message was removed. In a direct message they may be able to tell who reported it. This cannot be undone.` (the quote is dropped for a message with no text) · confirm `Remove message` |
| Removed (toast) | — | `Message removed. The report is marked actioned.` |
| Already removed (toast) | — | `This message was already removed. The report is marked actioned.` |
| Resolved (toast) | — | `Report marked reviewed.` · `Report dismissed.` · `Report marked actioned.` |
| Refused (toast) | — | For a 404 or 409, the server's own message (`This report is no longer open`, `Report not found`, …). Any other 4xx on Mark reviewed / Dismiss / Mark actioned: `Couldn't mark the report reviewed.` / `Couldn't dismiss the report.` / `Couldn't mark the report actioned.`; any other 4xx on Remove: `Couldn't remove the message.` Never a raw 5xx body or a transport error's text |
| Resolution unconfirmed (toast) | — | `Couldn't confirm the report was marked reviewed.` / `Couldn't confirm the report was dismissed.` / `Couldn't confirm the report was marked actioned.`, each followed by `It may have gone through anyway. Refresh to check, and retry if the report is still open.` (a 5xx or no response on Mark reviewed / Dismiss / Mark actioned) |
| Removal unconfirmed (toast) | — | `Couldn't confirm the removal. The message may have been removed anyway. Refresh to check, and retry if the report is still open.` (a 5xx or no response on Remove) |
| Row control names (accessible) | — | `Mark reviewed: report on message from <author>, “<excerpt>” (<reason>, reported <date and time>, with a reporter's note, report <n> of <total>)` · `Dismiss report on …` · `Mark actioned: report on …` · `Remove message from <author>, “<excerpt>” (…)` · `Show attachments: message from <author>, “<excerpt>” (…)` — `with no text` in place of the excerpt for a message with none; the date and time is the locale's absolute one (the row's hover title), left out when unreadable; the note clause only when there is a note; `report <n> of <total>` only on rows that would otherwise share a name, numbered in list order |

The confirmation says the conversation stays closed because that is the rule an officer is most likely to assume away: removing a message from a DM does not open the DM. It also says what the removal costs, because the officer is the one choosing to pay it: the sender sees their message go, and in a 1:1 DM the only other reader is who must have reported it — the trade-off accepted with report-scoped removal ([`chat/README.md`](../../behavior/chat/README.md) § Report and block → Officer action). The row has no channel name or kind to say "direct message" more specifically — the report snapshots the message, not its channel — so that sentence is conditional. It names the author and quotes the start of the message because every row carries the same verbs, and a confirmation that could belong to any row is not a confirmation of this one; the row's accessible names carry the same subject for the same reason, and add the report's reason, filing time and note because two members can report one message, and those are what the two rows differ by. The time is absolute, not the visible relative age: every report filed in the same minute reads "5 minutes ago", and a relative age would rename the controls on every tick. Reports that still match on all of it are numbered, so no two controls in the queue share a name.

**A refusal is quoted; a failure is not.** The report routes author their 404 and 409 answers to be read, and they are decided before anything changes. A 5xx body ("Internal server error") or a transport error ("Failed to fetch") is not copy, so the fallback stands in. Those failures are also an unknown outcome — a removal or a resolution may have committed before the response was lost — so the toast says that and how to find out, rather than claiming it failed.

**"Already removed" names no one.** The removal is idempotent on the message — its sender, another officer's delete, a sibling report's removal or an earlier attempt may each be why it is gone — and the queue cannot tell which, so the copy states the outcome and not a culprit.

Implementation: `apps/web/components/chat-admin/chat-report-copy.ts`.

### Discord Import (dashboard)

`/discord-import`, the chapter's one import in the state it is in (2026-11-06; what each state shows is owned by [`chat/README.md`](../../behavior/chat/README.md#imported-archive-messages) § Imported archive messages), and deleting it ([#2944](https://github.com/pdcarlson/Frapp/issues/2944)). What a delete removes and what it keeps is owned by [`chat/README.md`](../../behavior/chat/README.md#imported-archive-messages) § Imported archive messages; the confirmation says it in that section's words rather than its own.

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading the import` |
| Nothing imported yet | `Bring your chapter's Discord history into Frapp` | `Every message, file and thread lands in Frapp chat, searchable, with the same people able to read it. Members can link their Discord later to claim what they wrote.` Then the two ways in (the wizard's `Connect Discord` / `Upload an export` cards), `Comes over`: `Messages, threads and forum posts` · `Files and images` · `Reaction counts` · `Categories, if you want them` · `Private channels stay private`, and `Stays behind`: `DMs, voice, and who holds which role` |
| Last import deleted | — | `The import from <server> was deleted.` (`your Discord server` when it has no name) · `Dismiss` |
| Set up, not started | — | `An import from <server> was set up and not started. Delete it to remove anything uploaded for it.` (`from <server>` left out when it has no name) · `Delete` (opens the delete confirmation) |
| Importing | `<n> messages in so far` (eyebrow `Importing · <server>`, or `Waiting to start · <server>` while queued) | `<done> of <total> channels and threads done. You can close this tab. You'll get a notification when it finishes.` (the first sentence only once the counts are known), the percent under the meter · `Stop import`. On a bot import: `Now importing #<channel> · <n> messages` (a thread reads `#<channel> › <thread>`), then a tile per Discord category, `<name>` over `<done>/<total>` (` · <n> failed` when any did; `No category` for channels in none; past eight, the last reads `+ <n> more`), labelled `Progress by Discord category` |
| Stopping (toast) | — | `Stopping the import.`, or the API's message, or `Could not stop the import.` |
| Finished | `Your Discord history is in Frapp` (completed) · `The import stopped on an error` (failed) · `The import was stopped` (cancelled) · `The deletion stopped on an error` (a deletion that failed part-way) · `The import stopped` (any other) | `<server> · messages since <day> · finished <day, time>`, the parts it has (a nameless server's part is left out), and the import's own error under it when it failed. Figures: `messages` · `files` · `channels` and `threads` (a completed bot import, once its categories load) or `channels and threads` (completed otherwise) or `channels and threads done` (stopped part-way). A completed bot import also lists `By Discord category`, one row per category (`<name>` and its count of channels and threads; `No category` for channels outside one; past eight, `+ N more`). `Open chat` once it completed. On a failed import: `Resume import`, with `It picks up where it stopped. Nothing already imported comes in twice.` |
| Resuming (toast) | — | `Resuming the import.`, or the API's message, or `Could not resume the import.` |
| Didn't come over | `<n> things didn't come over` | One group per reason, each with its count: `File types Frapp doesn't store` · `Files with no type Frapp could tell` · `Files too large to store` · `Files Discord no longer has` · `Files storage couldn't take` · `Channels the bot could no longer read` · `Files missing from the upload` · `Export files Frapp couldn't read` · `Channels with no place chosen` · `Messages with no id or time` · `Other`. At 50: `Only the last 50 are kept.` |
| Import warnings (API) | — | `"<file>" is a file type Frapp doesn't store (<type>) and was not imported. The message it belongs to was.` · `"<file>" has no file type Frapp could tell, so it was not imported. The message it belongs to was.` · `"<file>" is larger than the archive accepts and was not imported. The message it belongs to was.` · `"<file>" is no longer available from Discord, so it was not imported. The message it belongs to was.` · `Storage couldn't take "<file>", so it was not imported. The message it belongs to was.` · `#<channel> is no longer readable in Discord (deleted, or the bot lost access). It was skipped.` On an upload: `"<file>" wasn't in the upload, so it was not imported. The message it belongs to was.` · `Export file "<file>" is missing from the upload, so its messages were skipped.` · `Export file "<file>" is <n> MB, over the <max> MB limit for one export file, so its messages were skipped. Re-export with a smaller --partition.` · `Export file "<file>" couldn't be read (<reason>), so its messages were skipped.` · `#<channel> had no place chosen in Frapp, so its messages were skipped.` · `A message with no id or time in the export was skipped.` |
| Delete (finished) | — | `Deleting the import removes the messages and files it brought in. The roles and read permissions it made stay.` · `Delete import` |
| Finish notification | `Discord import finished` · `Discord import stopped` (failed) | `<n> messages from <server> are now in Frapp chat.` (`1 message … is`; without a server name, `from` and the name are left out) · `The import from <server> stopped on an error. Open the Discord import page to see why.` |
| One import (API, 409) | — | `Your chapter already has a Discord import. Delete it before starting another.` |
| Cutoff (wizard, review step) | `How far back should we go?` | `Older messages and their files are never read or stored. You can't change this once the import starts.` Choices: `Everything` · `Last 4 years` · `Last 2 years` · `Last year` · `Pick a date` (opens `Import messages from`). Under them: `Your server was made in <Mon YYYY>.` (bot path, read from the server's id), then `Messages before <Mon D, YYYY> are left out.` or `The server's whole history comes over.` Problems: `Pick a date, or choose Everything.` · `Enter a whole date, or choose Everything.` · `Pick a date in the past, or choose Everything.` |
| Error | `Couldn't load the import` | `Confirm your chapter access and retry.` |
| Stale | — | `Couldn't refresh the import. This is the last update that loaded.` · `Try again` (a background refresh failed; the import as it last loaded, and its meter, stay) |
| Offline | `Import unavailable offline` | `Reconnect to load your chapter's Discord import.` |
| Offline (permission check) | `Can't confirm your access` | `Reconnect to check whether you can import Discord history.` |
| Permission denied | — | `Your role can't import Discord history. Ask your chapter president for access.` |
| Loading (channel panel) | — | `Loading the import’s channels…` |
| Error (channel panel) | `Couldn’t load the import’s channels` | `The import itself is unaffected and keeps running. Try again in a moment.` · `Retry` |
| Offline (channel panel) | `Channels unavailable offline` | `Reconnect to see this import’s channels.` (whether the read paused or failed while offline) |
| Stale (channel panel) | — | `Couldn’t refresh the channels. This is the last update that loaded.` · `Try again` (a poll of the panel failed; the channels it last showed stay) |
| Empty (channel panel) | — | `Waiting for the first channel to start.` (still running) · `No channel was imported.` (finished) |
| Channel panel groups | `Importing now` / `Stopped at` (running / stopped) · `Finished last` / `Finished` · `Failed` | A failed channel without a reason: `No reason was recorded.` Under the groups: `Imported messages don’t appear live in chat. Open a channel to see what has landed so far.` |
| Channel step category (wizard) | `<category>` (`No category` for channels in none) | `<n> channels · <n> threads · <n> to import` (the threads part on a bot import, when it has any), then ` · <n> private in Discord` and ` · <n> need attention` when they apply |
| Chat preview (wizard, channel step) | `What chat will look like` | `The new channels, as the chat sidebar will list them. Merged channels stay where they are.` Sections are headed as the sidebar heads them (`Channels` for the ones in no category); past six rows, `and <n> more` |
| Loading (wizard, connect step) | — | `Checking whether Discord is connected…` · `Confirming your Discord server…` (the returned authorization is being confirmed) |
| Error (wizard, connect step) | `Couldn't check the Discord connection` | `Retry to see whether your server is connected.` |
| Offline (wizard, connect step) | `Can't check Discord offline` | `Reconnect to check whether your server is connected.` (whether the read paused or failed while offline) |
| Stale (wizard, connect step) | — | `Couldn't recheck the Discord connection. This is the last answer that loaded.` · `Try again` (a recheck failed; the last answer, connected or not, stays) |
| Refused (wizard, connect step) | `Could not confirm that server` | The API's own message, or `That Discord authorization could not be confirmed for this chapter.` (kept across Back and Continue, since a refused authorization is not sent again) |
| Delete confirmation | `Delete the import from <server>?` (`Delete this Discord import?` when the server has no name) | `This deletes the <n> messages and <m> attachments it brought in, and its archive files. It then deletes the channels it created, and any it merged into that another deleted import created, once they hold nothing, and the categories it created once they are empty. The roles and read permissions it created stay. This cannot be undone.` A count that is zero is left out, and an import with neither reads `This deletes its archive files.` A delete offered again after one failed part-way opens instead with `An earlier deletion already removed <purged> of its <total> messages. This deletes the <left> left, their attachments, and its archive files.` (or, with none left, `An earlier deletion already removed its messages. This deletes its archive files.`) · confirm `Delete import` |
| Deleting (toast) | — | `Deleting the import. This page shows how far along it is.` |
| Deleting | `Deleting the import` | `Deleting: <left> of <total> messages left`, with the percent deleted under the meter. Once no message is left: `Messages deleted. Finishing with its channels and archive files.` |
| Deletion stopped | — | The finished state's line, then ` · <n> already deleted`, when a deletion failed part-way and Delete import is offered again |
| Delete refused (toast) | — | The API's own message (`Cancel the running import before deleting it.`), or `Could not delete the import.` |

The confirmation names the counts and the server because the button alone does not say how much goes: a delete of five thousand messages and one of a hundred and forty thousand look identical until the dialog says which. The page counts the messages down because a large purge runs for many minutes, and a bare `Deleting` could not tell an admin working from stuck; it stops at 99% and switches to what it is still doing, because the status, not the count, says the deletion is over (the count can finish short of the total).

The channel panel is what `See every channel` opens on a bot import (`Hide channels` closes it). Its strings keep the typographic apostrophe and ellipsis they were written with, unlike the page's, and the connect step's loading lines keep the ellipsis; match them exactly when editing any of them.

Implementation: the page's read states inline in `apps/web/components/discord-import/discord-import-page.tsx`, the import's states in `import-states.tsx`, the warning groups in `import-warnings.ts`, the cutoff in `review-step.tsx` and `import-wizard.tsx`, the API's warnings in `apps/api/src/application/workers/discord-export-worker.service.ts` and the finish notice in `discord-import-worker.service.ts`, the category tiles in `category-progress.ts`, the chat preview in `sidebar-preview.tsx` and `sidebar-groups.ts`, the channel step's in `channel-mapping-step.tsx`, the channel panel's in `apps/web/components/discord-import/import-watch-panel.tsx`, the connect step's in `apps/web/components/discord-import/connect-step.tsx`, the delete copy in `apps/web/components/discord-import/delete-import-copy.ts`.

### Billing (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading billing overview...` |
| Empty | `No invoices yet` | `Create your first invoice to start chapter dues collection.` |
| Error | `Couldn't load invoices` | `Confirm your chapter access and retry.` |
| Empty (filtered) | `No invoices match this filter` | `Try a different status, or clear the filter to see every invoice.` |
| Loading (plan panel) | — | `Loading plan...` |
| Offline | `Billing unavailable offline` | `Reconnect to sync subscription status and invoice balances.` |
| Billing-status read failed | — | `Couldn't load this chapter's Stripe details.` (with a Retry; shown only to a `billing:view` holder, for whom the error is a failure rather than the ordinary 403) |
| Overdue read failed | — | `Couldn't load the overdue list. Overdue badges and the Overdue filter are unavailable until it recovers.` |
| Past due (page banner) | — | `This chapter's subscription is past due. Write actions stay blocked until payment clears.` |
| Canceled (page banner) | — | `This chapter's subscription is canceled and the chapter is read-only.` |
| No billing rights | — | `Ask an officer to complete checkout.` / `…to update the payment method.` / `…to restart the subscription.` |

Three rows left this table with the greenfield Finance lane. **Preview/unauthenticated**
and its pair in §6 above went with the page-wide preview banner. **Offline
(permission check)** (`Can't confirm your access` / `Reconnect to check whether
you can manage chapter invoices.`) went with the officer invoice card: the
invoice surface is no longer behind a screen-level `<Can>`, so the one gate
left on it wraps a single control and takes §10's control-slot state
(`Offline — can't check your access.`) rather than a card-shaped one. The
**No billing rights** row is board `4b`'s "Ask an officer", which replaced a
sentence that quoted the `billing:manage` permission key at the one person who
cannot act on it.

### Dues (mobile, s11)

A member's dues screen, not the treasurer's billing overview — and **never the
word "subscription"**, which is the chapter's own bill with a different payer
([`../mobile/patterns.md`](../mobile/patterns.md) § Dues payment).

| State | Title | Description |
|---|---|---|
| Loading | — | Skeleton (`components/card-list-skeleton.tsx` around `BalanceCardSkeleton`, the balance card and the list it becomes); no visible copy, and `Loading your dues` as its accessible name. |
| Empty | `No dues yet` | `Your chapter hasn't billed you. Anything they send will show up here.` |
| Error | `Couldn't load your dues` | `Your invoices are still on record — this was a problem fetching them.` |
| Nothing owed | `You're all paid up` (balance label) | — |
| Payment captured, unsettled | — (balance card caption) | `Payment received, confirmation pending. This updates as soon as your chapter's records catch up.` With two or more open: `Payment received for <invoice title>, confirmation pending. This updates as soon as your chapter's records catch up.`, because the label then only counts them and a live `Pay now` pays that invoice. Re-reading until PAID is [`billing.md`](../../behavior/billing.md) § Member payment flow's rule (it owns it). The hold ends when the invoice list reads the invoice as no longer OPEN (PAID, VOID, or dropped from the list: the rows below), on a chapter switch, or when the app closes; nothing else ends it. Meanwhile the card stays on the paid invoice with the chip `Pending`, and with two or more open, that invoice's OPEN row reads `Pending` and the others wait. For the poll's budget after the sheet (about 24s, whether or not the poll has answered) the CTA is disabled as `Confirming payment…`; after that `Pay now` is live under this line, and with two or more open its accessibility hint is the footnote, `Pays <invoice title> — <amount> of your balance.`. Leaving the screen or the app and coming back re-reads the list, and so does a tick every 10s while the screen is up and the app in the foreground. The poll saying PAID ends nothing, because the list hasn't caught up yet. On Android a list read that never answers keeps the hold, because nothing times the request out yet ([#3433](https://github.com/pdcarlson/Frapp/issues/3433)). Pay stays live because nothing Dues reads says a payment failed: one that sat in processing and then failed leaves the invoice OPEN, and the member hears of it from the `Payment declined` push and the row it writes in Notifications (s14), neither of which Dues reads (the row carries no invoice id); a member who turned billing notifications off gets neither. A tap on a payment that failed since opens the sheet on the same intent; one the server already has as succeeded gets its refusal below. |
| Payment captured, invoice voided or gone | — (balance card line) | Voided: `Payment received for <invoice title>, but your chapter has cancelled that invoice. Ask your treasurer about it.` Gone from the list: `Payment received for <invoice title>, but that invoice is no longer on your dues. Ask your treasurer about it.` The hold ends and Pay moves on to the next invoice, so the line names its invoice, as the settled one does, and is drawn under the next CTA's caption. It promises no update, because neither invoice gets one: VOID is terminal, and the charge is the treasurer's to refund or reissue (`billing.md` § Payment webhook idempotency). For the rest of the visit, unless the list then reads the invoice PAID; paying the next invoice doesn't take it away, since each captured payment keeps its own line. The next visit drops it: History then shows a voided invoice as `Cancelled by your chapter`, and a dropped one appears nowhere on the screen. If the hold ended while the member was away, the line shows in the visit they come back to and goes in the one after. |
| Payment failed or refused | — (balance card caption, destructive) | The sheet's own message, or the server's for a refused request. A tap on an invoice whose stored payment the server already has as succeeded gets its 409 message as written: `Payment already completed; confirmation is being processed`. One Stripe still has as processing is handed back with no status ([#3432](https://github.com/pdcarlson/Frapp/issues/3432)), so the sheet opens on it, and what it says then is Stripe's (not yet seen on a device). Drawn on the card only while the card is about the invoice the attempt was for, so it is never another invoice's caption or hint, and above the error or loading state when there is no card. Cleared when a new attempt starts, on a new visit (the member coming back to the screen, or the app coming back from the background unless it went there during the attempt), and once the list moves the card to another invoice, so it doesn't come back if the card later returns. |
| Payment settled | — (balance card line) | `Paid <invoice title>. Your chapter has it — thanks.` Only once the invoice list reads the invoice PAID. Names the invoice, because it can sit under the next invoice's CTA: it is drawn under that CTA's caption, never in place of the footnote naming the next invoice or as the CTA's hint. Gone when the visit ends: the next return to the screen or the app drops it, and the invoice is in History. Paying the next invoice doesn't take it away. If the hold ended while the member was away (the screen stays mounted, so the poll's own last read, or the return's re-read, can find PAID), the line shows in the visit they come back to and goes in the one after. |
| Stripe unavailable (Expo Go) | — (disabled CTA reason) | `Paying in the app needs the installed Frapp build — Expo Go can't open the payment sheet. Your treasurer can still take payment another way.` |
| Stripe unavailable (web) | — (disabled CTA reason) | `Paying dues is available in the Frapp mobile app.` |
| Installed build, Stripe module failed to load | — (disabled CTA reason) | `Card payments couldn't start in this version of the app. Updating the app may fix it. Your treasurer can still take payment another way.` Only while a publishable key is set: a broken module with no key gets the no-key row, because an update can't switch payment on. |
| No publishable key | — (disabled CTA reason) | `Card payments aren't switched on for this build yet. Ask your treasurer how to pay this invoice.` |
| Trust footer | — | `Payments run through your chapter's Stripe account.` |

The due chip says **`Past due <date>`**, not `Overdue`: `OVERDUE` is the server's
flagged state and includes the chapter's `wf_dues_grace` window, which a member's
client cannot read (`GET /v1/invoices/overdue` is `billing:view`-only). §Status
labels reserves the backend's own labels for states the client can actually
confirm.

### Push availability (mobile, s16)

The reason Settings states on its push row, in place of the switch, when this build
can't push (`pushUnavailableReason()` in `apps/mobile/lib/notifications/push.ts`).
One sentence per cause, because each cause has a different remedy
([`../mobile/patterns.md`](../mobile/patterns.md#push-notifications) § Push
notifications). The s03 primer card never shows these: it isn't drawn when push
is unavailable ([#2299](https://github.com/pdcarlson/Frapp/issues/2299)).

| State | Title | Description |
|---|---|---|
| Expo Go | `Unavailable` (row value) | `Notifications need the installed Frapp build — Expo Go can't receive them. You'll still see everything here in the app.` |
| Web | `Unavailable` (row value) | `Notifications come to the phone app, not the web. You'll still see everything here.` |
| Installed build, module failed to load | `Unavailable` (row value) | `Notifications couldn't start in this version of the app. Updating the app may fix it. You'll still see everything here in the app.` |
| No EAS project id | `Unavailable` (row value) | `Notifications aren't switched on for this build yet. You'll still see everything here in the app.` |

### Notification preferences (mobile, s16)

The status footnote under Settings' notification switches (`notificationsMeta` in
`apps/mobile/app/(tabs)/preferences.tsx`). It shows the first row that applies,
in this order, so a write in flight reads as saving even while the first read is
still out. Once synced it shows nothing: the steady state needs no line.

| State | Title | Description |
|---|---|---|
| Reading this device's copy | — | `Loading your saved preferences…` |
| This device's copy was unreadable | — | `Saved preferences were unreadable and have been reset to defaults.` |
| Signed out | — | `Saved on this device only. Sign in to change the settings on your account.` |
| No chapter | — | `Category switches sync once you choose a chapter.` |
| A read or write failed | — | `Couldn't reach the server. Change a setting again to retry.` |
| A write in flight | — | `Saving…` |
| A read in flight, nothing being written | — | `Loading your preferences…` |
| Synced | — | — (no footnote; it read `Synced with your account.` until 2026-11-05) |

**The read row borrows the web Quiet hours section's loading line** (`Profile (dashboard)` below), because it is the same `GET /v1/settings`. Until #2938 a read in flight said `Saving…`, while nothing was being saved.

### Report and block (mobile s05 / s13 / s16, web `/chat` and `/profile`)

Member-safety copy (#2257, #2313). The behavior each string describes is owned by
[`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Report and block.
Each string lives once, in the file named in its row's last column. Copy both clients
say lives in `packages/chat-core/src/block-copy.ts` (`block-copy` below); copy that
names a control only one client has lives with that client, under `apps/mobile/` or
`apps/web/`. Both clients offer Report, Block and Unblock (#2687); the report copy lives in
`packages/chat-core/src/report-copy.ts` (`report-copy` below).

| State | Title | Description | Home |
|---|---|---|---|
| Block confirmation | `Block <name>?` | `Their messages in this chapter's chat will be hidden from you. They won't be told, and they can still post where you both are. Poll votes still count, and they stay in the directory. You can unblock them anytime in Settings.` (web: `from your profile.`) · confirm `Block`. The directory clause appears only when the loaded roster lists them | `block-copy` (`blockConfirmTitle`, `blockConfirmBody`) |
| Unblock confirmation | `Unblock <name>?` | `Their messages in this chapter's chat will show again. They won't be told.` · confirm `Unblock` | `block-copy` (`unblockConfirmTitle`, `UNBLOCK_CONFIRM_BODY`) |
| Block failed | `Couldn't block <name>` | `Nothing changed. Check your connection and try again.` Also any 404 other than the one below (an alert on mobile, a toast on web) | `block-copy` (`blockFailedTitle`, `BLOCK_FAILURE_BODY`) |
| Unblock failed | `Couldn't unblock <name>` | `Nothing changed. Check your connection and try again.` (an alert on mobile, a toast on web) | `block-copy` (`unblockFailedTitle`, `BLOCK_FAILURE_BODY`) |
| Block refused, not a member | `Couldn't block <name>` | `This member is no longer in your chapter, so there's nothing to block.` Only for a 404 whose message is `Member not found` (`isMemberNotFound`) | `block-copy` (`BLOCK_NOT_A_MEMBER_BODY`) |
| Actions sheet, Report row | — | `Report message` · `Your chapter's officers will be able to see it.` | mobile `components/chat/message-actions-sheet.tsx` |
| Action bar More menu (web) | — | `More actions` (the button's name) · `Report message`; `Block <name>` (destructive) | web `components/chat/message-item.tsx`; the Block label is `block-copy` (`blockActionLabel`) on every surface |
| Report form | `Report message` | `Why are you reporting it?` · the reasons · `Details (optional)` · `Send report`. Mobile's field placeholder reads `Add details (optional)` | `report-copy` (`REPORT_FORM_TITLE`, `REPORT_FORM_PROMPT`, `REPORT_SEND_LABEL`, `REPORT_REASON_LABELS`); the details field's label is each client's own |
| Block / Unblock rows (message actions sheet and the directory's member sheet) | — | `Block <name>` · `Hides their messages from you in this chapter's chat. They aren't told.`; `Unblock <name>` · `Their messages in this chapter's chat show again.` (directory only) | mobile `lib/chat/block-actions.ts` (`BLOCK_ROW_DESCRIPTION`, `UNBLOCK_ROW_DESCRIPTION`) |
| Report sent | `Report sent` | `Your chapter's officers can see this report. The member you reported isn't told.` · then `Block <name>` where the sender can be blocked, and `Done` | `report-copy` (`REPORT_SENT_TITLE`, `REPORT_SENT_BODY`) |
| Already reported | `Already reported` | `You already reported this message, and that report is still open. Your chapter's officers can see it.` | `report-copy` (`REPORT_ALREADY_TITLE`, `REPORT_ALREADY_BODY`) |
| Report failed, form open | — | `Your report didn't send. Check your connection and try again.` — no response, a 5xx, or any status the next row doesn't list | `report-copy` (`reportFailureBody`) |
| Report refused (403 / 404 / 409), form open | — | `This message can't be reported anymore. It may have been deleted, or you may no longer have access to where it was posted.` | `report-copy` (`reportFailureBody`) |
| Report failed after the form was dismissed | `Couldn't send your report` | Whichever of the two bodies above applies (an alert; mobile only, since web's dialog stays open until the request answers) | `report-copy` (`REPORT_FAILED_TITLE`) |
| Tombstone | — | `Message from a member you blocked` · action `Unblock` | `block-copy` (`TOMBSTONE_TEXT`) |
| Tombstone, unblocked since | — | `Hidden while you had this member blocked` · action `Reload` only while the post-unblock re-read has failed (a spinner while it runs) | `block-copy` (`TOMBSTONE_STALE_TEXT`) |
| Tombstone Reload failed again | `Couldn't reload these messages` | `Check your connection and try again.` (an alert on mobile, a toast on web) | `block-copy` (`MASKED_RELOAD_FAILED_TITLE`, `MASKED_RELOAD_FAILED_BODY`) |
| Reply quoting a blocked member | — | The tombstone's own words, in place of the quote's author and preview | `block-copy`, chosen by `hiddenQuoteText` in `packages/chat-core/src/blocks.ts` |
| Reply quoting a held message | — | `Message hidden` | `block-copy` (`HELD_QUOTE_TEXT`) |
| Block list unavailable | `Couldn't load your block list` | `<N new messages are> held until it loads, so nothing from a member you blocked shows by mistake.` · action `Retry`, or `Retries when you're back online` in its place while the read waits for the network | `block-copy` (`blockListNotice`, `BLOCK_LIST_WAITING_FOR_NETWORK`) |
| Block list loading, rows held | `Checking your block list` | `<N new messages are> held until it loads.` | `block-copy` (`blockListNotice`) |
| Pinned panel, pins hidden (web) | — | A blocked member's pins: `<N> pinned message(s) is/are hidden by your block list.` Pins the list cannot vouch for yet: `<N> pinned message(s) is/are waiting on your block list.` Below any pins it may show, in place of "Nothing pinned yet" when every pin is hidden; the menu's Pinned count includes both | web `components/chat/pins-popover.tsx` (`hiddenPinsText`) |
| Jump to a held message (web) | — | `That message is waiting on your block list. It opens once the list loads.` · action `Dismiss`, in place of "Finding that message..." or any of the unreachable lines above (§ Chat (dashboard)) | web `components/chat/chat-shell.tsx` |
| Blocked members, list | `Blocked members` | `Blocks apply in this chapter only.` above the rows, each with `Unblock` | `block-copy` (`BLOCKED_MEMBERS_TITLE`, `BLOCKED_MEMBERS_SCOPE`) |
| Blocked members, empty (mobile) | `You haven't blocked anyone in this chapter` | `Block someone from a message or their profile in the directory. Their messages in this chapter's chat are hidden from you, and they aren't told.` | title `block-copy`; body mobile `components/settings/blocked-members-sheet.tsx` |
| Blocked members, empty (web) | `You haven't blocked anyone in this chapter` | `Block someone from a message's More menu in chat. Their messages in this chapter's chat are hidden from you, and they aren't told.` | title `block-copy`; body web `components/profile/blocked-members-card.tsx` (`BLOCKED_MEMBERS_EMPTY_BODY_WEB`) |
| Blocked members, first read failed | `Couldn't load your blocked members` | `Check your connection and try again. Your blocks haven't changed.` · action `Retry` | `block-copy` |
| Blocked members, first read waiting for the network | `Couldn't load your blocked members` | `You're offline. This list loads when you're back online. Your blocks haven't changed.` · no action | `block-copy` |
| Blocked members, refresh failed over a cached list | — | `Couldn't refresh this list. It may be missing a recent change.` above the cached rows · action `Retry`, or `Retries when you're back online` while the read waits for the network | `block-copy` |

**The report confirmation promises neither a reviewer nor a response time.** The API
files a report into a queue only `channels:manage` holders — the chapter's officers —
can read, and no screen renders that queue yet; "officers will review this" would
promise an action nobody is set up to take. "Can see" is the capability, which is true
in every channel type, DMs included. It does not say reports are anonymous: nothing on
this client can promise what an officer surface will show. The block copy names what a
block does *not* do (the blocked member is not told, can still post, still counts in
polls) because silence is the feature — a member who assumed the other person was
notified would be wrong in the one way that matters — and says "this chapter" because a
block is scoped to one chapter and a member can belong to several.

### Hide a conversation (mobile and web)

Hiding a 1:1 DM from your own list (#2303). The behavior is owned by
[`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Direct Messages.
Every string lives once, in `packages/hooks/src/hide-conversation.ts`, and both
clients import it from `@repo/hooks`.

| State | Title | Description | Where |
|---|---|---|---|
| The control | — | `Hide conversation`: a choice in a 1:1 DM row's long-press menu (since #2877; before it, the long press asked directly), and the row's accessibility action of the same name (mobile); a control on a 1:1 DM row in the rail, named `Hide conversation with <name>`, and a row in the open DM's `⋯` menu (web) | `HIDE_CONVERSATION_LABEL` |
| Confirmation | `Hide your conversation with <name>?` | `It leaves your list, and nothing in it is deleted. They aren't told. It comes back when there's something new in it, and you can open it from Hidden conversations anytime.` · confirm `Hide`. A native alert on mobile; on web, the shell's confirm dialog from the rail and the `⋯` menu's panel from the header | `hideConversationConfirmTitle`, `HIDE_CONVERSATION_CONFIRM_BODY` |
| Hidden group | `Hidden conversations (<n>)` | A collapsed group at the end of the list, on both clients; opening a row from it brings that DM back | `HIDDEN_CONVERSATIONS_LABEL` |
| Hide failed | `Couldn't hide the conversation` | `Nothing changed. Check your connection and try again.` A mobile alert; a toast on web, because a rail hide can fail for a DM that is not open | `HIDE_CONVERSATION_FAILED_TITLE`, `HIDE_CONVERSATION_FAILED_BODY` |

**The confirmation says what does not happen.** A member hiding a thread they are
uneasy about wants to know that nothing is destroyed and the other member is not
told, and it says the thread comes back so that nobody mistakes a hide for a block.
The confirm is not styled destructive, because nothing is destroyed. It names the
Hidden conversations group as the way back, not "message them": the group sits at the
end of the same list the member is hiding from, while messaging them means finding them
in the directory first. *(Corrected 2026-09-28, #2773: the reason given here was that the
mobile app had no way to start a DM, which stopped being true when its directory gained
Message.)*

### Arrange the channel list (mobile and web)

A member's pins, folds and filters on the channel list (#2877). The behavior is owned by
[`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Sidebar arrangement.
Every string both clients show lives once, in `packages/hooks/src/channel-sidebar.ts`,
and both import it from `@repo/hooks`. The filter note below is web's alone and lives in
`apps/web/components/chat/channel-list.tsx`.

| State | Title | Description | Where |
|---|---|---|---|
| Pin | — | `Pin to top`, and `Unpin from top` on a pinned row: a long-press choice and a named accessibility action (mobile); a control on the rail row, named `Pin to top: <title>`, and a row in the channel menu (web) | `PIN_TO_TOP_LABEL`, `UNPIN_FROM_TOP_LABEL` |
| Pinned section | `Pinned` | The section header above everything else | `PINNED_SECTION_LABEL` |
| Filters | — | `Unread only`, `Hide muted`: toggle chips above the list (mobile); two switches behind the Channels header's filter control, named `Filter channels`, or `Filter channels, filters on` while one is on (web) | `UNREAD_ONLY_LABEL`, `HIDE_MUTED_LABEL` |
| Filtered to nothing | — | `No channels match your filters.` with the action `Show all channels`, which turns both filters off | `NO_MATCHING_CHANNELS`, `SHOW_ALL_CHANNELS_LABEL` |
| Save failed | `Couldn't save your channel list` | `Nothing changed. Check your connection and try again.` A mobile alert; a toast on web | `SIDEBAR_SAVE_FAILED_TITLE`, `SIDEBAR_SAVE_FAILED_BODY` |

**"Pin to top", never a bare "Pin".** The channel menu already has a `Pinned` panel for
pinned *messages*, which the chapter shares. A pin on the channel list is the member's own,
and the longer name keeps the two apart where they sit side by side. The section keeps the
board's `PINNED` label, because in the list it has no neighbour to be confused with.

**The filter note says what a filter never hides.** Web's filter popover ends with
`Pinned channels, the open channel and anything that mentions you always show.`, so a
member who turns on Hide muted and still sees a muted channel knows why.

### Message actions (mobile s05, and web's delete confirmation)

Reply, Edit and Delete on a message (#2775). Who is offered which is owned by
[`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Edit and delete and
§ Reply threads. The delete confirmation is one wording for both clients, so it lives in
`packages/chat-core/src/message-actions.ts`; the rest name controls only mobile has.

| State | Title | Description | Home |
|---|---|---|---|
| Actions sheet rows | — | The quick row first, web's four reactions, each read `React with <emoji>`, or `Remove <emoji> reaction` for one the viewer already made; then `Reply` · `Edit message` · `Delete message` (destructive), above the Report and Block rows | mobile `components/chat/message-actions-sheet.tsx` (`quickReactionLabel`) |
| Add-reaction chip | — | `+` after a message's reactions, read `Add reaction`; it opens the actions sheet | mobile `components/chat/message-item.tsx` (`ADD_REACTION_A11Y_LABEL`) |
| Delete confirmation | `Delete this message?` | `This can't be undone. Everyone in the channel will see "[message deleted]" in its place.` · confirm `Delete message`. A native alert on mobile, the shell's confirm dialog on web | `message-actions` (`DELETE_MESSAGE_CONFIRM_TITLE`, `_BODY`, `_LABEL`) |
| Delete failed | `Couldn't delete message` | The reason chat-core classified from the response (an alert) | mobile `lib/chat/confirm-delete-message.ts` |
| Reply strip | `Replying to <name>` | One line of the parent, as its quote will show it. A parent the block list hides, or one not loaded: `Replying to a message` over the quote's placeholder. Cancel reads `Cancel reply` | mobile `lib/chat/use-composer-staging.ts`; the cancel label in `components/chat/chat-composer.tsx` (`composerCancelLabel`) |
| Edit strip | `Editing message` | — · cancel `Cancel edit`; the send control reads `Save edit` to a screen reader | mobile `lib/chat/use-composer-staging.ts`, `components/chat/chat-composer.tsx` (`composerCancelLabel`) |
| Edit left empty | — | `A message can't be empty. Delete it instead, or cancel the edit.` (the composer hint, error tone, shown while the text is empty, beside the greyed-out Save) | mobile `lib/chat/use-composer-staging.ts` (`EDIT_EMPTY_HINT`) |
| Edit failed | — | The reason chat-core classified, in the composer hint; the edit stays open with the member's text | mobile `lib/chat/use-composer-staging.ts` |
| Edited marker | — | `(edited)` after the message's last line, on every row, grouped or not, and not on a deleted message. On a card it goes on a line under the card. The behavior is [`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Edit and delete; the placement is [`components.md`](components.md) §11 § What rides the row | `@repo/chat-core/message-actions` (`EDITED_MARKER`, `showsEditedMarker`) |
| Link wouldn't open | `Couldn't open that link` | `Check the address in the message, or copy it into your browser.` (an alert) | mobile `lib/chat/open-link.ts` |
| Link, to a screen reader | — | `Open <link text>` as a named action on the message; a quote's jump reads `Go to the original message` | mobile `components/chat/message-markdown.tsx`, `components/chat/message-item.tsx` |

### Start a DM (mobile s13)

The directory member sheet's Message action (#2773). The behavior is owned by
[`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Direct Messages, and
who it is offered for by [`../mobile/screens.md`](../mobile/screens.md) s13. Web's member
sheet has its own Message button with older failure copy; bringing it onto these strings
through a shared module is #2791.

| State | Title | Description | Home |
|---|---|---|---|
| The control | — | `Message`: a row under the member's name, on another member's profile | mobile `components/directory/member-detail-sheet.tsx` |
| Start failed | `Couldn't message <name>` | `The conversation couldn't be opened. Check your connection and try again.` (an alert) | mobile `lib/directory/start-dm.ts` (`startDmFailedTitle`, `START_DM_FAILED_BODY`) |
| Block list loading, or a read in flight (a retry included) | — | `Message` · `Checking your block list first.` (disabled) | mobile `lib/directory/start-dm.ts` (`MESSAGE_CHECKING_BLOCK_LIST`) |
| Block list read failed, waiting for the network | — | `Message` · `Couldn't check your block list first. Retries when you're back online.` (disabled) | mobile `lib/directory/start-dm.ts` (`MESSAGE_BLOCK_LIST_UNCHECKED`), with `BLOCK_LIST_WAITING_FOR_NETWORK` from `block-copy` |
| Block list read failed | — | `Message` · `Couldn't check your block list first. Tap to try again.` Tapping re-reads the list; it starts no DM | mobile `lib/directory/start-dm.ts` (`MESSAGE_BLOCK_LIST_UNCHECKED`) |

**The waiting rows say why rather than removing the action.** The list re-reads itself
on reconnect and when the app returns to the foreground, but nothing polls it, so after a
server error while the member stays online and in the app, a vanished Message would give
no reason and no way back.

### Alumni (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading alumni directory...` |
| Empty | `No alumni yet` | `Graduated members appear here.` |
| No results (filters) | `No alumni match the filters` | `Clear a field to see more.` |
| No results (filters), mobile s13 | `No alumni match the filters` | `Clear a filter to see more.` The fields sit behind a chip named Filters there, so the line names that |
| Error | `Couldn't load alumni` | `Check your chapter access.` |
| Offline | `Alumni unavailable offline` | `Reconnect to load alumni records.` |
| No chapter selected | `No chapter selected` | `Pick a chapter to browse alumni.` |

Rewritten by the same lane and on the same rule as the Members table above; the reasoning is not repeated here. Two things specific to this half:

- **The no-chapter state changed shape, not just wording.** It was the one state on this route rendered as a bare `<Card>` with a title and a sentence rather than through the §10 state family, and on a page the lane left with no cards it would have been the only card on the screen. It is an `EmptyState` now, so its title names the condition (`No chapter selected`) rather than the screen (`Alumni directory`).
- **The error description dropped a true sentence on purpose.** "Alumni visibility respects the same permission checks as the member directory" is a fact about the API, offered to a member who is looking at a failure they cannot diagnose. `Check your chapter access.` is the half they can act on.

### Profile (dashboard)

| State | Title | Description |
|---|---|---|
| Loading | — | `Loading your profile...` |
| Error | `Couldn't load your profile` | `You're signed in, but Frapp couldn't be reached. Try again in a moment.` |
| Offline | `Your profile is unavailable offline` | `Reconnect to load your directory entry and notification preferences.` |
| Quiet hours section — loading | — | `Loading your preferences...` |
| Quiet hours section — error | `Couldn't load your preferences` | `Quiet hours couldn't be read, so saving them would overwrite what's stored. Retry in a moment.` |
| Quiet hours section — offline | `Quiet hours unavailable offline` | `Reconnect to load and change when notifications are silenced.` |

**There is deliberately no Empty row**, and saying so is the point of the line: the viewer always exists, so `/profile` has no empty branch to write. The Resources & Reporting slice's rule is about states that exist and were never written down, not a mandate to invent one — without this sentence the next reader "completes" the table with copy no code can reach.

The Quiet hours section (the Preferences card until 2026-11-05) is a **second query** on the same screen (`GET /v1/settings` beside `GET /v1/users/me`), which is why it has its own three rows rather than borrowing the screen's. It had no states at all until the Profile & pre-auth slice, so a failed fetch rendered empty fields beside a live Save button that then reported success.

### Sign in (pre-auth)

| State | Title | Description |
|---|---|---|
| Idle (mobile s01) | `Frapp` | `Everything your chapter needs is already in chat.` — s01's wordmark and tagline are the screen's heading and body, not decoration above one. Not the brand tagline "Ask your chapter anything." ([`../brand-identity.md`](../brand-identity.md) §1): Ask is off by default (`EXPO_PUBLIC_ASK_ENABLED`), and this is the first screen App Review opens, so leading with it would advertise a feature the binary does not have (Guidelines 2.1 and 2.3). The line is the landing's closing line, held there for the same reason (landing D8, [`../landing/README.md`](../landing/README.md)). Owner decision 2026-09-22, [#2298](https://github.com/pdcarlson/Frapp/issues/2298). It returns to mobile in the slice that ships Ask. |
| Idle (web `/sign-in`) | `Welcome back` | No subtitle: the `Sign in` / `Create account` toggle above the title (`apps/web/components/auth/auth-mode-toggle.tsx`) says which form this is, and the column has to fit a laptop screen without scrolling (Paul, 2026-11-05). The fields' labels, `Email` and `Password`, sit inside them and float up on focus or input, so there are no placeholders. The footer is `Have an invite?` `Join your chapter`. Until that compression the subtitle was `Sign in to your chapter.` and the footer also carried `New here?` `Create an account`. Since 2026-11-05 the web form sits in a split frame whose header carries the mark and wordmark (`apps/web/components/auth/auth-frame.tsx`), so the wordmark is chrome and the title is the form's own; Paul asked for the redesign. The brand tagline left with it: the frame's product panel shows the chat instead, and "Ask your chapter anything." waits for Ask like it does on mobile and the landing (D8). `scripts/ci/__tests__/frapp-naming.test.mjs` pins that no web pre-auth title is the bare wordmark. Until 2026-11-05 this row was `Frapp` over the tagline, moved from Signet by ADR-25 step 4 ([#2579](https://github.com/pdcarlson/Frapp/issues/2579)). |
| Submitting | — | The primary reads `Continue` throughout and disables; no separate copy. |
| Auth error | `Unable to sign in` | The Supabase message, verbatim. It is deliberately non-enumerating ("Invalid login credentials" whether or not the address exists), so passing it through leaks nothing and says more than a generic line would. |
| Email me a magic link instead (web) | — | A text link under Continue rather than a third full-width button (2026-11-05). After Continue in tab order, so Tab from the password never lands a keyboard user on it by accident. |
| Magic link sent | `Magic link sent` | `Check your inbox to continue signing in.` |
| Magic link, no email | `Email required` | `Enter your email address to request a magic link.` |
| Continue with Apple / Google | — | Button labels. Each carries the official brand mark at 20px (Apple silhouette in `currentColor`, Google four-color G) beside the label. Web: equal Secondary size, Apple first, side by side since 2026-11-05; half the column cannot hold the full label, so each shows `Apple` or `Google` and keeps `Continue with Apple` / `Continue with Google` as its accessible name. Mobile s01 (#3349): the phone's own account leads as the one filled button (Apple on iOS with Google beside it, Google elsewhere), and off iOS Apple sits behind `Other ways to sign in`. The board's equal-size, Apple-first pair is superseded on mobile, not drift. |
| Continue with email (mobile s01) | — | Button label that opens the email form (password or magic link), titled `Sign in with email`, with a `‹ Back` row to the providers (#3349). |
| Identity collision | `Unable to sign in` | `An account with this email already exists. Sign in with your password or a magic link. Google or Apple can attach to that same account on later visits.` Mobile s01, where the form sits behind a button (#3349): `An account with this email already exists. Tap Continue with email and sign in with your password or a magic link. Google or Apple can attach to that same account on later visits.` |
| Provider not enabled | `Unable to sign in` | `This sign-in method isn't available yet. Use your password or a magic link.` Mobile s01: `This sign-in method isn't available yet. Tap Continue with email to use your password or a magic link.` |
| Membership hint | — | `Invited at a university address? Open that link after you sign in. Membership follows this account, including Apple Hide My Email.` On mobile s01 it sits under the buttons whenever a Continue with Apple button is showing (always on iOS; off iOS once `Other ways to sign in` is opened). On web it sits under the providers on both forms at caption size (2026-11-05): invite links land on sign-in, and Continue with Apple there can create the Hide My Email account it is about. |

### Sign up (pre-auth)

| State | Title | Description |
|---|---|---|
| Idle | `Create your account` | No subtitle, for sign-in's reasons: the toggle above the title says which form this is, and the labels sit inside the fields. Until 2026-11-05 the subtitle was `One account, then join your chapter or start one.` and the footer read `Already have an account?` `Sign in`; the toggle replaced both. Sign-up has no footer: sign-in's `Join your chapter` link would drop the `redirectTo` an invited member arrives with. |
| Created, session issued | `Account created` | `You are signed in and ready to continue.` |
| Created, confirmation required | `Check your inbox` | `Confirm your email to finish setting up your account.` |
| Error | `Unable to create account` | The Supabase message, verbatim, for the reason above. |

### Join chapter (pre-auth)

| State | Title | Description |
|---|---|---|
| Idle | `Join your chapter` | `Enter the invite your officer sent. Invites expire after 24 hours and work once.` |
| Invite-link hint | — | `Got an invite link? Paste it here, or open it and this page fills itself in.` |
| Unparseable paste | — | `Paste the invite your officer sent, or open the invite link.` |
| Create a chapter (secondary) | — | `Starting a chapter?` + `Create a chapter` (returns to `/chat`, which remounts the first-officer wizard). |
| Checking the session | — | `Verifying your session…` (announced, not drawn) |
| Session check failed, offline | `Can't check your session` | `Reconnect to confirm you're signed in, then redeem the invite.` |
| Session check failed, error | `Couldn't check your session` | `Frapp couldn't be reached to confirm you're signed in. Try again in a moment.` |
| Redeemed | `Chapter joined` | `You're in. Opening chat.` Mobile goes to s03, `You're in.` over `<chapter> · <school>`, with one pinned `Go to chat`, which spins under the same label while it runs. |
| Mobile s02, the question (#3350) | `How are you getting in?` | No line under the title: the two answers say it. The rows above are web `/join`'s, except Unparseable paste, which mobile shares word for word; mobile s02 asks this first and offers two answers instead of a field. |
| Mobile s02 answers | — | `I have an invite` + `Use the link your officer sent.`, then `I'm starting our chapter` + `Set it up, then invite everyone.` |
| Mobile s02 invite step | `Join with an invite` | `Paste the invite link or code your officer sent. Invites work once and expire after 24 hours.` The membership hint ([§ Sign in (pre-auth)](#sign-in-pre-auth)) sits under the field, and the pinned button is `Continue`, which opens the confirm step. |
| Mobile s02 confirm step (#3352) | `Join <chapter name>?` | One card: the chapter mark, the chapter name over its school, then `Invited by <name>` (left out when the inviter can't be read) and `Joining as <role>` (left out when joining would grant no role). Then the Terms checkbox when it's needed, and the pinned `Join chapter`. An opened invite link lands here. While the preview loads, or when it can't be read, the title is `Join with this invite?` over a card reading `Chapter invite` and `Ending in <last four> · Works once`, and Join still works. A dead invite, found by the preview or by the redeem, shows the **410** row below, hides the Terms checkbox and disables `Join chapter`. |
| Mobile s02 Account menu | — | `Account` in the top corner opens `Signed in as <email>` (`Your account` when the session has no email), `Sign out` and `Delete account` (`Deleting account…` while it runs). |
| **410** — expired, used, or missing | — | `This invite has expired or already been used. Ask an officer for a new one.` |
| **409** — already a member | — | `You're already a member of this chapter. Open it from your chapter list.` |
| Terms checkbox (#2302) | — | `I'm 18 or older and agree to the Terms of Service and Privacy Policy.` Shown unless the server says this user already accepted the current Terms. The wording is `LEGAL_ACCEPTANCE_LABEL` in `@repo/validation`, owner-approved with the September 2026 Terms, and shared by every acceptance surface. |
| Join without the box ticked, or a **403** Terms refusal | — | `Agree to the Terms of Service and Privacy Policy to join.` (`JOIN_TERMS_REQUIRED_COPY`). The refusal is recognised by its code, `legal.acceptance_required`, or failing that by its message; it also puts the checkbox back. |
| **410** — the account itself was deleted, its session not yet ended | — | `This account has been deleted, so it can't join a chapter.` Told apart from the invite 410s by its message, `ACCOUNT_DELETED_MESSAGE`, since a new invite wouldn't help. It names no control because web `/join` has no sign-out. |
| Any other failure | — | The server's message, else `Couldn't join that chapter. Check the invite and try again.` |

The two status rows are the reason this table exists. Both are routine, both were rendering one generic toast, and they need **opposite** next actions — one says fetch a new invite, the other says you already have what you came for. `spec/behavior/onboarding.md` §Invite Token Rules fixes the codes; both apps render the failure rows (410, 409, the deleted account, the fallback, and a server's Terms refusal) through one function, `joinErrorCopy` in [`packages/hooks/src/join-errors.ts`](../../../packages/hooks/src/join-errors.ts), and this table is where the strings are specified. The rest of the Terms rows are not in it: their strings live in `@repo/validation` (`LEGAL_ACCEPTANCE_LABEL`, `JOIN_TERMS_REQUIRED_COPY`), and when to show the checkbox, and the unticked-box message before anything is sent, in `useJoinTermsCheckbox` (`@repo/hooks`), #2302.

410 covers three distinct server messages (`Invite not found` / `Invite already used` / `Invite expired`). They collapse to one string on purpose: a member cannot act on the difference, and naming which one it was would tell an unauthenticated caller whether a token exists.

### Terms prompt (mobile and web)

A member who hasn't accepted the Terms version the server enforces (#2302): mobile's `(auth)/terms.tsx`, and web's full-screen `TermsPrompt` over the dashboard. Both render `TERMS_PROMPT_COPY` from `@repo/validation`, so the strings exist once in code; this table is where they are specified.

| State | Title | Description |
|---|---|---|
| Idle | `Agree to the Terms to continue` | `We've updated the Terms of Service and Privacy Policy. Read them, then agree to keep using Frapp.` It says "updated" for a member who never accepted, too: the Terms did change, and the prompt doesn't have to know which member is which. |
| Checkbox | — | `I'm 18 or older and agree to the Terms of Service and Privacy Policy.` (the Join chapter row above) |
| Primary | — | `Agree and continue` |
| Tapped without the box ticked | — | `Agree to the Terms of Service and Privacy Policy to continue.` |
| **410** — the account was deleted | — | `This account has been deleted. Sign out to continue.` |
| Any other failure | — | `Couldn't save your agreement. Check your connection and try again.` |
| Ways out | — | `Sign out` and `Delete account` on both: the prompt keeps a member from Settings on mobile and covers `/profile` on web, where deletion otherwise lives (Apple 5.1.1(v); `spec/behavior/data-retention.md`). Web's button reads `Delete account…` and uses `/profile`'s confirmation. |
| Deletion didn't finish (web) | — | `Deletion didn't finish. Part of it may already have gone through, and running it again is safe. Try once more in a moment.` `/profile`'s toast, from the same `DELETE_ACCOUNT_FAILED`, as one inline line because the prompt covers the page. |
| Sign-out threw (web) | — | `Couldn't sign out. Retry in a moment, or close this tab to end the session.` Rare: only a thrown failure reaches it. auth-js returns most sign-out failures as `{ error }` rather than throwing, and `signOutCurrentSession` ignores that, so those navigate to /sign-in as if they had worked, sometimes with the local session still stored ([#2610](https://github.com/pdcarlson/Frapp/issues/2610)). The controls come back so the member can retry, and stay locked while a successful sign-out navigates away. |

### Update required (mobile, global)

The minimum-version gate (#2526, [`../mobile/patterns.md`](../mobile/patterns.md) § Minimum version): a full-screen prompt over the whole app when the API says this build is below the minimum. It names Frapp rather than a store because the link may be the App Store, Google Play, or a TestFlight link during the beta. Implemented in `apps/mobile/components/client-policy-gate.tsx` (`UPDATE_REQUIRED_COPY`).

| State | Title | Description |
|---|---|---|
| Below the minimum | `This version of Frapp is out of date` | `It's no longer supported. Update to the latest version to keep using Frapp.` |
| Primary | — | `Update Frapp` |
| No usable link | — | `Open your app store and update Frapp from there.` in place of the button |
| The link didn't open | — | `Couldn't open the update link. Open your app store and update Frapp from there.` |

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
| Have an invite | — | `I have an invite` (find-step secondary; opens `/join`) |

### Chapter setup (mobile)

Mobile's first-officer setup, `(auth)/create-chapter.tsx` (#3351). Titles are `SETUP_TITLES` and `liveTitle` in that file. `<name>` is the chapter's short name, else its name.

| State | Title | Description |
|---|---|---|
| Find | `Find your chapter` | No line under the title. Field placeholder `Organization or school`. A result reads `<letters> · <organization>`, without the letters for an organization that doesn't display them. |
| Find, no match | — | `No match for "<query>". Add your chapter by hand below.` |
| Find, directory error | — | `We couldn't reach the directory.` with `Retry` |
| Find, by hand | — | `Not in our directory?` + `New colony or a smaller group. Add it by hand.` |
| Confirm, a match | `Is this your chapter?` | The match as a card. `Edit details` / `Hide details` opens the fields. |
| Confirm, by hand | `Tell us about your chapter` | No line under the title. `More details (optional)` / `Hide more details` opens the rest. |
| Confirm, archetype | — | `What kind of organization?`, asked only by hand or when the match's kind is unknown, with nothing preselected. |
| Letters switch | — | `Show Greek letters` + `Turn off if your organization doesn't display its letters. Your short name or logo stands in for them.` For an organization that hides its letters, neither the switch nor the letters field is drawn; in their place: `<organization> doesn't display its Greek letters, so your short name stands in for them.` |
| Color | `Pick your color` | `Your color tints buttons, badges and your chapter mark. You can change it later in Settings.` Then the Terms checkbox (the Join chapter row) and `Create <name>`. |
| Create failed | — | The server's message, else `Couldn't create that chapter. Check the details and try again.` |
| Live | `<name> is live` | `Your channels are ready. Invite your members next.` Then the seeded public channels, each marked `ready`. |
| Live, chapter not made active | `<name> is live` | `Your chapter is ready. Open chat to see its channels and invite your members.` No channel list, no invite step: both act on the active chapter. |
| Live, logo | — | `Add your chapter's logo` (`Change logo` once set) + `Optional. A logo stands in for your letter mark everywhere.` A refusal shows `uploadFailureReason`'s sentence, or `Logos can be JPEG, PNG, GIF or WebP.` / `Logos can be up to <limit>.` When the new chapter couldn't be made active: `You can add a logo later from the web dashboard's Settings.` |
| Primer | `Stay in the loop` | No line under the title; the push primer card says it. Only when this build can push. |
| Invite | `Invite your chapter` | `Send each person their own link. A link lets one person in and lasts 24 hours.` No link is ever drawn: a card reads `A new link for each person` over `<host>, good for 24 hours`. The gold primary is `Share invite` with the platform's share mark; each press shares a fresh link under the line `Join <name> on Frapp` (owner pick 2026-11-06, "Share first"). Links shared list under a `Shared` caption, newest first, as `Link <n>` with `Not used yet` or `Joined`. Leaving is the quiet line under the primary: `Skip for now`, then `Go to chat` once a link has gone out. |
| Invite failed | — | The server's message, else `Couldn't create an invite. You can invite members from the web dashboard.` When the share sheet won't open: `Couldn't open the share sheet. Try again, or invite members from the web dashboard.` |

### Chapter picker (mobile)

`(auth)/chapter-picker.tsx`. When each error shows, and when a failed select leaves instead, is [`screens.md`'s supporting-routes paragraph](../mobile/screens.md)'s.

| State | Title | Description |
|---|---|---|
| Idle | `Choose your chapter` | No line under the title: the list says it. The open chapter's row is marked `Current`. |
| Switch failed | — | `Could not switch chapters. Check your connection and try again.` |
| Switch refused (403, no longer a member) | — | `You can't open that chapter because you're no longer a member of it. Pick another chapter.` A retry can't succeed, so it names another chapter as the way on, not the connection. |

### App error boundary (`global-error`)

| State | Title | Description |
|---|---|---|
| Unrecoverable render error | `The dashboard hit an unrecoverable error` | `The page couldn't finish loading, and the error has been reported. Reloading usually clears it.` with `Reload the dashboard` |

This one replaces `Something went wrong` / `Try again`, which is §1's banned shape with none of §3's three parts — and it had shipped unstyled, since the boundary replaces the root layout and so loads neither the stylesheet nor the typeface unless it asks for them itself.

### Terminal pages (`not-found`, `error`)

The two full-page states the web greenfield added in lane 7
([#2147](https://github.com/pdcarlson/Frapp/issues/2147)), drawn from framework board option `1k`.
Both render through `apps/web/components/shared/crest-page.tsx`.

| State | Code | Title | Description | Actions |
|---|---|---|---|---|
| Route not found (`app/not-found.tsx`) | `404` | `Nothing lives here.` | `The link is old, or points at a chapter you're not in.` | `Back to chat` (primary, `/chat`) · `Go back` |
| Route error (`app/error.tsx`) | `500` | `Something broke on our side.` | `The error has been reported. Retrying usually clears it.` | `Retry` (primary) · `Back to chat` |

Three things about these rows, none of them free choices:

- **The 404's title and description are the board's own strings, transcribed.** They also happen to
  satisfy §3 — what failed, why, what next — so nothing had to be reconciled. The two causes the
  description names are the two that actually produce a 404 here: nothing in `apps/web` calls
  `notFound()`, so this renders for stale and mistyped URLs.
- **The 500's description is not the board's**, which gives only the title and "a Retry primary" for
  this variant. §3's other two parts are written here, in `global-error`'s voice above, because a
  reader still needs to know the failure was reported and what to do.
- **These are distinct rows, not one.** `global-error` above catches a failure in the root
  layout itself and must not depend on the component tree; `error` catches what reaches it and
  may. Their copy differs because their situations do: one says the page is gone, the other says
  retrying may work. Since [#2175](https://github.com/pdcarlson/Frapp/issues/2175), `app/error.tsx`
  is no longer the catch-all for everything below the root layout — the degraded-segment boundary
  below takes everything under the dashboard layout first, which leaves the 500 crest for the
  pre-auth routes and anything that outruns the inner boundary.

Neither page uses an em dash, per
[`../web-dashboard/README.md` § No em dashes in product copy](../web-dashboard/README.md#no-em-dashes-in-product-copy).

### Degraded segment (`(dashboard)/error.tsx`)

The fourth boundary, added by [#2175](https://github.com/pdcarlson/Frapp/issues/2175) once `#2145`'s
`next/dynamic` splits gave the dashboard a way to fail one region at a time. It renders
[components.md](components.md) §10's Error card, not `crest-page.tsx`: the shell above it is still
working, so this is a region that failed
rather than a page that is gone. All three rows are implemented by
[`apps/web/components/shared/segment-error.tsx`](../../../apps/web/components/shared/segment-error.tsx),
which the route boundary and the chapter wizard gate's own boundary both render.

| State | Title | Description | Action |
|---|---|---|---|
| Segment render error | `Couldn't load this page` | `The error has been reported. Retrying usually clears it.` | `Retry` |
| Stale chunk (`ChunkLoadError`) | `Couldn't load this page` | `This usually means a new version shipped while the tab was open. Reload to pick it up.` | `Reload` |
| Stale chunk, **offline** | `Couldn't load this page` | `You're offline, so part of this page couldn't load. Retry once you're back.` | `Retry` |

The wizard gate's boundary renders the same component with one substitution — the title becomes
`Couldn't open chapter setup`, because the page behind that dialog rendered fine and §3 asks the
title for what actually failed. The description and the action are the rows above, unchanged.

- **One title across the three rows, and a second only where the subject changes.** §3 asks the
  title for *what failed*, and from the member's side every row above failed identically: this part
  of the page did not load. What differs between them is the reason and the remedy, which are §3's
  other two parts. The wizard gate's substitution is not a fourth row — it is the same three rows on
  a surface where "this page" names the wrong thing.
- **The second row says `Reload` because only a reload clears the condition** — not because Retry
  cannot work. That stronger claim is wrong and was in the first draft of this section: `retry()`
  re-renders the segment, and the two splits the route boundary covers are opened by state the
  remount discards, so the page comes back without the lazy component rendering at all. What is true
  is narrower — `React.lazy` memoises the rejection for the life of the document, so the *control*
  that failed stays dead until the document is replaced. Retry restores the page around a broken
  button; Reload fixes it. Evidence in
  [`apps/web/lib/chunk-load-error.ts`](../../../apps/web/lib/chunk-load-error.ts).
- **The third row exists because `Reload` is actively harmful offline.** The same `ChunkLoadError`
  is raised for a chunk that was never fetched, and `apps/web` registers no service worker — so
  reloading cannot fetch the document and would replace a working, cache-backed dashboard with the
  browser's own offline page. It states the connection rather than a failure, which is the posture
  the "(global)" offline rows above take.
- **"usually" is load-bearing in the second description.** §3 wants the reason only *if known*, and a
  `ChunkLoadError` is typically a rotated build hash but can be a dropped connection. Naming the
  deploy as fact would be inventing one.
- **It borrows the route error's description for the first row** rather than writing a fifth variant
  of the same sentence, because the situation is the same one: reported, and worth retrying.

No row uses an em dash, for the reason the terminal pages above do not.

### Mobile render errors

The mobile app's three boundaries ([#3378](https://github.com/pdcarlson/Frapp/issues/3378)), all in
[`apps/mobile/components/route-error.tsx`](../../../apps/mobile/components/route-error.tsx). Both
rows render [components.md](components.md) §10's Error card, with its one button, centered in what
failed.

| State | Title | Description | Action |
|---|---|---|---|
| A tab screen failed (screen row) | `Couldn't load this screen` | `The error has been reported. Retrying usually clears it.` | `Retry`, with a `‹ Chat` back row above the card on a screen that hides the tab bar |
| The app failed: the root layout or the tab group's (app row) | `Something broke on our side.` | `The error has been reported. Retrying usually clears it.` | `Retry` |

- **The screen row is web's degraded segment, on a phone.** Each tab screen has its own boundary, so
  the tab bar and the other tabs still work and the title names the screen, as web's names the page.
  Where the screen hides the tab bar, the way out is a `‹ Chat` back row above the card, not a second
  action on it, because on iOS a member there would otherwise have only a Retry that keeps failing.
  Elsewhere the tab bar is the way out. Which screens get the row is
  [`../mobile/navigation.md` § Back rows](../mobile/navigation.md#back-rows)'s to say.
- **The app row is web's route error (`500`), on a phone.** It replaces a layout, so there is nothing
  left to go back to, and Retry, which mounts the layout again, is the only action.
- **Both borrow the route error's description**, for the reason the degraded segment does. Neither
  shows the error's own text, which can hold whatever the screen was rendering.

## 8. Mobile reliability labels

Use these exact labels for operational state pills:

- `Synced`
- `Pending`
- `Retry needed`
- `Cached`

Never replace these with alternate synonyms on one surface only. Message-level delivery indicators (sending / sent / failed) are specified in [resilience](../resilience/README.md).
