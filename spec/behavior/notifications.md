# Notifications

## Decoupled Architecture

The Notification service exposes two methods:

- `notifyUser(userId, payload)` — sends to a specific user.
- `notifyChapter(chapterId, payload)` — sends to all members of a chapter.

Other modules (Chat, Events, Study, Billing) call these methods without knowing about push tokens, Expo, or delivery mechanics.

## Delivery Flow

1. Resolve the payload's priority (absent means `NORMAL`).
2. **Unless the priority is URGENT**, check the user's notification preferences for the payload's category. If disabled, skip — no push *and* no in-app row.
3. Check quiet hours. If active and priority is not URGENT, queue as badge-only (no sound/vibration).
4. Save notification to `notifications` table (in-app history).
5. Fetch the user's `push_tokens`.
6. Send push notification via Expo Push Service with the appropriate priority.
7. If Expo reports a token as permanently undeliverable (`DeviceNotRegistered`), remove it from `push_tokens`. This is classified from the *ticket* Expo returns at send time (`ExpoPushProvider.recordTickets`), not from polling delivery *receipts* — receipt polling is a separate, unimplemented enhancement. Every other Expo error (rate limit, oversized message, bad app credentials, transport failure) is transient or describes something other than this specific token, and does not prune it — pruning on those would unregister a device that is still valid.

**URGENT outranks the category preference** (#1041). A member cannot mute a chapter emergency — or the president's subscription-status alert — by switching its category off, and the exemption covers the in-app row as well as the push: suppressing the row would leave no trace of the broadcast anywhere, which is the same failure in a slower form. Step 2 is the only gate URGENT skips; it is otherwise delivered exactly like any other payload. Note the ordering is an implementation detail of *when the preference is read*, not of what is checked — `notifyUser` skips the lookup entirely for URGENT rather than reading it and discarding the result, so an emergency broadcast costs no preference query per recipient.

Push delivery is mobile-only (Expo); **web push is intentionally out of scope** for this phase. The web dashboard surfaces the in-app history instead: its notification drawer reads `GET /v1/notifications` (optional `limit`) and subscribes to a **private Supabase Realtime broadcast** topic, `notif:<users.id>`, so new rows appear without a manual refresh. The ping carries `{table, op}` and **no row data** — it only tells the client to refetch, and the refetch goes through the API above, which stays the enforcing layer. It deliberately does *not* use `postgres_changes`: `notifications` is RLS-on with no policy, and the SELECT policy needed to make Postgres changes fire would equally expose the table to direct browser reads (see [`AUTHORIZATION_MODEL.md`](../../docs/internal/security/AUTHORIZATION_MODEL.md) §4 and #867). Tapping a row deep-links via the payload `target` and marks it read with `PATCH /v1/notifications/{id}/read`.

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
its emitter sets: `chat` sends `channelId`, `events` sends `eventId`, `tasks` sends
`taskId`, and `billing` / `points` / `service` / `members` send a bare `screen`. A
bundled chat burst adds `bundled: true` and `count`
(`chat-push-worker.service.ts` `buildPayload`). This example previously showed a
`messageId` the chat push worker has never emitted; clients MUST NOT read one.

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
| URGENT   | Plays sound even during Do Not Disturb. Used for emergency announcements and critical billing alerts. |
| NORMAL   | Standard notification with sound and vibration (respects device settings).                            |
| SILENT   | Badge-only. No sound, no vibration. Used for low-priority updates (e.g. weekly digest).               |

## Quiet Hours

- Per-user configurable start and end time (e.g. 10:00 PM to 8:00 AM).
- During quiet hours, NORMAL notifications are delivered as badge-only (no sound/vibration). URGENT notifications are unaffected.
- Quiet hours are timezone-aware. `quiet_hours_tz` holds a zone identifier `Intl.DateTimeFormat` can resolve — normally an IANA name such as `America/New_York`. The implementation uses `Intl.DateTimeFormat` to convert the current UTC time to the user's timezone; midnight is normalized to hour 0 to handle locale-specific h24 hour cycles.
- **Use a named zone; fixed offsets are not portable.** Whether `Intl` resolves an offset like `-05:00` depends on the runtime's ICU — Node 20, which the API Dockerfile and CI both run, rejects them, while Node 22 accepts them. Treat offsets as rejected. The web panel used to label this field "Timezone offset", so stored rows can hold one; on the deployment runtime those are unresolvable and delivery degrades to UTC with a warning, exactly like any other legacy bad value. Note also that "IANA" alone does not imply DST-aware: `UTC`, `EST`, and `Etc/GMT+5` are all IANA identifiers with no DST rules. Narrowing this to DST-aware zones needs a backfill and a zone picker, tracked separately.
- `PATCH /v1/settings` accepts `quiet_hours_start`, `quiet_hours_end`, and `quiet_hours_tz` as nullable. Omitting a field preserves its existing value; sending `null` — **or an empty string** — clears it. Blank is a clear rather than a validation error on all three, because both clients bind these inputs to `""`: rejecting it would fail the whole payload and take the member's unrelated edits with it. String values are trimmed before validation and storage, so a padded zone cannot pass the check and then fail at delivery.
- **Enforcement is off only when the window is cleared.** Quiet hours are derived from `quiet_hours_start`/`quiet_hours_end`; clearing only `quiet_hours_tz` leaves the window in force and evaluated in UTC. To disable, clear the start and end times.
- **`quiet_hours_tz` is validated server-side.** A zone the server cannot resolve is rejected with `400`; clients are not trusted to check. The rule itself lives in `@repo/validation` (`isSupportedTimeZone`) and is shared by the API DTO, the web profile panel, and the mobile preferences screen, so the layers cannot drift. The clients are a courtesy, not a guarantee, and they check only what the member is **typing right now**. Two reasons the server is the only authority: `isSupportedTimeZone` fails open on a runtime whose `Intl` resolves no zones, and a client's tzdata can simply be older than the server's — an Android build that predates `Europe/Kyiv` will reject a zone the server accepts.
- **A client validates what the member typed; it never re-judges what the server stored.** This is the rule on both clients, and it exists because a client's verdict on a stored zone can be a confident false negative. Web omits an untouched zone from the `PATCH` rather than echoing or rejecting it, and blocks the save only for a zone the member actually edited. Mobile likewise applies its resolvability check only to an edited value, and repairs a stored one only for device-independent defects — not a string, blank, or over-length.
- Consequences of that rule, both accepted: a legacy row holding a genuinely unresolvable zone round-trips to a `400` on the mobile toggle and surfaces as the retry state; and neither client will "fix" such a row on its own. A visible error on an already-broken row beats silently overwriting a correct one across every device.
- **An unresolvable stored zone degrades to UTC; it never blocks delivery.** Quiet-hour evaluation runs _before_ the notification row is written (step 3 of the delivery flow), so a `RangeError` out of `Intl.DateTimeFormat` would cost the member the push **and** the in-app row — silently, since `notifyChapter` swallows per-member rejections through `Promise.allSettled`. Rows written before the validation above can still carry such a zone, so delivery falls back to UTC and warns once per member and zone per process. A time-shifted quiet window is the accepted cost; losing the notification is not.

## Mobile preference sync

- **The query cache is the source of truth.** `useUpdateNotificationPreference` and `useUpdateUserSettings` (`@repo/hooks`) write optimistically, roll back on error, and invalidate once settled, so every later server payload — a refetch that normalized what was sent, a change made on another device, a chapter switch — reaches the screen. The mobile hook derives its state from `useUserSettings` / `useNotificationPreferences` and keeps no copy of its own. Before #312 it held local state latched to the first successful payload, and everything after that was dropped until a cold remount.
- A failed `PATCH` therefore **reverts** the switch rather than leaving it on the value the server refused, and the sync indicator reads `retry`. Changing the setting again is the retry.
- The mobile screen (`apps/mobile/app/(tabs)/preferences.tsx`) still hydrates from AsyncStorage first, for offline and pre-auth reads — that cache is what the screen shows when there is no server answer yet, never a competitor to one. It stores the effective state under `frapp.mobile.notification-preferences`; keys nothing reads are stripped on write, and the two pre-catalog toggles (`dmAlertsEnabled`, `eventRemindersEnabled`) migrate to the `chat` and `events` categories rather than being discarded.
- **The member-facing categories are a shared catalog**, `NOTIFICATION_CATEGORIES` in `@repo/validation` — `chat`, `events`, `points`, `billing`, `tasks`, `service`. Shared because each key is written verbatim into `notification_preferences.category`, which nothing validates: the column is unconstrained `text` and the DTO only length-limits it, so a per-surface copy drifts into preference rows the server never reads. Web's Profile grid adopting the same catalog is #564.
- **`announcements` is still not a member switch, for a new reason.** The original blocker was gate ordering — the preference was checked before priority, so the switch would have muted URGENT chapter announcements and their in-app rows. That is fixed (#1041): URGENT now bypasses the gate. What blocks the switch now is that the category has no non-URGENT traffic to govern — both of its emitters send URGENT. `ChatService` broadcasts every announcements-channel post that way, and the chat push worker marks anything it treats as an announcement the same (see **Chat notification preferences** below). So a preference row would suppress nothing, which is the dead-control failure the shared catalog exists to prevent. It ships once routine announcements are distinguishable from emergency ones, which is also what resolves the contradiction between the URGENT row in **Priority Levels** ("emergency announcements") and the Announcements row in the trigger table ("New announcement posted"). Tracked in #1323.
- A category with **no stored row is enabled** — that is what `notifyUser` does with an absent row, and no migration seeds rows — so the catalog's `defaultEnabled` describes the server's behaviour rather than setting a policy of its own.
- Notification preferences are chapter-scoped per the multi-tenancy invariant: reading (`GET /v1/notifications/preferences`) or writing (`PATCH /v1/notifications/preferences`) preferences for a `chapter_id` the caller is not an active member of returns `403 Forbidden`. The chapter here is supplied by the request (query/body), so membership is verified explicitly in the service rather than relying on the resolved active chapter. **Quiet hours are not chapter-scoped**: `user_settings` is unique on `user_id`, so one window governs every chapter a member belongs to.
- Members can view and edit quiet-hour start, end, and timezone on mobile, at parity with the web profile panel. Times are entered as 24-hour `HH:mm`; `HH:mm:ss` values returned by Postgres `time` columns are normalized to `HH:mm` for display and for writes. That normalization is load-bearing in one direction: the API's own DTO regex rejects fractional seconds, which a Postgres `time` can carry, so a raw server value forwarded into a `PATCH` would `400`.
- Quiet-hours toggle OFF `PATCH`es `null` for all three quiet-hour fields. Because "enabled" is _derived_ from a window being stored, disabling necessarily clears the member's times server-side — so the client remembers the last non-empty window under the `frapp.mobile.quiet-hours-window` AsyncStorage key.
- Quiet-hours toggle ON restores that window rather than overwriting it. The window is resolved in priority order: (1) the window the server currently reports, which is authoritative and covers a window set on another device; (2) the remembered window, which survives an app restart; (3) only for a member who has never had a window, the 22:00/08:00 defaults with the device timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
- Editing the window while quiet hours are OFF updates only the remembered window — it is not `PATCH`ed, because writing a window server-side would silently switch enforcement back on.
- When no auth token is present, all toggles persist locally only and sync state surfaces as "cached" so the UI doesn't claim server enforcement. The same is true with no active chapter, since preferences are chapter-scoped and there is nothing to `PATCH` against.

## Notification Grouping

Multiple notifications from the same source are collapsed before they reach the device:

- Chat: "3 new messages in #general" (instead of 3 separate notifications). As shipped the
  bundled push reads title `New messages in #<channel>` / body `<N> new messages`.
- Events: "2 upcoming events today."

**Grouping happens server-side, in the push worker — not on the device.** The
`BurstBundler` (`apps/api/src/modules/chat-push-worker/burst-bundler.ts`) collapses
3+ messages from the same sender to the same recipient inside a 60s window into a
single "N new messages" push, and that decision reaches the client only as
`data.bundled` / `data.count`. No category, thread, collapse or channel identifier is
sent: `ExpoPushProvider` builds each message from `to`, `title`, `body`, `data`,
`sound` and `priority` alone, so a client cannot group on identifiers it never
receives. The Android **notification channel** is a separate thing and is not a
grouping key — the app defines exactly one (`"default"`, set as the plugin's
`defaultChannel` in `apps/mobile/app.json`). The "2 upcoming events today" example
above is aspirational: only chat is bundled today.

## Badge Count

The app icon badge shows the total unread count: unread in-app notifications + unread chat messages across all channels. Badge count is updated on every notification delivery and when the user reads content.

**Mobile syncs the OS badge from the same queries the app already fetches, not from a dedicated count endpoint.** `apps/mobile/lib/notifications/use-badge-sync.ts`'s `useBadgeSyncRuntime` (mounted app-wide from `components/app-runtime.tsx`) sums `GET /v1/notifications`' unread rows (`read_at === null`, the same definition the in-app history and its "Mark all read" use) with `GET /v1/channels/unread`'s per-channel `unread_count`, and calls `Notifications.setBadgeCountAsync`. It resyncs whenever either query's data changes — including on app foreground, since `refetchOnWindowFocus` is already wired to `AppState` (`lib/connection/query-connectivity.ts`) — so no separate resume listener is needed. Badge setting needs no EAS `projectId`; it is a local OS call, not a remote push.

Two adjustments keep the two sources additive rather than double-counted or unbounded: `ChatService` writes a `notifications` row for every DM, group-DM, and announcement message on top of the read-receipt count `GET /v1/channels/unread` already reflects for that channel, so the notification half excludes chat-targeted rows (`selectUnreadNonChatCount`) rather than summing both unfiltered. And like the in-app history it mirrors, the notification half only sees the first page (`GET /v1/notifications`' default 50-row limit), so a member with more than 50 unread in-app notifications sees an undercounted badge until they clear some — the same accepted cap the history screen and its own unread pill already carry.

## Per-Channel Mute

Users can mute specific chat channels. Muted channels:

- Do not generate push notifications for new messages.
- Still show unread indicators in the app when opened.
- @mentions in muted channels still generate notifications (override mute).

The mention-override is implemented in the push worker's `decidePush`
(`apps/api/src/modules/chat-push-worker/push-rules.ts`): a `hasMention` recipient is sent a
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
uniform (`#announcements` is `all`, `#chapter-audit` is `off`, and both are seeded into every
chapter), so a client assuming `mentions` for an absent row would misreport exactly the
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
unreachable on touch. Mobile does not yet expose the control; the levels it writes are already
honoured by the worker for every client.

Two states the control must not fake. When the effective level is **not yet known** — the read
has not landed, or failed — the trigger is disabled and announces "Notification level
unavailable" rather than standing in `mentions`, because on `#announcements` or `#chapter-audit`
that stand-in states the wrong level. When a write **fails**, the failure is reported in the
channel header, not inside the popover: the popover unmounts its content when dismissed, and
holding it open until the write lands freezes it whenever the mutation is paused offline. The
report is scoped to the channel the failed write was for — the mutation is shared by the whole
shell, so an unscoped error asserts a failure on channels the member never touched.

## Chat notification preferences

Chat-specific levels live in the `chat_notification_preferences` table (ADR-06), separately from the broader `notification_preferences` table because chat needs a tri-state (`all` / `mentions` / `off`) and two scope arms — per-channel and per-kind. Both arms are keyed by `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))` with a unique constraint that allows exactly one row per (scope, key).

That key is an **expression** index, which matters to anyone adding a write path: `ON CONFLICT (a, b, c)` only matches an index defined on those exact columns or expressions, and PostgREST's `on_conflict` parameter takes column names and cannot express `coalesce(...)`. So the channel-scoped upsert targets a second, plain unique index on `(user_id, chapter_id, scope, scope_id)` added by `20260829011200_chat_notif_prefs_channel_upsert_target.sql`. The two do not disagree: for `scope='channel'` rows the expression reduces to `scope_id::text`, which the table's CHECK already guarantees is non-null on that arm; for `scope='kind'` rows `scope_id` is NULL and unique indexes treat NULLs as distinct, so the second index constrains that arm not at all and the original still governs it.

Defaults when no row is set (see ADR-06; the `defaultLevelFor` helper encodes the precedence rules):

| Channel / kind                    | Default level |
| --------------------------------- | ------------- |
| `#announcements`                  | `all`         |
| `#chapter-audit`                  | `off`         |
| `system_audit` kind (any channel) | `off`         |
| `imported` kind (any channel)     | `off` (absolute — see below) |
| Every other channel               | `mentions`    |

Precedence in the push worker is **channel-pref ▶ kind-pref ▶ default**. A user who explicitly sets `(scope='kind', scope_kind='system_audit', level='all')` opts in to audit-bridge pushes; otherwise audit messages never page anyone.

**What the worker counts as an announcement** — `kind === 'announcement'` **or** a channel named `announcements` — decides the push's title, its URGENT priority, and its `announcements` category together, from one predicate. All three, because they must not disagree: the category once keyed on `kind` alone, so an ordinary message in an `announcements` channel went out titled "New Announcement" at URGENT while labelled `category: 'chat'`. Once URGENT became exempt from the category gate (#1041), that mismatch let those pushes escape the member's coarse **Chat** switch — the only control that had been silencing them. Note the consequence, which is real and deliberate: because the channel *name* feeds this predicate, ordinary conversation in a channel called `announcements` is delivered URGENT and is not mutable by any member-facing switch. Narrowing that heuristic is part of #1323.

**`imported` is the one kind with no opt-in.** `decidePush` refuses it ahead of every other rule, including the presence check and the mention override, and `ChatPushWorkerService.handleMessage` exits on it before it even loads the chapter roster — an import is thousands of rows arriving as fast as Postgres can write them through a Realtime handler with no backpressure, so deciding downstream would mean thousands of roster loads. The mention carve-out is the load-bearing half: imported bodies are years of prose full of `@name` tokens, and a mention lifts a muted channel's `off`, so a kind-level default alone would not hold. "Notify me about backfilled history" is not a setting anyone wants.

## Audit-log → `#chapter-audit` bridge

The bridge worker (see ADR-08) subscribes to `chapter_audit_log` INSERT via Supabase Realtime and posts a `kind='system_audit'` message into the chapter's `#chapter-audit` channel as the system sender (`00000000-0000-0000-0000-000000000000`). Rows with `member_visible=false` are skipped — internal-scope rows stay out of the channel.

Message shape:

- `sender_id`: the system sender.
- `content`: human summary (`"<action>: <diff keys>"`).
- `kind`: `system_audit`.
- `payload`: `{ action, actor_user_id, diff }` — the renderer reads from `payload`, not the prose `content`.

Chapters that pre-date the `#chapter-audit` channel have no mirror; the bridge logs and continues. The audit row itself is always the source of truth.

## Notification Triggers (Complete List)

| Domain        | Trigger                                                            | Priority                    |
| ------------- | ------------------------------------------------------------------ | --------------------------- |
| Chat          | @mention                                                           | NORMAL                      |
| Chat          | DM received                                                        | NORMAL                      |
| Chat          | New message in unmuted channel                                     | NORMAL                      |
| Announcements | New announcement posted                                            | URGENT                      |
| Events        | Upcoming event reminder (30min before — see below)                 | NORMAL                      |
| Events        | New event created                                                  | SILENT                      |
| Events        | Event updated (time/location change)                               | NORMAL                      |
| Points        | Points awarded                                                     | NORMAL                      |
| Points        | Points deducted (fine)                                             | NORMAL                      |
| Points        | Leaderboard position change                                        | SILENT (weekly digest)      |
| Study         | Session paused (app backgrounded)                                  | NORMAL (local notification) |
| Study         | Session expired                                                    | NORMAL                      |
| Study         | Geofence departure                                                 | NORMAL                      |
| Billing       | Invoice created (member)                                           | NORMAL                      |
| Billing       | Invoice due soon (3 days, 1 day before)                            | NORMAL                      |
| Billing       | Payment received                                                   | SILENT                      |
| Billing       | Subscription status change                                         | URGENT (for admin)          |
| Tasks         | Task assigned to you                                               | NORMAL                      |
| Tasks         | Task due soon (1 day before)                                       | NORMAL                      |
| Tasks         | Task overdue                                                       | NORMAL                      |
| Tasks         | Task marked completed (to creator, needs confirmation)             | NORMAL                      |
| Tasks         | Task completion confirmed (points awarded)                         | NORMAL                      |
| Service       | Service hours approved                                             | NORMAL                      |
| Service       | Service hours rejected                                             | NORMAL                      |
| Admin         | New member joined                                                  | NORMAL                      |
| Admin         | Invite accepted                                                    | SILENT                      |
| Admin         | Role change on a member                                            | SILENT                      |

## Pre-Event Reminders

`ScheduledJobsService.sweepEventReminders` runs every five minutes and pushes a NORMAL reminder for events starting inside `(now, now + 30min]`.

**Who gets one.** The event's _required_ members, resolved by `AttendanceService.resolveRequiredMembers` — the same call the auto-absent sweep makes, deliberately shared rather than reimplemented:

- **Role-targeted** (`required_role_ids` non-empty) → members holding an intersecting role, alumni included. This is what keeps the reminder inside the event's own visibility rule: a role-targeted event is invisible through `GET /v1/events` to a member without an intersecting role, and a reminder that resolved targeting differently would announce that event's name to them.
- **Mandatory, untargeted** → every member except alumni, who can neither check in to a non-targeted event nor self-excuse.
- **Optional and untargeted** → nobody. Such an event requires nothing of anyone, and knowing who _wants_ a reminder needs RSVP intent, which is not modelled yet (#1035).

**Lead time.** One fixed 30-minute window, `EVENT_REMINDER_LEAD_MINUTES` (#1548 tracks the per-member 1hr / 15min choice this table used to promise, which needs a preference column that does not exist). The constant is the window's _width_, not the delivery offset — an event created inside its own window, or one first seen by a catch-up tick, is already closer than 30 minutes. **The push therefore reports the real remaining time**, computed per send, never the constant; a member told "30 minutes" who actually has five would miss a mandatory event's check-in window and be auto-marked ABSENT.

**Delivery guarantees.** The sweep claims `(EVENT, event_id, 'EVENT_REMINDER', <event start date>)` in `scheduled_notification_dispatches` before sending, so a reminder survives multiple replicas and repeated ticks without duplicating — the same mechanism the invoice and task sweeps use. The claim key is derived from the event row, never from the clock, so every tick inside the window computes the same key. The audience is resolved **after** the claim is won, so the five losing ticks cost one failed insert each rather than a full chapter-roster read they would discard. A claim is released when _every_ delivery failed — or when the audience resolves to nobody — so a transient outage retries on the next tick while a partial success does not re-notify the members who already got it.

The window's lower bound is `now`, exclusive, so a reminder is never sent about an event that has already started: a backed-up or restarted worker sends nothing rather than a burst of "starting soon" pushes for events already underway.

**Two limits worth stating plainly**, because both fail silently:

- **No lookback.** Six ticks per event and no catch-up. A worker gap or read outage spanning the full 30 minutes drops that event's reminder permanently — no claim is written, nothing retries, and the sweep reports zero, which looks exactly like having no upcoming events. See [`DEPLOYMENT.md`](../../docs/internal/ops/DEPLOYMENT.md) §5.6 before scheduling a long evening maintenance window.
- **A same-UTC-day reschedule is not re-armed.** `scheduled_notification_dispatches.due_date` is a `date`, so moving an event from 14:00 to 20:00 the same day reuses the claim key and the second claim loses — the only reminder members got named the old time. Moving it across a UTC day boundary does re-arm. The separate "event updated" push softens this but does not replace the reminder. Widening the key needs a schema change shared with three other sweeps; tracked in #1550.

Quiet hours and the member's `events` category preference are **not** special-cased here. The sweep sends at `NotificationService.notifyUser`'s default NORMAL priority precisely so both apply — URGENT is the priority that bypasses them, and naming one here would silently opt reminders out of both.
