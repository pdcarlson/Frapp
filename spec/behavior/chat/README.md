# Chat — Discord/Slack/GroupMe Hybrid

## Chat is the spine

Chat is not a module — it is the spine of the app, and every other capability (events, tasks, dues, points, polls) is a **chat integration** surfaced inline in conversation rather than behind a separate nav tab. The mobile app opens directly into chat.

- **Chat is non-optional. It cannot be disabled.** Every chapter always has, at minimum: `#general` (everyone, default landing), `#announcements` (exec-write, member-read, push by default), `#chapter-audit` (system-write only, member-read — the audit feed), and DMs / group DMs (always on).
- **Modules-as-integrations.** When an ops module is enabled it does not get a top-level nav tab first. It gets: (1) one or more **slash commands** in chat, (2) a **rich message renderer** that turns the artifact into an inline card with primary actions (RSVP / Done / Vote / Pay / Confirm / Submit), and (3) *optionally* a secondary dashboard page for the longer-form view. The dashboard is secondary to the chat experience, never primary.
- **Slash-command dispatch** is the entry point for module actions — a treasurer typing `/dues remind overdue` in `#general` gets a rich card inline, no tab-switching. The command catalog, dispatch path, and renderer registry are specified in [integrations.md](./integrations.md).
- Disabling a paid module hides its slash commands and its dashboard page. A module gets no system channel of its own ([`../integrations.md`](../integrations.md#integration-pattern)).

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
  - **A PRIVATE channel is seeded with its creator at create time.** `POST /v1/channels` writes `member_ids: [caller]` for `type: 'PRIVATE'` — and only for that type, since `PUBLIC` and `ROLE_GATED` never consult the column. This is not a convenience: the `PRIVATE` branch has **no `*` wildcard bypass**, so a row landing with `member_ids` NULL is unreadable by every user including its own creator and a President, and `updateChannel` cannot write the column, so nothing can repair it. Before the list was access-filtered such a channel merely looked alive while 403-ing; afterwards it is absent from every read surface, recoverable only from the id in the create response (#1008). Note there is still **no add/remove-member route** for a non-DM channel, so the seed is the whole of PRIVATE membership management today (#1302).
  - Reading or reacting in a channel the caller cannot see (including one in another chapter) returns **403** (or **404** if the channel/message id does not resolve within the caller's chapter). A `reply_to_id` must reference a message in the **same** channel.
  - **Alumni lifecycle (authored content only).** On `operation: 'post'` the predicate additionally denies Alumni-role members outside direct conversations and `ROLE_GATED` channels that explicitly require `alumni:post` (`#alumni` in a default chapter) — reads are unaffected, and `*` bypasses. **Editing** authorizes as a `'post'` for the same reason, so the rule cannot be sidestepped by rewriting an older message, and so does **requesting a file-upload URL** (`POST /v1/channels/:id/upload-url`) — a signed URL is a write credential for the channel's storage prefix, and every step of a two-step write authorizes as the write rather than as the read before it (#2186). `operation: 'vote'` is a write that clears the same read-only gate but is *exempt* from the lifecycle rule, since voting in a poll one can read is participation, not posting; reactions and message actions authorize as reads and are likewise open. The flag is resolved only when it can change the outcome — an authored post into a channel alumni cannot write in, decided by the same `isAlumniPostableChannel` predicate the gate uses — reusing the membership row already loaded, so reads, votes, and DM posts add no query to the hot path. See [alumni.md](../alumni.md).
  - **Service-role (RLS-bypassing) writes in `ChatService` perform this membership/channel-access pre-check before the insert.** Resolving the actor from the JWT (`SupabaseAuthGuard`) is necessary but not sufficient — authorization (may this actor touch this channel/message?) is independent and mandatory.
  - **Direct client reads are backstopped by RLS.** Most chat tables are default-deny (the API reads them with the service-role key), but `chat_message_actions` (reactions / votes) is read **directly** by both clients under the user's JWT — a per-channel backfill plus a *global* Supabase Realtime subscription where RLS is the only gate. Its `SELECT` policy therefore enforces the same visibility as `canAccessChannel` at the database layer, via a `SECURITY DEFINER` helper `public.can_read_chat_message(message_id)` (channel → chapter → membership, with `member_ids` for `PRIVATE`/`DM`/`GROUP_DM` and role permissions for `ROLE_GATED`). This closes a cross-chapter / private-DM / role-gated action-read leak (FRA-38); the app-layer pre-check on writes is unchanged. Channel visibility is not the whole policy: it also withholds a blocked member's reactions from the member who blocked them (§ What a block does and does not hide, #2494), so a rewrite that reduces it to `can_read_chat_message(message_id)` drops that. The full predicate is in [`AUTHORIZATION_MODEL.md`](../../../docs/internal/security/AUTHORIZATION_MODEL.md) § The policies that do exist.
  - **Search is not a side-channel:** `GET /v1/search` filters chat-message hits to channels the caller can read, using the same predicate. Snippets never include messages from inaccessible (private/DM/role-gated/other-chapter) channels. The same rule applies to the chapter-wide poll list (see `polls.md`).
  - **The channel list is filtered, and so is the single-channel read.** `GET /v1/channels` returns only the channels the caller may read, and `GET /v1/channels/{id}` answers **403** for one they may not — both decided by the same predicate, the list through the batch entry point and the single read through `assertChannelAccess`. A channel row is not neutral metadata: `name`, `description`, `required_permissions` and `member_ids` together describe who is talking to whom, and a direct message is server-named `dm-<userA>-<userB>`, so one unfiltered row discloses a DM pair twice over. An unfiltered chapter-wide list would therefore publish the chapter's entire private and direct-message graph to every member holding `members:view` — a strictly larger leak than the unread counts are already filtered to prevent, on the surface that feeds them. The `channels:manage` mutations deliberately keep resolving a channel without this per-user check: an officer is authorized to edit or delete a channel by that permission, not by membership of it.
- **Channel categories** (like Discord): chapters can organize channels into named groups (e.g. "General", "Executive", "Committees"). Categories are display-only grouping with a sort order. Channels not assigned to a category appear in a default "Channels" group.
- **Default channels** created on chapter setup (`DEFAULT_CHANNELS` in `apps/api/src/domain/constants/permissions.ts`): `#general` (PUBLIC), `#announcements` (PUBLIC, read-only — all members read, requires `announcements:post` to write), `#chapter-audit` (PUBLIC, read-only — system-write audit feed, all members read), `#alumni` (ROLE_GATED, `required_permissions: ['members:view', 'alumni:post']` — `members:view` is held by every seeded role, so it stays visible to the Alumni role + active members, while `alumni:post` is what makes it the one seeded channel alumni may write in).
- **Seeding happens at chapter creation (applies to all tiers)** — both `POST /v1/chapters` and the onboarding submit `POST /v1/chapters/onboard` seed channels. It is **not** gated on billing/subscription. `#chapter-audit` is required so the audit bridge has a destination.
- **Welcome message on onboarding submit.** A chapter created through the onboarding wizard gets a one-time welcome `system_audit` message, the first message it sees (a chapter created through `POST /v1/chapters` gets none). Its channel and text, and where each client lands after submit, are owned by [`../onboarding.md` § First-Officer Onboarding Wizard](../onboarding.md#first-officer-onboarding-wizard).
- **Performance requirement:** chapter setup must seed default channels in one write operation to avoid N+1 insert latency.
- **Failure behavior:** chapter setup must fail if default channel seeding fails; the API must not return chapter-create success when channel seeding errors.

## Direct Messages

- **1-on-1:** Initiated by selecting a member. Creates (or reuses) a DM-type channel between exactly two users. Chapter-scoped.
- **Group DM:** User selects multiple members (up to 10). Creates a GROUP_DM-type channel. Chapter-scoped.
- DMs appear in a separate "Messages" section in the UI, not mixed with chapter channels.
- DMs are not role-gated; they are scoped by an explicit member list stored on the channel.
- A user can leave a Group DM (`POST /v1/channels/:id/leave`), which removes them from the channel's member list. Leaving a 1-on-1 DM or any non-DM channel is rejected — there is no equivalent affordance for those. Once membership drops to one remaining member, the Group DM is archived (`chat_channels.archived_at` set) and drops out of the active channel list; it stays directly readable by id, so the last member's history is not deleted.
- **Privacy invariant:** DMs and group DMs are **never** part of the [AI corpus](../ai.md). They are not indexed for AI Q&A, not used as summarization context, and not surfaced via citations. This is enforced server-side regardless of any chapter-level AI consent settings — opting in to AI does not opt in DMs.
- **System DM on invite accept.** When a member accepts an invite, the inviter receives a `kind="system_audit"` message in their DM channel with that member — `"Alex Chen accepted your invite."` This is the same server-originated system-message pattern as the audit bridge, but targeted to a DM rather than `#chapter-audit`.

## Messages

**Text formatting:** Messages support Markdown-like formatting — bold (`**text**`), italic (`*text*`), inline code (`` `code` ``), code blocks, and links. The client renders this; the server stores raw text.

A message whose formatting nests too deep renders as its raw text, exactly as typed, with no formatting. The limit is 32 levels of the parsed message, counting the paragraph and its text: about 30 block quotes inside one another, or 15 nested list levels, since each list level takes two. A line that opens more than 32 block quotes or list items is treated the same way before it is parsed, even when it sits inside a code block (a line of only `-` or only `*` markers is a divider and is exempt). Message bodies are capped by length, not by depth, and a renderer that recursed through thousands of levels would crash for everyone who opens the channel ([#2209](https://github.com/pdcarlson/Frapp/issues/2209)). The web renderer applies this cap; mobile shows `content` as plain text already.

**Reactions:**

- Any member in the channel can add emoji reactions to a message.
- Multiple distinct reactions per message. Each reaction tracks the count and the list of users who reacted.
- A user can add the same emoji only once per message. Adding it again removes the reaction (toggle).
- Reactions are rows in `chat_message_actions` whose `action_type` is `reaction:<emoji>` (`REACTION_ACTION_PREFIX` in `@repo/chat-core`), so the table's unique `(message_id, user_id, action_type)` index is what allows one of each emoji per member. Clients read them directly under RLS and receive new ones over Realtime. The older `message_reactions` table and its `POST|GET /v1/channels/messages/{messageId}/reactions` routes are still served, but no client reads them; retiring them is #879.
- **Hot-path idempotency (`ChatService.recordMessageAction`).** Per-user actions on the hot path are written to `chat_message_actions`, deduped by the DB unique index `(message_id, user_id, action_type)`. The write is **atomic** — a single insert, with a unique-violation (`23505`) treated as a successful dedup (`deduplicated: true`), never a read-then-insert TOCTOU and never a 5xx. Concurrent identical reactions therefore yield exactly one row.

**File and image uploads:**

- Users can attach files to messages. Images render as inline previews; other files render as downloadable links with filename, size, and type.
- Files are stored in Supabase Storage under `chapters/{chapter_id}/chat/{channel_id}/{message_id}/{filename}`.
- Size limit: `MAX_UPLOAD_BYTES` per file ([`content-validation.md` § 3](../../../docs/internal/security/content-validation.md#3-size)). Configurable per chapter (admin setting) is specified, not yet implemented.
- Allowed file types: the `document` kind in `@repo/validation`, the same list as chapter documents and Backwork; membership and rationale live in [`content-validation.md`](../../../docs/internal/security/content-validation.md) § Validations Required.
- Upload flow: client requests signed URL from API, uploads directly to Storage, then sends message with attachment metadata.
- **The trust boundary is the `chat` bucket's `allowed_mime_types`, not the API's check.** `ChatService.requestChatUploadUrl` validates the extension and MIME against the `document` kind before minting a URL, but a signed upload URL **cannot pin a content type** — the client sets its own `Content-Type` on the PUT, and the API never sees the bytes. So the service-layer check gates URL *issuance* only: it turns a rejection into a readable error rather than a failed PUT, and is not a second line of defence. The bucket gates the **declared header, never the bytes**, so a member can store HTML under an `image/png` declaration; it comes back typed `image/png`. What keeps that out of a renderer on this surface is the **download** side: `ChatService.listMessageAttachments` signs every attachment with `IStorageProvider.getSignedDownloadUrls(..., forceDownload: true)`, which sets `Content-Disposition: attachment` for the whole batch (#1231 — batched into one provider call per bucket rather than one per row; the underlying batch API takes this option once for the call, not once per path, so it can no longer carry a per-file *filename* the way the old single-row `downloadAs` did — web restores the display name client-side via an `<a download>` attribute, which is UX only, not the mitigation). **Turning `forceDownload` off — for instance to render image previews inline — removes the mitigation**, so an inline-preview change must re-establish it another way; an `<img>` tag is the one exception, since it never executes a response as HTML/script regardless of `Content-Disposition` (`resolveAuthorAvatars` relies on exactly this to leave avatars undisposed). Do not relax the bucket list on the belief that something server-side resolves types behind it. Measured request/response, and what was deliberately not measured, in `packages/validation/src/upload-allowlists.ts` § What the bucket allowlist actually enforces; see also [`../../../docs/internal/security/content-validation.md`](../../../docs/internal/security/content-validation.md).
- **An attachment is a row, never text in the body.** It lands in `chat_message_attachments` (`message_id`, `channel_id`, `bucket`, `storage_path`, `filename`, `content_type`, `byte_size`, `width`, `height`, `external_url`), keyed unique on `(message_id, bucket, storage_path)` — per message, not per object — and cascading from the message. The composer sends the uploaded descriptors alongside the body; the server re-derives `channel_id` from the message and re-checks every `storage_path` against the `chapters/{chapter_id}/chat/{channel_id}/` prefix it minted, so a client can claim only objects it was given a URL for. Until #TBD this was appended into `content` as the literal string `📎 <filename> (<storagePath>)`, which left the object with no link back to the message — it could not be rendered, listed, or cleaned up on delete, and a member could edit the sigil out and orphan the file. `width`/`height` are nullable and unpopulated by every writer today, including this upload path — #1505 tracks deciding whether to add an image-dimension dependency to fill them in. `byte_size` has the same gap for legacy Discord-import rows specifically (the `20260823121000` backfill recovered `storage_path`/`filename` from message prose but could not recover a size — that requires a storage metadata call a SQL migration must not make); `scripts/backfill-chat-attachment-byte-size.mjs` closes it as a re-runnable one-off script (#1231), reading each object's stored size from `IStorageProvider`-equivalent listing metadata rather than downloading it.
- **A message may be nothing but a file.** An empty body with at least one attachment is a valid send.
- **Attachments are fetched, not embedded in the message.** `GET /v1/channels/{id}/messages/{messageId}/attachments` returns the rows with a one-hour signed download URL each, batched into as few `getSignedDownloadUrls` calls as the attachments' buckets require (#1231) rather than one per row. They are a separate read for two reasons that point the same way: every bucket is private so a URL has to be minted per request and cannot be cached with the message, and the message cache is fed partly by Realtime rows, which cannot carry a join. `chat_messages.metadata.attachment_count` — a count, never a copy of the data — rides on the row so a client knows whether the call is worth making; without it a file-only message would render as an empty bubble for everyone except its sender.
- **Sending** an attachment is web-only today: the mobile composer has no picker (`chat-composer.tsx` omits the affordance deliberately rather than shipping it inert). **Reading** one works on both. Mobile briefly showed a count instead — "1 attachment · open on web" — as a deliberate stopgap, because web can send a message that is nothing but a file and the backfill removed the filename text from every historical attachment message, so those messages would otherwise have rendered as empty bubbles indistinguishable from a rendering bug. That was honest but it was a dead end, so it is gone: `apps/mobile/components/chat/message-attachments.tsx` now lists the files, previewing images inline and opening everything else through the signed URL.
- **The renderer mounts only for a message that has attachments, on both clients.** Not merely "does not fetch" — the query hook reaches for the API client context on render, so mounting it for every plain-text row would make the overwhelming majority of messages depend on a context they have never needed. `attachment_count` is what decides, and it costs no request to read. A deleted message shows none either: the API 404s the list, but the client must not offer the affordance in the first place.

**Reply threads:**

- A message can be a reply to another message via `reply_to_id`. The UI shows the replied-to message as a quote/preview above the reply.
- This is Discord-style reply-with-quote, not Slack-style nested threads. All replies appear in the main channel timeline.
- Replying to a reply references the root message (no deep nesting).

**Edit and delete:**

- A sender can edit their own messages. Edited messages display an "(edited)" indicator and store `edited_at` timestamp. The original text is not preserved (no edit history in v1).
- A sender can delete their own messages. Users with `channels:manage` permission can delete any message in channels they manage. The permission is resolved **in the message's own chapter, after channel access is confirmed** — holding `channels:manage` in the caller's active chapter grants nothing over a message in another one. A channel the officer cannot read (a DM, or a `PRIVATE` channel they are not in) is out of reach of this route; the only way an officer removes a message there is through an open report naming it (§ Report and block → Officer action).
- Edit, delete, pin and unpin all authorize through the same channel-access lookup as reads: a message whose channel does not resolve within the caller's active chapter returns 404, and sender ownership alone is never sufficient (a member removed from a chapter must not keep editing their history there).
- Deleted messages are soft-deleted: content is replaced with "[message deleted]", `is_deleted = true`. Attachments for deleted messages are removed from Storage.
  - The purge runs **after** the row is flagged, and is best-effort: flagging the message stops the API minting *new* download URLs (`GET /v1/channels/:id/messages/:messageId/attachments` 404s a deleted message). A signed URL issued **before** the delete stays valid for the rest of its hour-long TTL regardless — deletion of the bytes is what ends that, and the purge is best-effort, so a Storage failure leaves the object readable to anyone already holding a URL. Failures are logged per bucket and never roll back the delete or fail the request.
  - **An object still referenced by an undeleted message is kept.** `chat_message_attachments` is unique on `(message_id, bucket, storage_path)` — per message, not per object — so two messages may point at one object: the Discord importer maps every reference to a deduplicated export file onto the same object, and the send-time check validates only the channel prefix, so a client can claim a path another message already uses. Only rows of **undeleted** messages count, or two deleted messages would spare each other's object forever.
  - The check covers other chat *attachments* only. `chat_messages.author_avatar_path` and `discord_import_files.storage_path` can resolve to the same imported object and are not consulted.
  - The attachment **rows** are not deleted. They disappear only with the message itself via `ON DELETE CASCADE`; keeping them is what lets the reference check above stay correct, and the read path already refuses them for a deleted message.

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

**How the privacy is enforced (#462).** Bookmarks live in their own
`chat_message_bookmarks` table, unique on `(user_id, message_id)` — not as state
on the message, because a bookmark is a fact about a *(viewer, message)* pair
rather than about the message. Three things make "not even a channel admin can
see who bookmarked what" structural rather than a matter of review, and all
three have to hold:

- **No route accepts a caller-supplied user id.** `ChatBookmarkController`
  derives the owner from `@CurrentUser('id')` on every route, so there is no
  parameter to escalate through.
- **`IChatMessageBookmarkRepository` offers no by-message query.** There is
  deliberately no "who bookmarked this" and no count, so the question cannot be
  asked. Adding one is what would quietly make this section false.
- **The table enables RLS with zero policies**, like `channel_read_receipts` and
  `message_reactions`, so there is no client-reachable read path at all. That is
  not a missing policy — it is the guarantee.
- **`user_id` is stripped in the repository**, by `stripBookmarkRow`, mirroring
  `stripAttachmentRow`. Note *where*: this API registers no
  `ClassSerializerInterceptor`, so a `@ApiOkResponse` DTO is documentation and
  does not filter anything off the wire. An earlier draft of this section
  claimed the field was absent because the DTO omitted it, which was false —
  the DTO omitted it and it shipped anyway. A response-shape guarantee in this
  codebase has to be enforced by the code that builds the response.
- **Account deletion purges the rows.** `anonymize_user` deletes them
  explicitly, like every sibling per-user table. The FK's `on delete cascade` is
  *not* the mechanism and never fires: deletion tombstones the `users` row
  rather than deleting it, so a cascade from `users(id)` is unreachable.

`channels:manage` grants nothing here: a moderator can pin, delete and moderate
a message and still cannot learn that anyone saved it. That asymmetry with pin
is the point.

Bookmarking authorizes the message at **`read`**, not `post` — a bookmark
authors nothing in the channel, so an announcement in a read-only channel (which
is exactly the kind of message members want to keep) stays bookmarkable. Both
write routes are idempotent, so a double-tap or an offline retry is a no-op.

**Losing access to a channel redacts the message, but never removes the
bookmark and never blocks removing it.** The list re-checks channel access on
every read, because the query re-reads `chat_messages` live — it returns the
message as it is *now*, so without the check a member who left `#exec` would
keep receiving edits made after they left. What they get instead is their own
row with the message blanked (`message_available: false`), which the client
renders non-interactively but still offers a Remove control on — the panel is
the only place such a row can be cleared, since the message-row chip is
reachable only from a channel the member can open.

The redaction is built as an **allowlist**: the redacted message is constructed
from the three fields that cannot carry a post-revocation signal — the
message's `id`, `channel_id` and `created_at`, all fixed at save time — and
everything else the endpoint serves is replaced. A denylist would serve any
newly added column to a member who had lost access, with nothing failing.

The endpoint's message projection is **nine fields**, not the whole row, and
that is a disclosure control rather than a size optimization: `deleteMessage`
blanks `content` and `metadata` but not `payload`, so serving the full row meant
a bookmarked poll or event card that had since been deleted shipped its payload
on an endpoint whose declared type says the message reads `[message deleted]`.
Three places spell that list — `BOOKMARK_MESSAGE_COLUMNS`,
`BookmarkedMessageDto`, and the `BookmarkedMessage` entity — and they must stay
in step. Two things follow, and both are load-bearing:

- **Un-bookmarking does not authorize the message.** It cannot: the row exists
  precisely because access was lost, so authorizing would make a member's own
  bookmark permanently undeletable. The delete is scoped by
  `(user_id, message_id, chapter_id)` and always answers 204.
- **An archived Group DM is not a revocation.** Archiving freezes posting, not
  reading, so the access check passes `includeArchived` — otherwise a bookmark
  in an archived Group DM would be redacted while the member can still open the
  channel.

The deletion rule above is load-bearing on an implementation detail worth
stating: `deleteMessage` soft-deletes, rewriting `content` to
`[message deleted]` and keeping the row, so the placeholder *is* the message's
own content. The bookmarks query therefore must **not** filter `is_deleted` —
adding that filter would make the bookmark vanish, the opposite of this rule.

**No sender-extend on ephemerality.** Senders cannot extend the lifetime of their own message past channel retention rules. The two ways content becomes durable are a chapter-elevated **pin** (visible to everyone who can see the channel) or a **bookmark** (private to the bookmarker). This keeps ephemerality real — there's no third path that lets a sender unilaterally make their own content stick around.

**Typing indicators:**

- When a user starts typing in a channel, a lightweight ephemeral event is broadcast to other channel members via Supabase Realtime Broadcast (not persisted).
- Shows "User is typing..." below the message input.
- Typing indicator expires after 5 seconds of inactivity (no keystrokes).

**Online/offline presence:**

- Member online status is tracked via Supabase Realtime Presence.
- Presence heartbeat: ~30 seconds. If no heartbeat is received, the user is marked offline.
- Online status is visible in the member list sidebar and in DM conversations. The web **Directory** (`/members`) renders it today; the DM and channel member lists do not yet.
- Statuses: Online, Idle (app open but inactive for >5 minutes), Offline.

**Two presence topics, deliberately.** They answer different questions and must not be merged:

| Topic | Scope | Read by |
| --- | --- | --- |
| `chat:channel:<channelId>` | Who has *this channel* open | The push worker, via service role, to suppress pushes to members already looking (ADR-10) |
| `presence:chapter:<chapterId>` | Who is present in the *chapter* at all | The web Directory |

The chat topic's channel config and its `{ userId, ts }` payload are a cross-service contract pinned by `packages/chat-core/src/presence-contract.spec.ts`. Re-keying it or widening its payload silently disables push suppression, so a surface needing chapter-wide presence takes the second topic rather than extending the first.

Both are **private** Realtime channels since 2026-09-06 (#1552, migration `20260906203000`), each behind its own predicate on `realtime.messages`: `presence:chapter:<chapterId>` admits any member of the chapter (`realtime_can_read_chapter_scope`); `chat:channel:<channelId>` admits exactly the members who may read that channel (`can_read_chat_channel` — PUBLIC to the chapter, PRIVATE/DM/GROUP_DM to `member_ids`, ROLE_GATED by permission — the same predicate `can_read_chat_message` now delegates to), so who is present in a DM is not visible chapter-wide. Joining, `track()` and, on the chat topic, the typing `send()` are all gated; `postgres_changes` bound to the chat channel still deliver. The push worker joins the chat topic privately with the identical config, because private and public are separate rooms — a worker left public would see an empty roster and suppress nothing. An anon-key holder can neither read either roster nor publish to it. Presence still stays **advisory** and must never be an input to an authorization decision: a member who may read a channel can still publish an entry naming another member, because Realtime policies see the topic and the message extension, not the presence payload. What each topic exposes is [`docs/internal/security/AUTHORIZATION_MODEL.md`](../../../docs/internal/security/AUTHORIZATION_MODEL.md) § "The policies that do exist".

**`ts` is last activity, not last publish** — this is what makes Idle reachable. If every publish stamped the current time, `ts` could never age past the 5-minute threshold and every present member would read Online forever. Instead a re-publish carries the *unchanged* activity timestamp, and the two signals split the three states: presence membership answers Online-vs-Offline, and `ts` answers Online-vs-Idle. Activity is approximated from throttled pointer, key, scroll and focus events plus `visibilitychange` — the browser cannot observe attention directly, and the throttle floor is the ~30s cadence, so the worst-case error is one interval against a five-minute window. A `visibilitychange` to *hidden* does not count as activity; treating it as such would reset the idle clock at the moment a member walks away.

**Nothing expires a presence entry.** Supabase Realtime presence is connection-scoped — there is no TTL and no reaper — so an entry goes away when the channel or socket tears down, not when a client stops publishing. There is therefore no liveness heartbeat to maintain: publishing happens on join, on every re-join (which is what restores a member after a drop), and when activity genuinely advances. A periodic re-publish of an unchanged payload would broadcast a diff to every subscriber and buy nothing.

**Presence is published from the app shell, not from the screen that displays it.** A member is present because the app is open, not because they are looking at the Directory — so the tracking half is mounted for every dashboard route. Scoping it to the reading screen would make the dot mean "has the Directory open" and render everyone in Chat as Offline.

Presence is ephemeral per ADR-02: it lives on the Realtime socket and is never persisted, so it costs no Postgres write and leaves no row to reap when a member disconnects.

**Search:**

- Full-text search within a single channel or across all channels the user can access.
- Search returns message snippets with highlighted matches, grouped by channel.
- Search respects permissions: only messages from channels the user can see are returned.

Both scopes are served by `GET /v1/search`; the single-channel form passes an optional
`channelId` ([`../search.md`](../search.md#single-channel-scope)). On web the surface is
`ChatSearchPanel`, reached from the channel header's `⋯` menu
(`apps/web/components/chat/channel-menu.tsx`, #2142 — it was a popover of its own, alongside
three more, until that lane merged the four), defaulting to the active channel with an
"All channels" toggle. Picking a hit selects its channel if it is not
already open and then jumps, reusing the same in-shell pending-target machinery a
`/chat?channel=&message=` deep link resolves through. **It does not change the URL** — a
search jump is not shareable, back-button-recoverable, or reload-surviving; only a real deep
link is.

**Three parts of the bullets above are aspirational, and the shipped surface says so rather
than pretending otherwise:**

- **Highlighted snippets do not exist**, for this surface or any other. `ts_headline` is
  specced for all four search sources and built for none; see #1356. Rows show the message
  body truncated, not a match-centred snippet.
- **Results are not grouped by channel.** They are one list ordered newest-first, with a
  per-row channel label when a hit is outside the channel in view.
- **A jump can only reach the loaded window.** Web loads one page of channel history and has
  no older-history backfill, so a hit older than that window cannot be scrolled to. The
  timeline reports reachability instead of silently doing nothing, and the shell states the
  limit in the channel header; the target stays pending, so a message that arrives later still
  gets its jump. Reaching genuinely old hits needs real backfill — see #1571.

## Report and block

Signet ships chapter channels, **direct messages**, and file uploads. That is user-generated content, and **App Store Review Guideline 1.2** expects a UGC app to give a member a way to report objectionable content and to block an abusive user. Officer moderation (`channels:manage`, above) is real but on its own does not reach a private DM, which is the surface a reviewer probes and the one a harassed member actually needs. These two controls are the member-side answer (#2257); a report is also what lets an officer remove the one message it names, DM or not (§ Officer action below, #2311).

**Status: schema, API, the mobile client and the web officer queue.** The tables exist (`20260915210000`) and the API is live: `POST|GET|PATCH /v1/chat/reports`, `POST /v1/chat/reports/{id}/remove-message`, and `GET|POST|DELETE /v1/chat/blocks` (`ChatReportController` / `ChatBlockController`, both `@SubscriptionExempt()`), and the API applies the caller's block list to the chat messages, reactions and attachments it serves and to whom chat notifies. The `chat_message_actions` read policy withholds a blocked member's reactions from the member who blocked them (`20260924170000`, #2494). [`chat-read-surface-ledger.spec.ts`](../../../apps/api/src/application/services/chat-read-surface-ledger.spec.ts) is the one list of where that holds and where it does not yet. It fails on anything it enumerates and has not classified: every route on the chat controllers, every RLS policy a client could read through, every notify-named call in the API, and every Realtime `postgres_changes` subscription the API opens. What it cannot see is listed at the top of that file; read that before treating a green run as coverage. Its `open` entries are the known gaps, server and client, each with its tracking issue. **The mobile app consumes the member half**: a long-press anywhere on someone else's message or poll — its text, a photo, a reaction chip — or the "Message actions" accessibility action opens Report and Block (Block for every sender who can be blocked at all — not the system actor or an imported row — unless a block attempt this session already came back as the API's 404 `Member not found`. A sender the cached roster does not list still gets Block: that is what a brand-new member looks like, and the long-press re-reads the roster); the thread tombstones a blocked member's messages, quotes and reactions, and holds unmaskable rows while the list is **loading or unavailable**, per § The masking contract (`apps/mobile/lib/chat/blocks.ts`); and Settings → Blocked members and the directory's member sheet can undo a block. **The web dashboard renders the officer queue**: Chat Admin's Reported messages card (`apps/web/components/chat-admin/chat-reports-card.tsx`, gated on `members:view` and `channels:manage` like the routes), with the evidence snapshot, the status tabs, Mark reviewed / Dismiss, and the report-scoped Remove below (Mark actioned where the message no longer exists). **Still owed:** web has none of the member half (#2313), and the server-side gaps are the ledger's `open` entries. Whether a block hides a blocked member's words *quoted in someone else's reply* (#2312 §1) is settled by the fail-closed rule in the table below. Where the sections below describe the owed parts, they describe what is owed — [`AGENTS.md`](../../../AGENTS.md) § Spec vs code.

### Report

- **Any member can report any message they can see**, in a channel or a DM. Visibility is the existing `canAccessChannel` predicate — reporting is authorized as a **read**, so it reaches exactly the messages the member could already render, and no more. A message that is already deleted cannot be reported (409, and no one is notified): its content is gone for everyone, so there is nothing left to act on. Two orderings keep that honest. A report the member **already has open** on the message is returned instead, as the idempotent replay (below) — the replay is checked before the refusal, so a retry of a report filed while the message was live is not told its report was never taken. And a removal can land between the check and the write, so a newly written report is checked again: if its message is gone by then, the report is closed as `actioned` at once (with no reviewer stamped — nobody decided it), no one is notified, and the answer is the same 409.
- **A report is filed as the caller, never with ambient service authority.** The reporter is the authenticated caller; a member cannot report as someone else.
- **Reports land in a per-chapter officer queue** readable by members holding `members:view` **and** `channels:manage`, or `*` — the same union every officer route requires, spelled once as `CHAT_REPORT_QUEUE_PERMISSIONS` in `@repo/validation` — newest first.
- **A report about a queue holder is reviewed by the other holders.** An officer can be reported like anyone else, and the queue leaves out every report whose reported sender is the viewer: it is not listed for them, and resolving or removing through it answers 404, the same as another chapter's report, so its existence is not confirmed either. Stripping the reporter's id is not enough on its own — the reporter's note can name them, and a report on a DM message has exactly one possible reporter. If the reported sender is the chapter's **only** queue holder, nobody can review the report yet: it is not lost, it stays `open` and appears to whoever next holds the queue permissions, and the API logs a warning that a report was filed with no reviewer (no one is notified, since the one holder is the reported sender). That is the only case logged: a reporter who is the one other holder has nobody to notify, but is a reviewer. The chapter's remedy is to give a second member the queue permissions; the reporter can block in the meantime.
- **Resolution is one-way.** An open report is resolved as `reviewed`, `actioned` or `dismissed`, stamped with the officer, and a report that is no longer open answers 409 — the write is conditional on `status = 'open'`, so a stale client cannot overwrite another officer's decision (a Dismiss landing on an `actioned` report would rewrite what the record says happened to the message).
- **Officers are told when a report arrives.** Filing a *new* report sends an in-app notification (and push) to every member the queue admits — `members:view` **and** `channels:manage`, or `*` — except the reported sender and the reporter. It is content-free: no message text, no reporter, no reported member, only that a report is waiting, with a `chat_reports` target that opens the queue (`spec/behavior/notifications.md` § Deep Linking). The reported sender is excluded even when they are an officer, because paging them is telling them they were reported; the queue does not show it to them either (below). A replayed report (the idempotent path below) notifies no one, so re-filing cannot re-page the moderation team, and a notification failure never fails the report. A report closed on the spot because its message was removed as it landed (above) notifies no one either. Category `admin`, priority NORMAL — the trigger is listed in [`notifications.md`](../notifications.md#notification-triggers-complete-list).
- **The reporter is never disclosed to the reported member.** There is no surface, API route, or repository method that answers "who reported me". The tables' zero-policy RLS (below) is what makes that structural rather than a matter of review.
  - **One inference is accepted rather than prevented** (owner decision 2026-09-22, taken with § Officer action's option 1). When an officer removes a reported message from a **1:1 DM**, its sender sees the message replaced by `[message deleted]` — and a 1:1 DM has exactly one other reader, while no officer can reach a DM any other way. So the sender can deduce who reported it. Nothing names the reporter; the removal itself is the tell. It is the price of letting the chapter act on a DM report at all: the option that avoided it (no officer removal in DMs) left the harassing content in the recipient's history. The officer is told before they remove (the confirmation, [`writing.md`](../../ui/design-system/writing.md) § Chat Admin — reported messages), so the choice is theirs to weigh — the reporter can also block. A group DM or a channel has more readers, and the inference weakens with each.
- **A report carries its own evidence.** The reported content and sender are snapshotted into the report row at file time. This is not belt-and-braces: a sender may soft-delete their *own* message, which overwrites its content with `[message deleted]`, so without the snapshot every reported member would have a one-tap way to blank the evidence and leave an unactionable report behind. For the same reason the report's `message_id` is nullable and does **not** cascade — a channel delete hard-deletes its messages, and an officer must not be able to erase reports against themselves by deleting the channel.
- **One *open* report per member per message.** A double-tap or an offline retry cannot queue the same message twice: it is answered with the report already open, and notifies no one — including after the message was deleted, since the replay is checked before the deleted-message refusal (above). Once a report is resolved the message can be reported again — a message dismissed as spam and then edited into harassment is a new report, not a duplicate.
- **Reports survive the reporter's account deletion**, rendering as "Deleted User". They are moderation history: a member must not be able to erase the record of a report by closing their account. See [`data-retention.md`](../data-retention.md).

### Officer action: removing a reported message

**Decision (#2311, option 1 — owner, 2026-09-22): an open report lets a `channels:manage` holder remove exactly the message it names, and nothing else.** The report row is the capability.

Without this the queue was read-only for the case it exists for. A member harassed in a DM reports the message; an officer can read the reported text in the queue, but `DELETE /v1/channels/messages/{id}` answers 403, because a DM admits only its two members and `channels:manage` — even `*` — does not reach one. The reporter could block; the chapter could do nothing to the content. Three answers were weighed:

1. **Report-scoped removal** — chosen. The narrowest expansion that makes the queue actionable, and it keeps "no officer reads the thread" true.
2. **No officer deletion in DMs; the remedy is the member** (block, or `members:remove`). No code, but the queue would then have to say plainly that a DM report is a signal for member action rather than a delete affordance, and the harassing content would stay in the recipient's history.
3. **Reported DM messages become officer-visible wholesale.** Rejected: it converts a report into a warrant over a private conversation.

The rules, `POST /v1/chat/reports/{id}/remove-message` (`channels:manage` on top of `members:view`, `@SubscriptionExempt()` with the rest of the controller):

- **A report about a DM does not open the DM to officers.** The capability authorizes one soft delete. It never opens a channel read, a thread, a pin list or the channel row: `assertChannelAccess` and every list surface take no report, and the route returns the resolved report, never the message. What an officer knows about the message is the evidence snapshot the report already carried. The response does carry the message's `channel_id` — an id, which every channel route still refuses — so the client can blank that one cached timeline instead of refetching every timeline it holds.
- **In a 1:1 DM the removal can reveal the reporter to the sender** — the one inference § Report accepts. The sender sees their message removed, and the DM's other member is the only person who could have reported it. Accepted with this option (owner, 2026-09-22) as the cost of the chapter being able to act on a DM at all; the confirmation tells the officer before they remove: "The sender will see this message was removed. In a direct message they may be able to tell who reported it."
- **The route takes a report id and nothing else.** The report names the message; the client never does, so there is no second identifier to point at a sibling message. The grant is checked inside the shared predicate — `ChannelAccessService.assertMessageAccess` with an explicit `ReportedMessageGrant`, not a second authorization path — against the message it names, the caller's chapter, the message's channel resolving inside that chapter, and the caller's membership. It authorizes a `read`-class action only; a report never authorizes an edit or an upload.
- **Only an open report in the caller's chapter, and not one about the caller.** The report is read scoped to the chapter and without the reports about the caller (§ Report), so another chapter's report and a report about the officer are the same 404 as none. A report that is `reviewed` or `dismissed` grants nothing (409); an `actioned` one is answered by the report-level replay below, and never removes anything itself.
- **The report is claimed before the message is touched.** The named report moves `open` → `actioned` in one update conditional on `status = 'open'`, and only if that lands is the message removed — so the capability is checked when it is used, not only when it is read. A Mark reviewed or Dismiss that got there first leaves nothing to claim: 409, and nothing is removed. One that arrives after the claim is refused by its own conditional write (§ Report, Resolution is one-way). Every 4xx this route answers is therefore decided before the message changes.
- **The removal is an ordinary soft delete** — the same tombstone, `metadata` wipe and attachment purge as any delete (§ Edit and delete). If it fails after the claim, the error is always returned, and what the report says depends on the failure. A 4xx is the access check refusing this officer before anything was written (for example, removed from the chapter after the request was admitted), so the claim is withdrawn — the report goes back to `open`, conditional on still carrying this request's own stamp — whatever state the message is in: a refusal is never reported as "already removed". Any other failure does not prove nothing was written, because the tombstone can commit and only the answer be lost, so the message is read again first. While it is still there (or the read fails too), the claim is withdrawn the same way, so a failed removal does not leave an `actioned` report over content that is still there, and the report is open for a retry. If it is gone, this request's own write may be what landed: the claim stands, the attachment purge the failed delete never reached runs, and the sibling sweep runs, so no report reopens over a removed message. The error is returned as an unknown outcome, and a retry gets the report-level replay's 200. A withdrawal that itself fails is logged as an error for a person to look at.
- **Every open report on the message closes with it.** Several members can report one message; once it is removed, all of their reports have been acted on. After the removal, one conditional update marks every open report on that message in the chapter `actioned`, stamped with the officer and the claim's timestamp, so no sibling is left open over a message that is gone. Running it after the delete also catches a report filed while the removal was in flight. If that update fails, the removal stands and the route answers 500; a retry takes the report-level replay below, which runs the sweep again.
- **Idempotent on the message.** A message that is already soft-deleted — by its sender, an officer's ordinary delete, a sibling report's removal, or an earlier attempt that failed after the delete landed — is not an error: nothing is written to it, the reports still close as `actioned`, and the response says `message_already_deleted: true`, so the queue reports "already removed" rather than claiming a removal it did not make, and without saying who removed it.
- **Idempotent on the report.** A report that is already `actioned` over a message that is gone — a sibling report's removal swept it, or this is a retry after a lost response — answers the same 200 with `message_already_deleted: true` (and sweeps the siblings again), rather than a 409 whose appearance would depend on which request got there first. A report that is `actioned` over a message still in place — closed with Mark actioned, or claimed by another officer's removal that has not yet deleted — is a 409: a resolved report grants nothing.
- **A hard-deleted message (`message_id` went NULL, by a channel delete or the import purge) on an open report is a 409.** The sibling sweep keys on `message_id`, so once it is NULL the other reports on that message cannot be found, and closing one alone would leave the rest open; there is also no removal to record. The officer closes each such report explicitly, as `actioned` (the web queue's Mark actioned) or otherwise.
- **It applies to any channel type**, not only DMs: a reported message in a `PRIVATE` or `ROLE_GATED` channel the officer is not in is removable the same way. In a channel the officer can already read, the ordinary delete route does the same thing without a report.

### Block

- **A block is scoped to one chapter.** A member can belong to more than one chapter ([`multi-tenancy.md`](../multi-tenancy.md)), and blocking someone in one chapter says nothing about another chapter they may both belong to. Blocks are keyed on user ids, matching `chat_messages.sender_id`.
- **Blocking is silent, and nothing may become an oracle for it.** The blocked member is not told and must not be able to discover it. This is the whole point of the feature, and it is why the block table carries no RLS policy: a "read your own block list" policy scoped `blocker_user_id = auth.uid()` is one edit away from a symmetric version that tells an abuser exactly who has blocked them.

  The rule binds behavior, not just storage. **Any surface that refuses an action *because* of a block leaks the block** — a distinct error on DM creation is enough to binary-search the roster and enumerate exactly who has blocked you. So a block is enforced by **not delivering**, never by refusing: the blocked member can still open a thread and send into it, and sees the ordinary success they would see anyway. Nothing they send reaches the blocker.
- **A member cannot block themselves, nor the system actor.** Blocking the system sender would silently mask the chapter welcome post, the `#chapter-audit` bridge, invite-accept DMs and the poll-expiry notice, with nothing rendering as "blocked" to explain why — chapter features would simply appear broken. (A poll and its tally are *not* in that set: `poll` is not a server-only kind, so they are authored by the member who created the poll.)
- **Blocking is reversible, and the unblock affordance is durable.** The blocked-members list in Settings is the one place a block can always be undone; a tombstone in a thread the member may never reopen is not sufficient.

#### What a block does and does not hide

| Surface | Blocked member's content |
| --- | --- |
| Channel messages | Hidden — replaced by a tombstone ("Message from a member you blocked") whose only action is **Unblock**. It does not expand in place: a server-masked row arrives with its content already withheld (§ The masking contract), so "expand" could only ever work on rows that happened to arrive over the live echo — a control that works on some rows and not others. Unblocking re-reads the newest page of each cached thread that holds a masked copy of that member's messages and swaps only those copies for the clear rows, into the cache as it stands when the response lands — never by re-running the thread's query, which would overwrite a message that arrived meanwhile. An older masked copy stays a tombstone ("Hidden while you had this member blocked", without the Unblock) until the app next reads the thread from scratch, and on mobile nothing in the thread triggers that. The thread screen stays mounted, so its cached messages are dropped only once the member has opened a different channel and about five minutes have passed (React Query's default `gcTime`), on a chapter switch or a sign-out (each clears the whole cache), or when the app restarts. That read covers only the newest page, so an old copy then leaves the timeline like any other message older than the page. The re-read retries before giving up, and if it still fails those copies offer **Reload**, which runs it again — never a tombstone with no way back. *Owner decision 2026-09-22: the tombstone's only action is Unblock — this replaced "a tombstone the blocker can expand"* |
| Direct messages | Hidden. The blocked member can still open a thread and send — refusing would be an oracle, see above — but nothing they send reaches the blocker |
| Reactions on the blocker's messages | Hidden — **and on every other message the blocker sees**, since a reaction is its author's own text (`reaction:` plus up to 41 characters). Clients read reaction chips from `chat_message_actions` directly, so its SELECT policy does the hiding: it withholds a blocked member's `reaction:*` rows from the member who blocked them, over PostgREST and the Realtime echo alike, and changes nothing the blocked member reads (`chat_viewer_has_blocked`, `20260924170000`, #2494). Rows a client cached before the block stay in its cache: on web until the thread is next read, on mobile until the thread's query is dropped, since mobile's re-reads and reconnect backfill merge onto the cached rows. So the mobile client also drops a blocked reactor from every chip against a ready list. While the list is loading or unavailable it shows only the viewer's own reactions and those of a member this client just unblocked (a confirmed change applies in every list state, below), failing closed the way held messages do. A chip therefore counts the reactors the viewer can see, not every reactor. The other way round, a thread read while the block stood holds none of that member's reactions, so after an unblock their earlier chips return on the thread's next read from scratch, not at once; new ones arrive live (#2632) |
| Attachments on the blocked member's messages | Hidden, and not reachable. The attachments route answers as it does for a deleted message, so the tombstone leaves no download path behind it |
| A blocked member's message **quoted in someone else's reply** | Hidden. The quote reads "Message from a member you blocked" in place of the parent's author and text, whoever wrote the reply; a parent held while the list is loading or unavailable quotes as "Message hidden". A block that hid the message but let a reply print it would hide nothing. *Settled 2026-09-22 by the fail-closed rule (#2312 §1); mobile applies it* |
| Poll votes | **Counted, not hidden.** A poll tally is chapter state, not a message; suppressing one vote would misreport the result to everyone |
| Points / task / event cards **authored by** the blocked member | Hidden, like any other message they sent. These carry the acting member's `sender_id` (`PointsService`, `TaskService` and `EventService` each pass the actor, not the system id), so they are masked by the same `sender_id` predicate as ordinary text. That is deliberate: their templates interpolate member free text — a task title, an event name, a points reason — so exempting them would hand a blocked member an unmaskable channel into the blocker's timeline. The chapter record itself is unaffected; chat is a notification surface for it, and the points, tasks and events screens remain the system of record |
| Messages from the **system actor** that merely name the blocked member | Not hidden. `SYSTEM_SENDER_ID` is not blockable at all (above) |
| Officer moderation surfaces | **Not hidden.** A `channels:manage` holder reviewing a report sees the content as filed; a personal block must not blind an officer acting in their role |
| Directory | Not hidden. Blocking is a chat control, not a chapter-membership one |

### The masking contract

**The client applies its own block list.** The server masks what it serves, but that is not sufficient on its own: the mobile and web chat threads also receive rows over a Supabase Realtime `postgres_changes` echo, which delivers the raw row. Realtime does evaluate the subscriber's `SELECT` policy before delivering it, but a policy can only drop a row or deliver it whole, never swap in the API's tombstone and `sender_blocked`, and `chat_messages_select` carries no block clause. A client that trusted only the server's projection would render a blocked member's *live* messages in full.

Two rules follow, and both are load-bearing:

- **Nothing may key off the server's masking sentinel.** The sentinel is a rendering detail of one code path; a client that pattern-matches it inherits a contract the server never promised, and silently stops masking the day that string changes. What the server *does* promise is a boolean: every message row `GET /v1/channels/{id}/messages` returns carries `sender_blocked`, set on every row rather than only the masked ones, so "this server does not mask" and "this message is fine" cannot be confused. The list itself is `GET /v1/chat/blocks`.
- **A block list that cannot be read is not an empty block list.** The read must be tri-state — ready, loading, unavailable — because a failed fetch that reads as "nobody is blocked" fails open on a safety feature. **While the list is loading *or* unavailable**, messages that arrived by a path the server could not mask are held rather than rendered, and so are other members' reactions; a loading list is no more current than a failed one. When the list is unavailable the member is told so; while it is loading they are told only if something is actually held, since the first read usually lands first.

Holding the right messages requires knowing **how each row reached the cache**, which is provenance, not timing. A `created_at` watermark cannot express it: the timestamp says when a row was *written*, never how it arrived, and an UPDATE echo re-delivers a row under the same `created_at` it was read with. See #2315. The shared normalizer records it directly: a row is server-evaluated exactly when it arrived carrying `sender_blocked` (`ChatMessage._blockEvaluated` in `@repo/chat-core`), and the realtime manager strips that field off every echo, so a Realtime row can never claim it. Because a merge replaces the cached row, a later Realtime echo of it (an edit, a pin) makes it unevaluated again. If the row it replaces was server-*masked*, the merge carries that verdict (`sender_blocked`) onto the echo, and the client tombstones it unless it has confirmed unblocking the sender. The echo's body is exactly what the mask withheld, and a list that reads ready may predate a block made on another device. Nothing dates the carried verdict against that unblock, so a member unblocked here and blocked again elsewhere shows when their masked row is echoed, until a list read succeeds — for a whole outage if the list is unavailable (#2499).

> **Corrected 2026-09-23 (#2315).** This paragraph used to argue first that REST and Realtime serialize `timestamptz` differently, so string-comparing them misclassifies. `@supabase/realtime-js` does pass `timestamptz` through untouched (`transformers.js`), but the Realtime server already sends ISO. A `postgres_changes` subscription on `chat_messages` against the local stack (Realtime `v2.113.4`, realtime-js `2.116.0`) delivered an inserted row's `created_at` as `"2026-09-23T01:49:55.661142+00:00"`, the same shape as `to_json(created_at)`. The provenance argument never depended on the format.

Three client rules complete the contract, each closing a way the rules above would misfire:

- **An echoed row is never re-evaluated by the server**, because the reconnect backfill and the polling fallback read only rows after the last-seen cursor, which every echo advances. So a client remembers, for the session, which rows it already showed against a *ready* list, and which server-cleared rows it showed while the list was loading or unavailable. Server-evaluated rows are included because an UPDATE echo of a REST row (a pin, an edit, a soft delete) replaces it unevaluated. A later outage does not take any of those back; only an unevaluated row that first arrives during the outage is held (`apps/mobile/lib/chat/block-clearance.ts`). A block always outranks that memory.
- **A block or unblock the server confirmed applies at once, in every list state** — a blocked member's rows tombstone, and an unblocked member's rows and reactions show, even while the list is loading or unavailable. It is kept beside the list rather than written into it, so it can neither flip an unavailable list to ready nor be undone by a read that was already in flight when it was made; a read that started after it is the server's answer again (`useBlockedUserIds` in `@repo/hooks`).
- **A ready list contradicted by the server is re-read.** A REST row masked for a sender the ready list does not name is what a block made on another device looks like, so the client re-reads the list once per such set of masked rows, and forgets the set once a ready list stops being contradicted. A sender this client unblocked still counts: a masked row that arrives after the unblock is what the same member blocked again elsewhere looks like. A tombstone keeps offering Unblock unless this client itself confirmed the unblock.

### Retention and authorization

- `chat_message_reports` and `chat_member_blocks` both have RLS enabled with **zero policies**. No client reads either table directly; the API reaches them with the service-role key. For these two tables that default-deny is the safety guarantee rather than the convention — see the argument in `20260915210000_chat_reports_and_blocks.sql`.
- Account deletion purges a member's **own** block list and keeps everything else — blocks against them, reports they filed, and reports about them. The reasoning is in [`data-retention.md`](../data-retention.md#individual-account-deletion) § Individual Account Deletion, which owns the erasure contract; read it there rather than here, so the two cannot drift.


## Announcements

- The `#announcements` channel is special: only members with `announcements:post` permission can send messages. All members can read.
- Posting to `#announcements` triggers a push notification to all chapter members (respecting their notification preferences), except those who have blocked the author (§ [What a block does and does not hide](#what-a-block-does-and-does-not-hide)). That chapter-wide fan-out is gated on the channel being **PUBLIC and `is_read_only`** as well as announcement-named — the structural shape of an announcements channel (everyone reads, only the permitted write), rather than its name. It pushes the message body at `URGENT`, which is exempt from the quiet-hours downgrade, so it is only sound where every member can already read the channel and not just anyone can post to it. A `PRIVATE` or `ROLE_GATED` channel whose name happens to contain `announcements` does **not** get the chapter-wide fan-out; per-recipient pushes to that channel's own readable audience (mentions, and channel-scoped `all` preferences, via the chat push worker) still apply as normal (#1008).
- Announcement messages cannot be replied to in-thread. The rule is a property of the **channel**, not the caller: it is keyed off `is_read_only` (so it covers `#chapter-audit` and any chapter-created read-only channel, and survives a chapter renaming its announcements channel), and it holds regardless of permissions — a member with `announcements:post`, and the President's `*`, are refused a threaded reply just the same. `announcements:post` governs who may author a **top-level** announcement; nobody threads one. Enforced by `allowsInThreadReplies` in `@repo/validation`, called from `ChatService.sendMessage`.
- **Which status a rejected reply gets depends on who is asking**, because channel access is authorized first. A member *without* `announcements:post` is refused by the channel-access gate before the reply is ever inspected, so they get **403** ("You do not have access to this channel") — the same answer they get for a top-level post. Only a caller who *may* post there (`announcements:post`, or `*`) reaches the reply rule, and they get **400** ("Messages in a read-only channel cannot be replied to in-thread"), matching the cross-channel `reply_to_id` rejection described above. A client that wants to explain "this channel doesn't take replies" must therefore key off the 400, and must not assume a 403 here means the reply specifically was the problem.

## Slash Commands and Integrations

Slash commands turn chat into the dispatcher for every ops module. The full command catalog, slash-command dispatch path (simple vs heavy commands), announcement gating, vote-change semantics, the rich-message renderer registry, and the audit bridge are specified in [integrations.md](./integrations.md). Push-notification behavior for chat lives in [../notifications.md](../notifications.md).

## Message Persistence

Every message is written to `chat_messages` in Postgres **first**, and reaches connected clients only as a consequence of that write — Realtime replicates the row to the channel's Postgres Changes subscribers. The API performs no separate publish step (ADR-02; see `spec/ui/resilience/message-delivery.md#receiving-messages-realtime`). If realtime delivery fails, the message is still persisted and will appear on the next history fetch or page refresh.

## Read Receipts

Each user's last-read timestamp per channel is tracked in a `channel_read_receipts` table. Opening a channel stamps the cursor to server `now()`; there is no mark-read-to-a-specific-message.

Unread count per channel = messages created after that cursor, **excluding two cases that would otherwise make the badge wrong**:

- **The viewer's own messages never count.** Otherwise posting would light up your own badge until you reopened the channel you had just posted in.
- **Deleted messages never count.** A badge that survives the deletion of the only message behind it cannot be cleared by reading.

A member with no receipt for a channel has never opened it, so **every** message counts rather than none.

- **`kind = 'imported'` never counts.** An archive is history the chapter imported, not messages anyone sent them, and the rule above would otherwise hand every member a badge the size of the import that no amount of reading could clear. This is stated explicitly in `get_channel_unread_counts` rather than left to fall out of the nullable-sender comparison, which excluded it only as an artefact of `NULL <> uuid` being NULL.

Mention count is the subset of that same set which mentions the viewer.

Both are computed server-side by `get_channel_unread_counts` and served from `GET /v1/channels/unread`, which returns one row per channel the caller can read — including channels with nothing unread, as zero. Clients MUST NOT re-derive either number locally: a second definition would disagree with this one on exactly the cases above.

### Mentions

`chat_messages.mentions` holds the `users.id` of everyone mentioned in the body, resolved **server-side at send time** against the chapter roster. This is a security boundary rather than a convenience: a mention overrides a per-channel mute in the push rules, so a client-supplied list would let any member force a push to any other member in a channel they had deliberately muted.

Resolution is tiered and fails closed — exact user id, exact display name, name without spaces, first word, unique prefix — and **ambiguity at any tier resolves to nobody**. If two members share a first name, `@jane` mentions neither, because silently picking one notifies the wrong person while looking correct to the sender. Unresolvable tokens are dropped silently; an `@` in prose is not an error.

**Three deliberate limits, invisible to anyone building a mention affordance without reading this:**

- **Surname-only does not resolve.** No tier matches on the last word of a display name, so `@Carlson` does not reach "Paul Carlson". This is a product decision, not an oversight — surname matching would make `@smith` ambiguous across most chapters — and it is pinned by `mentions.spec.ts`. A client SHOULD NOT offer a surname as a working mention suggestion.
- **A display name starting with a digit is unreachable by typing.** Every mention token must open on a Unicode letter — a separate requirement from the lookbehind that excludes email addresses — so no `@`-prefixed text a person can type will ever begin with a digit — a member named e.g. "123 Squad" cannot be `@`-mentioned by any prefix of that name. The exact-user-id tier still resolves such a member when something already knows their id; only handle-style typing is blocked. Autocomplete SHOULD NOT present a digit-led display name as reachable by typing.
- **Two mentions glued together collapse to the first.** `@jane@bob` extracts only the token `jane` — the second `@` is immediately preceded by a letter, which the same lookbehind that excludes email addresses also disqualifies, so `bob` is never tokenized at all rather than tokenized-and-unresolved. Anything that inserts mentions programmatically MUST separate them with whitespace or punctuation (`@jane, @bob`), or the second one vanishes silently.

None of these are bugs to fix; they fall out of the tiering and the tokenizer rules above, and a client's job is to design around them rather than assume every display name is reachable by every input.

**Web composer autocomplete.** `apps/web/components/chat/composer.tsx` wires `@tiptap/extension-mention` to the chapter roster (`useChapterRoster`), popping a filtered member list on `@` (`apps/web/components/chat/mention-list.tsx`, `apps/web/components/chat/mention-suggestion.ts`). It designs around the three limits above rather than reaching for a client-side reimplementation of the resolver: selecting a member inserts the display name reduced to letters, digits, and marks (`mentionLabelFor`) — not just whitespace stripped, because the tokenizer *truncates* (not rejects) a token at its first disallowed character, and a label that kept e.g. `(`/`,`/`&` could shorten in transit to something that happens to exactly match a *different* member's name. Stripping to the tokenizer's always-safe character class lines up with the resolver's "name without spaces" tier (both reduce to the same folded form) so the exact member picked is the exact member that resolves — never a same-named lookalike, a truncated fragment, or a surname-only/first-word-only match. A digit-led display name is excluded from the popup's candidates entirely (`opensOnLetter`), since no token built from one could ever be recognized by the tokenizer. The composer sends plain text — `editor.getText()` — so nothing about this affordance changes the wire contract: a member typing a mention by hand and one picked from the popup produce indistinguishable message bodies, and resolution stays exactly where §Mentions above says it must, server-side at send time.

Two properties of *how* the roster is read are load-bearing, because both are easy to undo without any test noticing:

- **The body is parsed before the roster is fetched.** A message containing an `@` that yields no mention token — an email address, a bare `@` in prose, `@here` — issues **no roster query at all**. The gate is the same parser that resolves the tokens a moment later, so "has a mention" and "resolves a mention" cannot disagree.
- **The roster arrives as `user_id, display_name` in one query**, joined against chapter membership. Resolution never sees a full `users` row, so `email`, `bio` and `graduation_year` are not marshalled on the send hot path — the same boundary the chat *display* path draws. The chapter scope lives in that join rather than in the caller, which is what makes it impossible to resolve a mention against a wider set than the sending chapter.

Ambiguity detection is why the roster is read whole rather than narrowed to the parsed handles: knowing that `@jan` matches two members requires seeing every member a tier matches, and the folding the tiers compare against is defined in application code, not in SQL.

## Imported archive messages

A chapter migrating from Discord imports its history into the **same**
`chat_messages` / `chat_channels` tables as live chat, marked `kind = 'imported'`
— not a parallel schema, so it is searchable, linkable and permission-checked by
exactly the machinery everything else uses.

**How an import happens — two ways, both ending in the same rows.** The admin
chooses one at `/discord-import`; everything after the choice is identical.

- **Connect Discord** (`source = 'bot'`). The chapter installs one
  Frapp-owned bot through Discord's ordinary "Add to Server" screen, and the
  API reads the history itself over Discord's REST API. **No admin ever sees,
  pastes or stores a credential**: the bot token is a single global Frapp
  value, and the only per-chapter thing stored is a `guild_id` — a public
  snowflake, inert without an install behind it.
- **Upload an export** (`source = 'upload'`). The admin runs
  [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter) themselves
  (`-f Json --media --utc --partition 8mb`) and their browser uploads each file
  straight to the private `chat-archive` bucket through a signed URL, so no
  export byte passes through the API.

**The upload path is not deprecated and is offered every time.** It is what
keeps working if Discord ever throttles or refuses one shared bot across every
chapter, and it is the only path for a chapter that cannot install apps in its
own server. Either way a background job writes the rows, the admin sees
per-import progress, and can delete the whole import afterwards.

**What the bot path costs, stated plainly.** One bot process holds read access
to every connected chapter's Discord server at once. That is a real cross-tenant
surface and it is contained by two things, both re-checked on every slice rather
than once at setup: a guild id is only ever read from `discord_connections` by
`chapter_id` and never accepted from a caller, and Discord itself is asked to
confirm that each channel about to be read actually lives in that guild — a
channel that reports a different one fails the import rather than being skipped.

- **Connecting proves two facts, and takes neither from the browser.** Which
  guild the bot landed in comes back on the OAuth **token exchange**, a
  server-to-server call keyed by a one-time code — not from the `guild_id`
  Discord puts on the redirect. That the authorizing human actually runs that
  server is read from `GET /users/@me/guilds` under their own access token, and
  Manage Server (or Administrator, or being the owner) is required. The token is
  used for those two reads and revoked; it is never stored.
- **Those two facts are not enough on their own, so the callback binds
  nothing.** They establish that a Manage Server human installed the bot into a
  guild — not that they meant *this chapter* to read it, and starting a
  handshake is an ordinary action for any officer in any chapter. Left there, an
  officer of one chapter could send their own authorize link to an admin of
  somebody else's Discord server and read it into their chapter, with every
  Discord-side check passing honestly. So the callback **parks** what it learned
  and hands the browser a second one-time token; a normal authenticated,
  chapter-scoped request is what actually links the server, and it links it only
  to the chapter that request is scoped to. An authorization completed by
  somebody else, for a chapter they are not in, activates nothing. The
  legitimate admin is asked for nothing extra — their session already matches,
  so the dashboard confirms on arrival.
- **The bot is installed read-only**: View Channels and Read Message History,
  nothing else. It cannot post, edit, or remove anything. One visible
  consequence: Discord gates listing *private* archived threads behind Manage
  Threads, which is a permission that can also delete threads, so Frapp does
  not ask for it — private archived threads are reported as skipped, by name,
  rather than silently omitted. Public and active threads import normally.
- **Threads are not a separate mapping question.** A thread inherits whatever
  destination the admin chose for the channel it lives in, because it is part of
  that conversation. Forum channels are mappable for the same reason: every post
  in one is a thread, and they inherit the forum's choice.
- **A bot that cannot read message content fails loudly.** Without Discord's
  Message Content Intent the API gets HTTP 200 with empty content on every
  message. The import counts authored messages with nothing in them and stops
  with an error naming the fix, rather than writing a chapter's whole history as
  empty bubbles — which would look like success.
- **The whole path disappears when unconfigured.** With no Discord application
  set up for the environment, `GET /v1/discord/availability` answers
  `available: false` and the wizard offers only the upload flow.
- **The callback always answers with a redirect, never an error page.** Discord
  returns the admin to `/v1/discord/connect/callback` as a top-level browser
  navigation, so whatever happens there — success, a declined consent screen, a
  spent state, a database that cannot be reached — resolves to a 302 back to the
  dashboard carrying one `?discord=<code>` from a closed set the dashboard owns
  the wording for. It is never a JSON error body: an admin who has just picked
  their server has no way back from one, and it would be served from the API
  origin rather than the app. This has failed in a deployed environment once,
  when the migrations had not been promoted; the schema being behind the code is
  one of the causes this contract has to cover, not an exception to it.
- **A failure Frapp caused says so, and reports itself.** `expired` means the
  handshake really was spent or timed out and starting again will work.
  Something broken on our side answers `failed` instead, because telling an
  admin to "start the connection again" is a loop when the store that mints the
  new handshake is the thing that is down. Distinguishing the two leaks nothing:
  which one the admin sees turns on whether the store answered, never on whether
  their particular state existed, so it cannot be used to probe for live
  handshakes. Any such failure also raises a Sentry event on its way past —
  swallowing an exception into a friendly redirect otherwise removes the only
  signal an operator had, leaving a path that is 100% broken looking healthy.

- **Re-running *the same import* is a no-op, not a duplicate.** Every imported
  row carries `external_message_id` — the Discord message snowflake — under a
  unique index per channel, so a job that resumes, retries, or is restarted
  writes each message once. This is deliberately *not* `client_message_id`, which
  is the live client's optimistic-send key (ADR-03 and its 2026-08-24
  amendment). **The index is scoped per channel**, which is the important
  qualifier: starting a *second* import of the same export into a *different*
  channel imports the history again, by design — that is an operator choosing to
  put it somewhere else, not a duplicate. Re-running the wizard from the start
  therefore does not deduplicate against an earlier import; delete the first one
  instead.
- **Where it lands is the operator's choice, per channel**, and it is always
  asked: `chat_channels` has no unique constraint on `(chapter_id, name)`, so a
  same-named Frapp channel is never treated as consent to merge into it.
- **The Discord → Frapp role mapping grants nothing.** The wizard records which
  Frapp role each Discord role corresponds to, and shows it back to the admin as
  a worksheet for promoting people by hand. Nothing reads it to grant a
  permission and the importer never touches a `members` row — there are no
  accounts behind imported messages to grant anything to.
- **Consent is a deliberate friction point.** The admin must confirm they posted
  an in-channel notice in their Discord server before an import can be created.
  Frapp cannot verify it, and says so — but
  `discord_imports.consent_acknowledged_at` is NOT NULL, so no import exists
  anywhere in the system that skipped the question.
- **An import is bounded, and so is a chapter's archive.** Both import paths
  refuse a batch that would cross a per-import or per-chapter byte ceiling, at
  the moment files are registered — so nothing is recorded, no upload URL is
  handed back on the upload path, and on the bot path nothing is fetched from
  Discord. The ceilings clear a real DiscordChatExporter run over an active
  server with `--media` by a wide margin: they stop a runaway, they do not
  ration a legitimate import. A chapter at its ceiling deletes an old import to
  continue, which is the only thing that releases the bytes (see the next
  bullet) and which finishes in the background rather than instantly. The
  numbers, and what the check does and does not enforce, are owned by
  [`docs/internal/security/content-validation.md`](../../../docs/internal/security/content-validation.md)
  § 3.
- **Deleting an import removes what it brought in**: its messages (cascading to
  attachments and reactions) and its objects in the `chat-archive` bucket. Scoped
  by `metadata->>'discord_import_id'`, so purging one import that merged into a
  live channel leaves that channel's live messages — and any *other* import's
  messages — untouched. This is currently the only deletion path that reaps the
  `chat-archive` bucket; there is no chapter-deletion path in the product.

What follows is the behaviour the archive has once it is in.

- **Attribution without accounts.** An imported message has `sender_id = null` and
  carries `author_name` (the display name as the export recorded it),
  `author_avatar_path` and `author_external_id` (the author's Discord id). The
  alternative — a `users` row per Discord handle — was rejected: a row in `users`
  is reachable from the chapter roster, the members directory, server-side
  mention resolution and `anonymize_user`, so it would publish non-members into
  all four to satisfy a foreign key. A DB constraint guarantees every message
  names its author through one column or the other.
- **`author_avatar_path` is served through its own signed-URL endpoint,
  `POST /v1/channels/{id}/messages/avatars`** (`ChatService.resolveAuthorAvatars`,
  #1231) — not a field on the message read, for the same reason attachment
  URLs aren't: the URL expires, and the message cache is fed partly by
  Realtime rows, which cannot carry a join. Channel-scoped, like
  `listMessageAttachments`, and **deliberately never a function of a
  caller-supplied path**: an avatar's `storage_path` and a message
  attachment's live under the exact same `chat-archive` object layout
  (`archiveMediaObjectPath` — nothing in the path shape distinguishes
  "avatar" from "attachment"), and that bucket carries no storage RLS (its
  own migration's header: reads are API-issued signed URLs, which never
  consult RLS). Trusting a raw path from the caller would therefore let a
  caller who knows — or guesses — an attachment's path fetch a signed URL
  for it under the guise of "avatar", bypassing channel access entirely.
  Instead the caller sends message ids it already has from this channel;
  the service runs the ordinary `assertChannelAccess` check and then derives
  the avatar path set itself via `IChatMessageRepository.findAuthorAvatarPaths`,
  which scopes its query by `channel_id` in the same statement — a message id
  from another channel contributes nothing. A message whose avatar resolves
  to nothing — no avatar, a message id outside the channel, or a signing
  failure — falls back to initials, same as before this shipped.
- **Read-only.** `imported` is in `SERVER_ONLY_KINDS`: a client cannot post one.
  Ownership checks compare `sender_id` to the caller, and `null` matches nobody,
  so an imported message is editable by no one and deletable only by a
  `channels:manage` moderator.
- **Never notifies.** The push worker exits on the kind before it loads the
  chapter roster, and `decidePush` refuses it ahead of every other rule —
  including the mention override, because imported prose is full of `@name`
  tokens and a mention otherwise lifts a muted channel's `off`. There is no
  preference that turns this back on.
- **Never counts as unread**, per § Read Receipts above.
- **Never arrives over Realtime.** The `chat_messages` SELECT policy excludes the
  kind. That policy is what Supabase Realtime evaluates per subscriber, so an
  archive backfill produces no frames — which matters because an import can be
  targeted at a channel members currently have open, and there is no batching on
  the client's insert path. A publication row filter cannot do this job: Realtime
  builds its table list from `pg_publication_tables` names and never reads the
  filter expression.
- **Reactions survive as counts, not as people.** Discord reaction totals are
  preserved on the message's `payload`
  (`{"reactions": [{"emoji": "🔥", "count": 4}]}`); **per-reactor attribution is
  not, and cannot be.** Both `message_reactions.user_id` and
  `chat_message_actions.user_id` are NOT NULL foreign keys to `users`, and
  minting a `users` row per Discord handle was rejected for the reasons above. No
  count is lost and no identity is invented. The web bubble draws that summary
  as read-only chips (same geometry as live reactions, not buttons). Custom
  emoji render as `:name:` — v1 does not resolve `--media` images. Mobile is a
  separate surface.
- **Pins are recorded, not applied.** A message Discord had pinned imports with
  `is_pinned = false` and `payload.was_pinned_at_source = true`. A channel's 50
  live pin slots are the chapter's to spend, and an archive with 200 pins would
  bury whatever they had chosen.
- **Mentions are never resolved.** An imported message's `mentions` array is
  always empty. A mention overrides a per-channel mute in the push rules, so
  resolving `@name` tokens out of archive prose would let an import lift a mute a
  member deliberately set.
- **Moderating an archived message is not live.** The Realtime exclusion is a
  row rule, not an operation rule, so a soft-delete, pin or edit of an imported
  message reaches other members on their next channel read rather than
  immediately. Deliberate: the archive is static history and moderating it is
  rare, while the alternative reinstates the fan-out the exclusion prevents.

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
| `hours` | Service hours log confirmation (created by `/hours log`) |
| `rush` | Recruitment candidate card (created by `/<vocab> add`; live vote/bid via GET) |
| `audio` | Voice memo (mobile-native): recorded, uploaded to Storage, sent with waveform metadata — **specified, not yet in `CHAT_MESSAGE_KINDS`** |
| `pulse` | Chapter-health catch-up card — see [catch-up.md](./catch-up.md) — **specified, not yet in `CHAT_MESSAGE_KINDS`** (#821) |
| `system_audit` | System-generated notice, never client-postable. Its server-side writers and where each posts: [integrations.md § Server-originated kinds](./integrations.md#server-originated-kinds-anti-forgery) |
| `imported` | A read-only archive message brought in from another system (Discord). Server-only; see *Imported archive messages* below |
| `loading` | Client-side placeholder while NestJS RPC completes a heavy command. `_status: "recorded"` is the terminal form when the write committed but the chat card did not post — no Retry, no Discard |
| `announcement` | Broadcast announcement |

Rows marked *specified, not yet in `CHAT_MESSAGE_KINDS`* are absent from the enum; rows marked
*placeholder* are in the enum but render `ComingSoonCard`. Everything else is built.

`chat_messages.kind` carries no CHECK constraint, so adding a kind is a code change rather than a
migration — but it is a change in **three** places, and missing any one fails differently:

| Declaration | Consumed by | Symptom if missed |
| --- | --- | --- |
| `apps/api/src/domain/entities/chat.entity.ts` | `@IsIn(...)` in `chat.dto.ts` — the live send gate | API rejects the send |
| `packages/validation/src/index.ts` | `SendChatMessageSchema`; currently unreferenced, kept as the shared contract for non-Nest consumers | Nothing fails today — the shared contract silently diverges |
| `packages/chat-core/src/types.ts` | `coerceKind` in `normalizeRow` | Row is silently rewritten to `text`, so the renderer never fires |

Unknown kinds degrade to plain text — on web via that `coerceKind` rewrite, which runs *before*
`MessageRenderer`'s `default:` branch is ever reached. Either way the `content` string is what the
user sees, so every rich kind must write a readable one.

`chat_message_actions` records per-user actions on messages (reactions, RSVPs, votes, payment confirmations). Indexed on `(message_id, user_id)` for per-message aggregation and `(user_id, action_type, created_at desc)` for user history.

## Hot-path client behavior

These are the user-observable guarantees of the chat client (web and mobile), independent of the underlying implementation:

- **Optimistic + idempotent sends.** Every send/react/card-action is applied to the local view immediately under a client-generated UUID (`client_message_id`), then confirmed against the canonical row. A failed send rolls back with a toast; a duplicate (same `client_message_id`) reconciles to a single message — racing two sends of the same body yields exactly one stored message, never two.
- **Offline composer queue.** Drafts persist across reloads/cold launches. Messages composed while offline are queued and flushed in order on reconnect. A send that hard-fails (4xx) surfaces inline with a retry affordance rather than disappearing.
- **Composer keyboard contract (web).** Enter submits the message, Shift+Enter inserts a hard break, and Cmd+/ (Ctrl+/ on Windows) opens the slash palette.
- **Reconnect pill.** On loss of the realtime connection the client shows an unobtrusive "Reconnecting…" indicator near the channel header and retries with capped backoff.
- **Resubscribe before backfill.** On reconnect the client resubscribes to realtime first and backfills only once the channel reaches `SUBSCRIBED`, reading from its last-seen message id. Backfilling first would drop every row written between the query and the listener attaching. Overlap is safe because the per-channel merge is idempotent on `client_message_id`, so nothing duplicates. Implementation: `packages/chat-core/src/realtime-manager.ts` (its test suite names this the subscribe-then-backfill gate).
- **Empty states are explicit.** No visible channels, no messages in a channel, no DM threads, and no search results each render a purposeful empty state rather than a blank pane.
- **Author and DM names resolve by id, client-side, from one narrow roster.** A message carries only `sender_id`; a DM channel carries only its server-generated `dm-<userA>-<userB>` / `group-dm-<epoch>` name plus `member_ids`. Both clients resolve those against a single cached chapter projection — `GET /v1/members/roster`, which returns `{ user_id, display_name, avatar_url }` and deliberately nothing else, so rendering a name never puts the chapter's contact details on a device. Avatars are initials of the resolved name. A 1:1 DM shows the other participant; a group DM keeps a chapter-supplied title and otherwise summarises participants. A sender that cannot be resolved — a deleted account, whose membership row `anonymize_user` purges — degrades to a truncated id rather than a blank name, and an empty stored `display_name` counts as unresolved because the column is `NOT NULL DEFAULT ''`.
- **The name is deliberately not joined onto the message.** Messages reach the cache four ways, and the live one is a `postgres_changes` echo of the `chat_messages` row, which cannot carry a join. A join would therefore leave every live-arrived message unnamed for the whole session, not briefly: that handler advances the last-seen cursor, the `since` window below is exclusive, and both channel queries set `staleTime: Infinity`, so nothing re-fetches the row. Resolving by id is the only option that behaves the same on every path.

## Reconnect replay

`GET /channels/:id/messages?since=<message_uuid>&limit=50` returns messages created AFTER the given message UUID. Clients use this on reconnect to backfill missed messages before resubscribing to Realtime.

## Web ↔ mobile parity

The mobile (Expo) chat experience shares web's realtime transport and outbox, so **presence and the offline composer queue behave the same across platforms** — both run the same `@repo/chat-core` code. Reactions round-trip on both, but the affordance does not match: mobile draws a single quick reaction where web offers four plus a full picker. Inline rich-message cards are web-only apart from polls: web has a renderer registry (`apps/web/components/chat/renderers/`, `dues` still a stub), mobile branches on `poll` alone. Differences that are canonical:

- **Voice memos** would be mobile-native: recorded in the composer, uploaded to Storage, and sent as `kind="audio"` with waveform metadata, with web clients playing them back. **Specified, not built** — `audio` is not in `CHAT_MESSAGE_KINDS`, as the Message Kinds and Actions table above records, so this describes the intended behavior rather than a shipped one.
- **Presence lifecycle on mobile** — **specified, not built.** The presence payload carries no status field: it is exactly `{ userId, ts }`, pinned by key-set equality in `presence-contract.spec.ts` because widening it silently breaks push suppression. Nothing binds `AppState` to presence. As designed it would map app state to presence: backgrounded → `idle`, force-quit → `offline` — statuses that today are derived from the age of `ts`, never written.
- The authenticated entry point on mobile lands directly on chat, with the channel list as the default tab.
