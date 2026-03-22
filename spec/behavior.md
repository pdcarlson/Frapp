# Behavior Specification: Frapp

This document defines the rules, invariants, edge cases, and error behavior that the system must uphold. Implementation (API, database, clients) must conform to these behaviors.

---

## 1. Multi-Tenancy

**Invariant:** Every resource query and mutation must be scoped to a `chapter_id`. No endpoint may return or modify data belonging to a chapter the requesting user is not a member of.

**Enforcement layers:**

1. **API middleware** — Extracts the active chapter from the request (header or JWT claim) and verifies the user is a member of that chapter.
2. **Database RLS** (where applicable) — Row-level security policies on Supabase ensure that even direct database access respects tenant boundaries.
3. **Schema** — Nearly all tables carry a `chapter_id` foreign key.

**Edge cases:**

- A user who is a member of multiple chapters must explicitly select which chapter is active. The API rejects requests where the chapter context is missing or mismatched.
- If a user's membership in a chapter is revoked mid-session, all subsequent requests for that chapter return 403 Forbidden.
- Cross-chapter data leaks are treated as critical security bugs.

---

## 2. RBAC — Open-Ended Permissions

### Permission Model

Permissions are **arbitrary strings**. Any string is valid as a permission.

Frapp publishes a **system permissions catalog** — these are the strings the API enforces on endpoints:

| Permission            | Grants                                                 |
| --------------------- | ------------------------------------------------------ |
| `*`                   | Wildcard — all actions                                 |
| `events:create`       | Create events                                          |
| `events:update`       | Edit events                                            |
| `events:delete`       | Delete events                                          |
| `members:invite`      | Generate invite tokens                                 |
| `members:remove`      | Remove members from the chapter                        |
| `members:view`        | View the full member directory                         |
| `points:adjust`       | Manually add/remove points                             |
| `points:view_all`     | View all members' transactions (not just own)          |
| `roles:manage`        | Create, edit, delete roles; assign roles to members    |
| `channels:create`     | Create chat channels                                   |
| `channels:manage`     | Edit/delete channels, pin messages, manage permissions |
| `announcements:post`  | Post in the #announcements channel                     |
| `billing:view`        | View subscription and invoice status                   |
| `billing:manage`      | Manage subscription, create member invoices            |
| `backwork:upload`     | Upload resources to Backwork                           |
| `backwork:admin`      | Manage courses, professors, delete resources           |
| `geofences:manage`    | Create/edit/delete study geofences                     |
| `polls:create`        | Create polls in channels                               |
| `tasks:manage`        | Create, assign, and confirm tasks                      |
| `chapter_docs:upload` | Upload documents to Chapter Files                      |
| `chapter_docs:manage` | Delete/organize documents in Chapter Files             |
| `service:log`         | Log service hours (typically all members)              |
| `service:approve`     | Approve or reject service hour entries                 |
| `semester:rollover`   | Trigger a new semester rollover                        |
| `reports:export`      | Export attendance, points, and roster reports          |

Chapters can define **custom permission strings** beyond this catalog. Custom permissions are used for:

- Channel gating (a channel can require any permission string, including custom ones).
- UI visibility hints (show/hide a tab or action based on permissions).
- Future extensibility (new API features can adopt existing custom strings without schema changes).

The system does NOT reject unknown permission strings. It stores and evaluates them for gating purposes the same way it handles system permissions.

### Permission Check Algorithm

1. Fetch the user's `role_ids` for the active chapter from `members`.
2. Fetch the `permissions` arrays for those roles from `roles`.
3. Flatten to a unique set.
4. If the set contains `*`, access is granted.
5. Otherwise, check that **all** required permissions for the endpoint are present in the set.

Permissions are never cached across requests. Each request freshly resolves the user's permission set, ensuring that role changes take effect immediately.

### Role Lifecycle

- On chapter creation, **default system roles** are seeded: President (`*`), Treasurer, Member, New Member, Alumni. Each has a sensible default permission set.
- System roles can be **renamed** and have their **permissions modified**, but cannot be deleted.
- Chapter admins with `roles:manage` can create unlimited **custom roles**.
- Roles have a **display_order** (integer, for UI sorting) and an optional **color** (hex string, for chat name colors like Discord).
- A user with no assigned roles has zero permissions (fail-safe closed).

### Presidency Transfer

The President role is a system role that always carries the `*` wildcard permission.

- **Transfer:** The current President assigns the President role to another member and removes it from themselves. This is a **single atomic operation** — the system never allows a chapter to have zero Presidents or two Presidents simultaneously.
- **Edge case:** If the President leaves the chapter (account deletion or manual removal by Frapp support), the system flags the chapter and prompts the next member with the highest-ranked admin role to claim the presidency. If no suitable member exists, Frapp support intervenes.
- **Safeguard:** Only the current President can initiate a presidency transfer. No other role (even with `roles:manage`) can assign or remove the President role.

### Edge Cases

- If a role is deleted while members still hold it, those members lose the permissions from that role on their next request (no stale cached permissions).
- If a chapter has only one member (the President), that member cannot remove themselves or cancel the presidency.
- Role names must be unique within a chapter. Attempting to create a duplicate returns 409 Conflict.

---

## 3. Backwork (Academic Library)

### Rich Metadata

Every uploaded resource carries the following metadata fields. **All fields except the file itself are optional** to allow graceful handling of incomplete information.

| Field                 | Type               | Description                                                                         |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| **Department**        | Free text          | e.g. "CS", "MATH", "ECON". Auto-vivified per chapter.                               |
| **Course number**     | Free text          | e.g. "101", "3320". Combined with department for display (e.g. "CS 101").           |
| **Professor name**    | Free text          | Auto-vivified per chapter.                                                          |
| **Year**              | Integer            | e.g. 2025.                                                                          |
| **Semester**          | Enum               | Spring, Summer, Fall, Winter.                                                       |
| **Assignment type**   | Enum               | Exam, Midterm, Final Exam, Quiz, Homework, Lab, Project, Study Guide, Notes, Other. |
| **Assignment number** | Integer (optional) | For "Homework 3", "Lab 2", "Exam 1", etc.                                           |
| **Document variant**  | Enum               | Student Copy, Blank Copy (professor-released), Answer Key.                          |
| **Tags**              | Text array         | Free-form for additional categorization.                                            |
| **File hash**         | String             | SHA-256 of the uploaded file. Used for duplicate detection.                         |

### Auto-Vivification

When a member provides a department or professor name that does not exist in the chapter's dictionary, the system automatically creates the corresponding record.

- Lookup is scoped to the chapter. "CS" in Chapter A is independent of "CS" in Chapter B.
- Auto-vivification is atomic with the resource creation (same transaction).
- Department records store the short code (e.g. "CS") and an optional full name (e.g. "Computer Science") that admins can fill in later.

### Duplicate Prevention

Unique constraint on (chapter_id, file_hash). If the exact same file (by hash) has already been uploaded to the chapter, the API returns 409 Conflict with a reference to the existing resource.

### Browsing and Search

- Resources are browsable by department, course, professor, semester/year, assignment type, and tags.
- Full-text search across title, tags, course name, and professor name.
- Results are always scoped to the user's active chapter.

### PDF Redaction (Phase: v2)

When uploading a Student Copy, the user can optionally redact personal information:

1. The in-app viewer renders the PDF page-by-page.
2. The user drags and resizes opaque black rectangles over areas to redact (name, student ID, handwriting, etc.).
3. On confirm, the app **rasterizes** each page to a flat image with the redaction boxes baked in. This is effectively a screenshot — the underlying text and PDF metadata are destroyed.
4. The rasterized version is what gets uploaded and stored. The original PDF is never sent to the server.
5. The storage record is flagged as `is_redacted: true`.

**Rationale:** Overlaying black boxes on an existing PDF does not prevent text selection of the underlying content. Rasterization ensures true redaction.

### AI Metadata Extraction (Phase: v3+)

On upload, an optional AI step parses the PDF and pre-fills metadata fields (department, course number, professor, assignment type, etc.). The user reviews and corrects before confirming. The data model and upload flow must not block this future capability (all metadata fields are optional; the upload endpoint accepts partial metadata).

---

## 4. Points Ledger — Security, Audit, and Atomicity

### Core Invariant

Every point change is a row in `point_transactions`. There is no mutable "balance" column. A member's balance is always computed as `SUM(amount) WHERE user_id = ? AND chapter_id = ?`.

### Atomic Point Awarding

When a user checks into an event:

1. Validate the event exists and belongs to the chapter.
2. Validate the user has not already checked in (unique constraint on event_id + user_id).
3. In a single database transaction:
   a. Insert `event_attendance` with status PRESENT.
   b. Insert `point_transactions` with amount = event.point_value, category = ATTENDANCE.
4. If either insert fails, the entire transaction rolls back.

### Admin Adjustments

- Only users with the `points:adjust` permission can manually add or remove points.
- Every manual adjustment requires a **reason** field (non-empty string). This is displayed in the transaction log alongside the adjustment.
- All admin point changes record the admin's user ID as `adjusted_by` in the transaction metadata. This creates an irrefutable audit trail.
- Categories for manual adjustments: MANUAL (reward) or FINE (penalty).

### Anti-Fraud

- **Append-only:** All transactions are immutable. No edits, no deletes. Corrections are new transactions with the inverse amount and a description referencing the original.
- **Rate limiting:** A single admin cannot create more than N point adjustments per hour (chapter-configurable, default 50). Exceeding the limit returns 429 Too Many Requests.
- **Anomaly flagging:** If a single transaction exceeds a configurable threshold (e.g. +/- 100 points, chapter-configurable), it is automatically flagged for review. Flagged transactions are visible in a dedicated "Audit" tab on the points ledger dashboard.
- **No self-adjustment:** An admin cannot award points to themselves. The API rejects `points:adjust` requests where the target user matches the requesting user.

### Leaderboard

- Chapter-scoped. Shows rank, member name, and total points.
- Configurable time window: all-time, this semester, this month.
- Visible to all members.
- Admins see the full transaction ledger for all members. Members see only their own transactions plus the leaderboard rankings.

### Edge Cases

- Negative balances are allowed. The system does not block fines even if the balance would go negative.
- If a member is removed from a chapter, their point history is preserved for audit purposes but they no longer appear on the leaderboard.
- Points awarded for study sessions and events cannot be manually reversed by the recipient; only admins can create offsetting transactions.

---

## 5. Chapter Billing (Stripe)

### Webhook Reliability

- Stripe webhooks are the **source of truth** for subscription status changes.
- Every webhook event is checked for idempotency using the Stripe event ID (never process the same event twice).
- Timestamp-aware: an older webhook event must not overwrite a newer subscription status.

### Edge Cases

| Scenario                                      | Handling                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| User pays but browser crashes before redirect | Webhook (`checkout.session.completed`) activates the chapter regardless.                                                                       |
| Stripe is down during chapter creation        | API returns 503 Service Unavailable. Chapter is NOT created in the database (no orphaned records).                                             |
| Webhook arrives before database commit        | Use upsert logic in the webhook handler; retry naturally on the next Stripe delivery.                                                          |
| Subscription lapses to `past_due`             | 3-day grace period. During grace: read access continues, invite/create actions blocked. After grace or upon `canceled`: hard lock (read-only). |
| Chapter has active members when canceled      | All members retain read access. No new actions. Data preserved indefinitely for re-activation.                                                 |
| Duplicate checkout attempts                   | Deduplicate by `stripe_customer_id` + chapter; prevent creating multiple subscriptions for the same chapter.                                   |

### Billing Adapter Pattern

Application logic talks to an `IBillingProvider` interface, never directly to the Stripe SDK. This allows future provider changes (e.g. LemonSqueezy) without touching business logic.

### Member Invoices (Dues)

- Admins with `billing:manage` create invoices for individual members (e.g. semester dues).
- Invoice statuses: DRAFT (not yet sent), OPEN (sent, awaiting payment), PAID, VOID.
- Payments tracked via Stripe PaymentIntents. Webhook confirms payment and moves invoice to PAID.
- Overdue invoices: if an invoice is OPEN past its `due_date`, a notification is sent to the member and the invoice is flagged as overdue in the admin dashboard.
- Financial transactions log all payments, refunds, and adjustments with Stripe charge IDs for reconciliation.

---

## 6. Chat — Discord/Slack/GroupMe Hybrid

### Channels

**Types:**

| Type       | Visibility                       | Who can post                     |
| ---------- | -------------------------------- | -------------------------------- |
| PUBLIC     | All chapter members              | All chapter members              |
| PRIVATE    | Invited members only             | Invited members only             |
| ROLE_GATED | Members with matching permission | Members with matching permission |
| DM         | Exactly two members              | Those two members                |
| GROUP_DM   | Selected members (up to 10)      | Those members                    |

- Channels can require **any permission string** (including custom chapter-defined permissions) for visibility and posting. This is how ROLE_GATED channels work — the `required_permissions` field holds one or more permission strings.
- **Channel categories** (like Discord): chapters can organize channels into named groups (e.g. "General", "Executive", "Committees"). Categories are display-only grouping with a sort order. Channels not assigned to a category appear in a default "Channels" group.
- **Default channels** created on chapter setup: `#general` (PUBLIC), `#announcements` (all-read, requires `announcements:post` to write), `#alumni` (ROLE_GATED, visible to Alumni role + active members).
- **Performance requirement:** chapter setup must seed default channels in one write operation to avoid N+1 insert latency.
- **Failure behavior:** chapter setup must fail if default channel seeding fails; the API must not return chapter-create success when channel seeding errors.

### Direct Messages

- **1-on-1:** Initiated by selecting a member. Creates (or reuses) a DM-type channel between exactly two users. Chapter-scoped.
- **Group DM:** User selects multiple members (up to 10). Creates a GROUP_DM-type channel. Chapter-scoped.
- DMs appear in a separate "Messages" section in the UI, not mixed with chapter channels.
- DMs are not role-gated; they are scoped by an explicit member list stored on the channel.
- A user can leave a Group DM. If only one member remains, the Group DM is archived.

### Messages

**Text formatting:** Messages support Markdown-like formatting — bold (`**text**`), italic (`*text*`), inline code (`` `code` ``), code blocks, and links. The client renders this; the server stores raw text.

**Reactions:**

- Any member in the channel can add emoji reactions to a message.
- Multiple distinct reactions per message. Each reaction tracks the count and the list of users who reacted.
- A user can add the same emoji only once per message. Adding it again removes the reaction (toggle).
- Reactions are stored in a `message_reactions` table (message_id, user_id, emoji, created_at). Unique on (message_id, user_id, emoji).

**File and image uploads:**

- Users can attach files to messages. Images render as inline previews; other files render as downloadable links with filename, size, and type.
- Files are stored in Supabase Storage under `chapters/{chapter_id}/chat/{channel_id}/{message_id}/{filename}`.
- Size limit: 25 MB per file. Configurable per chapter (admin setting).
- Allowed file types: images (JPEG, PNG, GIF, WebP), PDFs, and common document formats (DOCX, XLSX, PPTX, TXT, CSV). Executables and scripts are blocked.
- Upload flow: client requests signed URL from API, uploads directly to Storage, then sends message with attachment metadata.

**Reply threads:**

- A message can be a reply to another message via `reply_to_id`. The UI shows the replied-to message as a quote/preview above the reply.
- This is Discord-style reply-with-quote, not Slack-style nested threads. All replies appear in the main channel timeline.
- Replying to a reply references the root message (no deep nesting).

**Edit and delete:**

- A sender can edit their own messages. Edited messages display an "(edited)" indicator and store `edited_at` timestamp. The original text is not preserved (no edit history in v1).
- A sender can delete their own messages. Users with `channels:manage` permission can delete any message in channels they manage.
- Deleted messages are soft-deleted: content is replaced with "[message deleted]", `is_deleted = true`. Attachments for deleted messages are removed from Storage.

**Pinned messages:**

- Users with `channels:manage` permission can pin messages in a channel.
- Pinned messages are accessible via a dedicated "Pins" panel in the channel UI.
- A channel can have up to 50 pinned messages. Pinning a 51st requires unpinning an older one.
- Pinning a message sets `is_pinned = true` and `pinned_at` on the message.

**Typing indicators:**

- When a user starts typing in a channel, a lightweight ephemeral event is broadcast to other channel members via Supabase Realtime Broadcast (not persisted).
- Shows "User is typing..." below the message input.
- Typing indicator expires after 5 seconds of inactivity (no keystrokes).

**Online/offline presence:**

- Member online status is tracked via Supabase Realtime Presence.
- Presence heartbeat: ~30 seconds. If no heartbeat is received, the user is marked offline.
- Online status is visible in the member list sidebar and in DM conversations.
- Statuses: Online, Idle (app open but inactive for >5 minutes), Offline.

**Search:**

- Full-text search within a single channel or across all channels the user can access.
- Search returns message snippets with highlighted matches, grouped by channel.
- Search respects permissions: only messages from channels the user can see are returned.

### Announcements

- The `#announcements` channel is special: only members with `announcements:post` permission can send messages. All members can read.
- Posting to `#announcements` triggers a push notification to all chapter members (respecting their notification preferences).
- Announcement messages cannot be replied to in-thread (read-only channel for non-admins).

### Message Persistence

Every message is written to `chat_messages` in Postgres **before** being broadcast to connected clients. If realtime delivery fails, the message is still persisted and will appear on the next history fetch or page refresh.

### Read Receipts

Each user's last-read timestamp per channel is tracked in a `channel_read_receipts` table. Unread count per channel = count of messages created after the user's last-read timestamp for that channel.

---

## 7. Notifications

### Decoupled Architecture

The Notification service exposes two methods:

- `notifyUser(userId, payload)` — sends to a specific user.
- `notifyChapter(chapterId, payload)` — sends to all members of a chapter.

Other modules (Chat, Events, Study, Billing) call these methods without knowing about push tokens, Expo, or delivery mechanics.

### Delivery Flow

1. Check the user's notification preferences for the payload's category. If disabled, skip.
2. Check quiet hours. If active and priority is not URGENT, queue as badge-only (no sound/vibration).
3. Save notification to `notifications` table (in-app history).
4. Fetch the user's `push_tokens`.
5. Send push notification via Expo Push Service with the appropriate priority.
6. If delivery fails (invalid token, Expo error), remove the invalid token from `push_tokens`.

### Deep Linking

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

### Priority Levels

| Priority | Behavior                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------- |
| URGENT   | Plays sound even during Do Not Disturb. Used for emergency announcements and critical billing alerts. |
| NORMAL   | Standard notification with sound and vibration (respects device settings).                            |
| SILENT   | Badge-only. No sound, no vibration. Used for low-priority updates (e.g. weekly digest).               |

### Quiet Hours

- Per-user configurable start and end time (e.g. 10:00 PM to 8:00 AM).
- During quiet hours, NORMAL notifications are delivered as badge-only (no sound/vibration). URGENT notifications are unaffected.
- Quiet hours are timezone-aware (stored as UTC offsets). The implementation uses `Intl.DateTimeFormat` to convert the current UTC time to the user's timezone; midnight is normalized to hour 0 to handle locale-specific h24 hour cycles.

### Notification Grouping

Multiple notifications from the same source are collapsed on the device:

- Chat: "3 new messages in #general" (instead of 3 separate notifications).
- Events: "2 upcoming events today."

Grouping is handled client-side using notification category/thread identifiers provided in the payload.

### Badge Count

The app icon badge shows the total unread count: unread in-app notifications + unread chat messages across all channels. Badge count is updated on every notification delivery and when the user reads content.

### Per-Channel Mute

Users can mute specific chat channels. Muted channels:

- Do not generate push notifications for new messages.
- Still show unread indicators in the app when opened.
- @mentions in muted channels still generate notifications (override mute).

### Notification Triggers (Complete List)

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

---

## 8. Study Sessions — Foreground Enforcement

### Heartbeat Validation

- The client sends GPS coordinates every 5 minutes while the app is in the foreground.
- The server runs a point-in-polygon check against the selected geofence's coordinates.
- If the heartbeat shows the user is outside the polygon, the session status is set to EXPIRED and a notification is sent.
- If no heartbeat is received within 10 minutes, the session is marked EXPIRED (stale heartbeat).

### Anti-Distraction: Foreground Requirement

When a study session is active, the mobile app must remain in the **foreground**.

- If the app moves to the **background**, the session timer **pauses immediately**. The heartbeat timer stops.
- A local notification fires: "Your study session is paused. Return to Frapp to resume."
- If the user returns within a **grace window** (chapter-configurable, default 5 minutes), the timer resumes seamlessly and the next heartbeat is sent.
- If the user does **not** return within the grace window, the session auto-expires with status `PAUSED_EXPIRED`. Points are calculated only for the active (foreground) time accumulated before the pause.
- The API only receives heartbeats while the app is in the foreground. No heartbeat = paused or expired.

### Study Mode Screen

While a study session is active, the app displays a dedicated study mode screen:

- Large timer showing elapsed study time.
- Current geofence name and location status (inside/outside).
- Progress toward the next point award (e.g. "12 of 30 minutes toward next point").
- Motivational streak indicator (e.g. "3rd session this week").
- Minimal UI — no feeds, no chat, no distractions. Just the timer and status.
- A "Stop Studying" button to end the session.

### Points Award

- Points are awarded when the session reaches COMPLETED status (user manually stops via the study mode screen).
- Minimum session length must be met (chapter-configurable, default 15 minutes). Sessions shorter than the minimum award zero points.
- Points = `floor(total_foreground_minutes / minutes_per_point) * points_per_interval`. Both `minutes_per_point` and `points_per_interval` are chapter-configurable.
- The `points_awarded` flag on the session prevents double-awarding.
- Point transactions for study sessions include the session ID and geofence ID in the metadata for audit.

### Edge Cases

- If the app is force-killed or the device loses power, the heartbeat stops and the session expires after the stale-heartbeat timeout (10 minutes). The user is notified and can start a new session.
- If the user's GPS is spoofed or unreliable (accuracy > 100m), the heartbeat is rejected and the session is flagged. After 2 consecutive rejected heartbeats, the session is expired with status `LOCATION_INVALID`.
- A user can only have one active study session at a time. Starting a new session while one is active returns 409 Conflict.

---

## 9. Events & Attendance

### Event Creation

- Admins with `events:create` permission create events with: name, description, location (free text), start time, end time, point value (configurable, default 10), mandatory flag, and recurrence rule (optional).
- **Recurring events:** Admins can set a recurrence rule (weekly, biweekly, monthly). The system generates individual event instances according to the rule. Each instance can be individually edited or deleted. **Scope for edits and deletes** (web admin): **this instance only** (default API behavior), **this and future** (parent metadata plus all instances from the selected occurrence onward; time changes shift later instances by the same delta), or **entire series** (parent and all instances; `recurrence_rule` changes apply only on the parent row). **Deletes** that remove a series delete child instances before the parent so foreign keys remain valid. There is no background job that regenerates future instances from the parent after the initial create.
- **Role-based required attendance:** Events can specify which roles are required to attend via a `required_role_ids` field (text array, nullable). If set, only members with those roles are counted for attendance purposes. If null, the event is either mandatory for all members (`is_mandatory = true`) or optional. This enables targeted meetings (e.g. an exec meeting requires only officers; a scholarship committee meeting requires only members with a scholarship-related role).
- **Meeting minutes:** Events have an optional `notes` field (rich text / markdown). Editable by admins with `events:update` permission after the event. Visible to all members who have access to the event (based on required roles or chapter-wide for non-role-targeted events).

### Check-In

- Members check in via the mobile app (self-service).
- Check-in atomically creates an attendance record AND awards the event's point value (same database transaction).
- Check-in is only available during the event's time window (between start_time and end_time, with a configurable grace period after end_time, default 15 minutes).
- Unique constraint: one attendance record per (event, user). Double check-in returns 409 Conflict.
- For role-targeted events, only members with matching roles can check in. Members without the required role who attempt to check in receive a 403 Forbidden.

### Attendance Management

- Admins with `events:update` permission can view full attendance for any event.
- **Excuse workflow (admin-only):** Admins mark members as EXCUSED with an optional reason string. Members cannot self-submit excuses. Excused members are not penalized for mandatory events and do not appear as ABSENT in reports.
- Admins can also manually mark members as ABSENT or LATE after the event.
- Marking a member ABSENT who previously checked in (PRESENT) does NOT reverse the points already awarded. The admin must separately create a point adjustment if needed.
- **Auto-absent:** For mandatory or role-targeted events, members who are required to attend but did not check in and were not marked EXCUSED are auto-marked ABSENT after the grace period ends.

### Edge Cases

- If a role referenced in `required_role_ids` is deleted, that role is effectively ignored for attendance purposes (members who previously held it are no longer required).
- If an event's point value is changed after some members have already checked in, only future check-ins use the new value. Already-awarded points are not retroactively adjusted.

---

## 10. Onboarding and Invites

### Invite Token Rules

- Tokens expire after 24 hours.
- A token can only be used once (`used_at` is set on redemption).
- If a token is expired or already used, the API returns 410 Gone.
- Each token carries a `role` that determines the joining member's initial role.
- Only users with the `members:invite` permission can generate tokens.
- Admins can generate multiple tokens at once (batch invite). Batch creation is optimized to use a single bulk database operation to minimize network roundtrips and ensure efficiency.

### Edge Cases

- If a user already has an account and is a member of the chapter, attempting to use an invite token for the same chapter returns 409 Conflict.
- If the chapter's subscription is not active, generating invite tokens returns 402 Payment Required.
- If the token's role has been deleted between token creation and redemption, the user is assigned the default "Member" role instead.

---

## 11. Polls and Voting

- Users with `polls:create` permission can create polls in any channel they have access to.
- A poll has a question, 2-10 options, and an optional expiration time.
- Members in the channel can vote. One vote per member per poll (single-choice by default; multi-choice is a poll option).
- When a member submits a new vote, the system treats it as a full replacement of that member's prior selection set for the poll.
- For multi-choice polls, the replacement flow clears existing votes for `(message_id, user_id)` in a single scoped delete operation before inserting the newly selected options.
- Results are visible in real-time as votes come in.
- Once expired (or manually closed by the creator), the poll is locked — no more votes.
- Polls are stored as a special message type (`type: POLL`) in `chat_messages` with poll data in `metadata`, plus a `poll_votes` table for individual votes.

---

## 12. Member Directory and Profiles

- Every chapter has a searchable member directory.
- Each member has a profile card showing: display name, profile photo, role(s), point balance, join date, and optional bio.
- Profile photos are stored in Supabase Storage under `chapters/{chapter_id}/profiles/{user_id}`.
- Members can edit their own display name, bio, and profile photo. Admins with `members:view` permission can view all profiles.
- Search by name, role, or join date.

---

## 13. Activity Feed

The home screen shows a unified activity feed for the user's active chapter:

- Recent events: new event created, event starting soon.
- Backwork: new resource uploaded.
- Points: points awarded or deducted (own).
- Members: new member joined.
- Announcements: latest announcement.

Feed items are pulled from existing data (events, point_transactions, backwork_resources, members, chat_messages where channel = announcements). This is a **read-only aggregation view**, not a separate data store.

---

## 14. Global Search

A single search bar accessible from the top of the mobile and web app:

- Searches across: Backwork resources (title, department, course, professor, tags), chat messages (content), events (name, description), and members (name).
- Results are grouped by domain (Backwork, Chat, Events, Members).
- All results respect chapter scoping and permission checks (chat messages from channels the user cannot access are excluded).
- Implementation: Postgres full-text search (`tsvector` / `to_tsquery`) on relevant columns.

---

## 15. Calendar Integration

- Events display an "Add to Calendar" action.
- Tapping it generates an `.ics` file (or deep-links to the device's calendar app on mobile) with event name, description, location, start/end time, and a link back to the event in Frapp.
- Recurring events generate recurring calendar entries.

---

## 16. Dark Mode

- Full dark mode support across web and mobile.
- Respects the device/OS system preference by default.
- Manual override available in user settings (Light, Dark, System).
- The "Modern Ivy" color palette has dark-mode variants defined in the theme package.

---

## 17. Observability

### Structured Logging

Every API request is logged as structured JSON with: request ID, user ID, chapter ID, endpoint, HTTP method, status code, response latency, and timestamp.

### Request Tracing

A unique `x-request-id` header is generated for each incoming request (or preserved if the client sends one). This ID is included in all log entries and all error responses, enabling end-to-end tracing.

### Health Check

`GET /health` returns service status, database connectivity, Supabase connectivity, and uptime. Used by monitoring tools and load balancers. No authentication required.

### Error Tracking

Integrate with Sentry (or equivalent). All unhandled exceptions and 5xx responses are reported with full context (request ID, user ID, chapter ID, stack trace). PII is scrubbed before reporting.

### Metrics

Key metrics exported for monitoring dashboards:

- Request rate (per endpoint, per status code).
- Error rate (4xx, 5xx).
- Response latency (p50, p95, p99).
- Active WebSocket / Realtime connections.
- Active study sessions.
- Push notification delivery success/failure rate.

### Alerting

Configurable alerts (via the monitoring provider) for:

- Error rate exceeds threshold (e.g. >5% 5xx in 5 minutes).
- API downtime (health check fails).
- Database connection pool exhaustion.
- Stripe webhook processing failures.
- Push notification delivery failure spike.

---

## 18. Error Handling Standards

All API errors follow a consistent shape:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Event with id abc123 not found in this chapter.",
  "requestId": "req_abc123def456"
}
```

- Internal errors (500) never expose database details or stack traces. The `requestId` enables support to locate the full error in logs.
- All errors are logged with structured context: `[ServiceName] message | detail: {...} | requestId: ... | error: stack`.
- Validation errors (400) return the full list of field-level issues from the validation pipe.
- Rate limit errors (429) include a `Retry-After` header.

---

## 19. Security Invariants

- All API endpoints (except `/health` and webhooks) require authentication.
- All data access is scoped by `chapter_id`. No cross-chapter data access is possible through any endpoint.
- Webhook endpoints (Stripe) verify signatures before processing. Invalid signatures return 401 and are logged as security events.
- File uploads are scanned for allowed MIME types. Disallowed types are rejected before storage.
- Rate limiting is applied per user per endpoint to prevent abuse. Default: 100 requests/minute for read endpoints, 30 requests/minute for write endpoints. Chapter-configurable overrides for specific endpoints (e.g. chat send message may have a higher limit).
- Passwords are never stored by Frapp. Authentication is delegated entirely to Supabase Auth.
- All secrets (Supabase keys, Stripe keys) are injected via environment variables. Never committed to version control. Never logged.

---

## 20. Service Hours (Philanthropy / Community Service)

A dedicated tracker for community service and philanthropy hours, separate from study hours.

### Logging

- Members with the `service:log` permission log service entries: date, duration (hours and minutes, stored as `duration_minutes`), description (what they did), and optional proof (file upload — photo, PDF, etc.).
- Proof files are stored in Supabase Storage under `chapters/{chapter_id}/service/{entry_id}/`.
- All entries are chapter-scoped.

### Approval Workflow

- New entries start with status PENDING.
- Admins with `service:approve` permission review entries and mark them APPROVED or REJECTED with an optional comment.
- **On approval:** A point transaction is automatically created (category: SERVICE) based on a chapter-configurable rate (e.g. 1 point per 60 minutes of service). The `points_awarded` flag on the entry prevents double-awarding.
- **On rejection:** No points are awarded. The member is notified with the admin's comment.
- Admins can view all PENDING entries in a dedicated queue on the web dashboard.

### Visibility

- Members see their own service history (all statuses) and a chapter-wide service leaderboard (total approved hours).
- Admins see all entries for all members with filtering by status, date range, and member.

### Edge Cases

- If an admin accidentally approves an entry, they can change the status back to REJECTED. If points were already awarded, a separate point adjustment is required (the system does not auto-reverse).
- Service entries cannot be edited after submission. If the member made an error, they delete the entry and resubmit (only possible while status is PENDING).

---

## 21. Tasks

A lightweight task management system for chapter operations.

### Task Lifecycle

- Admins with `tasks:manage` permission create tasks with: title, description (optional), assignee (single member), due date, and optional point reward on completion.
- Task statuses: TODO → IN_PROGRESS → COMPLETED. Tasks past their due date that are not COMPLETED are flagged as OVERDUE.

### Assignee Actions

- The assignee can mark their task IN_PROGRESS (signals they are working on it) or COMPLETED (signals they are done).
- Marking a task COMPLETED does not immediately award points. An admin must **confirm** completion.

### Admin Confirmation

- When an assignee marks a task COMPLETED, the admin is notified.
- The admin reviews and confirms completion. On confirmation:
  - If a point reward is attached, a point transaction (category: MANUAL, with task ID in metadata) is created for the assignee.
  - The `confirmed_at` timestamp is set.
- The admin can reject the completion (revert to IN_PROGRESS) with an optional comment.

### Notifications

- Assignee is notified when a task is assigned to them.
- Assignee is notified 1 day before the due date if the task is not COMPLETED.
- Assignee and admin are both notified when a task becomes OVERDUE.
- Assignee is notified when completion is confirmed (and points are awarded).

### Visibility

- Tasks are chapter-scoped.
- The assignee sees their own tasks.
- All admins (users with `tasks:manage`) see all tasks.
- Members without `tasks:manage` only see tasks assigned to themselves.

---

## 22. Chapter Documents

A "Chapter Files" storage area for organizational documents (bylaws, constitutions, meeting agendas, etc.), separate from Backwork which is strictly for academic materials.

### Permissions

- `chapter_docs:upload` — Upload new documents.
- `chapter_docs:manage` — Delete documents, create/rename/delete folders.
- All members can view and download documents regardless of permissions.

### Structure

- Documents are organized into an optional flat folder structure (one level deep). A document belongs to zero or one folder.
- Folders have a name and a sort order. Documents without a folder appear in a root "All Files" view.

### Metadata

Each document has: title, description (optional), folder (optional), storage path, uploaded_by (FK users), and created_at. No academic metadata (no department, professor, assignment type, etc.).

### Storage

Files are stored in Supabase Storage under `chapters/{chapter_id}/documents/{document_id}/{filename}`.

### Edge Cases

- Deleting a folder moves its documents to the root level (no cascading delete of files).
- Document titles do not need to be unique. Duplicate file content (same hash) is allowed since organizational documents may be legitimately duplicated (e.g. updated versions).

---

## 23. Semester Rollover

Admins with `semester:rollover` permission can trigger a "New Semester" action from chapter settings.

### On Rollover

1. The current leaderboard period is archived with a label (e.g. "Fall 2025") and a date range. This is stored in a `semester_archives` table.
2. A new leaderboard period begins. Points continue to accumulate in `point_transactions` (no data is deleted), but the leaderboard view defaults to the new period. Historical periods remain selectable in a dropdown.
3. Admins are prompted with an option to bulk-transition members from the "New Member" role to the "Member" role (pledge promotion). This is optional and can be done individually as well.
4. Study session configurations (geofences, reward rates, minimum session lengths) carry forward unless manually changed.

### Historical Data

- All historical semesters are viewable in the leaderboard, reports, and attendance views via a semester/period selector.
- Point transactions, attendance records, and service entries are timestamped and can always be filtered by date range regardless of semester archives.

### Edge Cases

- A chapter can only trigger a rollover once per calendar month (prevents accidental double-rollover). Attempting a second rollover within the same month returns 409 Conflict.
- If no semester archive exists yet (brand new chapter), the leaderboard shows "All Time" as the default period.

---

## 24. Reports and Export

Admins with `reports:export` permission can generate and download reports from the web dashboard.

### Available Reports

| Report            | Scope                      | Columns                                                                                     |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| **Attendance**    | Per event or date range    | Member name, event name, date, status (PRESENT/ABSENT/EXCUSED/LATE), check-in time          |
| **Points**        | Per member or chapter-wide | Member name, total points, breakdown by category (ATTENDANCE, SERVICE, STUDY, MANUAL, FINE) |
| **Member roster** | Current members            | Name, email, role(s), join date, point balance                                              |
| **Service hours** | Per member or chapter-wide | Member name, date, duration, description, status (APPROVED/PENDING/REJECTED)                |

### Export Flow

1. Admin selects report type, scope, and date range on the web dashboard.
2. API generates the file (CSV or PDF).
3. API returns a signed download URL (valid for 1 hour).
4. Admin downloads the file.

### PDF Formatting

PDF reports use a clean, branded template with:

- Chapter name and logo (if uploaded) in the header.
- Frapp branding in the footer.
- Report title and date range.
- Tabular data with alternating row shading for readability.

---

## 25. Legal (Terms of Service, Privacy Policy, FERPA)

### Terms of Service

- Displayed on the landing site (frapp.live/terms) and linked from the app footer.
- Accepted during chapter creation (onboarding step): the admin must check a "I agree to the Terms of Service and Privacy Policy" checkbox before proceeding to payment.
- Covers: acceptable use policy, data ownership (chapters own their data; Frapp has a license to host and process it), limitation of liability, subscription terms and auto-renewal, account termination conditions.

### Privacy Policy

- Displayed on the landing site (frapp.live/privacy) and linked from the app footer.
- Covers: what data is collected (account info, location data for study hours, uploaded files, chat messages), how data is used (to provide the service, not sold to third parties), third-party services (Supabase, Stripe, Expo Push), data retention (see section 26), user rights (access, correction, deletion on request), cookies and analytics.

### FERPA Notice

- A specific callout (frapp.live/ferpa) that Backwork materials are shared voluntarily by members.
- Frapp is not an educational institution and does not access student education records.
- Members are responsible for ensuring they have the right to share uploaded materials.
- Members are encouraged to use the redaction feature to remove personal information before uploading.

### In-App Placement

- All three legal pages are linked from:
  - The landing site footer.
  - The web app and mobile app settings/about screen.
  - The chapter creation onboarding flow (ToS and Privacy Policy acceptance).

---

## 26. Data Retention

### Chapter Cancellation

- When a chapter's subscription is canceled, all data is preserved **indefinitely** in read-only mode.
- Members can still log in and view all existing data (chat history, Backwork, points, events, etc.) but cannot create new content, invite members, or perform any write operations.
- If the chapter re-activates (resumes payment), full access is restored immediately with no data loss.

### Individual Account Deletion

- On request (via settings or support), a user's personally identifiable information (PII) is scrubbed: email, display name, bio, avatar, profile photo.
- Their point transactions, attendance records, chat messages, and service entries are preserved but **anonymized** — attributed to "Deleted User" with a null user reference.
- The user's Supabase Auth account is deleted.
- This is irreversible.

### Inactive Chapter Cleanup

- Frapp reserves the right to delete data for chapters that have been inactive (canceled subscription, no logins) for more than 2 years.
- This is documented in the Terms of Service.
- Before deletion, an email notification is sent to the last known admin email with a 30-day warning.

---

## 27. Alumni Features

### Alumni Role

Alumni is a system role seeded on chapter creation with limited default permissions: read access to chat (cannot post in most channels), view Backwork, view member directory. No points accumulation, no event check-in, no study hours.

### Alumni Directory

- A separate, searchable directory of alumni members.
- In addition to the standard profile fields (name, role, join date), alumni can self-report: graduation year, current city, and current company/organization.
- The alumni directory is visible to all chapter members (active and alumni).
- Search/filter by graduation year, city, or company.

### Alumni Chat Channel

- A default `#alumni` channel is seeded on chapter creation alongside `#general` and `#announcements`.
- `#alumni` is ROLE_GATED: visible to members with the Alumni role AND active members. This allows current brothers and alumni to communicate.

### Donation Link

- Chapter settings include an optional `donation_url` field.
- If set, a "Support the Chapter" button/link appears in the mobile app for alumni members.
- Frapp does not process donations. The link opens an external URL (e.g. a university giving page or a Venmo link).

---

## 28. Onboarding Tutorial

When a new member joins a chapter (via invite token), they see a guided walkthrough on their first app launch.

### Walkthrough Screens

1. **Welcome** — Chapter name and logo (if uploaded). "Welcome to [Chapter Name] on Frapp!"
2. **Chat** — Brief overview: "This is where your chapter communicates. Channels, DMs, and announcements."
3. **Events** — "Check in to earn points. Never miss a meeting."
4. **Backwork** — "Find study materials uploaded by your brothers."
5. **Study Hours** — "Earn points by studying at approved locations."
6. **Profile Setup** — Prompt to set display name, upload a profile photo, and write a short bio.
7. **Done** — "You're all set! Start exploring." CTA to the home feed.

### Behavior

- The tutorial can be skipped at any point via a "Skip" button.
- The tutorial can be revisited from the settings screen (Profile > "Replay Tutorial").
- The walkthrough adapts to the surface: on mobile it is a swipeable card stack; on web it is a modal slideshow.
- A `has_completed_onboarding` flag is stored on the member record to control whether to show the tutorial.

---

## 29. Chapter Branding

### Logo

- Chapters can upload a logo image (PNG, JPG, WebP; max 2 MB).
- The logo is displayed in: the app header/sidebar, the member directory, exported PDF reports, and the onboarding tutorial welcome screen.
- Logo stored in Supabase Storage under `chapters/{chapter_id}/branding/logo.{ext}`.
- If no logo is uploaded, the chapter name is displayed as text.

### Custom Accent Color

- Chapters can set a custom accent color (hex string, e.g. `#8B0000` for crimson).
- The accent color is used for: primary buttons, links, active tab indicators, and highlights throughout the app for that chapter's members.
- Default accent color (if none set): Frapp's Royal Blue `#2563EB`.
- Accent color is stored on the `chapters` table.

### Brand Boundaries

- Chapter branding applies only within the chapter context (when a user is viewing that chapter's data).
- The Frapp brand (navigation shell, splash screen, landing site, docs site) is NOT affected by chapter branding.
- Accent color must meet WCAG AA contrast requirements against the background. The API validates this on save and rejects colors with insufficient contrast.

### React Query Hooks Testing
- All React Query hooks related to roles (like `useRoles`, `useCreateRole`) are tested in `packages/hooks/src/use-roles.spec.tsx`. They verify successful requests and cache invalidation rules (e.g. `queryClient.invalidateQueries({ queryKey: ["roles"] })`).
