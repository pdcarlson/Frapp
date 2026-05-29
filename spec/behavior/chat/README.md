# Chat — Discord/Slack/GroupMe Hybrid

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
- **Channel-access enforcement (multi-tenancy + RBAC invariant).** Every chat read, send, reaction, and search result is authorized from a **trusted DB lookup** — channel → chapter → membership (and, for `ROLE_GATED`, the caller's effective permissions) — never from a client-supplied chapter/channel field. The decision is a single shared predicate (`canAccessChannel` in `@repo/validation`) reused by every chat + search code path in the NestJS API (cold reads, the hot-path send/react controller, and search), so layers cannot drift:
  - `PUBLIC` → any chapter member; `PRIVATE`/`DM`/`GROUP_DM` → the user must be in the channel's `member_ids`; `ROLE_GATED` → the user must hold `*` or one of `required_permissions`; an unknown type denies (never falls open).
  - Reading or reacting in a channel the caller cannot see (including one in another chapter) returns **403** (or **404** if the channel/message id does not resolve within the caller's chapter). A `reply_to_id` must reference a message in the **same** channel.
  - **Service-role (RLS-bypassing) writes in `ChatService` perform this membership/channel-access pre-check before the insert.** Resolving the actor from the JWT (`SupabaseAuthGuard`) is necessary but not sufficient — authorization (may this actor touch this channel/message?) is independent and mandatory.
  - **Search is not a side-channel:** `GET /v1/search` filters chat-message hits to channels the caller can read, using the same predicate. Snippets never include messages from inaccessible (private/DM/role-gated/other-chapter) channels.
- **Channel categories** (like Discord): chapters can organize channels into named groups (e.g. "General", "Executive", "Committees"). Categories are display-only grouping with a sort order. Channels not assigned to a category appear in a default "Channels" group.
- **Default channels** created on chapter setup (`DEFAULT_CHANNELS` in `apps/api/src/domain/constants/permissions.ts`): `#general` (PUBLIC), `#announcements` (all-read, requires `announcements:post` to write), `#chapter-audit` (PUBLIC, read-only — system-write audit feed, all members read), `#alumni` (ROLE_GATED, visible to Alumni role + active members).
- **Seeding happens at chapter creation (applies to all tiers)** — both `POST /v1/chapters` and the onboarding submit `POST /v1/chapters/onboard` seed channels. It is **not** gated on billing/subscription. `#chapter-audit` is required so the Chunk 02 audit bridge (and the onboarding welcome message) have a destination.
- **Performance requirement:** chapter setup must seed default channels in one write operation to avoid N+1 insert latency.
- **Failure behavior:** chapter setup must fail if default channel seeding fails; the API must not return chapter-create success when channel seeding errors.

## Direct Messages

- **1-on-1:** Initiated by selecting a member. Creates (or reuses) a DM-type channel between exactly two users. Chapter-scoped.
- **Group DM:** User selects multiple members (up to 10). Creates a GROUP_DM-type channel. Chapter-scoped.
- DMs appear in a separate "Messages" section in the UI, not mixed with chapter channels.
- DMs are not role-gated; they are scoped by an explicit member list stored on the channel.
- A user can leave a Group DM. If only one member remains, the Group DM is archived.
- **Privacy invariant:** DMs and group DMs are **never** part of the [AI corpus](../ai.md). They are not indexed for AI Q&A, not used as summarization context, and not surfaced via citations. This is enforced server-side regardless of any chapter-level AI consent settings — opting in to AI does not opt in DMs.

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
- A sender can delete their own messages. Users with `channels:manage` permission can delete any message in channels they manage.
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
- Announcement messages cannot be replied to in-thread (read-only channel for non-admins).

## Slash Commands (Chunk 05)

Slash commands turn chat into the dispatcher for every ops module ("modules-as-integrations"). The catalog is filtered by the chapter's `enabled_modules` so disabling a paid module hides its command from the palette without UI churn. Commands marked `implemented: true` post a rich message; `implemented: false` commands surface a "coming soon" toast (Chunk 10 sub-chunks flip them as they ship). Server-side authorization is independent of the client gate — the Edge Function re-checks permission for every send.

Initial catalog (Chunk 05):

| Command | Implemented | Required module | Server gate | Posted to |
| --- | --- | --- | --- | --- |
| `/poll "Q?" Opt1 Opt2 [closes=<mins>]` | yes | `polls` | chapter member | current channel |
| `/announce <message>` | yes | always-on | `announcements:post` (or `*`) via `canAccessChannel({ operation:'post' })` | `#announcements` |
| `/event`, `/task`, `/dues`, `/points`, `/hours` | no | per-module | n/a | n/a (palette stub) |

Parsing rules live in `packages/chat-integrations/src/parsers.ts` (`parsePollArgs`, `parseAnnounceArgs`) so web, mobile, and any future heavy-command RPC share one source of truth. Poll arguments tokenize on whitespace but respect double-quoted spans for the question; unterminated quotes return a specific error rather than silently truncating. Polls require at least two distinct options (case-insensitive dedup) and at most ten; an optional trailing `closes=<minutes>` overrides the 24-hour default.

Vote-change uses the UPSERT semantics in ADR-07: every user has at most one row in `chat_message_actions` with `action_type='vote'` per poll message; switching options updates the row's `payload.option_id` in place.

## Message Persistence

Every message is written to `chat_messages` in Postgres **before** being broadcast to connected clients. If realtime delivery fails, the message is still persisted and will appear on the next history fetch or page refresh.

## Read Receipts

Each user's last-read timestamp per channel is tracked in a `channel_read_receipts` table. Unread count per channel = count of messages created after the user's last-read timestamp for that channel.

## Message Kinds and Actions (Chunk 02)

`chat_messages.kind` extends the simple TEXT/POLL distinction:

| Kind | Description |
|------|-------------|
| `text` | Plain text message (default) |
| `event` | Event RSVP card (created by `/event` slash command) |
| `task` | Task assignment card |
| `poll` | Poll (inline vote) |
| `dues` | Dues reminder card |
| `points` | Points award notification |
| `hours` | Service hours log confirmation |
| `system_audit` | System-generated audit message (posted to #chapter-audit) |
| `loading` | Client-side placeholder while NestJS RPC completes a heavy command |
| `announcement` | Broadcast announcement |

`chat_message_actions` records per-user actions on messages (reactions, RSVPs, votes, payment confirmations). Indexed on `(message_id, user_id)` for per-message aggregation and `(user_id, action_type, created_at desc)` for user history.

## Reconnect replay

`GET /channels/:id/messages?since=<message_uuid>&limit=50` returns messages created AFTER the given message UUID. Clients use this on reconnect to backfill missed messages before resubscribing to Realtime.
