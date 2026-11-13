# Notifications

## Decoupled Architecture

The Notification service exposes two methods:

- `notifyUser(userId, chapterId, payload)` — sends to a specific user in that chapter.
- `notifyChapter(chapterId, payload)` — sends to all members of a chapter.

Other modules (Chat, Events, Study, Billing) call these methods without knowing about push tokens, Expo, or delivery mechanics.

## Delivery Flow

1. Resolve the payload's priority (absent means `NORMAL`).
2. **Unless the priority is URGENT**, and only for a category a member has a switch for (`NOTIFICATION_CATEGORIES` in `@repo/validation`), check the user's notification preferences for the payload's category. If disabled, skip — no push *and* no in-app row. A row for any other category is never read: no control is left to undo it. That covers `chat`, whose switch was dropped on 2026-11-06 in favour of per-channel and per-DM levels (**Per-Channel Mute** below), so a `chat` row an older build wrote cannot keep a member muted.
3. Check quiet hours. If active and priority is not URGENT, queue as badge-only (no sound/vibration).
4. Save notification to `notifications` table (in-app history). The row always carries that `chapter_id`. **History is active-chapter-only:** `GET /v1/notifications` and `PATCH /v1/notifications/{id}/read` resolve the chapter the same way every other member surface does (`ChapterGuard`, per [`multi-tenancy.md`](multi-tenancy.md)) and bind `chapter_id` on the select and the update. A member of two chapters does not see, or mark read, the other chapter's rows while one is active. Preferences remain the exception — they take `chapter_id` from the query or body and check membership in the service, because a member may edit another chapter's switches without switching into it.
5. Fetch the user's `push_tokens`.
6. Send push notification via Expo Push Service with the appropriate priority.
7. If Expo reports a token as permanently undeliverable (`DeviceNotRegistered`), remove it from `push_tokens`. This is classified from the *ticket* Expo returns at send time (`ExpoPushProvider.recordTickets`), not from polling delivery *receipts* — receipt polling is a separate, unimplemented enhancement. Every other Expo error (rate limit, oversized message, bad app credentials, transport failure) is transient or describes something other than this specific token, and does not prune it — pruning on those would unregister a device that is still valid.

**URGENT outranks the category preference** (#1041). A member cannot mute a chapter emergency — or the president's subscription-status alert — by switching its category off, and the exemption covers the in-app row as well as the push: suppressing the row would leave no trace of the broadcast anywhere, which is the same failure in a slower form. Step 2 is the only gate URGENT skips; it is otherwise delivered exactly like any other payload. Note the ordering is an implementation detail of *when the preference is read*, not of what is checked — `notifyUser` skips the lookup entirely for URGENT rather than reading it and discarding the result. `notifyChapter` does the same at roster scale: it never issues the batched preference read for an URGENT payload, so an emergency broadcast costs no preference query.

`notifyChapter` does **not** fan out `notifyUser`. It loads the roster once, then (unless URGENT) the category preference for the whole audience in chunked `in (user_id)` reads of 100 ids — the 414 bound measured in `apps/api/src/domain/utils/chunk-ids.ts` — pages each chunk under the #686 rule, evaluates quiet hours in memory against a similarly batched `user_settings` read, inserts in-app rows with `createMany` in the same 100-row chunks, and looks up `push_tokens` in those same id chunks for the users who got a row. Push itself stays per recipient, because each Expo payload must stamp that user's `notificationId`. Missing preference rows stay enabled, matching `notifyUser`. Failed preference, settings, insert, or token pages are isolated at chunk grain and logged as aggregate counts rather than swallowed; a rejected Expo send is counted the same way.

**How an in-app row is marked read** (#3788). A row is read once the member has seen what it is about, by any of these routes:

- **Opening the row.** Tapping it in the mobile inbox or the web drawer, or tapping its push, sends `PATCH /v1/notifications/{id}/read` (a push carries the row's id as `notificationId`).
- **Mark all read.** One `POST /v1/notifications/read` with no body reads every unread row the member has in the active chapter, rows past the 50 a client lists included (#3929). Until then each client sent the per-row `PATCH` once per row.
- **Reading its channel.** `POST /v1/channels/{id}/read` stamps the caller's receipt, then sets `read_at` on their unread rows in that chapter whose `data.target` is that chat channel and that were created at or before the receipt's instant. Hiding a 1:1 DM marks it read the same way and clears the same rows. A row created after the read is about a message it did not cover, so it stays unread. The clear is best-effort: if it fails, the receipt still succeeds and the row keeps its dot. Members mostly read chat by opening the channel rather than the row, so without this the inbox kept every chat push unread after the messages were seen.

- **Opening the screen it points at** (#3929). A non-chat row is read once the member opens the screen its `data.target.screen` names, on either client: the client sends `POST /v1/notifications/read` with `screens` (for example `["events"]`), and the API reads the member's unread rows in the chapter that point at one of them. Web maps a dashboard page to its screens (`apps/web/lib/notifications/seen-screens.ts`): Events, Tasks and Meetings (all three read `ai_suggestions`, #4313 and #3930), Activity (task rows: a submitted task's review opens there, 2026-11-13), Points, Billing, Service, Members, Chat Admin for `chat_reports` and Discord import for `discord_import`. Mobile maps its routes the same way (`apps/mobile/lib/notifications/seen-screens.ts`); `chat_reports` and `discord_import` have no mobile screen, so there they are read by a tap. The screen is the grain, not the item: opening Events reads every event notice, not only the one for the event on show. A client sends it only while the page or app is in front and its list shows an unread row for that screen, once per set of such rows, so the write budget is spent only when there is something to clear.

Both writes stamp `read_at` with the instant the request began and leave a row created after it unread. `read_at` lives on the server, so a read on one device is a read on the other: the update fires the `notif:<users.id>` ping below, and both clients refetch on it.

**Rows from before a fix are backfilled, not left** (#3929). Migration `20261109233000` read every chat row its member's read receipt already covered, and every chat row whose channel no longer exists (nothing is left to open). It was written when production showed the owner 20 unread rows he had seen: the API that clears on a channel read (#3788) was not yet the one production ran, and nothing had gone back over the rows from before it.

Both clients show a row read as soon as its `PATCH` is sent: `useNotifications` in `@repo/hooks` overlays every pending receipt on the list, so a refetch that lands before the write commits can't relight the dot, and a failed write simply stops overlaying it.

Push delivery is mobile-only (Expo); **web push is intentionally out of scope** for this phase. The web dashboard surfaces the in-app history instead: its notification drawer reads `GET /v1/notifications` (optional `limit`) — **active chapter only**, per step 4 — and subscribes to a **private Supabase Realtime broadcast** topic, `notif:<users.id>`, so new rows, and rows read elsewhere, appear without a manual refresh. Mobile joins the same topic app-wide (`apps/mobile/lib/notifications/use-notification-sync.ts`, #3929); before that it heard nothing, so a row read on web stayed unread on an open phone until the app next came to the foreground. Both build the topic from `@repo/chat-core/change-topics` and attach through `@repo/chat-core/topic-attach`. The ping carries `{table, op}` and **no row data** — it only tells the client to refetch, and the refetch goes through the API above, which stays the enforcing layer. It deliberately does *not* use `postgres_changes`: `notifications` is RLS-on with no policy, and the SELECT policy needed to make Postgres changes fire would equally expose the table to direct browser reads (see [`authorization-model.md`](../../docs/security/authorization-model.md) §4 and #867). Tapping a row deep-links via the payload `target` and marks it read with `PATCH /v1/notifications/{id}/read`.

### The in-app list

Both clients draw the same entries, from `groupNotificationsBySource` in `@repo/hooks/notification-rows` (#3948, 2026-11-13):

- **One entry per conversation.** A channel's chat rows (`data.target.channelId`) collapse into their newest, which the entry draws and opens, with how many messages it stands for under its preview ("14 messages"; a bundled burst counts its `data.count`). A thread's replies (`threadRootId`) are their own entry, since they open the thread. A row that mentions the viewer (`data.mentioned`) stands on its own, because it addresses them. Every other row is its own entry. An entry sits under Today or Earlier by its newest row, and is unread while any of its rows is. Slack's Activity, Discord's Inbox and GroupMe's chat list each show one line per conversation; until #3948 fourteen messages in `#general` were fourteen rows.
- **Opening an entry** reads its newest row (`PATCH .../read`) and opens the conversation, and reading the channel reads the rest (§ How an in-app row is marked read). No new request.
- **Unread / All.** All by default. Unread leaves read rows out before grouping, so an entry's count is what is still new there; with nothing unread the list says "You're all caught up." The choice lives while the list is mounted and is not stored.

The rows are still the first page `GET /v1/notifications` returns (50), as § Badge Count says.

**The unread count is the same number on both clients.** Web's bell and mobile's inbox both count the rows `GET /v1/notifications` returns with `read_at` null, so once a read reaches the server they agree. The app icon badge is a different number on purpose (§ Badge Count): it leaves chat rows out and adds chat mentions and direct messages from the channel counts.

## Deep Linking

Every notification payload includes a `target` object with screen and parameters:

```json
{
  "target": { "screen": "chat", "channelId": "uuid" },
  "notificationId": "uuid"
}
```

**That is the payload as sent, not an illustration.** `notifyUser` stamps
`notificationId` — the id of the `notifications` row it has just written — onto every
push (`apps/api/src/application/services/notification.service.ts`), which is what lets
a tap mark the row read without a lookup. The `target` itself carries **only** the keys
its emitter sets: `chat` sends `channelId`, plus `threadRootId` for a thread reply
(mobile opens that as the thread over its channel; web's drawer opens the channel,
[`chat/README.md`](./chat/README.md#messages), Message threads), `events` sends `eventId` (and `meetingId` for "Minutes posted", which web opens at `/meetings/<id>`; mobile opens the event until it shows minutes. "Meeting recording uploaded" sends the event alone: the minutes are still a draft its readers cannot open), `tasks` sends
`taskId`, plus `view: 'review'` on "submitted a task" to the officer who assigned it: both clients open that review in Activity (mobile `/activity?review=<taskId>`, web `/activity?review=<taskId>`, the task's sheet or panel up), because the task board lists only the reader's own tasks. Any other task push opens the reader's own task (mobile `/tasks?task=<taskId>`; web the board). A build from before 2026-11-13 reads only `screen` and opens the board. `billing` / `points` / `service` / `members` / `chat_reports` /
`discord_import` send a bare `screen`. `ai_suggestions` sends `batchId`, `sourceType`
and `sourceId`, for the review of suggested tasks (#4309, #4313): web opens the minutes they
came from (`/meetings/<sourceId>` when `sourceType` is `meeting`), where they are listed under
the action items, the Events page when `sourceType` is `event` (an event from this time last year, #3930), and otherwise the Tasks board's Suggested list; mobile opens its one Suggested list for all three
([`../ui/mobile/screens.md`](../ui/mobile/screens.md), Suggested; corrected 2026-11-12: it fell through to the notification list until #4415 built the list). `chat_reports` names the officer report queue
(the new-report notification, [`chat/README.md`](./chat/README.md#report)); web
resolves it to `/settings?tab=chat#reported-messages`, the queue at the foot of Chapter settings' Chat page (#3837), and mobile, which has no queue, falls through to the
notification list like any screen it does not route. `discord_import` is the notice
that a Discord import finished or stopped on an error, sent to the admin who set it up
([`chat/README.md`](./chat/README.md#imported-archive-messages)); web resolves it to
`/settings?tab=chat&tool=discord-import` (#3837), and mobile, which has no import page, falls through the same way. Every chat row and push also carries `senderId`, the sending member's
`users.id`, which the in-app list uses to withhold a blocked member's rows
([`chat/README.md`](./chat/README.md#what-a-block-does-and-does-not-hide), #2715). A
bundled chat burst adds `bundled: true` and `count` (`chat-push-worker.service.ts`
`buildPayload`). A single-message chat **push** (not a bundle) also carries
`messageId`, the `chat_messages.id` it quotes, at the top level of its data beside
`notificationId`, never inside `target`, so a phone can take the push out of its tray
when the message is deleted (#4418). The in-app row records the same id in its
`chat_message_id` column instead, not in `data`, so the list's rows carry none; a
client deep-links from `target` alone.

Since #4346 every chat row also says what the in-app list draws it by, so no client
parses a title: `chatKind` (`dm`, `group`, `announcement` or `channel`, the
announcement test being the push's own), `channelName` when the channel has a name a
member would recognize (never a DM's or an unnamed group DM's internal name), and
`mentioned: true` when the recipient is in the message's `chat_messages.mentions`:
named, holding a role it named, or the author of the message it replies to (#3844),
the same test chat's own mention highlight uses. Rows written before #4346 have none of
the three. The member-joined row (`invite.service.ts`) carries `memberUserId`, the
`users.id` of who joined; it is deliberately not `senderId`, which means a chat sender
and drives the block filter.

Tapping the notification opens the app directly to the relevant content. If the user is not authenticated, the app shows the login screen first, then navigates to the target after authentication.

On mobile both halves of that live in `apps/mobile/lib/notifications/`: `targets.ts`
resolves a payload to a route — and is the same resolver the in-app history (s14) uses
for its rows, so an in-app tap and a push tap cannot name different screens — while
`use-push-runtime.ts` **holds** a cold-start target until the member is authenticated
*with a chapter*, and drops it if they sign out first (navigating a signed-out member
into a chapter-scoped screen only produces a 400). An unrecognized screen, or one
missing its required param, falls back to the notification list rather than guessing.
Client-side mechanics: [`../ui/mobile/patterns.md`](../ui/mobile/patterns.md) § Push
notifications.

## Priority Levels

| Priority | Behavior                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------- |
| URGENT   | Plays sound even during Do Not Disturb (the device's and Frapp's own, § Do Not Disturb) and quiet hours. Used for emergency announcements and critical billing alerts. |
| NORMAL   | Standard notification with sound and vibration (respects device settings).                            |
| SILENT   | Badge-only. No sound, no vibration. Used for low-priority updates (e.g. weekly digest).               |

## Quiet Hours

- Per-user configurable start and end time (e.g. 10:00 PM to 8:00 AM).
- During quiet hours, NORMAL notifications are delivered as badge-only (no sound/vibration). URGENT notifications are unaffected.
- Quiet hours are timezone-aware. `quiet_hours_tz` holds a zone identifier `Intl.DateTimeFormat` can resolve — normally an IANA name such as `America/New_York`. The implementation uses `Intl.DateTimeFormat` to convert the current UTC time to the user's timezone; midnight is normalized to hour 0 to handle locale-specific h24 hour cycles.
- **Fixed UTC offsets are rejected** (#2361). `-05:00`, `+0530`, `+05` and every other value opening with a sign and a digit fails validation with `400`, on every runtime. The check is a pattern, not an `Intl` probe, because whether `Intl` resolves an offset depends on the runtime's ICU (Node 20 rejects them, Node 22+ accepts them), so a probe would let the verdict move with the next Node bump and let a client on a different ICU disagree with the server. An offset also observes no DST, so it would put a member's quiet window an hour out for most of the year. This is a write-path rule. A stored offset still reads, and delivery evaluates it in whatever zone the runtime resolves it to, degrading to UTC where it cannot. Mobile would replay a stored offset into its next quiet-hours `PATCH`, so it repairs one to the device's zone first, as it does a blank zone. If the device itself reports an offset as its zone, mobile uses its fixed default zone instead. At the decision (2026-09-30), production and staging held no `user_settings` rows at all, so no stored offset exists (count recorded on #2361). DST-free zone *names* stay accepted: "IANA" alone does not imply DST-aware, and `UTC`, `EST` and `Etc/GMT+5` are all IANA identifiers with no DST rules. Narrowing this to DST-aware zones needs a backfill and a zone picker, tracked separately.
- `GET /v1/settings` always answers with a full `UserSettingsDto`: `quiet_hours_start`, `quiet_hours_end`, `quiet_hours_tz`, `theme`, and the member-status fields (§ Do Not Disturb). `PATCH` answers with the same fields as saved. **A member who has never saved may have no `user_settings` row**: nothing writes one at sign-up or on joining a chapter. Since 2026-11-06 the API creates the row on a member's first request that reports a zone (`time_zone`, § What a push says), with every other column at its default, so a row existing does not mean the member saved anything. They get the column defaults, which are no window (so quiet hours are off) and `theme: 'system'`. The endpoint used to answer them with an empty body, which both clients rendered as a failed load (#2885). A failed read is still an error and is never answered with the defaults.
- `PATCH /v1/settings` accepts `quiet_hours_start`, `quiet_hours_end`, and `quiet_hours_tz` as nullable. Omitting a field preserves its existing value; sending `null` — **or an empty string** — clears it. Blank is a clear rather than a validation error on all three, so a blank field never fails the whole payload and takes the member's unrelated edits with it (the clients once bound these inputs to `""`; neither sends a blank now, and the rule stays for any client that does). String values are trimmed before validation and storage, so a padded zone cannot pass the check and then fail at delivery.
- **Enforcement is off only when the window is cleared.** Quiet hours are derived from `quiet_hours_start`/`quiet_hours_end`; clearing only `quiet_hours_tz` leaves the window in force and evaluated in UTC. To disable, clear the start and end times.
- **`quiet_hours_tz` is validated server-side.** A zone the server cannot resolve is rejected with `400`; clients are not trusted to check. The rule itself lives in `@repo/validation` (`isSupportedTimeZone`) and the API DTO enforces it. Since 2026-11-06 neither client takes a typed zone at all (below), so neither runs this check any more; what follows explains why a client would be the wrong judge anyway. When the clients did check, they were a courtesy, not a guarantee, and checked only what the member was typing. Two reasons the server is the only authority: `isSupportedTimeZone` fails open on a runtime whose `Intl` resolves no zones, and a client's tzdata can simply be older than the server's — an Android build that predates `Europe/Kyiv` will reject a zone the server accepts.
- **A client never re-judges what the server stored.** Neither client takes a typed zone (2026-11-06). Each uses the device's or browser's zone (`localTimeZone` in `@repo/validation`) for a member with none. When the zone in force is a different one, each says so and offers its own, replacing the stored zone only on that tap. A window stored with no zone is shown as UTC, because that is how the server evaluates it. A client's verdict on a stored zone can be a confident false negative (older tzdata), which is why it never checks one. Web leaves the zone out of a times-only save. Mobile repairs a stored zone only for device-independent defects: not a string, blank, over-length, or an offset.
- Consequences of that rule, both accepted: a legacy row holding a genuinely unresolvable zone round-trips to a `400` on the mobile toggle and surfaces as the retry state; and neither client will "fix" such a row on its own. A visible error on an already-broken row beats silently overwriting a correct one across every device.
- **An unresolvable stored zone degrades to UTC; it never blocks delivery.** Quiet-hour evaluation runs _before_ the notification row is written (step 3 of the delivery flow), so a `RangeError` out of `Intl.DateTimeFormat` would cost the member the push **and** the in-app row. `notifyUser` would surface that as a thrown delivery; `notifyChapter` evaluates the same helper in memory over batched settings and used to hide the throw behind `Promise.allSettled`. Rows written before the validation above can still carry such a zone, so delivery falls back to UTC and warns once per member and zone per process. A time-shifted quiet window is the accepted cost; losing the notification is not.

## Do Not Disturb

A member's status (#3845) is Online, Idle, Do Not Disturb or Invisible, plus an optional custom status line. Only Do Not Disturb changes delivery. Where each status shows, and what Invisible hides, is [`chat/README.md`](chat/README.md) § Online/offline presence (Member-set status), built on web and mobile (mobile sets the status and shows the member's own dot; other members' dots are #3917).

- **DND is quiet hours switched on now.** While it is on, every non-URGENT push, chat and every other category, is delivered SILENT: badge-only, no sound or vibration. The in-app row is still written and badges and unread counts still update. URGENT still rings. The check sits beside the quiet-hours one in `NotificationService`, once in `notifyUser` and once in the batched `notifyChapter` path, and the chat push worker delivers through `notifyUser`, so one rule covers every push. DND and quiet hours stack: either one silences.
- **DND covers all non-urgent pushes, not only chat** (Shawn's pick, 2026-11-09, shipped as the recommendation and pending Paul's review in the PR that built it). A member who says "don't disturb me" does not want an event reminder buzzing either. It sits on top of the per-channel and per-DM levels (§ Chat notification preferences) rather than replacing them: a message those levels already mute stays muted, and one they let through arrives silent.
- **Storage.** On the member's `user_settings` row, so it follows them across devices and account deletion clears it: `status` (`online`, `idle`, `dnd`, `invisible`; default `online`), `status_expires_at`, `custom_status` (one line, at most 80 characters) and `custom_status_expires_at`. A null end time means "until I change it". The clients offer DND for 1 hour, 8 hours, until tomorrow, or until turned off, and a custom line for 30 minutes, 1 hour, 4 hours, today (the default), or until cleared; Invisible has no end time (the design picked on #3845; both clients build it from `@repo/hooks/member-status`). The server takes any future instant and computes nothing from the member's clock. The client computes each end in the device's zone with local-calendar arithmetic, so a DST night doesn't move it: "today" ends at the next local midnight, and "until tomorrow" at the next 8:00 AM local, the hour the default quiet-hours window ends (§ Preference sync): tomorrow's, or this morning's when it is picked after midnight and before 8. It sends the instant in UTC (`Z`), which is an explicit offset.
- **An end time is read, not swept.** Nothing rewrites the row when a status or line runs out. `GET` and `PATCH /v1/settings`, and delivery, read a status past its end time as `online` and a line past its end time as none.
- **A save writes only what it names** (#3924). Every `PATCH /v1/settings` sends the database only the fields it carries; the rest stay as stored, so a save from one device cannot undo a change another device made while it was in flight (a status toggle cannot wipe a quiet-hours window, and a theme save cannot switch DND off). A member with no row yet gets one with the column defaults for everything not named.
- **`PATCH` rules.** A status and its end time are one choice: sending `status` replaces `status_expires_at` with the value sent alongside it, absent meaning none, so switching from "DND for 1 hour" to Invisible does not end Invisible an hour later. `online` never keeps an end time. `custom_status` and `custom_status_expires_at` pair the same way, and a null or blank line clears both. An end time sent without its partner, or one not in the future, is a `400`; a null or blank one sent alone asks for nothing and is ignored, so it never fails the save's other edits. `status: null` is a `400` rather than a silent no-op. The line is trimmed and must be a single line: no control characters and no Unicode line or paragraph separator. Its 80-character cap counts code points, as the column's `char_length` check does, so an emoji with a variation selector counts as two. End times must be an ISO 8601 instant with an explicit offset (`iso-instant.ts`), so no shape Postgres would read differently from the API, or refuse, gets through.

## Preference sync

Both surfaces, since #564 gave web the category grid. Renamed from "Mobile preference sync", which stopped being true when web adopted the catalog — the bullets below were already mostly cross-surface, and the per-surface differences are called out where they exist.

- **The query cache is the source of truth.** `useUpdateNotificationPreference` and `useUpdateUserSettings` (`@repo/hooks`) write optimistically, roll back on error, and invalidate once settled, so every later server payload — a refetch that normalized what was sent, a change made on another device, a chapter switch — reaches the screen. The mobile hook derives its state from `useUserSettings` / `useNotificationPreferences` and keeps no copy of its own. Before #312 it held local state latched to the first successful payload, and everything after that was dropped until a cold remount.
- A failed `PATCH` therefore **reverts** the switch rather than leaving it on the value the server refused, and the sync indicator reads `retry`. Changing the setting again is the retry.
- The mobile screen (`apps/mobile/app/(app)/preferences.tsx`) still hydrates from AsyncStorage first, for offline and pre-auth reads — that cache is what the screen shows when there is no server answer yet, never a competitor to one. With nothing stored, the screen shows quiet hours **off**, the server's own default for a member who never saved (#2938). Separately, while a read is in flight and nothing is being written, the footnote says the preferences are loading rather than "Saving…", and the quiet-hour times can't be edited until the settings read answers, since an edit then would be overwritten by the window it returns. It stores the effective state under `frapp.mobile.notification-preferences`; keys nothing reads are stripped on write, and the pre-catalog `eventRemindersEnabled` toggle migrates to the `events` category rather than being discarded (`dmAlertsEnabled`, which migrated to `chat`, is stripped since `chat` left the catalog).
- **The member-facing categories are a shared catalog**, `NOTIFICATION_CATEGORIES` in `@repo/validation` — `events`, `points`, `billing`, `tasks`, `service`, `members`. `chat` was a switch until 2026-11-06: a switch that silenced every chat push at once, DMs and mentions included. Chat is tuned per channel and per DM instead (**Per-Channel Mute**), where the noise is, and the server stops reading `chat` rows (Delivery Flow step 2). The mobile cache's pre-catalog `dmAlertsEnabled` toggle, which migrated to `chat`, is now stripped like any other key nothing reads. Shared because each key is written verbatim into `notification_preferences.category`, which nothing validates: the column is unconstrained `text` and the DTO only length-limits it, so a per-surface copy drifts into preference rows the server never reads. **Both surfaces draw from it**: mobile's s16 grid and web's Settings → Chapter alerts section (#564; on `/profile` until #3856). The **fold** from server rows onto those keys is shared for the same reason — `rowsToNotificationCategoryState`, beside the catalog — since a per-surface copy is how two screens come to disagree about what a member's switches say. It returns a complete state rather than a patch (an absent row is enabled, matching `notifyUser`) and drops rows for categories outside the catalog, which is what keeps a stale `announcements` row from widening a grid past the switches it draws.
- **Someone joins the chapter (`members`, #4008) is the one switch only some members see.** It governs "<Name> joined", and a member is shown it only when they would be sent that push: the catalog row's `audience` is `MEMBER_JOINED_AUDIENCE` (`@repo/validation`), the same list `InviteService` pushes to, and `shownNotificationCategories(permissions)` draws the row only for a member whose permissions satisfy it (the wildcard always does). With no permissions yet, while they load, the row is not drawn. It defaults on like every category; off means no push and no in-app row (Delivery Flow step 2). It is one narrow switch rather than a wider "Chapter admin" category on purpose: the other Admin pushes stay on the unswitchable `admin` key. Chat reports must not be silenced by accident, the Discord import notice answers a job the admin started themselves, and invite accepted and role change send no push (the first is a system line in the inviter's DM). Slack, Discord and GroupMe all let join notices be muted on their own, apart from moderation alerts.
- **`announcements` is still not a member switch, for a new reason.** The original blocker was gate ordering — the preference was checked before priority, so the switch would have muted URGENT chapter announcements and their in-app rows. That is fixed (#1041): URGENT now bypasses the gate. What blocks the switch now is that the category has no non-URGENT traffic to govern: its only emitter, the chat push worker, sends everything it treats as an announcement URGENT (see **Chat notification preferences** below). So a preference row would suppress nothing, which is the dead-control failure the shared catalog exists to prevent. It ships once routine announcements are distinguishable from emergency ones, which is also what resolves the contradiction between the URGENT row in **Priority Levels** ("emergency announcements") and the Announcements row in the trigger table ("New announcement posted"). Tracked in #1323.
- A category with **no stored row is enabled** — that is what `notifyUser` does with an absent row, and no migration seeds rows — so the catalog's `defaultEnabled` describes the server's behaviour rather than setting a policy of its own.
- **The two surfaces differ on offline, deliberately.** Mobile has the AsyncStorage cache above and a `pending`/`retry` sync indicator, so it can accept a toggle and show that it has not landed yet. Web has neither a mutation persister nor an outbox, and since #1754 the query client sets `networkMode: "always"` — so an offline toggle no longer parks indefinitely; it starts, exhausts `retry: 2` and rejects in about three seconds. What that leaves is not silent loss but a switch that moves, sits wrong for three seconds, and snaps back under an error toast. On a control whose position *is* the state, that is still the wrong answer, so web **refuses** the write while `OFFLINE` and toasts why — immediately, and without ever showing a value the server was never told about. It refuses with `aria-disabled` rather than the `disabled` attribute: `switch.tsx` scopes every state colour to `enabled:`, so a genuinely disabled switch loses its on/off appearance entirely and drops out of the tab order — and *reading* which categories are muted is the more common offline need. The offline note says only that changes cannot be made; it deliberately does **not** claim the displayed state is what the server holds, because a toggle fired just before the connection dropped is mid-retry and will reject shortly. **Refusing is not made redundant by #1754**, which is the correction #1707 actually received: it made queueless writes *fail* rather than hang, which is a different thing from queueing them. Disabling such controls up front, dashboard-wide, is **#1753** — this card is that behaviour on one surface, early. Only a real outbox for dashboard writes would make refusing unnecessary here, and none is planned.
- Notification preferences are chapter-scoped per the multi-tenancy invariant: reading (`GET /v1/notifications/preferences`) or writing (`PATCH /v1/notifications/preferences`) preferences for a `chapter_id` the caller is not an active member of returns `403 Forbidden`. The chapter here is supplied by the request (query/body), so membership is verified explicitly in the service rather than relying on the resolved active chapter. **Quiet hours are not chapter-scoped**: `user_settings` is unique on `user_id`, so one window governs every chapter a member belongs to.
- **Quiet hours on both surfaces is a switch, and the times show only while it is on** (owner, 2026-11-06). Mobile s16 draws them as two rows, From and To, each opening the platform's own time picker (`@react-native-community/datetimepicker`: the compact iOS picker, the Android clock dialog), so nothing is typed. The iOS wheel's change is saved once it has rested for 700 ms, because it reports every position it passes and a burst of `PATCH`es has no guaranteed order. Web's Settings → Notifications draws the switch, then `type="time"` inputs with a Save button while on. On both, the zone is not a field (previous bullet). `HH:mm:ss` values returned by Postgres `time` columns are normalized to `HH:mm` for display and for writes. That normalization is load-bearing in one direction: the API's own DTO regex rejects fractional seconds, which a Postgres `time` can carry, so a raw server value forwarded into a `PATCH` would `400`.
- Quiet-hours toggle OFF `PATCH`es `null` for all three quiet-hour fields. Because "enabled" is _derived_ from a window being stored, disabling necessarily clears the member's times server-side, so each client remembers the last window it saw stored. Mobile keeps it under the `frapp.mobile.quiet-hours-window` AsyncStorage key, so it survives an app restart. Web keeps it for the life of the page, and a fresh load falls back to the defaults below.
- Quiet-hours toggle ON restores that window rather than overwriting it. The window is resolved in priority order: (1) the window the server currently reports, which is authoritative and covers a window set on another device; (2) the remembered window; (3) only for a member who has never had a window, the 22:00/08:00 defaults with the device's or browser's zone.
- While quiet hours are off, neither client shows the times, so there is no edit to make that could write a window and silently switch enforcement back on. (Until 2026-11-06 mobile showed them while off and kept such edits in the remembered window only.)
- When no auth token is present, all toggles persist locally only and sync state surfaces as "cached" so the UI doesn't claim server enforcement. The same is true with no active chapter, since preferences are chapter-scoped and there is nothing to `PATCH` against.

## Notification Grouping

Multiple notifications from the same source are collapsed before they reach the device:

- Chat: "3 new messages in #general" (instead of 3 separate notifications). As shipped the
  bundled push keeps the title a single push would have (below) and reads body
  `<N> new messages`; an announcement burst stays URGENT in the `announcements` category.
- Events: "2 upcoming events today."

**Bundling happens server-side, in the push worker.** The
`BurstBundler` (`apps/api/src/application/workers/burst-bundler.ts`) collapses
3+ messages from the same sender to the same recipient inside a 60s window into a
single "N new messages" push, and that decision reaches the client only as
`data.bundled` / `data.count`. Messages past the threshold in the same window
push nothing, since the bundle covers them, except the first that mentions the
recipient: it pushes and writes its row on its own, with `mentioned: true`, so a
mention is never folded into a count written before it (#4359). Only the first
in the window, so a sender who mentions in every message (a role ping, a run of
quote-replies) stays capped like any burst; a mention in the threshold message
itself rides on the bundle row as `mentioned: true`.

**On the device, a conversation's pushes stack and leave once read.**

- Every chat push (bundled or not, announcements included) carries `threadId`
  `chat:<channelId>`, which `ExpoPushProvider` sends as iOS `aps.thread-id`, so
  Notification Center stacks one channel's pushes together. A DM or group DM is
  its own channel, so a DM stacks per person. Android has no equivalent through
  Expo's push service and keeps the system's own per-app bundling.
- Every "submitted a task" push to the officer who assigned it carries
  `threadId` `tasks:review` (2026-11-13), so a night of submissions is one
  stack on the lock screen rather than a banner each. Nothing takes them out
  of the tray on review yet.
- Mobile takes a channel's chat pushes out of the tray once the server counts
  the channel as fully read (`GET /v1/channels/unread` reads `unread_count: 0`):
  `useBadgeSyncRuntime` passes those channels to `clearReadChatNotifications`,
  which dismisses presented notifications whose `data.target` is that chat
  channel. Opening a channel marks it read and refetches the counts, and the
  counts refetch on foreground, so a channel read on another device or the web
  clears the next time the app comes forward. Clearing while the app stays
  closed would need a silent (`content-available`) push and a background task,
  which the app does not have.

No collapse identifier is sent, so no push replaces another. The Android
**notification channel** is a separate thing and is not a grouping key; which
channels the app defines is owned by
[`../ui/mobile/patterns.md` § Push notifications](../ui/mobile/patterns.md#push-notifications). The "2 upcoming events today" example
above is aspirational: only chat is bundled today.

## Badge Count

The app icon badge counts what addresses the member: unread in-app notifications, chat @-mentions across all channels, and every unread message in a direct or group message. A channel that is merely busy adds nothing, the same rule the channel list's badges follow ([foundations.md](../ui/design-system/foundations.md) §5; owner decision 2026-11-07). Badge count is updated on every notification delivery and when the user reads content.

**Mobile syncs the OS badge from the same queries the app already fetches, not from a dedicated count endpoint.** `apps/mobile/lib/notifications/use-badge-sync.ts`'s `useBadgeSyncRuntime` (mounted app-wide from `components/app-runtime.tsx`) sums `GET /v1/notifications`' unread rows (`read_at === null`, the same definition the in-app history and its "Mark all read" use) with `GET /v1/channels/unread`'s per-channel `mention_count`, or `unread_count` for a direct message (`addressedUnreadTotal` in `@repo/hooks`, which reads `GET /v1/channels` to tell which channels are direct), and calls `Notifications.setBadgeCountAsync`. It resyncs whenever either query's data changes — including on app foreground, since `refetchOnWindowFocus` is already wired to `AppState` (`lib/connection/query-connectivity.ts`) — so no separate resume listener is needed. Badge setting needs no EAS `projectId`; it is a local OS call, not a remote push.

**On Android a badge of 0 is not sent to the OS** (#4011). `expo-notifications`' Android badge call answers 0 with `NotificationManager.cancelAll()`, which would dismiss every notification in the tray, read or not, each time the count reached 0, including at every cold start before the chapter loads. So `setBadgeCount` (`apps/mobile/lib/notifications/push.ts`) skips the native call for 0 on Android. Android's launcher dot comes from the tray, so it clears as the tray clears. On both platforms, chat pushes leave per channel once read (§ Notification Grouping), and every other push leaves once its in-app row is read: each push carries its row's `notificationId`, and `useBadgeSyncRuntime` passes the read rows to `clearReadNonChatNotifications`. A thread reply's push, a push for a channel the member left, and a push from a chapter they are no longer in stay until opened or swiped, so on Android those can keep the dot lit at a count of 0. Clearing the tray at sign-out is an open question (#4365). A non-zero count is still sent, for the launchers that show a number through ShortcutBadger; such a launcher keeps its last non-zero number until the next one, which `cancelAll` never reset either. iOS sets the number, 0 included.

Two adjustments keep the two sources additive rather than double-counted or unbounded: the chat push worker writes a `notifications` row for every chat push it sends, DMs, group DMs and announcements included (to each recipient who has not blocked its sender and is not in the channel right now) on top of the read-receipt count `GET /v1/channels/unread` already reflects for that channel, so the notification half excludes chat-targeted rows (`selectUnreadNonChatCount`) rather than summing both unfiltered. And like the in-app history it mirrors, the notification half only sees the first page (`GET /v1/notifications`' default 50-row limit), so a member with more than 50 unread in-app notifications sees an undercounted badge until they clear some — the same accepted cap the history screen and its own unread pill already carry.

## Per-Channel Mute

Users can mute specific chat channels. Muted channels:

- Do not generate push notifications for new messages.
- Still show unread indicators in the app when opened.
- @mentions in muted channels still generate notifications (override mute).
- A reply to your message counts as an @mention of you, so it overrides mute too (#3844; the rule: [`chat/README.md` § Mentions](chat/README.md#mentions)).

The mention-override is implemented in the push worker's `decidePush`
(`apps/api/src/application/services/push-rules.ts`): a `hasMention` recipient is sent a
push regardless of the resolved `off` level. The one exception is the `system_audit` kind —
those system messages never page anyone unless explicitly opted in (see below), so a mention
does not lift their `off` default.

**Setting the level.** Members change their own level from the channel header on web
(`apps/web/components/chat/notification-level-popover.tsx`), which writes through
`PUT /v1/channels/:id/notification-preference`. The route resolves the row from the
authenticated caller and the channel in the path — it does **not** accept a `user_id`, because
a preference is per-user and a caller-supplied id would let any member silence another's
notifications. It calls `assertChannelAccess` before writing: `chat_channels` has RLS enabled
with no policies and the API holds the `service_role` key, so that application-layer check is
the only thing stopping a member from writing a preference row about a private channel or a DM
they are not part of, which would confirm that channel exists.

`GET /v1/channels/notification-preferences` returns the caller's **effective** level for every
channel they can read — the stored row where one exists, otherwise that channel's default from
`defaultLevelFor`. It deliberately does not return "stored rows only": the defaults are not
uniform (`#general` and `#announcements` are `all`, `#chapter-audit` is `off`, all three are
seeded into every chapter, and officers can set any channel's default), so a client assuming `mentions` for an absent row would misreport exactly the
channels members most want to turn down, and the popover — which suppresses a write for the
level it already shows as current — would then swallow the corrective click. Resolving the
default server-side keeps one implementation of it, the one the push worker already uses.

The response is driven by the accessible-channel list rather than by the stored rows, which is
also what makes enumeration impossible: a preference row outlives access to its channel, so
keying the response off rows would let a caller learn channel ids they have lost access to. It
is a separate endpoint rather than a `muted` field on the channel payload, matching how unread
counts are served; `channel-list.tsx` records why a per-user field on the shared channel type
is the wrong shape.

The control lives in the channel header rather than on the channel row because the row is a
single `<button>` (a nested button is invalid HTML) and a hover-revealed action would be
unreachable on touch. Web's control is `apps/web/components/chat/notification-level-popover.tsx`.
Mobile's is `apps/mobile/components/chat/notification-level-control.tsx` in the thread header.
Both write through the same PUT and read the same effective-level GET; the two states below
(unknown trigger, header-scoped write failure) apply on both surfaces. The worker already
honours those levels for every client.

The effective-level query is keyed **outside** the `["channels"]` prefix so a mark-read does
not refetch it on every channel switch (that coupling was two extra round trips per switch,
each re-running the accessible-channel predicate). The hook still observes the channel list
and fingerprints each readable channel's `id` plus every field the server's default reads
(`name`, `type`, `is_read_only`, `default_notification_level`); a Discord import, a rename to or
from `general` / `announcements` / `chapter-audit`, a read-only toggle or an officer's default
that lands in that list — including via that mark-read invalidation — invalidates the prefs
query. The key itself does not change, so already-known
channels keep their mute control while the new GET is in flight; a brand-new channel stays
unavailable until its row arrives. Channel-set mutations still invalidate the same key.
See #1401.

Two states the control must not fake. When the effective level is **not yet known** — the read
has not landed, or failed — the trigger is disabled and announces "Notification level
unavailable" rather than standing in `mentions`, because on `#announcements` or `#chapter-audit`
that stand-in states the wrong level. When a write **fails**, the failure is reported in the
channel header, not inside the popover: the popover unmounts its content when dismissed, and
holding it open until the write lands freezes it whenever the mutation is paused offline. The
report is scoped to the channel the failed write was for — the mutation is shared by the whole
shell, so an unscoped error asserts a failure on channels the member never touched.

## Chat notification preferences

Chat-specific levels live in the `chat_notification_preferences` table (ADR-06), separately from the broader `notification_preferences` table because chat needs a tri-state (`all` / `mentions` / `off`) and three scope arms: per-channel, per-kind, and the member's chapter-wide chat level (`scope='chapter'`, both keys null, § Chapter-wide chat level below). The channel and kind arms are keyed by `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))` with a unique constraint that allows exactly one row per (scope, key).

That key is an **expression** index, which matters to anyone adding a write path: `ON CONFLICT (a, b, c)` only matches an index defined on those exact columns or expressions, and PostgREST's `on_conflict` parameter takes column names and cannot express `coalesce(...)`. So each arm's upsert targets its own plain unique index:

| Arm | Plain index | Added by |
| --- | --- | --- |
| `channel` | `(user_id, chapter_id, scope, scope_id)` | `20260829011200_chat_notif_prefs_channel_upsert_target.sql` |
| `kind` | `(user_id, chapter_id, scope, scope_kind)` | `20260902170000_chat_notif_prefs_kind_upsert_target.sql` |
| `chapter` | `(user_id, chapter_id, scope, scope_id, scope_kind) NULLS NOT DISTINCT` | `20261111120000_chat_notif_prefs_chapter_scope.sql` |

The channel and kind indexes never disagree with the expression index, because each constrains exactly one arm and is inert on the other. For `scope='channel'` rows the expression reduces to `scope_id::text`, which the table's CHECK already guarantees is non-null on that arm, and `scope_kind` is NULL so the kind index does not apply; for `scope='kind'` rows the mirror holds. Those two treat NULLs as distinct, which is what makes each inert outside its arm, and the expression index enforces the invariant across both. It enforces nothing on the chapter arm, where the expression is NULL: there the chapter index alone keeps one row per member and chapter.

**A new arm needs its own plain index.** The channel index cannot serve the kind arm — its `scope_id` is NULL on every kind row, so `ON CONFLICT` matches nothing and each write would INSERT a duplicate rather than update. Dropping either index does not fail a build or a test; it makes that arm's endpoint raise `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification` at runtime, on every call. The chapter arm has both keys NULL, so its index covers both and is `NULLS NOT DISTINCT`, which is the only way two writes collide there; channel rows still differ by `scope_id` and kind rows by `scope_kind`, so it adds no collision to either. The pairing is therefore asserted by `check:pglite-migrations`, which pins that all three exist, are `CREATE UNIQUE INDEX`, are neither partial nor expression-based, and cover the arm each is named for.

### Write paths

| Route | Scope |
| --- | --- |
| `GET /v1/channels/notification-preferences` | the caller's effective level per channel, **for an ordinary (`text`) message** |
| `PUT /v1/channels/{id}/notification-preference` | set one channel's level |
| `GET /v1/channels/notification-preferences/kinds` | the caller's per-kind **overrides** |
| `PUT /v1/channels/notification-preferences/kinds/{kind}` | set one kind's override |
| `DELETE /v1/channels/notification-preferences/kinds/{kind}` | clear one kind's override |
| `GET /v1/channels/notification-preferences/chapter` | the caller's chapter-wide chat level, `all` or `mentions` |
| `PUT /v1/channels/notification-preferences/chapter` | set it; `all` deletes the row |

Every write keys the row on the authenticated user, never on a body or path value — a mute is per-user, and accepting a caller-supplied user id would let any member silence another member's notifications.

**The two reads answer different questions, and the difference is load-bearing.** The channel read resolves the precedence chain through the worker's own `resolveLevel`, so it reports the level that will actually be applied to an **ordinary `text` message** in each channel — including a kind override on `text` that outranks the channel's default (in a DM only when it is louder than the DM's own `all`; see the precedence below). It is the number a per-channel mute UI should display. Reimplementing that chain locally is what let the two disagree once before: the endpoint read only channel rows, which was correct only while nothing could write a kind row.

Its scope is one kind by construction, and that bound is real: a channel does not have a single level across kinds. A member who overrides `announcement` to `off` is muted for announcements in `#announcements` while this endpoint — asked about `text` — still reports `all` for that channel. Neither read is wrong; together they say "ordinary messages here are `all`, announcements anywhere are `off`". A UI that wants the level for a *specific* kind must combine the two, and one that renders a single per-channel toggle should say it governs ordinary messages.

The kind read reports **overrides only**, with `level: null` where the member has set none. It deliberately does not fill in a default, because a kind has none to fill in: what a kind falls back to depends on the channel a message lands in, so an `announcement`-kind message resolves through the channel's own default like any other (`all` in `#announcements`, `#general` and DMs, an officer's choice where one is set, `mentions` elsewhere). Reporting a single scalar would state the wrong level for the seeded `#announcements`, and a settings screen that wrote back what it displayed would thereby *create* an override silently downgrading that channel. `DELETE` exists for the same reason: outside DMs a kind override outranks every channel's default, so one a member could not remove would be a permanent invisible downgrade. It validates against every `CHAT_MESSAGE_KIND` rather than the settable subset, so that moving a kind out of that subset later cannot strand a row already written for it.

**The channel arm has no `DELETE`, and since this endpoint began resolving kind overrides that is a real gap rather than a considered omission.** It used to be one: while the channel read only ever returned name-derived defaults, writing a displayed value back was behaviourally identical to having no row. It no longer is — a displayed value may now be a kind override, so a client that saves what it renders can materialise channel rows that outrank the override and cannot then be removed. No shipped client does this (the web popover writes only on an explicit click), which is why it is tracked rather than fixed here; the fix is the symmetric `DELETE /v1/channels/{id}/notification-preference`.

The kind routes take no channel and perform no channel-access check, because a kind is chapter-wide and the response reveals nothing about which channels exist.

`imported` and `loading` are **rejected** by the setter and **absent** from the list, rather than merely undocumented: the first because the worker refuses that kind before any preference is read (below), the second because it is the optimistic placeholder a heavy slash command posts before its real card replaces it — a preference for it would work, which is the problem, pushing "Recording points…" for a card reconciled away seconds later. `chat_messages.kind` carries no CHECK constraint (`text not null default 'text'`), so the setter also validates the kind against the settable set; without that, a misspelled kind would persist a row matching no message ever, which the member would read as an active setting.

Defaults when no row is set (see ADR-06; the `defaultLevelFor` helper encodes the precedence rules, first match wins):

| Channel / kind                    | Default level |
| --------------------------------- | ------------- |
| `system_audit` kind (any channel) | `off`         |
| `imported` kind (any channel)     | `off` (absolute — see below) |
| A DM or group DM                  | `all`         |
| A channel with an officer-set default | that default |
| The announcements channel (below) | `all`         |
| `#general`                        | `all`         |
| `#chapter-audit`                  | `off`         |
| Every other channel               | `mentions`    |

**Officers set a channel's default; a member's own choice always wins** (owner decision
2026-09-29, #2771, modelled on Discord's server default notification setting). The default is
`chat_channels.default_notification_level`, set by a `channels:manage` holder through
`PATCH /v1/channels/{id}` from chat admin on web, and `null` until one is set. `null` falls
through to the rows below it, the built-in default (`builtInChannelDefault` in
`@repo/validation`, which the chat-admin control reads to name what "Standard" means). Those
rows are what the decision calls seeded, and seeding them by rule means no row is written: the
cost is that they follow the name, so renaming `#general` drops it to `mentions` unless an
officer has set its default. The API refuses a default on a DM or group DM, which has no
officer and always defaults to `all`, like any messenger's DMs. A kind default outranks an
officer's: `#chapter-audit` set to `all` still pages nobody with audit rows.

Precedence in the push worker is **channel-pref ▶ kind-pref ▶ chapter-wide level ▶ default**, so an officer's
default never overrides a level a member stored. **In a DM or group DM a kind row can make it
louder, never quieter.** A kind override is a chapter-wide way to tune channel traffic, and DMs
were pushed by a separate path that never read it until #2771, so letting a `text` row of
`mentions` apply would silently stop every DM for a member who set it to calm `#general`. A kind
row quieter than the DM's default is therefore ignored there, and a DM is muted from the DM
itself. One louder than it still counts, so the `system_audit` opt-in below keeps reaching
system messages posted into DMs (the invite-accept notice, a DM poll's expiry). A user who explicitly sets `(scope='kind', scope_kind='system_audit', level='all')` opts in to `system_audit` pushes; otherwise those messages never page anyone. The opt-in reaches the server's own notices only, never an audit-bridge mirror: `decidePush` refuses a mirror row (`isAuditMirrorRow`, `client_message_id = 'audit:<id>'`) ahead of every preference, the member's channel-scope `all` on `#chapter-audit` included (owner decision, 2026-11-06: audit entries arrive silently). That opt-in is reachable from `PUT /v1/channels/notification-preferences/kinds/system_audit` (see **Write paths** above); until that route shipped the kind arm was readable by the worker but writable by nobody, so the branch always evaluated an empty set.

### Chapter-wide chat level

**Chat messages** (#3840, asked by Shawn, 2026-11-09), on the phone's Settings → Notifications and web's Settings → Chapter alerts (#4124), is one choice for the whole chapter, the way Slack's "Mentions & DMs only" and Discord's server-wide "Only @mentions" work:

- **All messages**: each channel at its own default (the table above). This is the absence of a row; choosing it deletes one.
- **Mentions and DMs only**: every ordinary channel acts as `mentions`, so it notifies only for an @mention of you, and a reply to your message counts as one (#3844, § Per-Channel Mute). DMs, group DMs and the announcements channel (URGENT) still notify every message.

It is stored as a `scope='chapter'` row with `level='mentions'`, and `resolveLevel` reads it after the channel and kind rows, so **a level the member set on one channel, or on a message kind, still wins**: that is how a member keeps one busy channel loud. It only ever **lowers** a channel's default: it never reaches a DM, a group DM or the announcements channel, and a channel whose default is already quieter (`#chapter-audit`, an officer's `off`, the `system_audit` kind) stays as it is.

The per-channel read reports the result, with `from_chapter_level: true` on a channel the chapter-wide level decided, and every channel notification menu labels that option "Only @mentions (your default)": the phone's thread header and long-press menus, and web's channel header `⋯` → Notifications panel and the rail's right-click Notifications submenu (#4124).

**There is no "Off".** The issue asked for one, standing for the Chat switch, but that switch was dropped on 2026-11-06 (owner: "Do we really want users to be able to turn off chat?"; Delivery Flow step 2), and quiet hours are how a member goes silent. The CHECK allows `off` on this arm, so adding it later needs no migration.

The phone shipped it first, since push is phone-only; web's Settings → Chapter alerts carries the same two options as radio cards above the category switches (#4124). Both read their words from `CHAT_CHAPTER_LEVEL_OPTIONS` in `@repo/validation`.

**The push worker is the only chat push path** (#2771). `ChatService` used to push DMs and announcements itself as well, so an announcement reached an away member twice, a DM that mentioned its recipient did the same, and a DM the member had muted pushed anyway, since that path never read `chat_notification_preferences`. Every chat push now goes through the rule chain above, once per recipient.

**Every chat push names its sender.** The title is `<Sender> in #<channel>` for a channel, `<Sender>` for a DM, `<Sender> in <group>` for a group DM with a name, and `Announcement from <Sender>` for an announcement, bundled or not; the body is the first 200 characters (or `<N> new messages` for a burst). A message with no text, a photo or file sent on its own, says what was sent: `Sent an attachment`, `Sent <N> attachments` (#3846), or `Sent a GIF` for a GIF message (#4631, [`chat/README.md` § GIFs](chat/README.md#gifs)). A DM's stored name (`dm-<uuid>-<uuid>`) and an unnamed group DM's (`group-dm-<timestamp>`) never reach a title. With no sender name to show (a blank display name, or a lookup that failed, which costs the name and not the push), the titles fall back to `New message in #<channel>`, the group's name for a named group DM, `New Message` for any other DM, and `New Announcement`, bundled or not. The system actor (`SYSTEM_SENDER_ID`, "Frapp System": the audit bridge, poll-expiry notices, invite-accept DMs) is never named, so its pushes keep those fallback titles.

**What the worker counts as an announcement** — a message in an announcements channel: a PUBLIC, read-only channel whose name contains `announcements`, the seeded `#announcements` included (`isAnnouncementChannel` in `@repo/validation`, which the activity feed and web `/announce` use too) — decides the push's title, its URGENT priority, and its `announcements` category together, from one predicate. All three, because they must not disagree: the category once keyed on `kind` alone, so an ordinary message in an `announcements` channel went out titled "New Announcement" at URGENT while labelled `category: 'chat'`. Once URGENT became exempt from the category gate (#1041), that mismatch let those pushes escape the member's coarse **Chat** switch — the only control that had been silencing them. Only the tiers and roles on such a channel's who-can-post list can write in its timeline (`is_read_only` is kept equal to having that list, #3722), which is what makes a chapter-wide URGENT push sound. Any reader may reply in a message thread there (#3785), so **a thread reply is never an announcement push**: it goes out as an ordinary chat push, to the thread's followers only (`decidePush`'s `skip-thread` for everyone else, an @mention excepted), never above the channel's level ([`chat/README.md` § Message threads](chat/README.md)). Until #2771 the worker also accepted any channel merely *named* `announcements`, so a group DM given that name, or `#announcements` with read-only switched off, let any member send URGENT pushes that skip quiet hours; neither qualifies now, and each gets ordinary channel pushes at its ordinary default. The message's `kind` no longer counts either: the client sets it, and any member could post `kind: 'announcement'` in `#general` or a DM to send the same URGENT push. The predicate is still name-keyed, so a rename changes it; narrowing it is part of #1323.

**`imported` is the one kind with no opt-in — and is therefore not settable.** (It is not the only kind excluded from the settable set; `loading` is too, for the unrelated reason given under **Write paths**.) `PUT /v1/channels/notification-preferences/kinds/imported` returns 400 and the kind is omitted from the list response, because a stored row for it could never be read: `decidePush` refuses it ahead of every other rule, including the presence check and the mention override, and `ChatPushWorkerService.handleMessage` exits on it before it even loads the chapter roster — an import is thousands of rows arriving as fast as Postgres can write them through a Realtime handler with no backpressure, so deciding downstream would mean thousands of roster loads. The mention carve-out is the load-bearing half: imported bodies are years of prose full of `@name` tokens, and a mention lifts a muted channel's `off`, so a kind-level default alone would not hold. "Notify me about backfilled history" is not a setting anyone wants.

## Audit-log → `#chapter-audit` bridge

The bridge worker (see ADR-08) subscribes to `chapter_audit_log` INSERT via Supabase Realtime and posts a `kind='system_audit'` message into the chapter's `#chapter-audit` channel as the system sender (`00000000-0000-0000-0000-000000000000`). Rows with `member_visible=false` are skipped — internal-scope rows stay out of the channel.

Message shape:

- `sender_id`: the system sender.
- `content`: human summary (`"<action>: <diff keys>"`).
- `kind`: `system_audit`.
- `payload`: `{ action, actor_user_id, diff }` — the renderer reads from `payload`, not the prose `content`.

Chapters that pre-date the `#chapter-audit` channel have no mirror; the bridge logs and continues. The audit row itself is always the source of truth.

## What a push says

A push is read on a lock screen, in a glance, next to iOS Calendar and Google Calendar invites. So it names its subject and says what the reader needs to act on, never a category ("New Event", "Task Assigned") over a sentence that restates it. Chat pushes name their sender (above); event, task and member pushes follow the same rule (2026-11-06, from Paul's lock screen reading "New Event / Chapter has been scheduled").

- **The title is the thing**: the event's or task's own name. A change says what changed after it: `Chapter rescheduled`, `Chapter moved`.
- **When another member's action is the news, the title names them and it**: `Shawn Klein submitted: Clean his room`, `Paul Carlson sent back: Clean his room` (2026-11-13, from Paul's lock screen reading only `Clean his room` when a task came in for review). It is the task review loop: submitted, resubmitted, finished, confirmed and sent back. The body says what came with it and what is asked: `1 photo · Confirm to award 10 points`.
- **The body is the facts, most important first, joined by ` · `**: for an event, whether it is required _of the reader_, when, and where: `Required · Mon, Nov 9, 8–9 PM · The Lodge`. A series is announced once, as its pattern (`Every Mon, 8–9 PM, from Nov 9`), never once per occurrence.
- **Times are in the reader's zone.** The server renders the text, so it needs each recipient's zone: both clients send their device's or browser's zone on every request as `x-time-zone` (`@repo/api-sdk`), and the API records it in `user_settings.time_zone` when it changes (`TimeZoneSyncService`). A member with none falls back to `quiet_hours_tz`, then to the zone of whoever scheduled or moved the event (the actor of that push), then to `America/New_York`; a fallback zone is always labelled (`8–9 PM EST`) so a guess never reads as the member's own clock. Task due dates are calendar dates with no zone and are written as stored.
- **Required means what attendance enforces.** `memberAttendance` (`event-role-targeting.ts`) reads the member's answer from attendance by role ([`events.md`](events.md#event-creation) § Event Creation): required, optional, or not invited, and a member not invited is not sent the push. An alumnus required only by the event's default, not by a role that names them, reads as optional, because the auto-absent sweep never holds them to it.
- **Nobody is told about their own action.** The member who scheduled or moved an event, assigned themselves a task, or just joined the chapter gets no push about it.
- **An edit is announced only when it moves something.** Both clients round-trip the whole event on save, so a rename arrives carrying the same times and location. `eventChangeOf` compares values (instants as instants) against the row before the write; a save that moves neither time nor place sends nothing.

| Push | Title | Body |
| --- | --- | --- |
| New event | `Chapter` | `Required · Mon, Nov 9, 8–9 PM · The Lodge` |
| Event rescheduled | `Chapter rescheduled` | `Now Tue, Nov 10, 8–9 PM · Required` |
| Event location changed | `Chapter moved` | `Now at The Lodge · Mon, Nov 9, 8–9 PM · Required` |
| Event reminder | `Chapter` | `Starts in 20 minutes · The Lodge · Required` |
| Task assigned | `Book the venue` | `From Paul Carlson · due Sat, Nov 14 · 10 points` |
| Task marked done (to its creator) | `Alex Smith submitted: Book the venue` | `1 photo · Confirm to award 10 points`: their note quoted when they left one (`"Booked it"`, cut at 60 characters), the photo count or `Link attached`, then the ask (`Check it and confirm` with no points). Opens the review itself (`target.view: 'review'`), and every one stacks in the iOS group `tasks:review`. |
| Task resubmitted after a send-back | `Alex Smith resubmitted: Book the venue` | `Replied "<their note>" · 2 photos · Confirm to award 10 points` |
| Task done with nothing to sign off (no points, no proof, #4635) | `Alex Smith finished: Book the venue` | `Done · send it back if something's off` |
| Task confirmed | `Paul Carlson confirmed: Book the venue` | `+10 points`, or `Done` for a task with proof and no points |
| Task sent back | `Paul Carlson sent back: Book the venue` | `"<officer's reason>"` |
| Task overdue | `Book the venue` | `Overdue · was due Sat, Nov 14` |
| Member joined | `Alex Smith joined` | `New member of the chapter` |

**No push goes out without a title and a body (#3846).** A push with no text tells the reader nothing on a lock screen. Every sender builds its own copy by the rules above. As a last line of defence, `ExpoPushProvider` fills a blank title with `Frapp` and a blank body with a line naming the push's category (`New message`, `Event update`, `Task update`, …), and reports the blank to Sentry under `expo-push-blank-copy:<category>` so the sender that built it gets fixed.

## Notification Triggers (Complete List)

| Domain        | Trigger                                                            | Priority                    |
| ------------- | ------------------------------------------------------------------ | --------------------------- |
| Chat          | @mention                                                           | NORMAL                      |
| Chat          | Reply to your message, as an @mention of you (#3844; Discord's default, "@ON" when replying; who it skips: [`chat/README.md` § Mentions](chat/README.md#mentions)) | NORMAL |
| Chat          | DM received                                                        | NORMAL                      |
| Chat          | New message in unmuted channel                                     | NORMAL                      |
| Announcements | New announcement posted                                            | URGENT                      |
| Events        | Upcoming event reminder (30min before — see below)                 | NORMAL                      |
| Events        | New event created                                                  | SILENT                      |
| Events        | Event updated (time/location change)                               | NORMAL                      |
| Events        | Excuse sent for an event (to its creator, or the `events:update` holders when it has none; never the sender), its decision (to the member), and one reminder when excuses are still pending as check-in closes (to the receivers). Category `events`; target `events` with `eventId` ([`events.md` § Excuses](events.md#excuses), #3735) | NORMAL |
| Events        | A series edit dropped an excuse: the meeting it was for has no rebuilt meeting to carry to (to the excuse's sender, while still a member). "Send your excuse again" when the series was rescheduled, "Your excuse was removed" when it no longer repeats. Category `events`; target `events` with the series head's `eventId` ([`events.md` § Excuses](events.md#excuses), #4620) | NORMAL |
| Points        | Points awarded                                                     | NORMAL                      |
| Points        | Points deducted (fine)                                             | NORMAL                      |
| Points        | Leaderboard position change                                        | SILENT (weekly digest)      |
| Study         | Session paused (app backgrounded)                                  | NORMAL (local notification) |
| Study         | Session expired                                                    | NORMAL                      |
| Study         | Geofence departure                                                 | NORMAL                      |
| Billing       | Invoice created (member)                                           | NORMAL                      |
| Billing       | Invoice due soon (3 days, 1 day before)                            | NORMAL                      |
| Billing       | Payment received                                                   | SILENT                      |
| Billing       | Payment declined                                                   | NORMAL                      |
| Billing       | Subscription status change                                         | URGENT (for admin)          |
| Tasks         | Task assigned to you                                               | NORMAL                      |
| Tasks         | Task due soon (1 day before)                                       | NORMAL                      |
| Tasks         | Task overdue                                                       | NORMAL                      |
| Tasks         | Task marked completed (to creator, needs confirmation)             | NORMAL                      |
| Tasks         | Task completion confirmed (points awarded)                         | NORMAL                      |
| Tasks         | Suggested tasks to review: one push per batch an AI run drafts, to the member the run acted for, only when they could accept at least one now (the permission, the module on, the source open to them). Category `tasks`; target `ai_suggestions` with `batchId`, `sourceType`, `sourceId` ([`ai.md` § Suggestions](ai.md#suggestions), #4309) | NORMAL |
| Events, Tasks | This time last year: at most one push a week, to the chapter's President, only when the weekly comparison raised something new they could act on. Title `This time last year`; category `events` or `tasks` by the first thing in it; target `ai_suggestions` with `batchId`, `sourceType` (`event` or `task`), `sourceId` ([`ai.md` § This time last year](ai.md#this-time-last-year), #3930) | NORMAL |
| Service       | Service hours approved                                             | NORMAL                      |
| Service       | Service hours rejected                                             | NORMAL                      |
| Admin         | New member joined (to members who can open the roster and invite or assign roles: `members:view` with `members:invite` or `roles:manage`; never the joiner, #3656). Category `members`, which those members can switch off (**Someone joins the chapter**, #4008); the other Admin rows have no switch | NORMAL |
| Admin         | Invite accepted                                                    | SILENT                      |
| Admin         | Role change on a member                                            | SILENT                      |
| Admin         | Chat message reported (to report-queue officers; never the reported sender or the reporter; content-free) | NORMAL |
| Admin         | Discord import finished, or stopped on an error (to the admin who set it up, while they hold `channels:manage`; not when an admin stopped it, nor for a failed deletion) | NORMAL |

## Pre-Event Reminders

`ScheduledJobsService.sweepEventReminders` runs every five minutes and pushes a NORMAL reminder for events starting inside `(now, now + 30min]`.

**Who gets one.** The event's _required_ members, resolved by `AttendanceService.resolveRequiredMembers` — the same call the auto-absent sweep makes, deliberately shared rather than reimplemented:

- Every member whose answer under [attendance by role](events.md#event-creation) is **required**: by a role of theirs (alumni included, since listing their role is a deliberate choice), or by the default (alumni left out, since they can neither check in nor self-excuse unless a role of theirs is listed). A required member is always invited, so the reminder stays inside the event's own visibility rule.
- Optional and not-invited members get none. An optional member's reminder needs RSVP intent, which is not modelled yet (#1035).

**Lead time.** One fixed 30-minute window, `EVENT_REMINDER_LEAD_MINUTES` (#1548 tracks the per-member 1hr / 15min choice this table used to promise, which needs a preference column that does not exist). The constant is the window's _width_, not the delivery offset — an event created inside its own window, or one first seen by a catch-up tick, is already closer than 30 minutes. **The push therefore reports the real remaining time**, computed per send, never the constant; a member told "30 minutes" who actually has five would miss a mandatory event's check-in window and be auto-marked ABSENT.

**Delivery guarantees.** The sweep claims `(EVENT, event_id, 'EVENT_REMINDER', <event start date>)` in `scheduled_notification_dispatches` before sending, so a reminder survives multiple replicas and repeated ticks without duplicating — the same mechanism the invoice and task sweeps use. The claim key is derived from the event row, never from the clock, so every tick inside the window computes the same key. The audience is resolved **after** the claim is won, so the five losing ticks cost one failed insert each rather than a full chapter-roster read they would discard. A claim is released when _every_ delivery failed — or when the audience resolves to nobody — so a transient outage retries on the next tick while a partial success does not re-notify the members who already got it.

The window's lower bound is `now`, exclusive, so a reminder is never sent about an event that has already started: a backed-up or restarted worker sends nothing rather than a burst of "starting soon" pushes for events already underway.

**Two limits worth stating plainly**, because both fail silently:

- **No lookback.** Six ticks per event and no catch-up, so anything costing all six drops that event's reminder permanently — no claim is written and nothing retries. A failing candidate query is audible (`event-reminder sweep: event lookup failed`, once per tick); a worker that never ran is not, and neither is a healthy tick with nothing upcoming, so a zero count on its own means nothing. See [`render.md`](../../docs/ops/deployment/render.md#56-in-process-scheduled-jobs) before scheduling a long evening maintenance window.
- **A same-UTC-day reschedule is not re-armed.** `scheduled_notification_dispatches.due_date` is a `date`, so moving an event from 14:00 to 20:00 the same day reuses the claim key and the second claim loses — the only reminder members got named the old time. Moving it across a UTC day boundary does re-arm. The separate "event updated" push softens this but does not replace the reminder. Widening the key needs a schema change shared with three other sweeps; tracked in #1550.

Quiet hours and the member's `events` category preference are **not** special-cased here. The sweep sends at `NotificationService.notifyUser`'s default NORMAL priority precisely so both apply — URGENT is the priority that bypasses them, and naming one here would silently opt reminders out of both.
