# Chat — Discord/Slack/GroupMe Hybrid

## Chat is the spine

Chat is not a module — it is the spine of the app, and every other capability (events, tasks, dues, points, polls) is a **chat integration** surfaced inline in conversation rather than behind a separate nav tab. The mobile app opens directly into chat.

- **Chat is non-optional. It cannot be disabled.** Every chapter always has, at minimum: `#general` (everyone, default landing), `#announcements` (exec-write, member-read, push by default), `#chapter-audit` (system-write only, member-read — the audit feed), and DMs / group DMs (always on).
- **Modules-as-integrations.** When an ops module is enabled it does not get a top-level nav tab first. It gets: (1) one or more **slash commands** in chat, (2) a **rich message renderer** that turns the artifact into an inline card with primary actions (RSVP / Done / Vote / Pay / Confirm / Submit), (3) a **system channel** where the module's notifications land (`#events`, `#dues`, etc.) so the firehose doesn't drown `#general`, and (4) *optionally* a secondary dashboard page for the longer-form view. The dashboard is secondary to the chat experience, never primary.
- **Slash-command dispatch** is the entry point for module actions — a treasurer typing `/dues remind overdue` in `#general` gets a rich card inline, no tab-switching. The command catalog, dispatch path, and renderer registry are specified in [integrations.md](./integrations.md).
- Disabling a paid module hides its slash commands, mutes its system channel, and hides its dashboard page.

## Channels

**Types:**

| Type       | Visibility                       | Who can post                     |
| ---------- | -------------------------------- | -------------------------------- |
| PUBLIC     | All chapter members              | All chapter members              |
| PRIVATE    | Invited members only             | Invited members only             |
| ROLE_GATED | Members with matching permission | Members with matching permission |
| DM         | Exactly two members              | Those two members                |
| GROUP_DM   | Selected members (up to 10)      | Those members                    |

- Channels can require **any permission string** (including custom chapter-defined permissions) for visibility and posting. This is how ROLE_GATED channels work — the `required_permissions` field holds one or more permission strings.
- **Channel-access enforcement (multi-tenancy + RBAC invariant).** Every chat read, send, reaction, poll, and search result is authorized from a **trusted DB lookup** — channel → chapter → membership (and, for `ROLE_GATED`, the caller's effective permissions) — never from a client-supplied chapter/channel field. The decision is a single shared predicate (`canAccessChannel` in `@repo/validation`), and its DB wiring is centralized in one injectable, `ChannelAccessService` (`assertChannelAccess` for a single channel, `filterAccessibleChannelIds` for list/batch surfaces). Every chat **and poll** code path in the NestJS API routes through it (cold reads, the hot-path send/react controller, search, and all poll create/read/vote operations), so the surfaces cannot drift:
  - `PUBLIC` → any chapter member; `PRIVATE`/`DM`/`GROUP_DM` → the user must be in the channel's `member_ids`; `ROLE_GATED` → the user must hold `*` or one of `required_permissions`, and an **empty or absent** requirement list denies rather than falling open (a channel that gates on nothing is a misconfiguration, not a public channel); an unknown type denies. The API rejects creating or updating a ROLE_GATED channel without requirements, and the seeder always persists them, so the closed branch cannot strand a real channel.
  - Reading or reacting in a channel the caller cannot see (including one in another chapter) returns **403** (or **404** if the channel/message id does not resolve within the caller's chapter). A `reply_to_id` must reference a message in the **same** channel.
  - **Alumni lifecycle (authored content only).** On `operation: 'post'` the predicate additionally denies Alumni-role members outside direct conversations and `ROLE_GATED` channels that explicitly require `alumni:post` (`#alumni` in a default chapter) — reads are unaffected, and `*` bypasses. **Editing** authorizes as a `'post'` for the same reason, so the rule cannot be sidestepped by rewriting an older message. `operation: 'vote'` is a write that clears the same read-only gate but is *exempt* from the lifecycle rule, since voting in a poll one can read is participation, not posting; reactions and message actions authorize as reads and are likewise open. The flag is resolved only when it can change the outcome — an authored post into a channel alumni cannot write in, decided by the same `isAlumniPostableChannel` predicate the gate uses — reusing the membership row already loaded, so reads, votes, and DM posts add no query to the hot path. See [alumni.md](../alumni.md).
  - **Service-role (RLS-bypassing) writes in `ChatService` perform this membership/channel-access pre-check before the insert.** Resolving the actor from the JWT (`SupabaseAuthGuard`) is necessary but not sufficient — authorization (may this actor touch this channel/message?) is independent and mandatory.
  - **Direct client reads are backstopped by RLS.** Most chat tables are default-deny (the API reads them with the service-role key), but `chat_message_actions` (reactions / votes) is read **directly** by the web client under the user's JWT — a per-channel backfill plus a *global* Supabase Realtime subscription where RLS is the only gate. Its `SELECT` policy therefore enforces the same visibility as `canAccessChannel` at the database layer, via a `SECURITY DEFINER` helper `public.can_read_chat_message(message_id)` (channel → chapter → membership, with `member_ids` for `PRIVATE`/`DM`/`GROUP_DM` and role permissions for `ROLE_GATED`). This closes a cross-chapter / private-DM / role-gated action-read leak (FRA-38); the app-layer pre-check on writes is unchanged.
  - **Search is not a side-channel:** `GET /v1/search` filters chat-message hits to channels the caller can read, using the same predicate. Snippets never include messages from inaccessible (private/DM/role-gated/other-chapter) channels. The same rule applies to the chapter-wide poll list (see `polls.md`).
- **Channel categories** (like Discord): chapters can organize channels into named groups (e.g. "General", "Executive", "Committees"). Categories are display-only grouping with a sort order. Channels not assigned to a category appear in a default "Channels" group.
- **Default channels** created on chapter setup (`DEFAULT_CHANNELS` in `apps/api/src/domain/constants/permissions.ts`): `#general` (PUBLIC), `#announcements` (all-read, requires `announcements:post` to write), `#chapter-audit` (PUBLIC, read-only — system-write audit feed, all members read), `#alumni` (ROLE_GATED, `required_permissions: ['members:view', 'alumni:post']` — `members:view` is held by every seeded role, so it stays visible to the Alumni role + active members, while `alumni:post` is what makes it the one seeded channel alumni may write in).
- **Seeding happens at chapter creation (applies to all tiers)** — both `POST /v1/chapters` and the onboarding submit `POST /v1/chapters/onboard` seed channels. It is **not** gated on billing/subscription. `#chapter-audit` is required so the audit bridge (and the onboarding welcome message) have a destination.
- **Welcome message on onboarding submit.** When a chapter is created via the onboarding wizard submit, a one-time welcome `system_audit` message is seeded into `#chapter-audit` (the user lands on `/chat?channel=general`): `"Welcome to <Greek letters> <designation>. Invite your chapter to get the conversation started."` This is the first message every new chapter sees.
- **Performance requirement:** chapter setup must seed default channels in one write operation to avoid N+1 insert latency.
- **Failure behavior:** chapter setup must fail if default channel seeding fails; the API must not return chapter-create success when channel seeding errors.

## Direct Messages

- **1-on-1:** Initiated by selecting a member. Creates (or reuses) a DM-type channel between exactly two users. Chapter-scoped.
- **Group DM:** User selects multiple members (up to 10). Creates a GROUP_DM-type channel. Chapter-scoped.
- DMs appear in a separate "Messages" section in the UI, not mixed with chapter channels.
- DMs are not role-gated; they are scoped by an explicit member list stored on the channel.
- A user can leave a Group DM. If only one member remains, the Group DM is archived.
- **Privacy invariant:** DMs and group DMs are **never** part of the [AI corpus](../ai.md). They are not indexed for AI Q&A, not used as summarization context, and not surfaced via citations. This is enforced server-side regardless of any chapter-level AI consent settings — opting in to AI does not opt in DMs.
- **System DM on invite accept.** When a member accepts an invite, the inviter receives a `kind="system_audit"` message in their DM channel with that member — `"Alex Chen accepted your invite."` This is the same server-originated system-message pattern as the audit bridge, but targeted to a DM rather than `#chapter-audit`.

## Messages

**Text formatting:** Messages support Markdown-like formatting — bold (`**text**`), italic (`*text*`), inline code (`` `code` ``), code blocks, and links. The client renders this; the server stores raw text.

**Reactions:**

- Any member in the channel can add emoji reactions to a message.
- Multiple distinct reactions per message. Each reaction tracks the count and the list of users who reacted.
- A user can add the same emoji only once per message. Adding it again removes the reaction (toggle).
- Reactions are stored in a `message_reactions` table (message_id, user_id, emoji, created_at). Unique on (message_id, user_id, emoji).
- **Hot-path idempotency (`ChatService.recordMessageAction`).** Per-user actions on the hot path are written to `chat_message_actions`, deduped by the DB unique index `(message_id, user_id, action_type)`. The write is **atomic** — a single insert, with a unique-violation (`23505`) treated as a successful dedup (`deduplicated: true`), never a read-then-insert TOCTOU and never a 5xx. Concurrent identical reactions therefore yield exactly one row.

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
- A sender can delete their own messages. Users with `channels:manage` permission can delete any message in channels they manage. The permission is resolved **in the message's own chapter, after channel access is confirmed** — holding `channels:manage` in the caller's active chapter grants nothing over a message in another one.
- Edit, delete, pin and unpin all authorize through the same channel-access lookup as reads: a message whose channel does not resolve within the caller's active chapter returns 404, and sender ownership alone is never sufficient (a member removed from a chapter must not keep editing their history there).
- Deleted messages are soft-deleted: content is replaced with "[message deleted]", `is_deleted = true`. Attachments for deleted messages are removed from Storage.

**Pinned messages (chapter-elevated):**

- Users with `channels:manage` permission can pin messages in a channel.
- Pinned messages are accessible via a dedicated "Pins" panel in the channel UI.
- A channel can have up to 50 pinned messages. Pinning a 51st requires unpinning an older one.
- Pinning a message sets `is_pinned = true` and `pinned_at` on the message.
- Pin is the **chapter-public** elevation: the message becomes durable and prominent for everyone who can see the channel. Pinning is the right answer for chapter-wide important content.

**Bookmarks (personal):**

- Any member can bookmark any message they can see. Bookmarks are **private to the bookmarker** — no one else (not even channel admins) can see who bookmarked what.
- Bookmarked messages appear in a personal "Bookmarks" view, scoped per chapter.
- A bookmark does not affect the underlying message's lifecycle. If the original message is deleted, the bookmark surfaces a "[message deleted]" placeholder.
- Bookmarks are the right answer for "I want to remember this myself" without elevating to chapter-wide visibility.

**No sender-extend on ephemerality.** Senders cannot extend the lifetime of their own message past channel retention rules. The two ways content becomes durable are a chapter-elevated **pin** (visible to everyone who can see the channel) or a **bookmark** (private to the bookmarker). This keeps ephemerality real — there's no third path that lets a sender unilaterally make their own content stick around.

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

## Announcements

- The `#announcements` channel is special: only members with `announcements:post` permission can send messages. All members can read.
- Posting to `#announcements` triggers a push notification to all chapter members (respecting their notification preferences).
- Announcement messages cannot be replied to in-thread. The rule is a property of the **channel**, not the caller: it is keyed off `is_read_only` (so it covers `#chapter-audit` and any chapter-created read-only channel, and survives a chapter renaming its announcements channel), and it holds regardless of permissions — a member with `announcements:post`, and the President's `*`, are refused a threaded reply just the same. `announcements:post` governs who may author a **top-level** announcement; nobody threads one. Enforced by `allowsInThreadReplies` in `@repo/validation`, called from `ChatService.sendMessage`.
- **Which status a rejected reply gets depends on who is asking**, because channel access is authorized first. A member *without* `announcements:post` is refused by the channel-access gate before the reply is ever inspected, so they get **403** ("You do not have access to this channel") — the same answer they get for a top-level post. Only a caller who *may* post there (`announcements:post`, or `*`) reaches the reply rule, and they get **400** ("Messages in a read-only channel cannot be replied to in-thread"), matching the cross-channel `reply_to_id` rejection described above. A client that wants to explain "this channel doesn't take replies" must therefore key off the 400, and must not assume a 403 here means the reply specifically was the problem.

## Slash Commands and Integrations

Slash commands turn chat into the dispatcher for every ops module. The full command catalog, slash-command dispatch path (simple vs heavy commands), announcement gating, vote-change semantics, the rich-message renderer registry, and the audit bridge are specified in [integrations.md](./integrations.md). Push-notification behavior for chat lives in [../notifications.md](../notifications.md).

## Message Persistence

Every message is written to `chat_messages` in Postgres **before** being broadcast to connected clients. If realtime delivery fails, the message is still persisted and will appear on the next history fetch or page refresh.

## Read Receipts

Each user's last-read timestamp per channel is tracked in a `channel_read_receipts` table. Unread count per channel = count of messages created after the user's last-read timestamp for that channel.

## Message Kinds and Actions

`chat_messages.kind` extends the simple TEXT/POLL distinction:

| Kind | Description |
|------|-------------|
| `text` | Plain text message (default) |
| `event` | Event RSVP card (created by `/event` slash command) |
| `task` | Task assignment card |
| `poll` | Poll (inline vote) |
| `dues` | Dues reminder card — in the enum, but still renders the placeholder `ComingSoonCard` |
| `points` | Points award notification |
| `hours` | Service hours log confirmation — in the enum, but still renders the placeholder `ComingSoonCard` |
| `audio` | Voice memo (mobile-native): recorded, uploaded to Storage, sent with waveform metadata — **specified, not yet in `CHAT_MESSAGE_KINDS`** |
| `pulse` | Chapter-health catch-up card — see [catch-up.md](./catch-up.md). Specified, not yet built (#821) |
| `system_audit` | System-generated audit message (posted to #chapter-audit, or to a DM on invite-accept) |
| `loading` | Client-side placeholder while NestJS RPC completes a heavy command |
| `announcement` | Broadcast announcement |

Rows marked *specified, not yet in `CHAT_MESSAGE_KINDS`* are absent from the enum; rows marked
*placeholder* are in the enum but render `ComingSoonCard`. Everything else is built.

`chat_messages.kind` carries no CHECK constraint, so adding a kind is a code change rather than a
migration — but it is a change in **three** places, and missing any one fails differently:

| Declaration | Consumed by | Symptom if missed |
| --- | --- | --- |
| `apps/api/src/domain/entities/chat.entity.ts` | `@IsIn(...)` in the API DTO | API rejects the send |
| `packages/validation/src/index.ts` | `z.enum(...)` in `SendChatMessageSchema` | Schema rejects the send |
| `apps/web/lib/chat/types.ts` | `coerceKind` in `normalizeRow` | Row is silently rewritten to `text`, so the renderer never fires |

Unknown kinds degrade to plain text — on web via that `coerceKind` rewrite, which runs *before*
`MessageRenderer`'s `default:` branch is ever reached. Either way the `content` string is what the
user sees, so every rich kind must write a readable one.

`chat_message_actions` records per-user actions on messages (reactions, RSVPs, votes, payment confirmations). Indexed on `(message_id, user_id)` for per-message aggregation and `(user_id, action_type, created_at desc)` for user history.

## Hot-path client behavior

These are the user-observable guarantees of the chat client (web and mobile), independent of the underlying implementation:

- **Optimistic + idempotent sends.** Every send/react/card-action is applied to the local view immediately under a client-generated UUID (`client_message_id`), then confirmed against the canonical row. A failed send rolls back with a toast; a duplicate (same `client_message_id`) reconciles to a single message — racing two sends of the same body yields exactly one stored message, never two.
- **Offline composer queue.** Drafts persist across reloads/cold launches. Messages composed while offline are queued and flushed in order on reconnect. A send that hard-fails (4xx) surfaces inline with a retry affordance rather than disappearing.
- **Reconnect pill.** On loss of the realtime connection the client shows an unobtrusive "Reconnecting…" indicator near the channel header and retries with capped backoff.
- **Backfill before resubscribe.** On reconnect, for each channel the client reads its last-seen message id and backfills missed messages *before* resubscribing to realtime, so no message is lost and none is duplicated.
- **Empty states are explicit.** No visible channels, no messages in a channel, no DM threads, and no search results each render a purposeful empty state rather than a blank pane.

## Reconnect replay

`GET /channels/:id/messages?since=<message_uuid>&limit=50` returns messages created AFTER the given message UUID. Clients use this on reconnect to backfill missed messages before resubscribing to Realtime.

## Web ↔ mobile parity

The mobile (Expo) chat experience is held to **parity** with web: reactions, inline rich-message cards, presence, and the offline composer queue all behave the same across platforms. Differences that are canonical:

- **Voice memos** are mobile-native: recorded in the composer, uploaded to Storage, and sent as `kind="audio"` with waveform metadata. Web clients play them back.
- **Presence lifecycle on mobile** maps app state to presence: backgrounded → `idle`, force-quit → `offline` (consistent with the Idle/Offline statuses tracked via Realtime Presence above).
- The authenticated entry point on mobile lands directly on chat, with the channel list as the default tab.
