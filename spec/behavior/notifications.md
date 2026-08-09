# Notifications

## Decoupled Architecture

The Notification service exposes two methods:

- `notifyUser(userId, payload)` — sends to a specific user.
- `notifyChapter(chapterId, payload)` — sends to all members of a chapter.

Other modules (Chat, Events, Study, Billing) call these methods without knowing about push tokens, Expo, or delivery mechanics.

## Delivery Flow

1. Check the user's notification preferences for the payload's category. If disabled, skip.
2. Check quiet hours. If active and priority is not URGENT, queue as badge-only (no sound/vibration).
3. Save notification to `notifications` table (in-app history).
4. Fetch the user's `push_tokens`.
5. Send push notification via Expo Push Service with the appropriate priority.
6. If delivery fails (invalid token, Expo error), remove the invalid token from `push_tokens`.

## Deep Linking

Every notification payload includes a `target` object with screen and parameters:

```json
{
  "target": {
    "screen": "chat",
    "channelId": "uuid",
    "messageId": "uuid"
  }
}
```

Tapping the notification opens the app directly to the relevant content. If the user is not authenticated, the app shows the login screen first, then navigates to the target after authentication.

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

- The mobile preferences screen (`apps/mobile/app/(tabs)/preferences.tsx`) hydrates from AsyncStorage immediately for offline reads, then reconciles with the server via `useUserSettings` and `useNotificationPreferences` (from `@repo/hooks`) once an auth token is present in `expo-secure-store`.
- DM-alerts toggle maps to category `chat`; event-reminders toggle maps to category `events` (`PATCH /v1/notifications/preferences`).
- Notification preferences are chapter-scoped per the multi-tenancy invariant: reading (`GET /v1/notifications/preferences`) or writing (`PATCH /v1/notifications/preferences`) preferences for a `chapter_id` the caller is not an active member of returns `403 Forbidden`. The chapter here is supplied by the request (query/body), so membership is verified explicitly in the service rather than relying on the resolved active chapter.
- Members can view and edit quiet-hour start, end, and timezone on mobile, at parity with the web profile panel. Times are entered as 24-hour `HH:mm`; `HH:mm:ss` values returned by Postgres `time` columns are normalized to `HH:mm` for display and for writes.
- Quiet-hours toggle OFF `PATCH`es `null` for all three quiet-hour fields. Because "enabled" is _derived_ from a window being stored, disabling necessarily clears the member's times server-side — so the client remembers the last non-empty window under the `frapp.mobile.quiet-hours-window` AsyncStorage key.
- Quiet-hours toggle ON restores that window rather than overwriting it. The window is resolved in priority order: (1) the window the server currently reports, which is authoritative and covers a window set on another device; (2) the remembered window, which survives an app restart; (3) only for a member who has never had a window, the 22:00/08:00 defaults with the device timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
- Editing the window while quiet hours are OFF updates only the remembered window — it is not `PATCH`ed, because writing a window server-side would silently switch enforcement back on.
- When no auth token is present, all toggles persist locally only and sync state surfaces as "cached" so the UI doesn't claim server enforcement.

## Notification Grouping

Multiple notifications from the same source are collapsed on the device:

- Chat: "3 new messages in #general" (instead of 3 separate notifications).
- Events: "2 upcoming events today."

Grouping is handled client-side using notification category/thread identifiers provided in the payload.

## Badge Count

The app icon badge shows the total unread count: unread in-app notifications + unread chat messages across all channels. Badge count is updated on every notification delivery and when the user reads content.

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

## Chat notification preferences

Chat-specific levels live in the `chat_notification_preferences` table (ADR-06), separately from the broader `notification_preferences` table because chat needs a tri-state (`all` / `mentions` / `off`) and two scope arms — per-channel and per-kind. Both arms are keyed by `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))` with a unique constraint that allows exactly one row per (scope, key).

Defaults when no row is set (see ADR-06; the `defaultLevelFor` helper encodes the precedence rules):

| Channel / kind                    | Default level |
| --------------------------------- | ------------- |
| `#announcements`                  | `all`         |
| `#chapter-audit`                  | `off`         |
| `system_audit` kind (any channel) | `off`         |
| Every other channel               | `mentions`    |

Precedence in the push worker is **channel-pref ▶ kind-pref ▶ default**. A user who explicitly sets `(scope='kind', scope_kind='system_audit', level='all')` opts in to audit-bridge pushes; otherwise audit messages never page anyone.

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
| Events        | Upcoming event reminder (configurable: 1hr / 30min / 15min before) | NORMAL                      |
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
| Tasks         | Task completion confirmed (points awarded)                         | NORMAL                      |
| Service       | Service hours approved                                             | NORMAL                      |
| Service       | Service hours rejected                                             | NORMAL                      |
| Admin         | New member joined                                                  | NORMAL                      |
| Admin         | Invite accepted                                                    | SILENT                      |
| Admin         | Role change on a member                                            | SILENT                      |
