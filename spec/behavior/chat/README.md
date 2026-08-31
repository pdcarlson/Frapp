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
  - **A PRIVATE channel is seeded with its creator at create time.** `POST /v1/channels` writes `member_ids: [caller]` for `type: 'PRIVATE'` — and only for that type, since `PUBLIC` and `ROLE_GATED` never consult the column. This is not a convenience: the `PRIVATE` branch has **no `*` wildcard bypass**, so a row landing with `member_ids` NULL is unreadable by every user including its own creator and a President, and `updateChannel` cannot write the column, so nothing can repair it. Before the list was access-filtered such a channel merely looked alive while 403-ing; afterwards it is absent from every read surface, recoverable only from the id in the create response (#1008). Note there is still **no add/remove-member route** for a non-DM channel, so the seed is the whole of PRIVATE membership management today (#1302).
  - Reading or reacting in a channel the caller cannot see (including one in another chapter) returns **403** (or **404** if the channel/message id does not resolve within the caller's chapter). A `reply_to_id` must reference a message in the **same** channel.
  - **Alumni lifecycle (authored content only).** On `operation: 'post'` the predicate additionally denies Alumni-role members outside direct conversations and `ROLE_GATED` channels that explicitly require `alumni:post` (`#alumni` in a default chapter) — reads are unaffected, and `*` bypasses. **Editing** authorizes as a `'post'` for the same reason, so the rule cannot be sidestepped by rewriting an older message. `operation: 'vote'` is a write that clears the same read-only gate but is *exempt* from the lifecycle rule, since voting in a poll one can read is participation, not posting; reactions and message actions authorize as reads and are likewise open. The flag is resolved only when it can change the outcome — an authored post into a channel alumni cannot write in, decided by the same `isAlumniPostableChannel` predicate the gate uses — reusing the membership row already loaded, so reads, votes, and DM posts add no query to the hot path. See [alumni.md](../alumni.md).
  - **Service-role (RLS-bypassing) writes in `ChatService` perform this membership/channel-access pre-check before the insert.** Resolving the actor from the JWT (`SupabaseAuthGuard`) is necessary but not sufficient — authorization (may this actor touch this channel/message?) is independent and mandatory.
  - **Direct client reads are backstopped by RLS.** Most chat tables are default-deny (the API reads them with the service-role key), but `chat_message_actions` (reactions / votes) is read **directly** by the web client under the user's JWT — a per-channel backfill plus a *global* Supabase Realtime subscription where RLS is the only gate. Its `SELECT` policy therefore enforces the same visibility as `canAccessChannel` at the database layer, via a `SECURITY DEFINER` helper `public.can_read_chat_message(message_id)` (channel → chapter → membership, with `member_ids` for `PRIVATE`/`DM`/`GROUP_DM` and role permissions for `ROLE_GATED`). This closes a cross-chapter / private-DM / role-gated action-read leak (FRA-38); the app-layer pre-check on writes is unchanged.
  - **Search is not a side-channel:** `GET /v1/search` filters chat-message hits to channels the caller can read, using the same predicate. Snippets never include messages from inaccessible (private/DM/role-gated/other-chapter) channels. The same rule applies to the chapter-wide poll list (see `polls.md`).
  - **The channel list is filtered, and so is the single-channel read.** `GET /v1/channels` returns only the channels the caller may read, and `GET /v1/channels/{id}` answers **403** for one they may not — both decided by the same predicate, the list through the batch entry point and the single read through `assertChannelAccess`. A channel row is not neutral metadata: `name`, `description`, `required_permissions` and `member_ids` together describe who is talking to whom, and a direct message is server-named `dm-<userA>-<userB>`, so one unfiltered row discloses a DM pair twice over. An unfiltered chapter-wide list would therefore publish the chapter's entire private and direct-message graph to every member holding `members:view` — a strictly larger leak than the unread counts are already filtered to prevent, on the surface that feeds them. The `channels:manage` mutations deliberately keep resolving a channel without this per-user check: an officer is authorized to edit or delete a channel by that permission, not by membership of it.
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
- Size limit: 25 MB per file (`MAX_UPLOAD_BYTES` in `@repo/validation`). Configurable per chapter (admin setting) is specified, not yet implemented.
- Allowed file types: the `document` kind in `@repo/validation` — images (JPEG, PNG, GIF, WebP), PDFs, Open XML Office (DOCX, XLSX, PPTX), legacy Office (DOC, XLS, PPT), TXT, and CSV. Executables, scripts, and SVG are blocked. Same list as chapter documents and Backwork; see [`chapter-docs.md`](../chapter-docs.md) § Upload allowlist.
- Upload flow: client requests signed URL from API, uploads directly to Storage, then sends message with attachment metadata.
- **The trust boundary is the `chat` bucket's `allowed_mime_types`, not the API's check.** `ChatService.requestUploadUrl` validates the extension and MIME against the `document` kind before minting a URL, but a signed upload URL **cannot pin a content type** — the client sets its own `Content-Type` on the PUT, and the API never sees the bytes. So the service-layer check gates URL *issuance* only; it is what turns a rejection into a readable error rather than a failed PUT, not a second line of defence. Measured against the local stack (storage-api 1.66.4): a PUT declaring a type outside the bucket list is rejected with **HTTP 400** and an `invalid_mime_type` body — whose `statusCode` field reads `415`, which is not the response status. What the bucket gates is the **client-declared header, never the bytes**: HTML uploaded while declaring `image/png` is accepted and stored, and is served back on a signed download as `image/png` with the markup intact. That served type is what keeps a browser from executing it, and no `nosniff` header backstops it — so any consumer that sniffs content instead of trusting the served type is still exposed. Do not relax the bucket list on the belief that something server-side resolves types behind it. Full measurement in `packages/validation/src/upload-allowlists.ts`; see also [`../../../docs/internal/security/content-validation.md`](../../../docs/internal/security/content-validation.md).
- **An attachment is a row, never text in the body.** It lands in `chat_message_attachments` (`message_id`, `channel_id`, `bucket`, `storage_path`, `filename`, `content_type`, `byte_size`), keyed unique on `(bucket, storage_path)` and cascading from the message. The composer sends the uploaded descriptors alongside the body; the server re-derives `channel_id` from the message and re-checks every `storage_path` against the `chapters/{chapter_id}/chat/{channel_id}/` prefix it minted, so a client can claim only objects it was given a URL for. Until #TBD this was appended into `content` as the literal string `📎 <filename> (<storagePath>)`, which left the object with no link back to the message — it could not be rendered, listed, or cleaned up on delete, and a member could edit the sigil out and orphan the file.
- **A message may be nothing but a file.** An empty body with at least one attachment is a valid send.
- **Attachments are fetched, not embedded in the message.** `GET /v1/channels/{id}/messages/{messageId}/attachments` returns the rows with a one-hour signed download URL each. They are a separate read for two reasons that point the same way: every bucket is private so a URL has to be minted per request and cannot be cached with the message, and the message cache is fed partly by Realtime rows, which cannot carry a join. `chat_messages.metadata.attachment_count` — a count, never a copy of the data — rides on the row so a client knows whether the call is worth making; without it a file-only message would render as an empty bubble for everyone except its sender.
- **Sending** an attachment is web-only today: the mobile composer has no picker (`chat-composer.tsx` omits the affordance deliberately rather than shipping it inert). **Reading** one works on both. Mobile briefly showed a count instead — "1 attachment · open on web" — as a deliberate stopgap, because web can send a message that is nothing but a file and the backfill removed the filename text from every historical attachment message, so those messages would otherwise have rendered as empty bubbles indistinguishable from a rendering bug. That was honest but it was a dead end, so it is gone: `apps/mobile/components/chat/message-attachments.tsx` now lists the files, previewing images inline and opening everything else through the signed URL.
- **The renderer mounts only for a message that has attachments, on both clients.** Not merely "does not fetch" — the query hook reaches for the API client context on render, so mounting it for every plain-text row would make the overwhelming majority of messages depend on a context they have never needed. `attachment_count` is what decides, and it costs no request to read. A deleted message shows none either: the API 404s the list, but the client must not offer the affordance in the first place.

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
- Posting to `#announcements` triggers a push notification to all chapter members (respecting their notification preferences). That chapter-wide fan-out is gated on the channel being **PUBLIC and `is_read_only`** as well as announcement-named — the structural shape of an announcements channel (everyone reads, only the permitted write), rather than its name. It pushes the message body at `URGENT`, which is exempt from the quiet-hours downgrade, so it is only sound where every member can already read the channel and not just anyone can post to it. A `PRIVATE` or `ROLE_GATED` channel whose name happens to contain `announcements` does **not** get the chapter-wide fan-out; per-recipient pushes to that channel's own readable audience (mentions, and channel-scoped `all` preferences, via the chat push worker) still apply as normal (#1008).
- Announcement messages cannot be replied to in-thread. The rule is a property of the **channel**, not the caller: it is keyed off `is_read_only` (so it covers `#chapter-audit` and any chapter-created read-only channel, and survives a chapter renaming its announcements channel), and it holds regardless of permissions — a member with `announcements:post`, and the President's `*`, are refused a threaded reply just the same. `announcements:post` governs who may author a **top-level** announcement; nobody threads one. Enforced by `allowsInThreadReplies` in `@repo/validation`, called from `ChatService.sendMessage`.
- **Which status a rejected reply gets depends on who is asking**, because channel access is authorized first. A member *without* `announcements:post` is refused by the channel-access gate before the reply is ever inspected, so they get **403** ("You do not have access to this channel") — the same answer they get for a top-level post. Only a caller who *may* post there (`announcements:post`, or `*`) reaches the reply rule, and they get **400** ("Messages in a read-only channel cannot be replied to in-thread"), matching the cross-channel `reply_to_id` rejection described above. A client that wants to explain "this channel doesn't take replies" must therefore key off the 400, and must not assume a 403 here means the reply specifically was the problem.

## Slash Commands and Integrations

Slash commands turn chat into the dispatcher for every ops module. The full command catalog, slash-command dispatch path (simple vs heavy commands), announcement gating, vote-change semantics, the rich-message renderer registry, and the audit bridge are specified in [integrations.md](./integrations.md). Push-notification behavior for chat lives in [../notifications.md](../notifications.md).

## Message Persistence

Every message is written to `chat_messages` in Postgres **before** being broadcast to connected clients. If realtime delivery fails, the message is still persisted and will appear on the next history fetch or page refresh.

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
  Signet-owned bot through Discord's ordinary "Add to Server" screen, and the
  API reads the history itself over Discord's REST API. **No admin ever sees,
  pastes or stores a credential**: the bot token is a single global Signet
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
  Threads, which is a permission that can also delete threads, so Signet does
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
- **A failure Signet caused says so, and reports itself.** `expired` means the
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
  same-named Signet channel is never treated as consent to merge into it.
- **The Discord → Signet role mapping grants nothing.** The wizard records which
  Signet role each Discord role corresponds to, and shows it back to the admin as
  a worksheet for promoting people by hand. Nothing reads it to grant a
  permission and the importer never touches a `members` row — there are no
  accounts behind imported messages to grant anything to.
- **Consent is a deliberate friction point.** The admin must confirm they posted
  an in-channel notice in their Discord server before an import can be created.
  Signet cannot verify it, and says so — but
  `discord_imports.consent_acknowledged_at` is NOT NULL, so no import exists
  anywhere in the system that skipped the question.
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
  count is lost and no identity is invented. Rendering the preserved summary is
  not built yet — the data is stored ahead of the surface that will show it.
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
| `hours` | Service hours log confirmation — in the enum, but still renders the placeholder `ComingSoonCard` |
| `audio` | Voice memo (mobile-native): recorded, uploaded to Storage, sent with waveform metadata — **specified, not yet in `CHAT_MESSAGE_KINDS`** |
| `pulse` | Chapter-health catch-up card — see [catch-up.md](./catch-up.md) — **specified, not yet in `CHAT_MESSAGE_KINDS`** (#821) |
| `system_audit` | System-generated audit message (posted to #chapter-audit, or to a DM on invite-accept) |
| `imported` | A read-only archive message brought in from another system (Discord). Server-only; see *Imported archive messages* below |
| `loading` | Client-side placeholder while NestJS RPC completes a heavy command |
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

The mobile (Expo) chat experience is held to **parity** with web: reactions, inline rich-message cards, presence, and the offline composer queue all behave the same across platforms. Differences that are canonical:

- **Voice memos** are mobile-native: recorded in the composer, uploaded to Storage, and sent as `kind="audio"` with waveform metadata. Web clients play them back.
- **Presence lifecycle on mobile** maps app state to presence: backgrounded → `idle`, force-quit → `offline` (consistent with the Idle/Offline statuses tracked via Realtime Presence above).
- The authenticated entry point on mobile lands directly on chat, with the channel list as the default tab.
