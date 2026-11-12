# Chat — Discord/Slack/GroupMe Hybrid

## Chat is the spine

Chat is not a module — it is the spine of the app, and every other capability (events, tasks, dues, points, polls) is a **chat integration** surfaced inline in conversation rather than behind a separate nav tab. The mobile app opens directly into chat.

- **Chat is non-optional. It cannot be disabled.** Every chapter always has, at minimum: `#general` (everyone, the landing channel when a device has no last channel and the chapter has set no default), `#announcements` (exec-write, member-read, push by default), `#chapter-audit` (system-write only, member-read — the audit feed), and DMs / group DMs (always on).
- **Modules-as-integrations.** When an ops module is enabled it does not get a top-level nav tab first. It gets: (1) one or more **slash commands** in chat, (2) a **rich message renderer** that turns the artifact into an inline card with primary actions (RSVP / Done / Vote / Pay / Confirm / Submit), and (3) *optionally* a secondary dashboard page for the longer-form view. The dashboard is secondary to the chat experience, never primary.
- **Slash-command dispatch** is the entry point for module actions — a treasurer typing `/dues remind overdue` in `#general` gets a rich card inline, no tab-switching. The command catalog, dispatch path, and renderer registry are specified in [integrations.md](./integrations.md).
- Disabling a paid module hides its slash commands and its dashboard page. A module gets no system channel of its own ([`../integrations.md`](../integrations.md#integration-pattern)).

## Channels

**Types:**

| Type       | Visibility                       | Who can post                     |
| ---------- | -------------------------------- | -------------------------------- |
| PUBLIC     | All chapter members              | Who can post (below)             |
| PRIVATE    | Invited members only             | Invited members only             |
| ROLE_GATED | Who can see (below)              | Who can post (below)             |
| DM         | Exactly two members              | Those two members                |
| GROUP_DM   | Selected members (up to 10)      | Those members                    |

### Who can see and post

Paul, 2026-11-10 (#3722, under #4068): each channel answers two questions, and only two, in place of Discord's allow, deny and inherit per permission.

- **Who can see it:** everyone in the chapter (`who_can_see` null), or a list of tiers and roles (and groups, once #4076 lands). A member sees the channel when they hold any entry on the list.
- **Who can post:** everyone who can see it (`who_can_post` null), or a list. A member posts when they can see the channel and hold any entry on this list.
- An entry is `tier:<role_tiers.id>` (every role in that tier) or `role:<roles.id>`, spelled by `@repo/validation`'s `channel-access-lists.ts` and checked by the database's `chat_access_list_valid`. A list is stored sorted and without repeats, so two lists that say the same thing are equal. The President's `*` passes every list, so a chapter can't lock itself out. A client can't send an empty list (it would admit only `*`); a list empties only when the last role or tier on it is deleted, and the deletion takes its entry off every list in the chapter.
- **No deny and no per-person overrides.** Private channels with hand-picked members stay as they are (`PRIVATE`, decided by `member_ids`) and carry no lists; neither do DMs and group DMs. One exception: a private channel someone made read-only before #3722 keeps the roles that could post there as its who-can-post list, so its members post exactly where they did; `PATCH /v1/channels/:id` with `who_can_post: null` clears it, and nothing sets one. `type` follows the lists: `ROLE_GATED` exactly when who can see is a list, `PUBLIC` when it is everyone. `is_read_only` stays as a mirror of "who can post is a list" (a database check keeps them equal), because shipped mobile builds and the announcements push rule read it. Quote replies do not: whoever may post may quote (§ Announcements).
- **A channel copies its category until changed.** A category holds the same two answers. A new channel in it starts with them (when it is created without lists), and a channel whose lists equal its category's *matches* it and follows every later change to the category (`PATCH /v1/channels/categories/:id` with `who_can_see` or `who_can_post` moves every matching channel in one transaction, `set_chat_category_access`). Changing a channel's lists makes it custom; `match_category_access: true` on `PATCH /v1/channels/:id` copies the category's lists back. Moving a channel to another category keeps its lists. Web's Chat settings show "Matches <category>" or "Custom" with a Match button; the category row says who sees and posts in it, and its editor names the channels a save will move.
- **What a list can name** comes from `GET /v1/channels/access-options` (`channels:manage`): the chapter's tiers, then its roles, each with the user ids it reaches, so an editor can count a list's people without counting anyone twice.
- **What this replaced.** Until #3722 a `ROLE_GATED` channel was readable by holders of any string in `required_permissions`, a read-only channel was postable by holders of `announcements:post`, and a Discord import gated channels on `channels:read:<name>` strings. Migration `20261111233000` turned every channel's old settings into lists, role by role from what each role held, so every member saw and posted exactly where they had. `required_permissions` stays one release, unread for access, and a trigger keeps the lists following a writer that sets only the old columns (the Discord importer, an older API); removing both is [#4286](https://github.com/pdcarlson/Frapp/issues/4286).
- **Channel-access enforcement (multi-tenancy + RBAC invariant).** Every chat read, send, reaction, poll, and search result is authorized from a **trusted DB lookup** — channel → chapter → membership (and, for `ROLE_GATED`, the caller's effective permissions) — never from a client-supplied chapter/channel field. The decision is a single shared predicate (`canAccessChannel` in `apps/api/src/domain/utils/channel-access.ts`), and its DB wiring is centralized in one injectable, `ChannelAccessService` (`assertChannelAccess` for a single channel, `filterAccessibleChannelIds` for list/batch surfaces). Every chat **and poll** code path in the NestJS API routes through it (cold reads, the hot-path send/react controller, search, and all poll create/read/vote operations), so the surfaces cannot drift:
  - `PUBLIC` → any chapter member; `PRIVATE`/`DM`/`GROUP_DM` → the user must be in the channel's `member_ids`; `ROLE_GATED` → the user must hold `*` or an entry on `who_can_see` (§ [Who can see and post](#who-can-see-and-post)), and an **empty or absent** list denies rather than falling open; an unknown type denies. A post additionally needs an entry on `who_can_post` when that is a list. What the caller holds is resolved once per request from their roles (`RbacService.getChannelAccessHolder`).
  - **A PRIVATE channel is seeded with its creator at create time.** `POST /v1/channels` writes `member_ids: [caller]` for `type: 'PRIVATE'` — and only for that type, since `PUBLIC` and `ROLE_GATED` never consult the column. This is not a convenience: the `PRIVATE` branch has **no `*` wildcard bypass**, so a row landing with `member_ids` NULL is unreadable by every user including its own creator and a President, and `updateChannel` cannot write the column (the member routes below can, and an add repairs a NULL list). Before the list was access-filtered such a channel merely looked alive while 403-ing; afterwards it is absent from every read surface, recoverable only from the id in the create response (#1008). The seed is where membership starts, not where it ends (below).
  - **A PRIVATE channel's members are added and removed by `channels:manage`** (#1302): `POST /v1/channels/{id}/members` with `{ user_id }`, and `DELETE /v1/channels/{id}/members/{userId}`. Both answer with the updated channel.
    - **Who may.** A `channels:manage` holder, and membership of the channel is not required, the same as `PATCH` and `DELETE` on a channel. So an officer can manage a private channel they can't read, and can add themselves to read it.
    - **PRIVATE only.** Any other type is refused (400). DM and Group DM membership is fixed at creation apart from leaving (§ Direct Messages), and PUBLIC and ROLE_GATED channels never consult `member_ids`.
    - **Only a chapter member can be added** (400 otherwise). Nothing at the database stops a foreign id landing in `member_ids`, since the column has no foreign key, so this route's check is the only one. Removal checks nothing of the kind, so an id that should never have been listed, or whose member has left the chapter, can always be cleaned out: it admits nobody, so removing it takes no reader away.
    - **Leaving the chapter takes a member off its PRIVATE channels.** Removing a member from the chapter strips their id from every PRIVATE channel's list in it, in the same request (`remove_user_from_private_channels`). A left-behind id would admit nobody while they are out, because `canAccessChannel` requires chapter membership before it reads the list, but a re-invite creates a new membership for the same user, and the old id would let them straight back in, history included. A member removed from the chapter at the same moment an officer adds them can still end up listed, and ids of members who left before this rule shipped stay listed until pruned ([#2796](https://github.com/pdcarlson/Frapp/issues/2796)). DMs and Group DMs keep a departing member, and a returning member finds their own conversations again.
    - **The last chapter member can't be removed** (409). The guard counts current chapter members, not ids: removing a chapter member is refused when only ids whose members have left the chapter would remain, since those admit nobody. A PRIVATE channel no chapter member can read drops out of every access-filtered list, officers' included, and only someone who still holds its id could add to it again. That is #1008's defect by another route. To get rid of the channel, delete it. A channel whose only chapter member leaves the chapter is still left with no reader ([#2796](https://github.com/pdcarlson/Frapp/issues/2796)).
    - **Both are idempotent.** Adding someone already listed, or removing someone who isn't, succeeds and changes nothing, including on an empty or NULL list.
    - **Concurrent changes don't lose each other.** Each change is one SQL update over the row's own array (`add_private_channel_member`, `remove_private_channel_member`), so two officers adding different members at once both land, and two removals racing for the last two chapter members can't both succeed.
    - **The list stays a `uuid[]`, not a join table.** Every reader of channel membership reads the array: `canAccessChannel`, the RLS helper `can_read_chat_message`, search's channel filter and the push worker. A join table would rewrite all of them, one of them an RLS policy, and the atomic updates already close the race a join table would have.
    - **No client offers it yet.** Web and mobile have no screen that adds or removes a private channel's members ([#2792](https://github.com/pdcarlson/Frapp/issues/2792)).
  - Reading or reacting in a channel the caller cannot see (including one in another chapter) returns **403** (or **404** if the channel/message id does not resolve within the caller's chapter). A `reply_to_id` must reference a message in the **same** channel.
  - **Alumni lifecycle (authored content only).** On `operation: 'post'` the predicate additionally denies Alumni-role members outside direct conversations and channels whose posting list names the Alumni role or its tier (`who_can_post`, or `who_can_see` when anyone who can see may post; `#alumni` in a default chapter) — reads are unaffected, and `*` bypasses. **Editing** authorizes as a `'post'` for the same reason, so the rule cannot be sidestepped by rewriting an older message, and so does **requesting a file-upload URL** (`POST /v1/channels/:id/upload-url`) — a signed URL is a write credential for the channel's storage prefix, and every step of a two-step write authorizes as the write rather than as the read before it (#2186). `operation: 'vote'` is a write that clears the same read-only gate but is *exempt* from the lifecycle rule, since voting in a poll one can read is participation, not posting; reactions and message actions authorize as reads and are likewise open. The flag is resolved only when it can change the outcome — an authored post into a channel alumni cannot write in, decided by the same `isAlumniPostableChannel` predicate the gate uses — reusing the membership row already loaded, so reads, votes, and DM posts add no query to the hot path. See [alumni.md](../alumni.md).
  - **Service-role (RLS-bypassing) writes to a channel or message, in every chat service (`ChatService`, `ChatReactionService`, `ChatAttachmentService`, `ChatNotificationPreferenceService`, and any added beside them), perform this membership/channel-access pre-check before the insert.** Category writes (`ChatCategoryService`) touch no channel: they are gated by `channels:manage` on the route and scoped to the caller's chapter on every lookup and write. Resolving the actor from the JWT (`SupabaseAuthGuard`) is necessary but not sufficient — authorization (may this actor touch this channel/message?) is independent and mandatory.
  - **Direct client reads are backstopped by RLS.** Most chat tables are default-deny (the API reads them with the service-role key), but `chat_message_actions` (reactions / votes) is read **directly** by both clients under the user's JWT — a per-channel backfill plus a *global* Supabase Realtime subscription where RLS is the only gate. Its `SELECT` policy therefore enforces the same visibility as `canAccessChannel` at the database layer, via a `SECURITY DEFINER` helper `public.can_read_chat_message(message_id)` (channel → chapter → membership, with `member_ids` for `PRIVATE`/`DM`/`GROUP_DM` and the `who_can_see` list for `ROLE_GATED`). This closes a cross-chapter / private-DM / role-gated action-read leak (FRA-38); the app-layer pre-check on writes is unchanged. Channel visibility is not the whole policy: it also withholds a blocked member's reactions from the member who blocked them (§ What a block does and does not hide, #2494), so a rewrite that reduces it to `can_read_chat_message(message_id)` drops that. The full predicate is in [`authorization-model.md`](../../../docs/security/authorization-model.md) § The policies that do exist.
  - **Search is not a side-channel:** `GET /v1/search` filters chat-message hits to channels the caller can read, using the same predicate. Snippets never include messages from inaccessible (private/DM/role-gated/other-chapter) channels. The same rule applies to the chapter-wide poll list (see `polls.md`).
  - **The channel list is filtered, and so is the single-channel read.** `GET /v1/channels` returns only the channels the caller may read, and `GET /v1/channels/{id}` answers **403** for one they may not — both decided by the same predicate, the list through the batch entry point and the single read through `assertChannelAccess`. A channel row is not neutral metadata: `name`, `description`, `who_can_see` and `member_ids` together describe who is talking to whom, and a direct message is server-named `dm-<userA>-<userB>`, so one unfiltered row discloses a DM pair twice over. An unfiltered chapter-wide list would therefore publish the chapter's entire private and direct-message graph to every member holding `members:view` — a strictly larger leak than the unread counts are already filtered to prevent, on the surface that feeds them. The `channels:manage` mutations deliberately keep resolving a channel without this per-user check: an officer is authorized to edit or delete a channel by that permission, not by membership of it.
- **Channel categories** (like Discord): chapters can organize channels into named groups (e.g. "General", "Executive", "Committees"). Categories are display-only grouping with a sort order. Channels not assigned to a category appear in a default "Channels" group.
- **Default channels** created on chapter setup (`DEFAULT_CHANNELS` in `apps/api/src/domain/constants/permissions.ts`): `#general` (everyone sees and posts), `#announcements` (everyone sees; the top two starting tiers post), `#chapter-audit` (everyone sees, nobody posts, `is_audit_log` — system-write audit feed; § [The audit log is system-write only](#the-audit-log-is-system-write-only)), `#alumni` (seen and posted in by the four starting tiers and the Alumni role, which makes it the one seeded channel alumni may write in).
- **Seeding happens at chapter creation (applies to all tiers)** — the onboarding submit `POST /v1/chapters/onboard`, the one way to create a chapter, seeds channels. It is **not** gated on billing/subscription. `#chapter-audit` is required so the audit bridge has a destination.
- **Welcome message on onboarding submit.** A chapter created through the onboarding wizard gets a one-time welcome `system_audit` message, the first message it sees. Its channel and text, and where each client lands after submit, are owned by [`../onboarding.md` § First-Officer Onboarding Wizard](../onboarding.md#first-officer-onboarding-wizard).
- **Performance requirement:** chapter setup must seed default channels in one write operation to avoid N+1 insert latency.
- **Failure behavior:** chapter setup must fail if default channel seeding fails; the API must not return chapter-create success when channel seeding errors.

### Where Chat opens

Added 2026-11-05, owner direction ("Mobile opens up to the last channel you were in. like discord").

- **Chat opens on the member's last channel**, remembered per device, member and chapter: a phone and a laptop each open where they left off. It is device state, not a server preference.
- **Mobile:** launching the app opens that channel's thread, with back going to chat home. It happens once per app process and only at launch: never on a later return to chat home, never once the member has left chat home, and never when the channel list only answers after launch (a slow or offline start). A notification tap that launched the app opens its own target instead. With no remembered channel, launch stays on chat home.
- **Web:** `/chat` with no `?channel=` opens it, once the member's identity is known (so `#general` is never opened and marked read on the way). A link, by channel id or name, and a channel picked in this visit both win over it. A member whose token carries no chapter claim is remembered under a "sole" chapter key, as on mobile.
- **Chapter default** (added 2026-11-06, owner decision: the chapter picks one, members do not get a pick of their own, because Chat already reopens their last channel). A `channels:manage` holder marks one channel as the chapter's default from the web chat admin page (`chat_channels.is_default`, at most one per chapter; never a DM or group DM). Marking another moves it. Web opens it, ahead of `#general`, whenever there is no remembered channel. A member who can't see it falls through to `#general`. Mobile does not use it: with no remembered channel, launch stays on chat home.
- **Fallback:** a remembered channel that is deleted, no longer visible to the member, or a DM they hid is skipped. Web then opens the chapter default, else `#general`, else the first channel. The same applies in the middle of a visit: the open channel disappearing lands there.
- **Web's two lists** (since [#3774](https://github.com/pdcarlson/Frapp/issues/3774), Shawn, 2026-11-12). Web's chat panel shows the chapter's channels or the member's direct messages, and each remembers its own last conversation. Channels land as above, on channels only. Direct messages open only the DM the member last had open there; with none (a first visit, or that DM hidden or gone) they open no conversation and ask the member to pick one, because opening a DM they didn't pick would mark it read and clear its red count unseen. So hiding the open DM leaves Direct messages with nothing open. The phone keeps one remembered channel, since its Messages screen is a list that opens nothing by itself.
- One rule for both clients: `landingChannelId` / `lastChannelLandingId` in [`packages/hooks/src/landing-channel.ts`](../../../packages/hooks/src/landing-channel.ts). Web's first-chunk cache pins the same channel's tail against eviction, and the remembered DM's beside it.

### Chat density

Added 2026-11-06, owner request ([#2252](https://github.com/pdcarlson/Frapp/issues/2252)): "can we let users change their chat density in their settings?"

- **A member picks cozy (the default), compact or bubbles**, on web in Profile and on mobile in Settings. What each draws is [`components.md` §11 § Density](../../ui/design-system/components.md#density).
- **It is device state, not a server preference**, like the last channel above: kept per browser or phone (`localStorage`, AsyncStorage, key in `@repo/chat-core/density`), so a phone can stay cozy while a laptop is compact. It is not keyed by member, so a shared device keeps one density across sign-ins, and sign-out leaves it. Syncing it to the account would need a stored setting and an endpoint; revisit if members ask for it to follow them.
- **Bubbles is a third choice** (added 2026-11-10; a read receipt under your latest message is not built, because no endpoint returns other members' read positions yet, [#4040](https://github.com/pdcarlson/Frapp/issues/4040); [#3787](https://github.com/pdcarlson/Frapp/issues/3787); Paul's opt-in OK is [his comment there](https://github.com/pdcarlson/Frapp/issues/3787#issuecomment-6771881257)). Cozy stays the default; nobody is put on Bubbles.
- **A channel can have its own display**, per device like the default: the channel's menu (web: the header's ⋯ → Display; mobile: long-press the channel → Display) offers "Your default (…)", then Cozy, Compact or Bubbles "here". Unset, the channel follows the default. Kept as one map of channel id to density under its own key in `@repo/chat-core/density`, so the default's key is unchanged.
- **A new member picks their display while setting up** (added 2026-11-10, Winston's decision on [#3787](https://github.com/pdcarlson/Frapp/issues/3787#issuecomment-6760395975)): the web tutorial and mobile s03 each carry a `Pick your chat display` step with the same three cards as Profile and Settings, and a founder, who sees neither, gets the same step in chapter setup on both surfaces (#4056) ([`onboarding.md`](../onboarding.md)). The device's current display is preselected (Cozy on a device that never picked one), so moving on without a tap keeps it. The pick is device state like any other.

#### Always formal

Added 2026-11-10 ([#3787](https://github.com/pdcarlson/Frapp/issues/3787), Winston's decisions in [his comment there](https://github.com/pdcarlson/Frapp/issues/3787#issuecomment-6760395975)).

- **What it does.** A channel set to Always formal draws the formal display, which is cozy (full-width posts with the avatar and the name line), for every member, whatever their default or their per-channel pick. Members can't override it there: the Display view shows its choices disabled under `Always formal: everyone sees this channel in the formal display.`, and the menu row reads `Formal`. A member's own per-channel pick is kept and applies again if the lock is cleared. Every other channel follows the member's display.
- **It is chapter data, not device state:** `chat_channels.display_locked` (`20261111000000`), false by default, returned on every channel row.
- **Who sets it:** the channel's creator (`chat_channels.created_by`, recorded by `POST /v1/channels` since this shipped; null for older, seeded and Discord-imported channels) or anyone with `channels:manage`. A creator must still be able to read the channel: one removed from their own PRIVATE channel, or who lost a ROLE_GATED channel's permission, is refused like any member. It is set when the channel is created (`display_locked` on `POST /v1/channels`; web Chat settings' create form has an `Always formal` switch) or later through `PUT /v1/channels/:id/display-lock` (`{ display_locked }`), which answers 403 for anyone else (checked before anything about the channel is said) and 400 on a DM or group DM. The route needs only chapter membership, so a creator without `channels:manage` can reach it; the service decides (`ChatService.setDisplayLock`), and the clients offer the switch by the same rule (`canSetChannelDisplayLock` in `@repo/hooks`): web in the open channel's ⋯ → Display, mobile in a channel row's long-press → Display.
- **How the clients apply it.** Every thread row asks its channel's density by id, so each client copies the locked ids from the channel list into `@repo/chat-core/density` (`syncLockedChannels`) whenever the list loads, and the density hooks resolve a locked channel to the formal display (`resolveChannelDensity`). Mobile also takes the lock from a channel's own read when its thread opens, for a thread reached before chat home loaded the list. A change made on another device reaches a client on its next channel-list read.

### Chat backgrounds

Each channel can have its own background behind its messages (#3973; design picks recorded on that issue, Winston, 2026-11-10). It covers the messages column only, never the chapter tools beside it (#3779). A message thread (#3785) opened from the channel shows the same background behind its messages.

- **Chapter default.** The chapter has one default background, set in Chat settings on web and Settings → Chat background on mobile, by whoever edits the chapter profile (`CHAPTER_PROFILE_PERMISSIONS`, the same people who set the logo). Every chapter starts on Plain.
- **Channel override.** A channel can have its own background, set from the channel menu by `channels:manage`: Background in web's channel menu, and in the channel row's long-press menu on mobile, beside Display (#4031). Both clients offer it by one rule (`canSetChannelBackground` in `@repo/hooks`, over `channelTakesBackground` in `@repo/validation`, which the API applies too), so neither offers it on a channel that can't take a background. A photo also needs the setter's own right to post in the channel (below), which only the save checks. "Chapter default" clears it. The audit log and an archived channel take none. There is no per-member override.
- **DMs and group DMs** are always plain.
- **Choices:** the built-ins Plain, Gold glow, Midnight, Game day and Letters (the chapter's letters, else its initials, as a faint tile), or an uploaded photo. Their looks live in `@repo/theme/chat-backgrounds`; the keys are `CHAT_BACKGROUND_KEYS` in `@repo/validation`.
- **Photos** use the `image` upload allowlist and the private `branding` bucket, as the logo does. They are not plan-gated: photo upload is a candidate "Frat Max" feature, and `ChatBackgroundService.assertPhotoBackgroundAllowed` is the one hook to gate it once Paul defines that plan.
- **Reporting is quiet.** Setting a photo posts an ordinary chat line from the person who set it ("Set this channel's background to a photo.", or for the chapter default, in the default channel, else `#general`, else the oldest channel every member may post in, since a chapter imported from Discord often has neither). Posting it needs the setter's own right to post in that channel, as any message does. Members report it through that line's tap-and-hold menu like any message; no report button is added. Removing the line (an officer acting on a report, or its sender) withdraws the photo, and the channel falls back to the chapter default (or plain). A line that is gone only because its whole channel was deleted leaves the photo standing.
- **Readability is a hard constraint.** Every thread text token stays AA over every background. Built-ins are measured at their brightest pixel; a photo is blurred and sits under the thread's `--background` at a fixed opacity, chosen for the worst pixel a photo can hold (pure white), so no upload can drop text below AA. The guard is `apps/web/components/chat/chat-background-contrast.spec.ts`.
- **Always formal** channels (#3787) get no exception: a channel shows its own background or the chapter default either way.

## Direct Messages

- **1-on-1:** Initiated by selecting a member. Creates (or reuses) a DM-type channel between exactly two users. Chapter-scoped.
  - **One per pair.** A chapter holds at most one DM for a pair of members, whichever of them opens it. The database enforces it (`chat_channels_dm_pair_key`, keyed on the two member ids rather than the channel's name, #2788). Two overlapping opens, such as a double tap or both members opening at once, return the same channel.
- **Group DM:** User selects multiple members (up to 10). Creates a GROUP_DM-type channel. Chapter-scoped.
- DMs appear in their own section of the channel list ("Direct messages" on web, `DIRECT` on mobile), not mixed with chapter channels, except that a DM the member pins moves up into Pinned beside pinned channels (§ Sidebar arrangement).
  - Changed in [#3774](https://github.com/pdcarlson/Frapp/issues/3774) by Shawn (`shawnatomklein-eng`), 2026-11-12, for web: DMs and group DMs left the channel list for a list of their own, opened by the nav's Direct messages row under Chat, so the channel list holds the chapter's channels only. A pinned DM pins within that list. Mobile already kept them apart, on its Messages screen. Where it is drawn: [`spec/ui/web-dashboard/README.md` § Chat](../../ui/web-dashboard/README.md#chat).
- DMs are not role-gated; they are scoped by an explicit member list stored on the channel.
- A user can leave a Group DM (`POST /v1/channels/:id/leave`), which removes them from the channel's member list. Once membership drops to one remaining member, the Group DM is archived (`chat_channels.archived_at` set) and drops out of the active channel list; it stays directly readable by id, so the last member's history is not deleted. No client offers Leave on a Group DM yet.
- **A user can hide a 1-on-1 DM from their own list** (#2303). The same route does it: on a `DM` it hides rather than leaves, and on any non-DM channel it is still rejected, since there is no exit from a chapter channel. A hide is per member and destroys nothing. The channel row, its `member_ids` and its messages are untouched, and the other member's list and thread are exactly as they were: they are not told, and nothing they can see changes. It is not a leave, because a 1:1 DM whose member list dropped to one would stop being a conversation with anyone, and archiving it would take it off the other member's list too.
  - **Where.** Mobile: Hide conversation in a 1:1 DM row's long-press menu, or the row's accessibility action. Web: Hide conversation in a 1:1 DM row's right-click menu in the rail (§ Sidebar arrangement, "Row menu"), and a row in the open DM's `⋯` menu. Both confirm first.
  - **What it changes.** The DM moves out of the member's channel list into a collapsed **Hidden conversations** group at its end, on mobile and web, and is marked read. While it stays hidden, `GET /v1/channels/unread` leaves it out, so it lights no badge, not even for messages from a member the hider blocked, which never bring it back (below). It stays readable by id, so a push notification, a search hit or a bookmark still opens it. `GET /v1/channels` keeps returning the row, flagged `hidden: true`, so every jump that resolves a channel against that list keeps working; each client renders it only in the Hidden conversations group, except that web keeps an open hidden DM in its usual place on the rail so the open row stays marked. Hiding the open DM on web leaves the Direct messages list with nothing open, asking the member to pick a conversation (§ Where Chat opens, Web's two lists; it moved them to their default channel before [#3774](https://github.com/pdcarlson/Frapp/issues/3774)). A hide that fails says so at once (an alert on mobile, a toast on web).
  - **What brings it back.** Opening it again yourself: from the Hidden conversations group or the directory's Message action, on either client (mobile's Message since #2773). Both go through `POST /v1/channels/dm`, which clears the hide outright. It also comes back on a new message in it, from anyone except a member the hider has blocked in this chapter, the hider's own included (sent from another device, say), the next time the list is read. A blocked member's message does not bring it back, because nothing they send reaches the blocker (§ What a block does and does not hide); an unblock therefore brings back a thread they wrote in while the block stood. A deleted message does not count. The message rule is derived when the list is read (`get_hidden_channel_ids`), not written when a message is sent, so it adds nothing to the send path and cannot race it.
  - **What it does not do.** It does not stop the other member messaging: pushes still arrive, and their next message brings the thread back. That is a block's job (§ Report and block), and hiding alone does not answer App Store Guideline 1.2's "block abusive users".
  - The per-member state is `channel_read_receipts.hidden_at` (`20260925200000`), the one row that already exists per channel and member.
- **Privacy invariant:** DMs and group DMs are **never** part of the [AI corpus](../ai.md). They are not indexed for AI Q&A, not used as summarization context, and not surfaced via citations. This is enforced server-side regardless of any chapter-level AI consent settings — opting in to AI does not opt in DMs.
- **System DM on invite accept.** When a member accepts an invite, the inviter receives a `kind="system_audit"` message in their DM channel with that member — `"Alex Chen accepted your invite."` This is the same server-originated system-message pattern as the audit bridge, but targeted to a DM rather than `#chapter-audit`.

## Channel list previews

Mobile's Messages screen draws each conversation's latest message under its name (owner decision 2026-11-07). Chat home's channel rows draw no preview and no time: Paul tried them for a day (2026-11-06) and dropped them as space nobody reads (2026-11-07), and a DM's last line is the one a member looks for. Web's Direct messages list draws them the same way since [#3774](https://github.com/pdcarlson/Frapp/issues/3774) (Shawn, 2026-11-12), newest first; web's channel rail draws none (#1191).

- **Source.** `GET /v1/channels/latest` returns one row per channel the caller can read that has a message: its id, sender, `author_name`, `content` cut to 500 characters, `kind`, `payload` (an audit line's only), attachment count and `created_at`. It is computed by `get_channel_latest_messages`, which skips deleted messages, senders the caller blocked, and message-thread replies (§ Messages → Message threads), and is filtered to the same channels as `GET /v1/channels/unread`, a hidden DM left out. A conversation with no message has no row, and its list row reads `No messages yet`, so every listed row is two lines. While the read is pending or has failed, the line is held blank rather than left out, so the rows don't grow when it answers. A Hidden conversations row has no preview.
- **Wording** (`channelPreviewLine` in `@repo/chat-core/channel-preview`). The sender's first name and the one-line text: "Jake: I've got the van". The viewer's own reads "You: ...". In a 1:1 DM the other person's message drops the name, which the row is already titled with; a group DM keeps it. Only a resolved name is cut to its first word: someone the roster can't name keeps the thread's whole fallback label ("Member 2f4a1c"), so two of them still read apart. A file-only message or a card with no text is named ("Attachment", "Event"). An audit line reads as the thread draws it ("Paul updated the chapter profile"), the actor named even when it is the viewer, and a server notice is its text alone.
- **No time on a row** (2026-11-07). The stamp abbreviated ("Yesterday", "Oct 27"), and the Messages list's newest-first order already says which is newest. Its formatter (`formatListStamp`) was deleted with it.
- **Freshness.** Live (owner, #3698, 2026-11-07, which replaced "not live"). The previews refresh with the unread badges whenever a message the member may read lands in any channel, within about a second, coalesced into one read per burst: the realtime manager's inbox reports it, and the client re-reads both ([`message-delivery.md` § Receiving Messages](../../ui/resilience/message-delivery.md#receiving-messages-realtime)). They also refresh when the app returns to the foreground, on focus, on a pull and when stale (15 s). Opening a channel invalidates `["channels"]`, which covers both, and a block or unblock the server confirmed re-reads both, since both skip a blocked sender. A message from someone else arriving in the thread the member is looking at (focused, not merely mounted under another screen, with the app or tab in front of them) re-stamps that channel read first, so the channel they are reading never lights up (§ Read Receipts).

## Sidebar arrangement

Each member arranges their own channel list (#2877, owner decision 2026-09-29). The arrangement belongs to the member and the chapter together: it follows the member between web and mobile, it differs per chapter, and nobody else can read or change it, an officer included. The categories themselves stay the chapter's (§ Channels).

- **Sections, top to bottom:** Pinned, the default Channels group, one section per category in the chapter's order, Direct messages, then System on web (`#chapter-audit`). On web since [#3774](https://github.com/pdcarlson/Frapp/issues/3774) (Shawn, 2026-11-12) the Direct messages section is its own list behind the nav's Direct messages row: Pinned (its pinned DMs), its rows, then Hidden conversations; the channel list is Pinned (pinned channels), the channel groups, then System. Hidden conversations stays at the end, as § Direct Messages describes. An empty section is not drawn.
- **Pin.** A member can pin any channel or DM they can read. A pinned row moves out of its section into Pinned; it isn't shown twice. Pins carry no order of their own. Hiding a DM outranks pinning it: a hidden DM stays in Hidden conversations, and while web keeps an open one on the rail (§ Direct Messages) it sits under Direct messages, not Pinned. A hidden row offers no pin control. A pin is removed with its channel, and one on a channel the member can no longer read is left out of every response. Pinning needs read access (403 without it, 404 outside the chapter). Unpinning needs none, so a member can always clear a pin.
- **Sort.** Pinned and Direct messages sort A–Z by the title the row shows, so a DM sorts under the other member's name. Web's Direct messages list (since [#3774](https://github.com/pdcarlson/Frapp/issues/3774), Shawn, 2026-11-12) sorts its pinned and other rows newest first instead, as mobile's Messages screen does, a conversation with no message last and A–Z; it shows its skeleton until the latest messages first answer, and keeps the last good order if a later read fails. An open hidden DM, which has no latest row, leads. The default Channels group and each category sort by the chapter's order (below), and any channel without a place in it after those, A–Z; a chapter nobody has arranged therefore reads A–Z, as every section did until 2026-11-11. One comparator for both clients: `compareChannelOrder` in `@repo/hooks`. **Recent activity** is the second sort Paul approved. The last-message projection it needed exists since 2026-11-06 (§ Channel list previews), but no channel list offers the sort: Paul chose to keep the sections A–Z on mobile Chat home (2026-11-06). The direct messages lists are the ones ordered by recent activity, newest conversation first: mobile's Messages screen (2026-11-07), since it has no sections, and web's Direct messages list since [#3774](https://github.com/pdcarlson/Frapp/issues/3774). One rule for both: `compareLatestFirst` in `@repo/hooks`.
- **Chapter order** (owner, 2026-11-11, #4178: "we should be able to reorder channels as well. simple click and drag works"; this replaced "Channels inside a category have no chapter-set order"). It is the chapter's, not the member's: an officer with `channels:manage` sets it and every member sees it, on web and mobile. On web the officer drags a channel row up or down its section, or into another category (onto a row, or onto a category's heading to put it first), and drags a category's heading to move the whole category, as in Discord's server list. A press becomes a drag after the pointer travels 5px, so a click still opens the channel, and the release opens nothing. The held row lifts off the rail as a slightly larger, tilted copy that follows the pointer and sways with its sideways speed; the rows slide apart to open a row-sized slot where it will land, and on release the copy straightens and settles into that slot (owner, 2026-11-11: "reserve the space for it", "make whatever one you're holding kind of tilt"; this replaced a drop line). Dragging a category folds every category to its heading while it is held. Escape, or a release off the rail, settles the copy back where it began. Near the rail's top or bottom edge the rail scrolls. Under reduced motion nothing tilts, slides or settles. With a row or a category heading focused, Alt+Up and Alt+Down move it one place, and every move is announced. Only the default group and categories take part: Pinned, Direct messages, System and Hidden conversations neither drag nor take a drop. While an officer can reorder, a category with no channels still shows its heading, with `Drag channels here`, so it can take its first one; members never see an empty category. Mouse and pen only: a finger on the rail scrolls it. On mobile (#3838, Shawn: drag to reorder on the phone too) the officer opens **Arrange channels** from a channel's long-press menu, its own screen because a long press on Chat home already opens the row's menu, as Discord's mobile app arranges channels from the server's settings rather than the chat list. It lists the default group and every category (empty ones included) as headings with their channels under them; each channel row has a handle at its right edge, and dragging the handle lifts the row while the rows between slide apart, and letting go saves the section it landed in through the same `PUT /v1/channels/order`, filing the channel under the heading above it. Only the handle starts a drag, so the screen still scrolls, and a screen reader moves a row with its Move up and Move down actions, announced as on web. Mobile doesn't move categories yet.
- **New channel from the list** (Shawn, 2026-11-11, #3838: "create a new channel and then drag it where I want it to be directly from the channels list"). On web a `channels:manage` holder sees a + at the right of the Channels heading and of each category's heading (an empty one included) while the pointer is over the heading or the + has focus, as Discord and Slack draw theirs. It opens the same Create a channel panel as Chat settings, started in that heading's category with the category's who-can-see and who-can-post answers, and opens the new channel once it exists. Pinned, Direct messages, System and Hidden conversations carry none, and the + is gone while a row or heading is held. On mobile the + sits at the right of the Channels heading and each category heading on s04, always drawn (a phone has no hover), and opens a New channel sheet: name, description, category and a Private switch. Who can see and post is not asked there: a public channel takes its category's answers, and the sheet says they are changed in Chat settings on the web.
  - **Where it lives.** `chat_channels.display_order` (`20261111190000`), null until the channel's section is first arranged, and never set on a DM, a group DM or `#chapter-audit`; categories keep `chat_channel_categories.display_order`. `PUT /v1/channels/order` takes a section (`category_id`, null for the default group) and its channels top to bottom, moving any listed channel into it; `PUT /v1/channels/categories/order` takes the categories top to bottom. Both need `channels:manage`. Each writes in one transaction under a per-chapter lock (`reorder_chat_channels`, `reorder_chat_categories`), and a row the officer couldn't see (a private channel they're not in, a category created mid-drag) keeps its relative place after the listed ones. The rail sends the whole section, rows the officer pinned or filtered away included, so they keep their places. The write shows at once and goes back if it fails.
- **Filters,** off by default, either or both on:
  - **Unread only** keeps rows with something unread by the server's counts (§ Read Receipts), an @-mention included.
  - **Hide muted** drops rows whose effective notification level is `off` ([`../notifications.md`](../notifications.md#chat-notification-preferences)). A muted row that addresses the member stays: an unread @-mention, or anything unread in a DM. That matches push, where a mention gets past a mute.
  - With both on, a row must pass both.
  - The filters never remove the open channel or a pinned row.
  - A filter applies only while its data is known. If the unread counts or the notification levels are loading or failed to load, that filter hides nothing, so missing data never reads as "nothing unread".
  - When the filters leave no rows, the list says so and offers to turn both off, rather than drawing an empty sidebar.
  - There is no filter for read-only channels: `#announcements` is read-only, and a member folds an archive category instead.
- **Folds.** Any section header, Pinned included, folds its section, and the choice is remembered. A folded header shows the unread total of the rows inside it that pass the filters, in the mention red when any of them addresses the member, so folding never hides a mention. The open channel stays visible under a folded header. While the list scrolls, the section in view keeps its header pinned at the top, so it can still be folded from there ([`../../ui/design-system/components.md`](../../ui/design-system/components.md#sidebar-item) § Sidebar item, "Pinned section headings").
- **Where it lives.** `chat_sidebar_preferences` holds one row per (member, chapter): the two filters and the folded section keys. `chat_sidebar_pins` holds one row per pinned (member, channel). A member with no row gets every default: nothing pinned, nothing folded, no filter. Both tables are per-user current state, so account deletion purges them ([`../data-retention.md`](../data-retention.md)). A section key is `pinned`, `channels`, `direct`, `system`, or `category:<uuid>`. `isSidebarSectionKey` in `@repo/validation` is the one grammar for the API and both clients. Folding a `category:` key needs a category in the member's chapter, which bounds the stored keys by the chapter's categories. Unfolding needs none.
- **API.** `GET /v1/chat-sidebar`; `PATCH /v1/chat-sidebar` switches one filter or both, and a filter left out keeps its value; `PUT` and `DELETE /v1/chat-sidebar/collapsed/{sectionKey}`; `PUT` and `DELETE /v1/chat-sidebar/pins/{channelId}`. Every write is idempotent and answers with the whole arrangement. Folding is one database statement over the stored array (`set_chat_sidebar_section_collapsed`), so two devices folding different sections at the same moment both land.
- **One rule for both clients.** Web's rail and mobile's s04 render the output of `arrangeChannelSidebar` in `@repo/hooks`, which sits on `groupChannelsByCategory` (§ Channels), and read the arrangement through `useSidebarPreferences`. The unread counts and mute levels it reads are the server's, never recomputed, and reach it through `sidebarUnreadCounts` and `sidebarMutedChannelIds`, which report either as unknown while its read is pending or its last attempt failed. Writes show at once. A write that overlapped no other takes its own answer as the list; overlapping writes end with one re-read of the server, since their answers can arrive out of order. A failed write puts the list back on the server's state and tells the member, every time, not only for the latest write. A write still in flight when the member signs out, switches account or switches chapter never puts its own answer into the list read after that, so the next member of the chapter never sees the last one's arrangement; it only prompts a re-read, which goes out as whoever is signed in now. Its failure isn't reported either, since whoever is on screen then didn't make it. While the unread counts are unknown, both clients draw no unread badges, on rows or folded headers alike; mobile also says the counts are unavailable once a read has failed.
- **Row menu** (owner, 2026-11-06). Each channel row opens that channel's actions: on web a right-click on a rail row (or a long press, the menu key, or Shift+F10 with the row focused), and the row itself draws no hover controls; on mobile a long press on an s04 row, hidden conversations included, which taps and opens the app's own glass menu rather than a system alert. Which actions a row offers is `channelRowActions` in `@repo/hooks`, one rule for both clients, scoped to the member's permissions so nobody sees an action the server would refuse. Leaving Edit and Delete off DMs and `#chapter-audit` (below) matches the server for `#chapter-audit`, which refuses its delete and rename (§ [The audit log is system-write only](#the-audit-log-is-system-write-only)); for DMs and group DMs it is the menu's own caution, since the server does not refuse those deletes yet (#3633). In order: Mark as read (an unread row only), Pin to top or Unpin from top, Notifications (the three levels, the current one checked; locked while the level is unknown, and on mobile while offline), Display (mobile; this channel's display on this phone, § [Chat density](#chat-density), outside `channelRowActions` because it writes nothing to the server; web keeps it in the open channel's `⋯` menu), Copy link (web), and Hide conversation (a 1:1 DM); then, after a divider and only with `channels:manage`, Edit channel (on web it opens Chat settings on that channel; on mobile an Edit channel sheet with its name, description and category, #3838), Arrange channels (mobile; opens the Arrange channels screen above) and Delete channel (asks first, and Delete stays disabled until the channel's name is typed exactly, case and all: Paul, #3838, "deleting a channel should be harder"; Chat settings' Delete asks the same way). Mobile leaves out Copy link, since a phone has no address bar; it asks for the typed name in a sheet, since an Android alert can't hold a text field. Edit and Delete are never offered on a DM, a group DM or `#chapter-audit`. On web every action is also reachable without the menu: the open channel's `⋯` menu, opening the channel, the address bar, or Chat settings.
- **Rows carry no read-only mark.** Web used to draw a lock at the end of every read-only row, the same glyph that marks a private channel at the start of a row. Until 2026-11-08 (#3697) the Discord import made every channel it created read-only, so the lock appeared on nearly every row. A read-only channel says so in its composer instead.

## Messages

**Text formatting:** Messages support Markdown-like formatting — bold (`**text**`), italic (`*text*`), inline code (`` `code` ``), code blocks, and links. The client renders this; the server stores raw text.

- **Links on both clients go through one safety rule**, `isSafeHref` in `packages/chat-core/src/links.ts`: an `http`, `https` or `mailto` link, or a relative one, and never a protocol-relative `//host`. A link whose target fails it shows its text with no link.
- **Both clients render the set with one parser** (#2861): react-markdown with `remark-breaks`, web in `apps/web/components/chat/renderers/message-markdown.tsx` and mobile in `apps/mobile/components/chat/message-markdown.tsx`. What they must agree on lives in `packages/chat-core/src/markdown.ts`: the element allowlist (bold, italic, inline code, code blocks, links and line breaks, nothing wider) and the depth cap below. A heading, list or block quote shows its text without its formatting, and an image or a divider shows nothing. Raw HTML shows as the characters typed.
- **Line breaks show as typed.** One newline is one line break, and a blank line (or several) is one blank line. A code block and each item of an unwrapped list or quote take their own lines, and a code block is set apart from the text around it by a blank line. Both clients take that layout from `packages/chat-core/src/markdown-flow.ts`, which counts the line endings typed between blocks and writes each break out once: mobile draws the body as one `Text`, and web draws it as one inline flow under `white-space: pre-wrap`, with a code block as a full-width inline block. Before that, web drew every single newline as a blank line and opened a list or quote with an empty line ([#2934](https://github.com/pdcarlson/Frapp/issues/2934)).
- **Mobile also links a bare `http(s)` URL**, by `bareUrls` in `packages/chat-core/src/links.ts` through `remarkBareUrls` (#2775). A URL in code, or in a link's own label, stays as it is. A URL is measured on the body as typed, so one holding a `__` or `*` pair (`…/__init__.py`) links as far as it runs, though the parser read the pair as emphasis; what follows it reads as typed, as in plain text. The measurement runs through prose and emphasis only, and stops before code, a link or an image. A phone has no page to resolve a relative link against, so mobile also requires a scheme (`isOpenableHref`), and each link is also a named accessibility action on the message.
- **Web does not link a bare URL yet**, only `[text](url)` and `<url>` ([#2862](https://github.com/pdcarlson/Frapp/issues/2862)). `remarkBareUrls` is the shared rule it can adopt.

A message whose formatting nests too deep renders as its raw text, exactly as typed, with no formatting. The limit is 32 levels of the parsed message, counting the paragraph and its text: about 30 block quotes inside one another, or 15 nested list levels, since each list level takes two. A line that opens more than 32 block quotes or list items is treated the same way before it is parsed, even when it sits inside a code block (a line of only `-` or only `*` markers is a divider and is exempt). Message bodies are capped by length, not by depth, and a renderer that recursed through thousands of levels would crash for everyone who opens the channel ([#2209](https://github.com/pdcarlson/Frapp/issues/2209)). Both renderers apply this cap, from `packages/chat-core/src/markdown-depth-cap.ts`.

A message that would take too long to format renders as its raw text too, decided from the text before it is parsed ([#2664](https://github.com/pdcarlson/Frapp/issues/2664)). Some bodies within the length cap, such as thousands of `*`, `_` or `[` characters, or thousands of lines continuing a quote, took the parser over a second, on the main thread of every member who opened the channel. The check estimates that cost for each paragraph from its `*`, `_` (not one between two ASCII letters or digits), `]`, `![`, `<!` and `<?` counts, its escapes, entities, code spans and line breaks, and its length. It also caps the lines from the message's first quote or list line to its end at about 1,000, since a list item can stay open across blank lines. A paragraph ends at a blank line, or at a bullet or `1.` list item. It runs high rather than low, so it can over-trigger on long block content: a numbered list of about 70 items that each carry bold, or a code block heavy with `*` or `<?`, renders raw. Both renderers apply it, from `packages/chat-core/src/markdown-parse-budget.ts`.

**Reactions:**

- Any member in the channel can add emoji reactions to a message.
- Multiple distinct reactions per message. Each reaction tracks the count and the list of users who reacted.
- A user can add the same emoji only once per message. Adding it again removes the reaction (toggle).
- Reactions are rows in `chat_message_actions` whose `action_type` is `reaction:<emoji>` (`REACTION_ACTION_PREFIX` in `@repo/chat-core`), so the table's unique `(message_id, user_id, action_type)` index is what allows one of each emoji per member. Clients read them directly under RLS and receive new ones over Realtime. The older `message_reactions` table and its `POST|GET /v1/channels/messages/{messageId}/reactions` routes are still served, but no client reads them; retiring them is #879.
- **Hot-path idempotency (`ChatReactionService.recordMessageAction`).** Per-user actions on the hot path are written to `chat_message_actions`, deduped by the DB unique index `(message_id, user_id, action_type)`. The write is **atomic** — a single insert, with a unique-violation (`23505`) treated as a successful dedup (`deduplicated: true`), never a read-then-insert TOCTOU and never a 5xx. Concurrent identical reactions therefore yield exactly one row.

**File and image uploads:**

- Users can attach files to messages. Images render as inline previews that open in an in-app viewer; other files render as downloadable links with their filename and size.
- Files are stored in Supabase Storage under `chapters/{chapter_id}/chat/{channel_id}/{message_id}/{filename}`, with a photo's preview copy beside it at `.../{message_id}/preview/preview.jpg` (§ Photo previews).
- Size limit: `MAX_UPLOAD_BYTES` per file ([`content-validation.md` § 3](../../../docs/security/content-validation.md#3-size)). Configurable per chapter (admin setting) is specified, not yet implemented.
- Allowed file types: the `document` kind in `@repo/validation`, the same list as chapter documents and Backwork; membership and rationale live in [`content-validation.md`](../../../docs/security/content-validation.md) § Validations Required.
- Upload flow: client requests signed URL from API, uploads directly to Storage, then sends message with attachment metadata.
- **The trust boundary is the `chat` bucket's `allowed_mime_types`, not the API's check.** `ChatAttachmentService.requestChatUploadUrl` validates the extension and MIME against the `document` kind before minting a URL, but a signed upload URL **cannot pin a content type** — the client sets its own `Content-Type` on the PUT, and the API never sees the bytes. So the service-layer check gates URL *issuance* only: it turns a rejection into a readable error rather than a failed PUT, and is not a second line of defence. The bucket gates the **declared header, never the bytes**, so a member can store HTML under an `image/png` declaration; it comes back typed `image/png`. What keeps that out of a renderer on this surface is the **download** side: `ChatAttachmentService.listMessageAttachments` signs every attachment with `IStorageProvider.getSignedDownloadUrls(..., forceDownload: true)`, which sets `Content-Disposition: attachment` for the whole batch (#1231 — batched into one provider call per bucket rather than one per row; the underlying batch API takes this option once for the call, not once per path, so it can no longer carry a per-file *filename* the way the old single-row `downloadAs` did — web restores the display name client-side via an `<a download>` attribute, which is UX only, not the mitigation). **Turning `forceDownload` off — for instance to render image previews inline — removes the mitigation**, so an inline-preview change must re-establish it another way; an `<img>` tag is the one exception, since it never executes a response as HTML/script regardless of `Content-Disposition` (`resolveAuthorAvatars` relies on exactly this to leave avatars undisposed, and the image viewer below on the same basis). Do not relax the bucket list on the belief that something server-side resolves types behind it. Measured request/response, and what was deliberately not measured, in `packages/validation/src/upload-allowlists.ts` § What the bucket allowlist actually enforces; see also [`../../../docs/security/content-validation.md`](../../../docs/security/content-validation.md).
- **An attachment is a row, never text in the body.** It lands in `chat_message_attachments` (`message_id`, `channel_id`, `bucket`, `storage_path`, `filename`, `content_type`, `byte_size`, `width`, `height`, `thumbhash`, `preview_storage_path`, `external_url`), keyed unique on `(message_id, bucket, storage_path)` — per message, not per object — and cascading from the message. The composer sends the uploaded descriptors alongside the body; the server re-derives `channel_id` from the message and re-checks every `storage_path` against the `chapters/{chapter_id}/chat/{channel_id}/` prefix it minted, so a client can claim only objects it was given a URL for. Before attachments became rows, this was appended into `content` as the literal string `📎 <filename> (<storagePath>)`, which left the object with no link back to the message — it could not be rendered, listed, or cleaned up on delete, and a member could edit the sigil out and orphan the file. `width`/`height` are nullable. Since 2026-11-07 a chat photo send fills them from the sender's device (§ Photo previews), so the API took on no image dependency; Discord-import rows and photos sent before then stay null, and #1505 tracks whether to backfill those. `byte_size` has the same gap for legacy Discord-import rows specifically (the `20260823121000` backfill recovered `storage_path`/`filename` from message prose but could not recover a size — that requires a storage metadata call a SQL migration must not make); `scripts/backfill-chat-attachment-byte-size.mjs` closes it as a re-runnable one-off script (#1231), reading each object's stored size from `IStorageProvider`-equivalent listing metadata rather than downloading it.
- **A message may be nothing but a file.** An empty body with at least one attachment is a valid send.
- **Attachments are fetched, not embedded in the message.** `GET /v1/channels/{id}/messages/{messageId}/attachments` returns the rows with a one-hour signed download URL each, batched into as few `getSignedDownloadUrls` calls as the attachments' buckets require (#1231) rather than one per row. They are a separate read for two reasons that point the same way: every bucket is private so a URL has to be minted per request and cannot be cached with the message, and the message cache is fed partly by Realtime rows, which cannot carry a join. `chat_messages.metadata.attachment_count` — a count, never a copy of the data — rides on the row so a client knows whether the call is worth making; without it a file-only message would render as an empty bubble for everyone except its sender.
- **An image opens in a viewer, not as a download** (#2874). An attachment whose declared type is on `isViewableImage`'s raster list (`@repo/chat-core/attachments`: JPEG, PNG, GIF, WebP, BMP) previews inline, and clicking or tapping it opens it large. Both clients open it full screen over a dim backdrop, with no card around the image and no filename drawn (the filename is the image's accessible name). Every control is an icon with no words: close, download or share sit together in the top corner, and the step arrows (when the message has more than one image) sit at the sides on web and at the bottom on mobile (2026-11-05). Web draws the image at its own size, shrunk to fit and never enlarged past it; mobile fits it to the screen, as a phone's photo viewer does, and pinch zooms from there. Web's viewer (`apps/web/components/chat/image-viewer.tsx`, built on the full-screen frame `apps/web/components/shared/media-viewer.tsx` that chapter documents also open in, [chapter-docs § Preview](../chapter-docs.md#preview)) is hosted by the timeline above its virtualized rows so a row scrolling away can't take it with it. Esc, a press on the backdrop (one that starts and ends there) or the close icon dismisses it; focus stays inside while it is open and returns to the preview of the image it was showing, when that row is still on the page (the timeline may have scrolled it out of its window, and then Radix's default applies); the arrow keys step through the message's other images, wrapping at the ends. Its download icon is the same link to the same signed URL a file row is, so the download is still forced by the URL's `Content-Disposition`. Mobile opens an overlay over the whole thread (`apps/mobile/components/chat/image-viewer.tsx`, an in-tree overlay per [`../../ui/mobile/patterns.md`](../../ui/mobile/patterns.md) § Overlays) with pinch, pan and double-tap to zoom. The thread takes the whole window, with no tab bar ([#2889](https://github.com/pdcarlson/Frapp/issues/2889)), so the viewer does too, and its controls keep clear of the top and bottom safe-area insets. Its share icon downloads the image and hands it to the system share sheet. The file keeps the sender's name as its stem, made safe to be one path segment, but its extension comes from the declared type, never from that name (`shareFileName`). On iOS that sheet offers Save to Files but not Save Image: saving to Photos needs a purpose string the app doesn't declare yet ([#2888](https://github.com/pdcarlson/Frapp/issues/2888)). On Android it lists the installed apps that accept an image. Both clients close the viewer when its message stops being shown in full (deleted, masked or held by the block list) or when a refetch no longer lists the image. The viewer holds only which message and image it shows and reads the images through the same attachments query as the row, so a refetch hands it fresh signed URLs; they last an hour. Every other attachment stays a file row that downloads, including SVG, TIFF and HEIC, and AVIF, which Android can't decode before Android 12.
  - **Why this keeps the trust rule above.** The rule is that nothing member-uploaded is ever *served inline as a document*. The viewer never navigates to the file or embeds it as a document: it draws the signed URL in an `<img>` (web) or an `Image` (mobile), which decode it as an image or fail, and never run it as HTML or script, whatever its `Content-Disposition` or its real bytes. The URL is unchanged and still signed with `forceDownload: true`, so a member who opens it directly, or through the download action, gets a download. Mobile's Share hands a downloaded copy to another app, which types a file by its extension, so the extension comes from the declared type and never from the sender's unvalidated `filename`: HTML bytes typed `image/png` under the name `a.html` leave as `a.png`, never as a page. The type list is a rendering choice, not a second defence: the bucket gates the declared type and never the bytes, so a lying `image/png` reaches the viewer and shows as a broken image.
- **Sending** an attachment works on both clients. Web attaches any `document`-kind file, from the + menu's picker or by pasting into the composer (#2246): a paste that carries files and no text of its own (a screenshot, a copied image, a file copied in the Finder) goes through the picker's path, with its limits and refusals, and any other paste is text, so copying spreadsheet cells pastes the cells, not a picture of them. A pasted screenshot the browser calls `image.png` is named `Pasted image <date> at <time>.png` (`apps/web/lib/chat/clipboard-files.ts`). Mobile sends photos from the library (#2464, `apps/mobile/lib/chat/attachment-upload.ts`), transcoding only a type the allowlist rejects, and has no picker for other files. **Reading** one works on both. Mobile briefly showed a count instead — "1 attachment · open on web" — as a deliberate stopgap, because web can send a message that is nothing but a file and the backfill removed the filename text from every historical attachment message, so those messages would otherwise have rendered as empty bubbles indistinguishable from a rendering bug. That was honest but it was a dead end, so it is gone: `apps/mobile/components/chat/message-attachments.tsx` now lists the files, previewing images inline and opening everything else through the signed URL.
- **The renderer mounts only for a message that has attachments, on both clients.** Not merely "does not fetch" — the query hook reaches for the API client context on render, so mounting it for every plain-text row would make the overwhelming majority of messages depend on a context they have never needed. `attachment_count` is what decides, and it costs no request to read. A deleted message shows none either: the API 404s the list, but the client must not offer the affordance in the first place. Nor does either client ask for the files of a row whose `_status` is anything but `confirmed`: that row's id is its `client_message_id`, and the server mints its own, so the read 404s every time (#4095). The unsent row names how many files it carries (web) or draws the sender's local photos when it holds them (mobile); the confirmed row that replaces it fetches under the server id.
- **Photo previews** (owner decision 2026-11-07, option B on <https://claude.ai/artifact/YYsb51eUiKDcQKXKEsaZdC>). A photo is drawn at its own shape before a byte of it arrives, blurred until it loads, and the thread downloads a small copy rather than the original. The sending client does all of it, from the bytes it uploads, so the API never decodes an image: it records the photo's upright `width` and `height`; a ThumbHash (<https://evanw.github.io/thumbhash/>, at most 25 bytes, base64) of it; and, for a JPEG larger than 1280 px on its longest edge, a 1280 px JPEG copy at quality 0.7. A GIF gets no copy (the thread is where it animates), nor does a PNG or WebP (it may be transparent, and a JPEG would fill that in black); both still get a size and a hash. The upload-url call takes `with_preview: true` and, for an image, mints a second URL for the copy at `<the original's folder>/preview/preview.jpg`, returned as `preview_upload_url` and `preview_storage_path`. The send claims that path, and `validateAttachmentInputs` stores no other, so a copy belongs to exactly one original. These fields are display metadata, so a malformed one (a size outside 1 to 20000 px, or one without the other; a hash that is not base64; a preview path the mint did not hand out) is dropped and the photo still sends; a 400 would fail a message over a blur. The attachments read signs the copy in the same batch and returns `preview_url` (null when there is none, or it never uploaded). Readers draw `preview_url` in the thread, falling back to `download_url` if it fails; the viewer and every download keep the original. Mobile keeps both copies in `expo-image`'s disk cache keyed by the attachment, not the URL (`lib/chat/photo-cache.ts`, since 0.10.3): a signed URL changes on every fetch, so a URL-keyed cache never hit and every scroll back or channel reopen downloaded each photo again. Its viewer opens on the cached preview and sharpens to the original. Web leaves caching to the browser, which keys by URL. Removing a message deletes each copy with its original, unless another live message still names that original or that copy (`findSharedObjects` checks both columns, and the copy's path is derived from the original's, so a forwarded photo that never named it still takes it); a check that cannot be read keeps the copy; a report's hold keeps only the original, which is what the officer reviews. Deploy order: the API ships before web or a mobile OTA that sends these fields, because an older API's validation refuses a field it does not know; roll them back together. Every step is best effort: a photo that cannot be described is sent and drawn as before, as is every photo sent before this. Mobile: `lib/chat/photo-preview.ts`; web: `lib/chat/photo-preview.ts`; API: `ChatAttachmentService`, `chatPreviewPathFor`.
  - **Where the shape comes from before the read** (owner decision 2026-11-09, option A on #3879). The size and hash live on the attachment rows, which arrive only with the per-message attachments read, so the message carries them too: at send, the API stamps `metadata.attachment_photos` beside `attachment_count`, one `{width, height, thumbhash}` per photo (an `image/` attachment), sized or not, so the count minus the entries is the number of files (`attachmentMetadataOf`). A Realtime echo is the bare row, so this is the only way a live arrival can be sized. Readers hold each photo's place and each file's row while the read is out: web draws every sized photo's box with its blur; mobile draws a lone sized photo's box with its blur, and a grid's square tiles (their size never depended on the photos) with each stamped photo's blur. So a photo sent since then takes its final size on first paint and the rows above it don't move (the 0-CLS-above-the-composer budget, `spec/ui/resilience/performance-budgets.md`). It is display metadata, not a copy of the rows: the order need not match the read's, because a column of boxes is as tall in any order. It is stamped, cleared and re-stamped with `attachment_count` (a failed attachment write clears both; the dedupe retry re-stamps both), and a masked row, a tombstone and an import carry none. Both keys are the server's: a send drops a client's own copies of them from its `metadata`. Readers still check what they read (chat-core's `normalizeRow`), because rows stored before that kept a client's metadata verbatim: a count past 10 or more entries than the count reads as no geometry, an edge outside 1 to 20000 px as unsized, and a ThumbHash whose header's own sizes aren't all present (`isDecodableThumbhash` in `@repo/validation`) as no blur, because expo-image's iOS decoder crashes on a short one. The API applies the same hash check when it stores a photo. A message without it (sent before, or imported) draws its pending state as before, a one-line caption on web and a bet-on-a-photo tile on mobile, and its row grows once when the read lands; web's timeline keeps the newest message in view through that growth (#3863). Unlike the fields above, it needs no deploy order: a client that predates it ignores the field, and a client against an API that predates it finds none and draws as before. Web: `components/chat/message-attachments.tsx`; mobile: `components/chat/message-attachments.tsx`; chat-core: `normalizeRow` (`attachment_photos`).

**Reply threads:**

- A message can be a reply to another message via `reply_to_id`. The UI shows the replied-to message as a quote/preview above the reply.
- This is Discord-style reply-with-quote, not Slack-style nested threads. All replies appear in the main channel timeline.
- Replying to a reply references the root message (no deep nesting).
- A reply mentions the author it quotes (#3844, § Mentions).
- Reply is offered where the viewer can post (`can_post`): a quote reply is a post (§ Announcements). Both clients decide it with `channelAllowsReplies`, and root-normalize with `replyTargetId`, in `packages/chat-core/src/message-actions.ts`. Web stages a reply from a row's Reply control; mobile from the message's long-press sheet (#2775). Both show a "Replying to" strip above the composer with a cancel. Tapping a quote goes to the message it quotes when that message is loaded.

**Message threads (#3785):**

A second shape beside reply-with-quote, which stays exactly as above: **Start thread** on a message opens a side conversation whose replies live in their own panel (web) or pushed screen (mobile), not in the channel timeline. Decided 2026-11-10 (Paul: "more than happy to set up threads"; the shape is Winston's picks on the [#3785 proposal](https://github.com/pdcarlson/Frapp/issues/3785#issuecomment-6773974957)). The #489 decision above, that a reply lands in the timeline, still holds for Reply; it does not describe threads.

- **Naming.** In product copy the word is "thread". In code, "thread" also names a channel's whole conversation (the mobile `chat-thread` route) and a quote-reply ("replied to in-thread" in older text). The new feature is always **message thread** in code and docs: the `thread_root_id` column, `chat_thread_follows`, the `thread` channel operation and `/v1/channels/:id/threads/...`. The older uses are not renamed in slice 1.
- **Data.** A thread reply is an ordinary `chat_messages` row in its parent's channel carrying `thread_root_id`, the parent's id. So access, report, block, masking, retention, edit and delete all apply unchanged, and the reply rides the channel's `chat:channel:<id>` Realtime topic: no new topic, no new presence. The parent carries its summary (`thread_reply_count`, `thread_last_reply_at`, up to three `thread_recent_sender_ids`, newest first), kept by the `chat_messages_thread_summary` trigger, so the parent's own UPDATE echo tells every open client "3 replies · last reply 5m ago". It also carries `thread_last_reply`, its newest reply that isn't deleted (id, sender, text cut to 500 characters, kind, attachment count, time), for the thread card's preview ([#4297](https://github.com/pdcarlson/Frapp/issues/4297)). The same trigger sets it, and `chat_messages_thread_last_reply` keeps it when that reply is edited, deleted (falling back to the newest reply left, else none) or re-attributed. It is the replier's content on the parent's row, so a read that masks withholds it from a viewer who blocked that replier, whoever wrote the parent: it keeps the reply's id, sender and time with `sender_blocked: true` and no words, the way a masked message keeps its place. A client carries that verdict onto the parent's next echo while the same replier's reply is still the latest, Unblock re-reads such a parent as it does a masked message, and each client applies its own list to the echo (`threadPreviewVisible`), showing no preview while the list can't clear the replier. Threads as child channels (Discord's model) were rejected: a topic and presence per open thread, every channel query learning to skip children, and access copied from the parent.
- **Where.** Channels and group DMs, read-only ones included; not 1:1 DMs in slice 1, and never the audit log (`channelAllowsThreads`). A thread never nests: its root is always a timeline message, and a reply cannot itself be a root. A thread reply cannot also carry `reply_to_id`, and a timeline quote cannot point at a thread reply. Deleting the parent leaves its tombstone, and its replies stay reachable from it. An imported archive message cannot be a root in slice 1: the import purge hard-deletes imported rows, and the foreign key would take the members' replies with them.
- **Who may reply.** A thread write authorizes as the `thread` channel operation (`canAccessChannel`): anyone who can read the channel, except that an archived channel and the audit log refuse it, and an alumnus is held to the same rule as a post. It skips the read-only gate, so any reader may thread under an announcement (below).
- **The timeline skips thread replies.** `GET /v1/channels/:id/messages` never returns one, and a client drops one arriving over Realtime from the timeline cache (`realtime-manager.ts`) without moving the reconnect cursor. Replies are read with `GET /v1/channels/:id/threads/:rootId/messages`, paged like the timeline (`before`, `since`); `GET /v1/channels/:id/threads/:rootId` returns the parent and the caller's follow.
- **Following.** Posting a reply follows its sender; the first reply follows the parent's author; a reply that @mentions a member follows them. A member can also follow, mute or unfollow (`PUT .../follow`). Auto-follow never undoes a mute or an unfollow: an unfollow keeps the member's row as `unfollowed`, which only their own reply turns back to following. Opening a thread moves its read cursor (`POST .../read`) without following it, and sending in one marks it read through your reply.
- **Push.** A thread reply pushes its followers only (`following`; never `muted` or `unfollowed`), never more than the channel's level allows them (`decidePush`'s `skip-thread`), except an @mention, which pushes even through a muted thread, as it does through a muted channel. A thread reply is never an announcement push, even under an announcement: any reader may write it, so the channel alone would hand every member an URGENT push. The push's target carries `threadRootId`; an app that predates threads opens the channel. Presence in the channel still skips the push, as for any message.
- **Unread.** A thread reply never counts toward its channel's unread badge or Chat home preview (keeping the 2026-11-07 rule that a busy channel adds nothing). A thread reply that @mentions you counts toward the channel's mention tally until you read that thread or the channel, whichever comes later, so a client without thread UI cannot strand a badge (§ Read Receipts).
- **Notifications.** Reading a channel clears its timeline pushes from the inbox, not its threads' (`data.target.threadRootId` set); reading a thread clears that thread's. On mobile, a channel at zero unread leaves its thread pushes in the tray. `GET /v1/channels/:id/threads/followed` lists your followed and muted threads in a channel with how many replies are new (zero when muted), for the parent's chip and the channel's Threads count.
- **Typing** inside a thread names the typists (`Paul is typing…`, `Paul and Shawn are typing…`, `Paul, Shawn and Alex are typing…`, then `Several people are typing…`), never the viewer or a member they blocked, through the one typing-label helper (`typingLabel` in `@repo/chat-core/typing-label`) the channel lines use too. A thread's typing broadcast rides the channel topic tagged with its root, and the realtime manager keeps it off the channel's own typing line.
- **Web.** **Start thread** sits after Reply in a message's action bar, offered where threads are (above) and not on a deleted or imported message. From 1280px wide, with no tool page beside chat, the thread opens in a 384px column beside the chat, where the members column was, as Discord's and Slack's do on a computer: the channel stays in view and its composer stays usable, the header reads "Thread" over `#channel` with Follow and an X, and X or Escape closes it, and the members column is back if the member hadn't hidden it; the members toggle closes it too and shows the column. A reply being typed in a thread survives its closing and reopening, and the window crossing 1280px, until it is sent. Narrower, or beside a tool page, the thread replaces the message list inside the chat column, with Back (or Escape) returning to it, the timeline's scroll kept underneath. *Changed 2026-11-12 ([#4297](https://github.com/pdcarlson/Frapp/issues/4297), asked by Shawn):* Winston's slice-1 choice (#3785) had the thread replace the message list at every width; it now does so only below that width. The parent's thread card opens it (#4297, after Discord's): a bordered card under the reactions with up to three repliers' faces side by side (photo, else initials in their color), "3 replies" in the accent (the foreground on an Important row, as on mobile), "● 2 new" when the viewer follows the thread and has replies they haven't read (from `GET .../threads/followed`: read only while the timeline holds a parent with replies, again when one of them other than the open thread gains a reply, when the viewer reads a thread, every 5 s while Realtime is down to polling and once on its return, and once a minute for a thread read on another device), "last reply 5m ago", and a `›`. Under that row, the latest reply's preview: its replier's face, first name ("You" for the viewer's own, "Member 2f4a1c" for someone who left) and words on one line with an ellipsis, a file-only reply reading as its quote does ("Attachment", "2 attachments"); the line is at most 24rem wide, so a long reply doesn't widen the message. A thread whose latest reply the viewer can't see (blocked, or every reply deleted) draws the card without it. On a narrow card "last reply" drops out whole first, then the faces; the count, "2 new" and the `›` always show. In cozy a 2px connector in `--border` runs down the gutter from the author's photo and curves into the middle of the card's edge; compact and Bubbles draw the card alone. *Changed 2026-11-11 ([#4297](https://github.com/pdcarlson/Frapp/issues/4297), asked by Shawn):* the slice-1 chip was a bare line of up to three overlapping 20px initials, the count and the time, whose overlap hid half of each replier's initials. Thread replies send optimistically, and a failed one stays with Retry and Delete; there is no offline queue for them, so the thread composer disables offline and says why. The parent and the replies are full message rows, drawn by the timeline's own row ([#4034](https://github.com/pdcarlson/Frapp/issues/4034)): attachments, cards, reactions, the edited marker, the action bar (Edit and Delete included) and a blocked member's placeholder, in the channel's display. The parent heads the list from the start, and older replies page in above the loaded ones as the member scrolls up.
- **Mobile.** **Start thread** sits under Reply in a message's long-press sheet, on the same messages web offers it on. It and the parent's thread card (under the reactions or the card; under the bubble on the speaker's side in Bubbles) push the thread as its own screen over the channel: `chat-thread` again with a `threadRootId`, so the platform's back returns to the channel (`spec/ui/mobile/navigation.md` § Going back). The screen has a `‹` back, a header naming the parent, Follow / Following, the parent, an "N replies" divider, the replies newest at the bottom, the named typing line and a "Reply in thread…" composer. The header's first line is the parent's words, as a quote of it reads (its text on one line, or "Attachment" for files alone), and the second is its author and channel ("Miles Guerrero · #general", "You" for the viewer's own), as Discord names a thread by its first message; while the parent is loading, deleted, or from someone the viewer blocked, it reads "Thread" over the channel's name alone. *Changed 2026-11-12 ([#4297](https://github.com/pdcarlson/Frapp/issues/4297), asked by Shawn; option B of three drawn on the real screen, picked 2026-11-12):* the header read "Thread" over the channel's name on every thread. Web's panel still does. Sending, failure and offline behave as on web. The thread card is web's (above), in the same order and words: the repliers' faces (photo, else initials, 24pt), "3 replies", "● 2 new" (from the same `GET .../threads/followed` read, re-read when the thread screen marks a thread read), "last reply 5m ago" that drops out whole on a narrow card, a `›`, and the latest reply's preview line (24pt face, first name or "You", its words on one line, at most 384pt wide), with the 2pt connector from the author's photo in cozy. *Changed 2026-11-12 ([#4297](https://github.com/pdcarlson/Frapp/issues/4297), asked by Shawn):* the slice-1 chip was up to three overlapping 20pt initials, the count and "· last reply 5m ago". The parent and the replies are full rows, as web's are (above): the timeline's own row, so cards, reactions, quotes, the edited marker and a blocked member's tombstone draw as they do in the channel, and the parent is the channel's live copy while the channel holds it. A long-press opens the channel's actions sheet with what web's thread rows offer: the quick reactions, Copy, Edit (the parent's as a post, a reply's as a thread reply), Delete, Report and Block; not Reply, Start thread, Mention or Important. Edit opens in the thread's composer with the channel's "Editing message" strip and rules. Every write names the thread, so a reply's lands in the thread's cache. *Changed 2026-11-12 ([#4297](https://github.com/pdcarlson/Frapp/issues/4297), asked by Shawn):* Winston's slice-1 rows (#4055) were lean, with no reactions, cards or long-press actions inside a thread. A thread-reply push, or its row in the notification list, opens the thread with its channel under it, so back returns to the channel and the channel's realtime topic is attached for the thread's live replies and typing ([#4054](https://github.com/pdcarlson/Frapp/issues/4054)); a chat push tapped inside a thread goes on the stack over it rather than replacing it, except a reply in that same thread, whose tap leaves the member where they are.
- **No auto-archive.** A thread stays open as long as its parent exists.
- **Slices.** Slice 1 is the schema, API, push and unread rules above plus the web panel, mobile screen and parent chip; this spec section landed with the backend. Slice 2: "Also send to #channel", a cross-channel Threads inbox, thread results in search. Slice 3: Discord import as threads.

**Edit and delete:**

- A sender can edit their own messages. Edited messages display an "(edited)" indicator, dropped once the message is deleted (`showsEditedMarker`), and store `edited_at` timestamp. The original text is not preserved (no edit history in v1).
- **Which messages offer Edit and Delete is decided once for both clients**, in `packages/chat-core/src/message-actions.ts` (#2775). Edit is your own plain-text message only: not a card, not an imported row, and not in a channel where you can no longer post, since an edit authorizes as a post (§ Channels → Channel-access enforcement → Alumni lifecycle). The server enforces the ownership, post and imported-row halves (`ChatService.editMessage` refuses an imported row with 403, #2878, § Imported archive messages); the card half is client-side only for now, since `editMessage` never checks for a card kind ([#2863](https://github.com/pdcarlson/Frapp/issues/2863)). Delete is your own message, or anyone's with `channels:manage`. Neither is offered on a pending, failed or deleted row. Web edits inline in the row. Mobile edits in the composer under an "Editing message" strip, and the member's draft is kept aside until the edit is saved or cancelled. Both confirm a delete with the same words, and neither edit nor delete is optimistic: the server's row is the update.
- **An update to a message the loaded window doesn't hold is not merged in.** That covers the answer to an edit or delete, and a Realtime UPDATE echo (an edit, pin or soft delete by anyone). Spliced in at its `created_at`, an old message would become the cache's oldest row and the older-page read would skip every message between it and the window. Nothing in the timeline shows it, and web's Pinned panel lists only pins in the loaded timeline anyway (§ Report and block, #2780). The next read of its page brings the change (`mergeHeldServerRow` and `holdsServerRow` in `packages/chat-core/src/cache.ts`, #2871). A new message (INSERT) always lands.
- A sender can delete their own messages. Users with `channels:manage` permission can delete any message in channels they manage. The permission is resolved **in the message's own chapter, after channel access is confirmed** — holding `channels:manage` in the caller's active chapter grants nothing over a message in another one. A channel the officer cannot read (a DM, or a `PRIVATE` channel they are not in) is out of reach of this route; the only way an officer removes a message there is through an open report naming it (§ Report and block → Officer action).
- Edit, delete, pin and unpin all authorize through the same channel-access lookup as reads: a message whose channel does not resolve within the caller's active chapter returns 404, and sender ownership alone is never sufficient (a member removed from a chapter must not keep editing their history there).
- Deleted messages are soft-deleted: content is replaced with "[message deleted]", `is_deleted = true`. Attachments for deleted messages are removed from Storage.
  - **What a delete removes** (#1575): the text (`content`), the card's data (`payload`: an event's name, times and place, a poll's question and options, a task's fields, for every card kind), `metadata` (except an imported row's `discord_import_id`, which its import purge selects on; an imported row's `payload` is its Discord archive sidecar, not a card, and keeps only `source` and `author_username`, the handle the import backfills read), any flag, any Activity link indexed from the text, and the attachments' bytes (below). The row stays as a tombstone with its id, `kind`, sender, time, pin and thread counts, so it draws in place. Every API read serves a deleted message this way whatever the row holds (`redactDeletedMessage`, applied by the shared reader `maskBlockedMessages` and by the unpin, delete and send-retry answers), and the Realtime UPDATE echo of the delete carries the cleared row. A deleted message takes no further writes that could carry its data again: no edit, flag, pin, reaction, vote or card response, and a poll close that lands after the delete writes nothing.
  - **What it does not remove:** reactions and card responses (`chat_message_actions`: who reacted, and which option id each member voted, with the options' text gone), `mentions` (member ids), replies (each its own message, deleted on its own), a report's snapshot of the message, which is the officer's evidence (§ Report and block), and the in-app notifications the message produced, whose body quotes its text, and any push already delivered ([#4418](https://github.com/pdcarlson/Frapp/issues/4418)).
  - **Rows deleted before #1575 still hold their `payload`** until the cleanup migration `20261112060000_clear_deleted_message_payloads.sql` runs, which waits on Paul's approval as a data deletion. The API never serves it, but a member who can read the channel can still read it straight from `chat_messages` under its read policy (`chat_messages_select`, which does not filter `is_deleted`), and an unpin of such a row sends it in the Realtime UPDATE echo. Remove this bullet once the migration has run on production.
  - The purge runs **after** the row is flagged, and is best-effort: flagging the message stops the API minting *new* download URLs (`GET /v1/channels/:id/messages/:messageId/attachments` 404s a deleted message). A signed URL issued **before** the delete stays valid for the rest of its hour-long TTL regardless — deletion of the bytes is what ends that, and the purge is best-effort, so a Storage failure leaves the object readable to anyone already holding a URL. Failures are logged per bucket and never roll back the delete or fail the request.
  - **An object still referenced by an undeleted message is kept.** `chat_message_attachments` is unique on `(message_id, bucket, storage_path)` — per message, not per object — so two messages may point at one object: the Discord importer maps every reference to a deduplicated export file onto the same object, and the send-time check validates only the channel prefix, so a client can claim a path another message already uses. Only rows of **undeleted** messages count, or two deleted messages would spare each other's object forever.
  - The check covers other chat *attachments* only. `chat_messages.author_avatar_path` and `discord_import_files.storage_path` can resolve to the same imported object and are not consulted.
  - **An object a report holds is kept too**, until the report resolves and releases it (§ Report and block → Report, #2481). Unlike a shared object, nothing in chat shows it any more and no new URL is minted for it except through the report, for the officers reviewing it. A URL a reader was handed before the delete keeps working until it expires, as the bullet above says; for a held object nothing cuts that short.
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
blanked `content` and `metadata` but, until #1575, not `payload`, so serving the
full row meant a bookmarked poll or event card that had since been deleted
shipped its payload on an endpoint whose declared type says the message reads
`[message deleted]`.
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
- Names the typists just above the composer, as Discord does and as the thread line does: `Paul is typing…`, `Paul and Shawn are typing…`, `Paul, Shawn and Alex are typing…`, then `Several people are typing…` (`typingLabel` in `@repo/chat-core/typing-label`). A typist whose name hasn't loaded reads as `Someone`. A member the viewer has blocked never counts toward it (§ What a block does and does not hide). Until 2026-11-11 the channel line read "Someone is typing…" and named nobody.
- The line is always one caption line tall on both apps, empty when nobody types, so someone starting or stopping typing never moves the timeline or the composer.
- A sender broadcasts at most once every 3 seconds while typing, and never for an empty box: clearing the composer after a send, or erasing the last character, is not typing. A typist expires 4 seconds after their last broadcast, and the indicator catches up on the next sweep of expired typists, which runs every 1.5 seconds, so it clears 4 to 5.5 seconds after that broadcast. A message from a typist ends their typing at once, in the channel or the thread it lands in, so the line never says someone is typing under the message they just sent; the viewer's own message also resets their 3-second throttle, so starting the next message is announced straight away (`packages/chat-core/src/realtime-manager.ts`).
- The viewer's own typing never counts, including typing from another of the viewer's devices, whose broadcasts do arrive.

**Member list** (web and mobile, [#3536](https://github.com/pdcarlson/Frapp/issues/3536)):

- Beside a channel, the list shows everyone who can read it, by the same rule that admits a read: the whole chapter for a public channel, the holders of a required permission (or the wildcard) for a role-gated one, and `member_ids` for a private channel or group DM. A 1:1 DM shows no list. Only a member who can read the channel can ask for its list (`GET /v1/channels/{id}/members`).
- Grouped under each reader's highest role (lowest `display_order`, ties by name), groups in role order and readers with no role last under "No role", names A to Z inside each group (`groupChannelMembersByRole` in `@repo/hooks`, shared by web and mobile). Grouped by role rather than presence since 2026-11-06, because role is known with the first read: the presence groups this replaced drew one "Members" group and then moved every name when presence arrived. Presence now only paints a row's dot and dims an offline avatar. Names take the member's role color, as in the timeline. An API that sends no `role_id` gets one "Members" list in role-rank order instead.
- Past 12 readers a search field sits above the groups: every typed word must start a word of the name (split on spaces, hyphens, apostrophes and periods), ignoring case and accents. No match reads "No one named “…”".
- On mobile the list is a tall sheet from the thread header's members button, shown on every channel but a 1:1 DM, with the same groups and search. Since #3917 (2026-11-11) its rows carry web's presence dot, offline fade and custom status line, and the member profile sheet carries the dot on its avatar and the line under the name.
- A row opens that member's profile on both clients (mobile 2026-11-07, web [#3726](https://github.com/pdcarlson/Frapp/issues/3726)), as § Opening a member's profile says.

**Online/offline presence:**

- Member online status is tracked via Supabase Realtime Presence.
- No liveness heartbeat: an entry lasts as long as its connection (below). Web re-publishes activity at most every ~30 seconds, the phone every 2 minutes while open. *(Corrected 2026-11-11, #3917: this line said a ~30s heartbeat marked a silent member offline, which nothing does.)*
- Online status is visible in the member list sidebar and in DM conversations. The web **Directory** (`/members`) and the web channel member list (§ Member list above) render it, and so do the phone's channel Members sheet and member profile sheet (#3917, 2026-11-11); the DM view does not yet.
- Statuses: Online, Idle (app open but inactive for >5 minutes), Offline, plus the two a member can pick (#3845): Do Not Disturb, and Invisible, which everyone else sees as Offline. § Member-set status below.

**Two presence topics, deliberately.** They answer different questions and must not be merged:

| Topic | Scope | Read by |
| --- | --- | --- |
| `chat:channel:<channelId>` | Who has *this channel* open | The push worker, via service role, to suppress pushes to members already looking (ADR-10) |
| `presence:chapter:<chapterId>` | Who is present in the *chapter* at all | The web Directory, Chat's member list on both apps, and the phone's member profile sheet |

The chat topic's channel config and its `{ userId, ts }` payload are a cross-service contract pinned by `packages/chat-core/src/presence-contract.spec.ts`. Re-keying it or widening its payload silently disables push suppression, so a surface needing chapter-wide presence takes the second topic rather than extending the first.

Both are **private** Realtime channels since 2026-09-06 (#1552, migration `20260906203000`), each behind its own predicate on `realtime.messages`: `presence:chapter:<chapterId>` admits any member of the chapter (`realtime_can_read_chapter_scope`); `chat:channel:<channelId>` admits exactly the members who may read that channel (`can_read_chat_channel` — PUBLIC to the chapter, PRIVATE/DM/GROUP_DM to `member_ids`, ROLE_GATED by permission — the same predicate `can_read_chat_message` now delegates to), so who is present in a DM is not visible chapter-wide. Joining, `track()` and, on the chat topic, the typing `send()` are all gated; `postgres_changes` bound to the chat channel still deliver. The push worker joins the chat topic privately with the same config, because private and public are separate rooms — a worker left public would see an empty roster and suppress nothing. It adds `presence.enabled: true`, because realtime-js asks the server for the roster only for a channel that sets it or listens for presence; without it the worker's roster was always empty (#2974). The clients don't need the flag to `track()`. An anon-key holder can neither read either roster nor publish to it. Presence still stays **advisory** and must never be an input to an authorization decision: a member who may read a channel can still publish an entry naming another member, because Realtime policies see the topic and the message extension, not the presence payload. What each topic exposes is [`docs/security/authorization-model.md`](../../../docs/security/authorization-model.md) § "The policies that do exist".

**`ts` is last activity, not last publish** — this is what makes Idle reachable. If every publish stamped the current time, `ts` could never age past the 5-minute threshold and every present member would read Online forever. Instead a re-publish carries the *unchanged* activity timestamp, and the two signals split the three states: presence membership answers Online-vs-Offline, and `ts` answers Online-vs-Idle. Activity is approximated from throttled pointer, key, scroll and focus events plus `visibilitychange` — the browser cannot observe attention directly, and the throttle floor is the ~30s cadence, so the worst-case error is one interval against a five-minute window. A `visibilitychange` to *hidden* does not count as activity; treating it as such would reset the idle clock at the moment a member walks away. **On the phone the foreground is the activity** (#3917): the phone has no app-wide touch listener, and the OS locks an untouched phone, which backgrounds the app. So the return to the foreground stamps activity, and a phone in the foreground re-stamps it every 2 minutes (`FOREGROUND_REFRESH_MS`), so a member reading for longer than five minutes doesn't cross into Idle. A member who turns auto-lock off and walks away reads Online, as on Slack's and Discord's phone apps.

**Nothing expires a presence entry.** Supabase Realtime presence is connection-scoped — there is no TTL and no reaper — so an entry goes away when the channel or socket tears down, not when a client stops publishing. There is therefore no liveness heartbeat to maintain: publishing happens on join, on every re-join (which is what restores a member after a drop), and when activity genuinely advances. A periodic re-publish of an unchanged payload would broadcast a diff to every subscriber and buy nothing.

**Presence is published from the app shell, not from the screen that displays it.** A member is present because the app is open, not because they are looking at the Directory — so the tracking half is mounted for every dashboard route. Scoping it to the reading screen would make the dot mean "has the Directory open" and render everyone in Chat as Offline. Both apps run one hook, `@repo/hooks/use-chapter-presence`, each binding its own client and activity source.

**On the phone** (#3917, 2026-11-11) the hook runs once, app-wide, from `AppRuntime` (`apps/mobile/lib/presence/chapter-presence.ts`), and holds exactly one extra Realtime channel on the socket chat already keeps open. It holds it only while the app is in the foreground (`inactive`, the app switcher, still counts). **Switching away** first publishes the member's entry with `away: true`, which reads **Idle**, then, 1.5 seconds later (`AWAY_RELEASE_DELAY_MS`), releases the topic through the shared `releaseTopic`, which takes the entry off it. Every member who saw that away entry keeps them Idle for **five minutes** after it leaves (`AWAY_GRACE_MS`, Shawn's call on #3917, 2026-11-11: people pop into another app and come back), then Offline; coming back inside that time re-joins and reads Online again. A picked status holds through the grace: a DND member who switches away reads DND, not Idle, until it ends. An entry that isn't away beats an away one for the same member, so a member active in a web tab while their phone says away reads Online. Two limits, accepted: a member who opens the app after the leave never saw it, so reads that member Offline; and if the OS freezes the app before the away publish goes out, the member goes straight to Offline once their socket drops. A picked status still wins over away (a DND member stays DND), an Invisible member publishes nothing either way, and web never sets `away`, so a closed tab is Offline at once. Like web it gates on the link, never on `/health` (`realtime-resilience` rule 7): the connection monitor's `linkDown()`, which a confirmed drop sets and the next link-up event clears, whatever `/health` says, so a failing API doesn't make every member read Offline.

Presence is ephemeral per ADR-02: it lives on the Realtime socket and is never persisted, so it costs no Postgres write and leaves no row to reap when a member disconnects.

**Member-set status** (#3845, built on web and mobile 2026-11-09; mobile shows other members' dots since #3917, 2026-11-11). A member picks Online, Idle, Do Not Disturb or Invisible, and an optional custom line, from the Status row at the top of the avatar menu: on web a submenu and a small dialog, on mobile a status sheet opened from the ME menu ([`../../ui/mobile/navigation.md`](../../ui/mobile/navigation.md#global-entries-outside-the-tab-bar)). The choice is stored on their `user_settings` row, so it reaches their other devices (next bullet but two for how soon), and its delivery effect (DND silences every non-URGENT push) is in [`../notifications.md`](../notifications.md) § Do Not Disturb. How it shows:

- **It rides the chapter presence entry.** The entry on `presence:chapter:<chapterId>` is `{ userId, ts }` plus, only when there is something to say, `status` (`idle` or `dnd`), `line` (the custom line) and, from the phone, `away: true` while it lets go of the topic (§ Online/offline presence, On the phone). An automatic member's entry is the plain `{ userId, ts }` it always was. Carrying them on presence, rather than reading other members' settings, is what makes them vanish exactly when the dot does: offline, or invisible. Readers validate the payload like any other: an unknown `status` reads automatic, and a `line` is flattened to one line of at most 80 code points before it renders, because the payload is whatever the publishing client sent. **The line inherits presence's advisory status:** the Realtime policies don't bind an entry's `userId` to its publisher, so a chapter member with a modified client can publish an entry naming another member, with a status and line of their choosing, and stamp it newer than the real one, so readers show it for as long as that publisher stays connected. Clamping `ts` to the reader's clock was weighed and rejected: a clamped forgery is stamped "now", which still beats the real entry's last activity. Before #3845 a forged entry could only make someone look online; now it can also put words under their name. Serving the line from the server would close that, at the cost of a read per member per surface; it is accepted for now and stated in [`authorization-model.md`](../../../docs/security/authorization-model.md) § "The policies that do exist". The **chat-topic payload is not widened**: `chat:channel:<channelId>` stays `{ userId, ts }`, the contract `presence-contract.spec.ts` pins.
- **A picked status beats the clock.** A picked Idle stays Idle while the member types, and DND stays DND after five minutes away rather than going Idle. Only an Online member is aged into automatic Idle.
- **Invisible publishes nothing to the chapter topic** from the browser or phone where it was picked, at once, and from the member's other open dashboards once they next read their status. The client still joins `presence:chapter:<chapterId>`, because it still reads everyone else, but never calls `track()` there, and switching to Invisible while joined calls `untrack()`. Once every open dashboard has caught up, no client, modified or not, can learn from that topic that the member is online, and officers can't see through it (Paul's call 2, pending his review on #3923). The per-channel chat track is kept, so pushes for the channel the member is reading stay suppressed; the cost is that a member of that same channel, with a modified client, could tell they have it open (Paul's call 1, the same review).
- **Nothing is announced until the member's own status is known.** The client waits for `GET /v1/settings` before its first publish, so a member who saved Invisible never flashes Online on load. If that read fails, presence does not wait on the API: the client publishes the status this browser last saw for the member (kept in `localStorage`), or automatic Online with none, and keeps retrying. **The phone keeps no last-seen status, so it publishes nothing until a read succeeds** (#3917): a failed read there would otherwise put a member who saved Invisible online.
- **How a change reaches the member's other dashboards.** Another tab of the same browser is told at once (a `BroadcastChannel`) and refetches. Another browser or device re-reads the status every minute while its tab is visible, and as soon as a hidden tab is shown again, so a change made elsewhere is in force within about a minute. Until then that dashboard keeps publishing the old status: picking Invisible on a laptop leaves the member visible from an open desktop tab for up to a minute, or until that tab is next shown. The phone app re-reads every minute while it is in the foreground, and since #3917 it publishes chapter presence, so the same up-to-a-minute window applies to an open phone, and picking Invisible on the phone itself untracks at once.
- **End times are the client's to keep.** The server reads a status or line past its end time as gone, but only when asked, so the publishing client re-renders at the end time and re-publishes. A DND for one hour ends for everyone an hour later without a refetch.
- **What each surface draws.** The dot's shapes are in [`../../ui/design-system/components.md`](../../ui/design-system/components.md) § Chat member list. The member's own avatar on the account menu trigger carries their dot, Invisible included: the grey ring only they see. Their own row in the Directory and the channel member column also reads Invisible to them, dimmed like an offline row, because that is what the chapter sees. The custom line is one muted line under the name in the channel member column and the Directory, and is never shown while its member is invisible or offline, to anyone, the member included, since the line a member sees under their own name is the one the chapter sees.

**Search:**

- Full-text search within a single channel or across all channels the user can access.
- Search returns message snippets with highlighted matches, grouped by channel.
- Search respects permissions: only messages from channels the user can see are returned.

Both scopes are served by `GET /v1/search`; the single-channel form passes an optional
`channelId` ([`../search.md`](../search.md#single-channel-scope)). Message hits can also be
filtered by sender, date and content (`fromUserId`, `after`, `before`, `has`), always inside the
channels the caller can read ([`../search.md`](../search.md#message-filters), #3958). On web the surface is
`ChatSearchPanel`, reached from the channel header's `⋯` menu
(`apps/web/components/chat/channel-menu.tsx`, #2142 — it was a popover of its own, alongside
three more, until that lane merged the four). Under the box sit four filter chips (#3958,
asked by Shawn 2026-11-10; Slack, Discord and Teams filter search the same way):

- **From**: one member at a time, picked from the chapter roster.
- **In**: one channel out of every channel the member can read, or all of them. It starts on
  the open channel (all channels when none is open), and is the `channelId` above.
- **Date**: any time, today, last 7 days, last 30 days, or a custom range. Each is sent as
  instants at the member's own local midnight: "last 7 days" starts at the midnight seven
  days ago, and a custom range includes both of its days.
- **Has**: any of file, image, link and poll; a hit carries every one ticked.

Typing `from:` or `in:` at the end of the box opens the same picker the chip does, narrowed by
what follows the colon. Members match as the member column matches names (word starts, ignoring
case and accents); channels match anywhere in the name, since a channel name is free text. The
arrow keys and Enter pick from the box, Escape puts the picker away, and the chip itself works
by writing that word into the box. What follows the colon may run to several words while it
still matches something (`from:ada lov`); once it matches nothing, or when a space follows the
colon, the text is searched as typed, so no typed word is dropped unseen. A set chip names its
value and has a clear button beside it; a custom range with no finished date is not set.
A From, Date or Has filter searches with no text ("everything Ryan posted this week"); one or
two characters, or no text with only a channel, do not search, which is the API's own rule
([`../search.md`](../search.md#message-filters)). Each row shows the day and time, since hits
span days. Mobile has no chat search yet; #341 builds it with these filters. Picking a hit selects its channel if it is not
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
- **A jump pages back for an old hit, within a bound.** Web opens a channel on its newest 50
  messages and loads older ones, 100 at a time, as the member scrolls up (#1571; mobile's
  thread pages the same way through the same `@repo/chat-core/history`, #2772, but has no
  search or jump, and nothing below applies to it). A hit that
  is not loaded yet first reads what arrived after the newest loaded message (it may be newer
  than the cache, not older), then pages back for it, saying "Finding that message..."
  meanwhile, for up to 20 pages (2,000 messages); the notice in the channel header is the
  fallback, not the normal path. It says the message is further back than that, that the
  channel's history ran out without it, that loading failed, or that the channel's messages
  failed to load. On web, a refetch (a reconnect, for one) returns the thread to its newest page, and
  older history loads again as the member scrolls back. So does a jump's forward read that
  comes back full: more arrived than one read returns, so what it read becomes the newest
  page rather than sit across a gap from the older pages (#2807). The target stays pending, so scrolling up still opens it
  once it loads, and a message that arrives later still gets its jump. Landing directly on a
  hit past the bound needs a window around the message rather than every page between —
  #2785.

### Message flags

*(Added 2026-11-11, [#3921](https://github.com/pdcarlson/Frapp/issues/3921). Shawn asked for it and settled the design in his own chat; Paul added the Ask use below the same day.)* A member can mark a message after it is sent with one **flag**: **Important**, or one of the lighter flags **Funny**, **Interesting**, **Question**, **Hype** and **FYI**. The set is fixed (`CHAT_MESSAGE_FLAGS` in `@repo/validation`), not chapter-defined, and a message carries at most one flag. A flag is a label on the message, the same for every reader. A reaction is each member's own emoji with a count. The two stay separate.

- **Who may flag.** Anyone who can read the channel may flag a message that has none. Once it is flagged, only the message's sender, whoever added the flag, or a member with `channels:manage` (an officer, the permission pins use) may replace or remove it. This lets anyone catch a flag the sender forgot ("everyone at the kitchen at 5") without letting anyone undo anyone. One predicate decides it for the API and both clients: `canChangeMessageFlag` in `@repo/validation`. A flag adds no content, so it authorizes as a read, like a reaction: a member may flag in a read-only channel, and so may an alumnus.
- **Who flagged it is shown.** When the flagger isn't the sender, the label reads "· flagged by Name".
- **How it looks.** Important draws the whole row in danger red: a 2px bar on the leading edge, a faint red fill, and a red "Important" label on the author line, right of the time (#4288). It has the same shape as [a row that mentions you](../../ui/design-system/components.md#a-row-that-mentions-you), in a different color. A lighter flag draws only its label in `--muted-foreground`, in the same place: no fill and no bar. A flagged message always draws its author line, even inside a run. A deleted message, and a blocked member's tombstone, draw no flag. The pixels: [components.md § A flagged row](../../ui/design-system/components.md#a-flagged-row).
- **Important is not an announcement.** It sends no push. Instead a channel shows a "1 important message" strip until the member has seen each Important message (below).
- **The Important strip** *(settled with Shawn 2026-11-11, [#4186](https://github.com/pdcarlson/Frapp/issues/4186))*. At the top of a channel's timeline, a strip reads "1 important message", or "N important messages", while the member has unseen ones.
  - **What counts:** the channel's timeline messages flagged Important in the last 14 days that the member hasn't seen. Never counted: thread replies, deleted messages, the member's own messages, messages they flagged themselves, and messages from a member they blocked. A message whose *flagger* they blocked still counts, since a flag is chapter state (Blocks, below). The 14 days keep a new member, or one back from a break, from being greeted by stale ones.
  - **Seen:** a message is seen once the member jumps to it from the strip, scrolls it onto their screen, or dismisses the strip with ×, which marks every one in the channel seen. Seen is stored per member and per message (`chat_message_important_seen`, migration `20261111235900`), not as one timestamp per channel: a timestamp would let scrolling a newer Important message into view also mark an older one the member never saw. Once seen, a message stays seen, even if its flag is taken off and put back. Seen follows the member across devices.
  - **Tapping the strip** jumps to the oldest unseen one, through the jump search and pins use, and marks it seen; with several, each tap goes to the next.
  - **API.** `GET /v1/channels/{id}/important` answers the unseen ones, oldest first (at most 50, each with its id, `created_at`, `flagged_at`, sender, and first 140 characters on one line), and `total`, which counts them all. `POST /v1/channels/{id}/important/seen` with `{ "message_ids": [...] }` (up to 100) marks those seen; ids the strip doesn't count for the caller are ignored. `POST /v1/channels/{id}/important/dismiss` marks every one seen. Both writes answer the strip's new state. All three need read access to the channel, and leave a blocked sender's message out entirely (§ What a block does and does not hide). One request reads at most 1,000 Important messages from the window; a channel past that has its oldest flags uncounted. `ChatImportantService` holds the rule.
  - **Clients** (#4186). Web and the phone read and write through one hook, `useImportantMessages` in `@repo/hooks`, and never count from their own cache, which may not hold older pages. It re-reads when a loaded message's Important flag changes, by the member or by the Realtime echo of someone else's flag, and on the query's usual refresh. A jump marks its message seen at once. Rows scrolled onto the screen are reported in batches: a row counts once at least half of it is on screen (web measures the rows in the timeline's visible range; mobile uses FlatList viewability at 50%), and nothing counts while the timeline isn't in front of the member: a browser tab in the background, the channel list covering the timeline below `lg` on web, or on the phone another screen over the channel or the app in the background. A message flagged while it is already on screen counts once the strip learns of it. Every id the member jumped to, scrolled past or dismissed stays off the strip whatever an older answer says, until its write fails; a failed write puts it back and pauses scroll reports for 30 seconds, so a refused write isn't retried every second. Web jumps through the same path as search and bookmarks, paging older history; mobile's Show pages back up to ten pages for it (`useJumpToImportant`). Their look: [components.md § The Important strip](../../ui/design-system/components.md#the-important-strip).
- **Stored on the message.** `chat_messages.flag`, `flagged_by` and `flagged_at` (migration `20261111170000`) hold it, all null together, and a CHECK holds the flag to the fixed set. The row's Realtime UPDATE echo carries a change to every open timeline, as an edit or a pin does. Deleting a message clears its flag. Paul's intent (2026-11-11): a later reader such as Ask can use the stored flag as a pre-classification, telling a joke from reliable information without classifying the message again. A member's flag is a human judgement, so a reader weighs it as a hint, with `flagged_by` saying whose.
- **API.** `PUT /v1/channels/messages/{messageId}/flag` with `{ "flag": "important" }` sets or replaces a flag, and `DELETE` on the same path removes it. Both answer the message, masked for the caller. Setting the flag a message already carries succeeds and changes nothing, whoever asks. The write is a compare-and-set on the flag and flagger the permission check read, and on the message still being live, so of two members flagging one unflagged message at once, one wins and the other gets a 409, rather than replacing a flag they may not change. Flagging a deleted message is a 400, or a 409 when the delete lands mid-request.
- **Blocks.** A flag is chapter state, which a block counts rather than hides ([§ What a block does and does not hide](#what-a-block-does-and-does-not-hide)). An Important message stays Important for a member who blocked whoever flagged it. The server withholds that flagger's id (`flagged_by: null`) on the reads that mask (the timeline, pins, search, a thread, and the flag routes' own answers), and the row shows no "flagged by". A masked row carries no flag. Unlike a reaction, which the database withholds from the blocker, the flagger is not withheld everywhere: the Realtime echo, and the answer to a pin, unpin or edit, carry the raw `flagged_by`. So a client applies its own block list to the name before it draws one.

## Report and block

Signet ships chapter channels, **direct messages**, and file uploads. That is user-generated content, and **App Store Review Guideline 1.2** expects a UGC app to give a member a way to report objectionable content and to block an abusive user. Officer moderation (`channels:manage`, above) is real but on its own does not reach a private DM, which is the surface a reviewer probes and the one a harassed member actually needs. These two controls are the member-side answer (#2257); a report is also what lets an officer remove the one message it names, DM or not (§ Officer action below, #2311).

**Status: schema, API, the mobile client, and on web the member half and the officer queue.** The tables exist (`20260915210000`) and the API is live: `POST|GET|PATCH /v1/chat/reports`, `GET /v1/chat/reports/{id}/attachments`, `POST /v1/chat/reports/{id}/remove-message`, and `GET|POST|DELETE /v1/chat/blocks` (`ChatReportController` / `ChatBlockController`, both `@SubscriptionExempt()`), and the API applies the caller's block list to the chat messages, reactions and attachments it serves and to whom chat notifies. The `chat_message_actions` read policy withholds a blocked member's reactions from the member who blocked them (`20260924170000`, #2494). [`chat-read-surface-ledger.spec.ts`](../../../apps/api/src/application/services/chat-read-surface-ledger.spec.ts) is the one list of where that holds and where it does not yet. It fails on anything it enumerates and has not classified: every route on the chat controllers, every RLS policy a client could read through, every notify-named call in the API, and every Realtime `postgres_changes` subscription the API opens. What it cannot see is listed at the top of that file; read that before treating a green run as coverage. Its `open` entries are the known gaps, server and client, each with its tracking issue. **The mobile app consumes the member half**: a long-press anywhere on someone else's message or card (a poll, an event, a task, a rush candidate, or any other card kind mobile draws) — its text, a photo, a reaction chip — or the "Message actions" accessibility action opens Report, and the report form offers Block (Block for every sender who can be blocked at all — not the system actor or an imported row nobody has linked (§ Linking a member's Discord history) — unless a block attempt this session already came back as the API's 404 `Member not found`. A sender the cached roster does not list still gets Block: that is what a brand-new member looks like, and the long-press re-reads the roster); the thread tombstones a blocked member's messages, quotes and reactions, and holds unmaskable rows while the list is **loading or unavailable**, per § The masking contract (`packages/chat-core/src/blocks.ts`, which both clients classify through); and Settings → Blocked members and the directory's member sheet can undo a block. **The web dashboard applies the same list** (#2313): the `/chat` timeline tombstones, holds, and hides quotes and reactions through the same classifier, with the tombstone's Unblock (`apps/web/components/chat/`), and `/profile` → Blocked members is web's durable undo (`apps/web/components/profile/blocked-members-card.tsx`). A web message offers Report and Block from its action bar's More menu (#2687), by the same rules as mobile's sheet (`canReportMessage` and `canBlockSender` in `packages/chat-core/src/message-actions.ts`), with the report form a dialog (`apps/web/components/chat/report-message-dialog.tsx`) that offers Block once the report is in. **It also renders the officer queue**: Chat Admin's Reported messages section (`apps/web/components/chat-admin/chat-reports-card.tsx`, gated on `members:view` and `channels:manage` like the routes), with the evidence snapshot, the status tabs, Mark reviewed / Dismiss, and the report-scoped Remove below (Mark actioned where the message no longer exists). **Still owed:** the server-side gaps, which are the ledger's `open` entries. Whether a block hides a blocked member's words *quoted in someone else's reply* (#2312 §1) is settled by the fail-closed rule in the table below. Where the sections below describe the owed parts, they describe what is owed — [`AGENTS.md`](../../../AGENTS.md) § Spec vs code.

### Report

- **Any member can report any message they can see**, in a channel or a DM. Visibility is the existing `canAccessChannel` predicate — reporting is authorized as a **read**, so it reaches exactly the messages the member could already render, and no more. A message that is already deleted cannot be reported (409, and no one is notified): its content is gone for everyone, so there is nothing left to act on. Two orderings keep that honest. A report the member **already has open** on the message is returned instead, as the idempotent replay (below) — the replay is checked before the refusal, so a retry of a report filed while the message was live is not told its report was never taken. And a removal can land between the check and the write, so a newly written report is checked again: if its message is gone by then, the report is closed as `actioned` at once (with no reviewer stamped — nobody decided it), no one is notified, and the answer is the same 409.
- **A report is filed as the caller, never with ambient service authority.** The reporter is the authenticated caller; a member cannot report as someone else.
- **Reports land in a per-chapter officer queue** readable by members holding `members:view` **and** `channels:manage`, or `*` — the same union every officer route requires, spelled once as `CHAT_REPORT_QUEUE_PERMISSIONS` in `@repo/validation` — newest first. A report also records the channel its message was in (`channel_id`, an id that opens nothing, null once the channel is deleted), so a channel's own Chat admin page lists just that channel's reports (`GET /v1/chat/reports?channel_id=`); the chapter-wide queue still holds every report, including those about DMs.
- **A report about a queue holder is reviewed by the other holders.** An officer can be reported like anyone else, and the queue leaves out every report whose reported sender is the viewer: it is not listed for them, and resolving or removing through it answers 404, the same as another chapter's report, so its existence is not confirmed either. Stripping the reporter's id is not enough on its own — the reporter's note can name them, and a report on a DM message has exactly one possible reporter. If the reported sender is the chapter's **only** queue holder, nobody can review the report yet: it is not lost, it stays `open` and appears to whoever next holds the queue permissions, and the API logs a warning that a report was filed with no reviewer (no one is notified, since the one holder is the reported sender). That is the only case logged: a reporter who is the one other holder has nobody to notify, but is a reviewer. The chapter's remedy is to give a second member the queue permissions; the reporter can block in the meantime.
- **Resolution is one-way.** An open report is resolved as `reviewed`, `actioned` or `dismissed`, stamped with the officer, and a report that is no longer open answers 409 — the write is conditional on `status = 'open'`, so a stale client cannot overwrite another officer's decision (a Dismiss landing on an `actioned` report would rewrite what the record says happened to the message).
- **Officers are told when a report arrives.** Filing a *new* report sends an in-app notification (and push) to every member the queue admits — `members:view` **and** `channels:manage`, or `*` — except the reported sender and the reporter. It is content-free: no message text, no reporter, no reported member, only that a report is waiting, with a `chat_reports` target that opens the queue (`spec/behavior/notifications.md` § Deep Linking). The reported sender is excluded even when they are an officer, because paging them is telling them they were reported; the queue does not show it to them either (below). A replayed report (the idempotent path below) notifies no one, so re-filing cannot re-page the moderation team, and a notification failure never fails the report. A report closed on the spot because its message was removed as it landed (above) notifies no one either. Category `admin`, priority NORMAL — the trigger is listed in [`notifications.md`](../notifications.md#notification-triggers-complete-list).
- **The reporter is never disclosed to the reported member.** There is no surface, API route, or repository method that answers "who reported me". The tables' zero-policy RLS (below) is what makes that structural rather than a matter of review.
  - **One inference is accepted rather than prevented** (owner decision 2026-09-22, taken with § Officer action's option 1). When an officer removes a reported message from a **1:1 DM**, its sender sees the message replaced by `[message deleted]` — and a 1:1 DM has exactly one other reader, while no officer can reach a DM any other way. So the sender can deduce who reported it. Nothing names the reporter; the removal itself is the tell. It is the price of letting the chapter act on a DM report at all: the option that avoided it (no officer removal in DMs) left the harassing content in the recipient's history. The officer is told before they remove (the confirmation, [`writing.md`](../../ui/design-system/writing.md) § Chat Admin — reported messages), so the choice is theirs to weigh — the reporter can also block. A group DM or a channel has more readers, and the inference weakens with each.
- **A report carries its own evidence.** The reported content and sender are snapshotted into the report row at file time. This is not belt-and-braces: a sender may soft-delete their *own* message, which overwrites its content with `[message deleted]`, so without the snapshot every reported member would have a one-tap way to blank the evidence and leave an unactionable report behind. The snapshot is everything the member wrote on the message, not only `content`: a **poll** snapshots its question and then one `- label` line per option, since the options are member-written text that lives only on the card, and a question alone would make an innocuous question with a harassing option unreportable (#2724). When the card's question differs from `content`, both are kept. Both poll shapes are read: `kind: 'poll'` with `payload.options`, which web posts through `/poll` and mobile through the composer's New poll sheet, and the older `type: 'POLL'` with `metadata.options` from `POST /v1/channels/{id}/polls`. The officer queue shows the snapshot with its line breaks. For the same reason the report's `message_id` is nullable and does **not** cascade — a channel delete hard-deletes its messages, and an officer must not be able to erase reports against themselves by deleting the channel.
- **A report keeps the reported message's attachments until it is resolved and they are released** (owner decision 2026-09-30, #2481). Deleting a message purges its files (§ Edit and delete), so a sender could otherwise delete a reported photo and leave the officer an empty snapshot with nothing to review. Three options were weighed: keep the files while the report is open (chosen), copy them to a moderation bucket at report time, or accept the loss and say so in the queue. The rules:
  - **Filed:** the report snapshots each attachment's object (bucket and path) with what the member saw of it (file name, type, size), from the message it was authorized to read. A failed read fails the report before anything is written, so a retry files it whole.
  - **Held by object, not by message, until the report's release finishes.** No purge deletes an object a report holds: not the sender's delete, not an officer's ordinary delete, not the Discord import's deletion. A report holds from filing until its release (below) finishes, not only while it is `open`, because a removal claims its report (`actioned`) before it deletes the message and withdraws the claim if the delete fails: a delete landing while the claim is in flight must not purge the evidence of a report that then reopens. One object can be reached from two messages (a claimed path, [#1622](https://github.com/pdcarlson/Frapp/issues/1622); the importer's deduplicated media), so the hold covers the object whichever message's delete reaches it. A hold that cannot be read keeps the objects, as the shared-object check does.
  - **Kept bytes keep old links alive.** Deleting a message stops the API minting new download URLs for it, but a URL a reader was handed before the delete stays valid for the rest of its hour (§ Edit and delete). For an unreported message the purge ends that by deleting the bytes; for a held one it doesn't, so anyone who already had the photo's link can still open it for up to an hour after the sender deletes it. That is the accepted cost of keeping the evidence: the link was already theirs, and no new one is issued.
  - **Reviewed through the report.** `GET /v1/chat/reports/{id}/attachments` (the queue's permissions, the same 404 for another chapter's report or one about the caller, 409 once the report is no longer open) answers a forced-download signed URL per held object, whether or not the message still exists. It is the report's own evidence, like the text snapshot: it opens no channel, thread or message, so a report about a DM still does not open the DM. The queue names the files from the report row, which carries each one's name, type and size but never where it is stored, and loads them only when the officer asks.
  - **Released when the report resolves.** Once a report stops being `open` (resolved, removed with its message, or closed as it landed on a deleted message), each object it held is deleted unless an undeleted message still references it (so a report dismissed over a live message deletes nothing) or an open report holds it. The reports one resolution closes (a removal and its siblings) release together, so they don't hold against each other. An object another unreleased report resolved **within the last 15 minutes** also holds is kept for now, because that report may be a removal's claim that is about to be withdrawn back to `open`; a report resolved longer ago can't reopen, so its unfinished release holds nothing back. Each report is then stamped released on its own outcome, which ends its hold: one that had to wait, or whose Storage delete failed, stays unstamped for an hourly sweep while the others are done. Each tick the sweep takes up to 100 unstamped reports resolved more than 15 minutes ago, in id order from where its last tick stopped, starting over once it reaches the end, and releases them a chapter at a time. Carrying on rather than re-reading the same first reports is what keeps reports that keep failing from crowding out the rest. A claim withdrawn back to `open` clears the stamp.
  - **Reports filed before this shipped hold nothing.** Their rows have no snapshot, and nothing backfills one.
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
- **The removal is an ordinary soft delete** — the same tombstone, `metadata` wipe and attachment purge as any delete (§ Edit and delete). Like every delete it clears the card's `payload` too, so a removed poll's options go with it (#1575). If it fails after the claim, the error is always returned, and what the report says depends on the failure. A 4xx is the access check refusing this officer before anything was written (for example, removed from the chapter after the request was admitted), so the claim is withdrawn — the report goes back to `open`, conditional on still carrying this request's own stamp — whatever state the message is in: a refusal is never reported as "already removed". Any other failure does not prove nothing was written, because the tombstone can commit and only the answer be lost, so the message is read again first. While it is still there (or the read fails too), the claim is withdrawn the same way, so a failed removal does not leave an `actioned` report over content that is still there, and the report is open for a retry. If it is gone, this request's own write may be what landed: the claim stands, the attachment purge the failed delete never reached runs, and the sibling sweep runs, so no report reopens over a removed message. The error is returned as an unknown outcome, and a retry gets the report-level replay's 200. A withdrawal that itself fails is logged as an error for a person to look at.
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
- **Blocking is reversible, and the unblock affordance is durable.** The blocked-members list is the one place a block can always be undone (mobile: Settings → Blocked members; web: Settings → Blocked members, the personal page on the account menu, `/preferences?section=blocked`); a tombstone in a thread the member may never reopen is not sufficient.

#### What a block does and does not hide

| Surface | Blocked member's content |
| --- | --- |
| Channel messages | Hidden — replaced by a tombstone ("Message from a member you blocked") whose only action is **Unblock**. It does not expand in place: a server-masked row arrives with its content already withheld (§ The masking contract), so "expand" could only ever work on rows that happened to arrive over the live echo — a control that works on some rows and not others. Unblocking re-reads each cached thread that holds a masked copy of that member's messages, newest page first and back page by page to the oldest masked copy the thread holds (a client holds the older pages a member scrolled through until the thread next reads its newest page from scratch, #1571), and swaps only those copies for the clear rows, into the cache as it stands when the response lands — never by re-running the thread's query, which would overwrite a message that arrived meanwhile. It reads at most 50 pages of 100; rows beyond that are dropped from the thread, masked copies with them, and load again, unmasked, when the member scrolls back to them. The re-read retries from the page it failed on before giving up, and if it still fails those copies offer **Reload**, which runs it again — never a tombstone with no way back. *Owner decision 2026-09-22: the tombstone's only action is Unblock — this replaced "a tombstone the blocker can expand"* |
| Direct messages | Hidden. The blocked member can still open a thread and send — refusing would be an oracle, see above — but nothing they send reaches the blocker, and nothing they send brings back a 1:1 DM the blocker hid (§ Direct Messages) |
| The **pinned list, search results and bookmarks** (`GET /v1/channels/{id}/pins`, `GET /v1/search`, `GET /v1/bookmarks`) | Hidden, by the timeline's rule. The API masks the pinned list and search's message hits with the function it applies to channel messages (`maskBlockedMessages`), and bookmarks with its sibling over the bookmark projection (`maskBlockedBookmarkMessage`; both in `chat-block-mask.ts`, and bookmarks deliberately not through the first). Each reads the block list once per request. Every message row they serve carries `sender_blocked`; search's other sections carry no message and no flag. A masked row keeps its ids and time, so a search hit or a bookmark still opens its thread, where the message is a tombstone. It also keeps `is_pinned`, which web reads only to count a hidden pin: neither client draws a pin on a tombstone. Web shows a masked search hit or bookmark with the API's fallback text in place of the words, beside the author's name in the chat search and bookmarks panels, and without one in the find bar. Web's Pinned panel does not read the pins route: it lists the pinned messages in the loaded timeline, leaves a blocked member's off and says how many it left off ([`writing.md`](../../ui/design-system/writing.md) owns the wording), so a pin older than what the timeline has loaded (#1571) is neither listed nor counted ([#2780](https://github.com/pdcarlson/Frapp/issues/2780), which also covers the officer chat-admin page, the route's only web reader). Mobile has none of the three panels yet. The pinned list is masked, not treated as an officer surface, because every member of the channel reads it, although only an officer can pin ([#2310](https://github.com/pdcarlson/Frapp/issues/2310)) |
| Reactions on the blocker's messages | Hidden — **and on every other message the blocker sees**, since a reaction is its author's own text (`reaction:` plus up to 41 characters). Clients read reaction chips from `chat_message_actions` directly, so its SELECT policy does the hiding: it withholds a blocked member's `reaction:*` rows from the member who blocked them, over PostgREST and the Realtime echo alike, and changes nothing the blocked member reads (`chat_viewer_has_blocked`, `20260924170000`, #2494). Rows a client cached before the block stay in its cache: on web until the thread is next read (a web read returns the thread to its newest page and drops the older pages, #1571), on mobile until the thread's query is dropped, since mobile never re-reads a thread it holds and its reconnect backfill merges onto the cached rows. So both clients also drop a blocked reactor from every chip against a ready list (`visibleReactions`). While the list is loading or unavailable it shows only the viewer's own reactions and those of a member this client just unblocked (a confirmed change applies in every list state, below), failing closed the way held messages do. A chip therefore counts the reactors the viewer can see, not every reactor. The other way round, a thread read while the block stood holds none of that member's reactions, so after an unblock their earlier chips return on the thread's next read from scratch, not at once; new ones arrive live (#2632) |
| The **Important strip** (`GET /v1/channels/{id}/important` and its two writes) | Left out. A message the blocked member sent never counts toward the strip, and its excerpt and sender are never served, so the strip neither names them nor jumps to their tombstone. A message they only *flagged* still counts, since a flag is chapter state (§ Message flags, Blocks), and the strip never says who flagged it |
| Unread and @-mention badges | Not raised. `get_channel_unread_counts` skips the blocked member's messages and mentions in that chapter, so they move neither the channel-row badges on web and mobile nor the mobile app-icon badge (§ Read Receipts, #2521). Both clients re-read the counts when a block or unblock is confirmed |
| Chat rows in the **in-app notification history** (`GET /v1/notifications`) | Hidden, including rows written before the block. No row is written for a message sent after it: the push worker leaves the blocker out of that message's audience, so there is no push either. A row written before it is withheld when the list is read, so the history agrees with the thread, which shows the same message as a tombstone; an unblock brings the rows back. Each chat row records its sender (`data.senderId`), and the list leaves out the chat rows of every member the caller has blocked in that chapter. A chat row written before rows recorded a sender (#2715) can't be traced to one, since it names the channel, not the message, so it is withheld from a member who has blocked anyone in that chapter: a list that can't be evaluated isn't an empty one. So is every chat row once the caller's block list is too long to name in one query (about 80 members). A block list that can't be read fails the request rather than serving the history unfiltered. Marking a withheld row read (`PATCH /v1/notifications/{id}/read`, for an id a client held from before the block) returns it without its title and body. Clients re-read the list when a block or unblock is confirmed. A push already delivered to the lock screen stays there. Non-chat rows are not hidden (the non-chat notifications row below). *Owner decision 2026-09-27 ([#2715](https://github.com/pdcarlson/Frapp/issues/2715#issuecomment-5858267138)): mask on read. The rule for rows that record no sender was left to the change that built it, provided it doesn't fail open, and was set there* |
| The **typing indicator** ("Paul is typing…") | Hidden. `typing` is a Broadcast on `chat:channel:<id>` that anyone who can read the channel may send, so the server delivers a blocked member's too. Both clients drop it before the indicator counts it (`visibleTypingUsers` in `@repo/chat-core/blocks`, #2496): it names the typist, and even an anonymous one in a two-person DM would tell the blocker, live, that the member they blocked is writing to them. The list rule is the reaction chips' rule: while the list is loading or unavailable, only a member this client just unblocked counts, and nobody else. The rule trusts the `userId` the sender's client puts in the broadcast, which the server does not check yet ([#2725](https://github.com/pdcarlson/Frapp/issues/2725)). Presence on the same topic isn't shown to members at all: only the push worker reads it ("Two presence topics" under § Messages) |
| Attachments on the blocked member's messages | Hidden, and not reachable. The attachments route answers as it does for a deleted message, so the tombstone leaves no download path behind it |
| A blocked member's message **quoted in someone else's reply** | Hidden. The quote reads "Message from a member you blocked" in place of the parent's author and text, whoever wrote the reply; a parent held while the list is loading or unavailable quotes as "Message hidden". A block that hid the message but let a reply print it would hide nothing. *Settled 2026-09-22 by the fail-closed rule (#2312 §1); mobile applies it, and web since #2313* |
| Poll votes | **Counted, not hidden.** A poll tally is chapter state, not a message; suppressing one vote would misreport the result to everyone |
| The blocked member's **polls on the poll routes** (`GET /v1/polls`, `GET /v1/polls/{messageId}`) | Question and option text hidden, the poll itself kept. Each is masked in place, with its ids, timing, expiry and tallies intact and `sender_blocked` set, rather than left out of the list, since leaving it out would change the page's counts. The poll-expiry notice replies to the poll instead of quoting its question, so it does not bring the question back under the system actor, which cannot be blocked (#2495). Details: [`../polls.md`](../polls.md) |
| Points / task / event / service-hours / recruitment cards **authored by** the blocked member | Hidden, like any other message they sent. These carry the acting member's `sender_id` (`PointsService`, `TaskService`, `EventService` through `EventAnnouncementService`, `ServiceEntryService` and `RushService` each pass the actor, not the system id), so they are masked by the same `sender_id` predicate as ordinary text. That is deliberate: their templates interpolate member free text — a task title, an event name, a points reason, an hours description, a candidate's name — so exempting them would hand a blocked member an unmaskable channel into the blocker's timeline. The chapter record itself is unaffected; chat is a notification surface for it, and the points, tasks, events, service hours and recruitment screens remain the system of record |
| Notifications from **non-chat modules** that quote the blocked member's text: a fine reason, a task title or rejection comment, a service-hours review comment, an event or invoice name, and the reminders built from them. Also the [activity feed](../activity-feed.md)'s event, backwork and points items, and the [Activity page](../activity.md)'s task, hours-approval and event rows | **Not hidden.** They arrive in full, as a push and as an in-app row, and the feed lists them, the same way the records themselves stay on their screens. A block is a chat control, and the chapter's own actions and records are unaffected by it. The cost is known: an officer a member has blocked can still reach them through a fine reason or a task title. The chat cards for those same actions are hidden (the row above), because chat is the surface a block governs. The feed's announcement items are chat, and are hidden; so are the Activity page's poll rows, where a blocked member's poll is left out (#3897). *Owner decision 2026-09-23 ([#2498](https://github.com/pdcarlson/Frapp/issues/2498))* |
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

- **An echoed row is never re-evaluated by the server**, because the reconnect backfill and the polling fallback read only rows after the last-seen cursor, which every new-message (INSERT) echo advances; an UPDATE echo leaves it where it is (ADR-05). So a client remembers, for the session, which rows it already showed against a *ready* list, and which server-cleared rows it showed while the list was loading or unavailable. Server-evaluated rows are included because an UPDATE echo of a REST row (a pin, an edit, a soft delete) replaces it unevaluated. A later outage does not take any of those back; only an unevaluated row that first arrives during the outage is held (`blockClearance` in `packages/chat-core/src/blocks.ts`). A block always outranks that memory. On web, the dashboard's cached first chunk keeps each row's server verdict so a cold load can paint, and a verdict is only as old as the read that produced it, not the cache write. So the cache also keeps the ids the last ready list read named, and a cold load applies them as a floor until the live list has been read (#2688). Anyone blocked as of that read is a tombstone in the cached rows from the first paint. The residual is a block made on another device after the last ready list read web made while `/chat` was open (a read by `/profile`'s Blocked members card alone is not persisted): it shows in the cached rows until the list or a live read of the channel lands, and for the whole session with the list unreadable, the same shape as #2499.
- **A block or unblock the server confirmed applies at once, in every list state** — a blocked member's rows tombstone, and an unblocked member's rows and reactions show, even while the list is loading or unavailable. It is kept beside the list rather than written into it, so it can neither flip an unavailable list to ready nor be undone by a read that was already in flight when it was made; a read that started after it is the server's answer again (`useBlockedUserIds` in `@repo/hooks`).
- **A ready list contradicted by the server is re-read.** A REST row masked for a sender the ready list does not name is what a block made on another device looks like, so the client re-reads the list once per such set of masked rows, and forgets the set once a ready list stops being contradicted. A sender this client unblocked still counts: a masked row that arrives after the unblock is what the same member blocked again elsewhere looks like. A tombstone keeps offering Unblock unless this client itself confirmed the unblock.

### No pre-post content filter

**Decision (owner, 2026-09-28): nothing screens a message before it posts.** Guideline 1.2 lists "a method for filtering objectionable material from being posted" beside report and block. Frapp's answer is the combination it already ships, not a filter:

- the Terms' zero-tolerance clause (#2302), which a member must accept to join a chapter. Members from before #2302 are asked by an in-app prompt that the server doesn't enforce ([`legal.md`](../legal.md#acceptance-record) § Acceptance record);
- report (§ Report);
- block (§ Block);
- officer removal of a reported message (§ Officer action).

The owner's reason: Frapp is chat for fraternities and sororities, and swearing is normal there. The App Review note states this answer ([`apps/mobile/store/README.md`](../../../apps/mobile/store/README.md) § Review notes).

### Retention and authorization

- `chat_message_reports` and `chat_member_blocks` both have RLS enabled with **zero policies**. No client reads either table directly; the API reaches them with the service-role key. For these two tables that default-deny is the safety guarantee rather than the convention — see the argument in `20260915210000_chat_reports_and_blocks.sql`.
- Account deletion purges a member's **own** block list and keeps everything else — blocks against them, reports they filed, and reports about them. The reasoning is in [`data-retention.md`](../data-retention.md#individual-account-deletion) § Individual Account Deletion, which owns the erasure contract; read it there rather than here, so the two cannot drift.


## Announcements

- The `#announcements` channel is special: everyone reads it, and only the tiers and roles on its who-can-post list send messages (the top two starting tiers in a new chapter).
- Posting to `#announcements` pushes every chapter member once, through the chat push worker (the only chat push path since #2771), at `URGENT` and titled `Announcement from <Sender>`. It respects each member's own level for the channel or kind, skips members who have the channel open, and leaves out those who have blocked the author (§ [What a block does and does not hide](#what-a-block-does-and-does-not-hide)). `URGENT` is exempt from the quiet-hours downgrade, so the announcement default of `all` is only sound where every member can already read the channel and not just anyone can post to it: a channel counts as announcements only when it is **PUBLIC and `is_read_only`** with `announcements` in its name, the seeded `#announcements` included (`isAnnouncementChannel` in `@repo/validation`). A `PRIVATE`, `ROLE_GATED` or group-DM channel whose name contains `announcements`, or one anyone can post in (`#announcements` with read-only switched off included), gets ordinary channel pushes instead (#1008, #2771). The full rule chain is in [`../notifications.md`](../notifications.md#chat-notification-preferences).
- **A quote reply is a post** (#3722, 2026-11-11). Whoever may post in a channel may quote-reply there (`reply_to_id`), and whoever may not is refused at the same gate: `ChatService.sendMessage` authorizes the send as a `post` and has no separate reply rule. So in `#announcements` the tiers and roles on its who-can-post list may quote each other, and every other member still cannot post there at all. Both clients offer Reply exactly where `can_post` is true (`channelAllowsReplies`). ("In-thread reply" in older text means this quote-reply; message threads are a separate shape, below.) Two server-side writers store a reply where the reader could not: the poll-expiry notice (`PollService.announceExpiry`), which replies to the poll it announces because the quote is the only thing that names the poll without re-posting its author's text under the unblockable system actor ([`../polls.md`](../polls.md), #2495), and the Discord archive importer, which carries over the reply links in the history it imports.
  - Until #3722 the rule was: "Announcement messages cannot be replied to in-thread", keyed off `is_read_only` and holding for a member on the posting list and the President's `*` alike (`allowsInThreadReplies`). #3722 made a who-can-post list the only posting restriction, and a channel the Alumni role reads without posting now carries one, so keeping the old rule would have taken quote replies away from every member there. Changed in #3722 by Claude for pdcarlson, 2026-11-11; pending Paul.
- **Message threads are allowed under announcements** (#3785, Winston's pick 2026-11-10). Any member who can read the channel may start a thread on an announcement or reply in one; only officers still post top-level, and quote replies follow posting, as above. `#chapter-audit` takes no threads. Discord's announcement threads and Telegram's channel comments work the same way. Paul's recorded rule was that no member threads an announcement.
  - Overridden in #4027 by whewitt-frapp, 2026-11-10; pending Paul.
- **A refused quote reply gets 403**, the same answer as a refused top-level post ("You do not have access to this channel"), because it is refused by the same channel-access gate. A cross-channel `reply_to_id` is still a 400 (above).

### The audit log is system-write only

`#chapter-audit` is the chapter's record of officer changes, so only Frapp posts in it (#3909). Until 2026-11-09 it was gated like any read-only channel, and a member holding `announcements:post` or the President's `*` could post there; a beta chapter reported a member's message in it.

- **The channel is marked by `chat_channels.is_audit_log`**, set when the chapter is created (`DEFAULT_CHANNELS`) and backfilled onto existing chapters' seeded `#chapter-audit` (migration `20261109210000`). At most one per chapter (a partial unique index). What it gates on is the flag, not the name: the post gate, the Chat settings locks and the audit mirror's lookup (`findAuditLog`) all read `is_audit_log`, so a second channel that only shares the name can't move the feed or take the lock. The name still decides two things: a `#chapter-audit` seeded into a new chapter (one under an hour old) with no flagged channel is flagged at insert (the `chat_channels_flag_audit_log` trigger, so an older API's seeding is covered; a channel an officer or an import makes later with that name stays ordinary), and the push default (`builtInChannelDefault`) and the clients' system-channel glyph and row menu (`isSystemChannel`) still match the name ([#3910](https://github.com/pdcarlson/Frapp/issues/3910)).
- **No member writes in it, whatever they hold.** `canAccessChannel` refuses every `post` and `vote` in a flagged channel ahead of the read-only gate, so `*` and every posting list are refused too (403, a quote reply included), and so are an upload URL and a poll. Reads and reactions are unaffected. The audit mirror (`ChatBridgeWorkerService`) inserts its `system_audit` rows through the message repository and never passes this gate, which is what leaves it the only writer. The Discord importer, the other server path that inserts history directly, refuses the audit log as a merge target (the mapping save and the import worker both check, and the worker also stops if a channel it creates turns out to be the audit log), and the web wizard never offers or defaults to it. Its name still counts as taken, so a new channel that would share it is flagged as a clash.
- **Chat settings lock it.** `PATCH /v1/channels/:id` refuses switching its read-only off (400 "The audit log channel is always read-only") and a rename (400 "The audit log channel can't be renamed"), and `DELETE /v1/channels/:id` refuses it (400 "The audit log channel can't be deleted"); its description, category and push default stay editable. Web's Chat settings disable its name and show a line in place of the read-only switch. Refusing a DM or group DM delete is still [#3633](https://github.com/pdcarlson/Frapp/issues/3633).
- **Clients show no composer there**, on web or mobile, only `Only Frapp posts here: it's the chapter's audit log.` (`@repo/chat-core/audit-log-copy`) They read the flag off the channel row (`is_audit_log`), and also get `can_post: false` from the server.

## Slash Commands and Integrations

Slash commands turn chat into the dispatcher for the ops modules that have a message-shaped action. The full command catalog, slash-command dispatch path (simple vs heavy commands), announcement gating, vote-change semantics, the rich-message renderer registry, and the audit bridge are specified in [integrations.md](./integrations.md). Push-notification behavior for chat lives in [../notifications.md](../notifications.md).

## Message Persistence

Every message is written to `chat_messages` in Postgres **first**, and reaches connected clients only as a consequence of that write — Realtime replicates the row to the channel's Postgres Changes subscribers. The API performs no separate publish step (ADR-02; see `spec/ui/resilience/message-delivery.md#receiving-messages-realtime`). If realtime delivery fails, the message is still persisted and will appear on the next history fetch or page refresh.

## Read Receipts

Each user's last-read timestamp per channel is tracked in a `channel_read_receipts` table. Opening a channel stamps the cursor to server `now()`, and so do hiding a 1:1 DM (§ Direct Messages), Mark as read in the row menu (§ Sidebar arrangement), leaving the channel again, a message from someone else arriving in the thread the member is looking at (its thread focused, the app or tab in front of them; once per burst), and the app coming back to the foreground or its realtime connection recovering while they look at one (#3698, [§ Channel list previews](#channel-list-previews) "Freshness"); there is no mark-read-to-a-specific-message. A DM the member has hidden has no row in `GET /v1/channels/unread` at all while it stays hidden, so it lights no badge.

Unread count per channel = messages created after that cursor, **excluding the cases that would otherwise make the badge wrong**:

- **The viewer's own messages never count.** Otherwise posting would light up your own badge until you reopened the channel you had just posted in.
- **Deleted messages never count.** A badge that survives the deletion of the only message behind it cannot be cleared by reading.
- **Messages from a member the viewer has blocked in this chapter never count** (#2521). Nothing a blocked member sends reaches the blocker (§ What a block does and does not hide), and a badge that rises for a thread that opens onto tombstones is exactly that signal. Only the viewer's own block rows are read, so the blocked member's counts do not change; and since the cursor does not move while the block stands, an unblock puts those messages back on the badge.

A member with no receipt for a channel has never opened it, so **every** message counts rather than none.

- **`kind = 'imported'` never counts.** An archive is history the chapter imported, not messages anyone sent them, and the rule above would otherwise hand every member a badge the size of the import that no amount of reading could clear. This is stated explicitly in `get_channel_unread_counts` rather than left to fall out of the nullable-sender comparison, which excluded it only as an artefact of `NULL <> uuid` being NULL.

- **`#chapter-audit` entries never count** (owner decision, 2026-11-06: audit entries arrive silently). A `system_audit` row the audit mirror wrote, keyed `client_message_id = 'audit:<id>'` (`auditMirrorClientId`), is a log line, not a message to anyone. It never pushes either, whatever level the member set: `decidePush` refuses a mirror row ahead of every preference ([`../notifications.md`](../notifications.md#chat-notification-preferences)). The server's other `system_audit` notices (a poll closing, an invite accepted, the chapter welcome) are addressed to members and still count.

Mention count is the subset of that same set which mentions the viewer, plus every message-thread reply in the channel that mentions them and is newer than both the channel's cursor and their read of that thread (§ Messages → Message threads). A thread reply is never in the unread set itself.

Both are computed server-side by `get_channel_unread_counts` and served from `GET /v1/channels/unread`, which returns one row per channel the caller can read — including channels with nothing unread, as zero. Clients MUST NOT re-derive either number locally: a second definition would disagree with this one on exactly the cases above.

### Before the counts arrive (mobile)

On open and on resume the counts request is one of several sent at once and can take seconds (#3728). Until it answers, the phone shows what it already has (#4006, asked by Shawn, 2026-11-10), laid over the counts by `useShownUnreadCounts` in `apps/mobile/lib/chat/unread-first-paint.ts`:

- **The last answer.** Each answer from `GET /v1/channels/unread` is saved on the phone per member and chapter ([`caching.md`](../../ui/resilience/caching.md) lists it), and stands in while the request has not answered. Signing out forgets it, so a first launch and the first after signing in have none. The channel list itself is not saved, so on a cold start the marks appear with the list's first paint, not ahead of it.
- **Chat pushes still in the tray.** At launch and each time the app returns from the background, a channel with a chat push in the tray that reads as fully read, or has no count yet, is shown as one unread. A push names only its channel, so no mention is claimed and a channel that already has a count keeps it. The thread on screen is left out, since coming forward stamps it read.

This is a placeholder, not a second definition of unread, and the server's answer always wins:

- Nothing is written into the cached counts. The request goes out as it always did, and once it answers the saved answer is no longer shown; the tray stops lighting a channel at the first answer after that tray read, so a channel read on another device goes dark then.
- A failed request reads as failed: the counts are unavailable, not the saved ones.
- **Unread only** (§ Sidebar arrangement) hides nothing while the counts shown are the saved ones.
- Chat home, Messages and the app icon badge read the same overlay, so they agree. The tray is cleared on the server's answers only ([`../notifications.md` § Notification Grouping](../notifications.md#notification-grouping)), and only a server answer is saved.

### Mentions

`chat_messages.mentions` holds the `users.id` of everyone mentioned in the body, resolved **server-side at send time** against the chapter roster, and, on a reply, the author of the message it quotes. This is a security boundary rather than a convenience: a mention overrides a per-channel mute in the push rules, so a client-supplied list would let any member force a push to any other member in a channel they had deliberately muted.

**A reply mentions the author it quotes** (#3844; Shawn's beta ask, matching Discord's default "@ON" when replying), so it notifies them as an `@` does: the push, the channel's `@ N` count (`GET /v1/channels/unread`), the notification row and the highlight all read this one list, and a reply that also `@`s them lists them once. Not for a reply to yourself, to a deleted message, or to a system row or an imported one with no linked member (`replyPingTarget` in `ChatMentionService`). An edit keeps the ping as the send stored it: it is not re-decided, so deleting the quoted message later does not take it off the author's badge, and a reply sent before this rule does not gain one. There is no block check here, as a typed `@` has none, because `mentions` reaches the replier and a missing author would tell them they were blocked (§ Report and block); the push worker drops a recipient who blocked the sender, and the unread counts skip a blocked member's messages. Nor a read check: the push worker sends only to members who can read the channel. A quote reply and a thread-reply push cannot overlap, since a thread reply carries no `reply_to_id` (§ Messages → Message threads). There is no per-reply or member-side switch yet.

Resolution is tiered and fails closed — exact user id, exact display name, name without spaces, first word, unique prefix — and **ambiguity at any tier resolves to nobody**. If two members share a first name, `@jane` mentions neither, because silently picking one notifies the wrong person while looking correct to the sender. Unresolvable tokens are dropped silently; an `@` in prose is not an error.

**A name with a space in it is mentioned as written** (Paul, 2026-11-09, [#3825](https://github.com/pdcarlson/Frapp/issues/3825): picking "Winston Hewitt" should mention Winston Hewitt). A bare `@`-token still stops at whitespace, so `@jane and bob` is `@jane`. But text after an `@` that spells a name someone can be mentioned by, a member's display name or a role's name with a space in it, is one token, ignoring case and taking the longest name that fits: `@Winston Hewitt` is one mention, resolved through the exact-name tier, and it stops at whatever follows the name (`@Winston Hewitt, hi`, `@Winston Hewitt's`). The names come from `spacedMentionNames` in `@repo/validation`, which the API builds from the roster and roles it resolves against and each client builds from the roster and role names it already holds, so the send and the chip read the same token. This fixes two old misreads: with three Winstons, `@Winston Hewitt` used to reach nobody (the first name was ambiguous), and with a member named "Sam", `@Sam Abernathy` used to ping Sam.

- **Only a name made of token characters qualifies**: letters, digits, marks and `_ ' ’ . -`, opening on a letter, ending on a letter or digit, within the token bound. "Sam (VP)" does not, and neither does a digit-led name; they are mentioned by the reduced label, as before.
- **Old bodies are unchanged.** `@WinstonHewitt` still resolves (the folded tier), and nothing stored is rewritten. A renderer chips the reading that was sent: for a body sent before this rule, `@Sam Abernathy` that pinged "Sam" keeps its `@Sam` chip, because the chip follows the message's stored `mentions` (`findMentionSpans`' `accept`).
- **A role nobody holds lends no name**, as it is no target: `@Vice President` with an empty Vice President role is still `@Vice`.
- **A spaced name never takes a mention from someone the first word names exactly, unless it is written as the name is.** With members "Jordan" and "Jordan Will", `@Jordan will you come` is Jordan and `@Jordan Will`, capitalised as the picker writes it, is Jordan Will. Otherwise a member could rename themselves "Officers meeting" and take `@Officers meeting at 7` from the role, and a wrong recipient is worse than none. Where the first word names nobody exactly, case is ignored: `@winston hewitt` is Winston Hewitt (`sendMentionReading`).
- **Typing a spaced name by hand** resolves on send, but the pickers close at the first space, as tiptap's and mobile's query never spanned whitespace. On mobile a pick made with the caret inside a written `@Jane Doe` replaces the whole name.

**Three deliberate limits, invisible to anyone building a mention affordance without reading this:**

- **Surname-only does not resolve.** No tier matches on the last word of a display name, so `@Carlson` does not reach "Paul Carlson". This is a product decision, not an oversight — surname matching would make `@smith` ambiguous across most chapters — and it is pinned by `mentions.spec.ts`. A client SHOULD NOT offer a surname as a working mention suggestion.
- **A display name starting with a digit is unreachable by typing.** Every mention token must open on a Unicode letter — a separate requirement from the lookbehind that excludes email addresses — so no `@`-prefixed text a person can type will ever begin with a digit — a member named e.g. "123 Squad" cannot be `@`-mentioned by any prefix of that name. The exact-user-id tier still resolves such a member when something already knows their id; only handle-style typing is blocked. Autocomplete SHOULD NOT present a digit-led display name as reachable by typing.
- **Two mentions glued together collapse to the first.** `@jane@bob` extracts only the token `jane` — the second `@` is immediately preceded by a letter, which the same lookbehind that excludes email addresses also disqualifies, so `bob` is never tokenized at all rather than tokenized-and-unresolved. Anything that inserts mentions programmatically MUST separate them with whitespace or punctuation (`@jane, @bob`), or the second one vanishes silently.

None of these are bugs to fix; they fall out of the tiering and the tokenizer rules above, and a client's job is to design around them rather than assume every display name is reachable by every input.

**Web composer autocomplete.** `apps/web/components/chat/chat-editor.ts` wires `@tiptap/extension-mention` to the chapter roster (`useChapterRoster`) for both the composer and the inline editor a message turns into on Edit, popping a filtered list of members, then up to three roles (§ Role mentions), on `@` (`apps/web/components/chat/mention-list.tsx`, `apps/web/components/chat/mention-suggestion.ts`). It designs around the three limits above rather than reaching for a client-side reimplementation of the resolver: selecting a member inserts their name as written when it can be read back whole ("Winston Hewitt", since 2026-11-09; `mentionPickLabel`), and otherwise the display name reduced to letters, digits, and marks (`mentionLabelFor`, shared from `@repo/validation` since 2026-11-06) — not just whitespace stripped, because the tokenizer *truncates* (not rejects) a token at its first disallowed character, and a label that kept e.g. `(`/`,`/`&` could shorten in transit to something that happens to exactly match a *different* member's name. Stripping to the tokenizer's always-safe character class lines up with the resolver's "name without spaces" tier (both reduce to the same folded form) so the exact member picked is the exact member that resolves — never a same-named lookalike, a truncated fragment, or a surname-only/first-word-only match. A digit-led display name is excluded from the popup's candidates entirely (`mentionSuggestions` in `@repo/validation`; `mentionPickerEntries` picks and orders members and roles together), since no token built from one could ever be recognized by the tokenizer. The composer sends plain text — `editor.getText()` — so nothing about this affordance changes the wire contract: a member typing a mention by hand and one picked from the popup produce indistinguishable message bodies, and resolution stays exactly where §Mentions above says it must, server-side at send time.

**Mobile composer autocomplete** (2026-11-06). `apps/mobile/components/chat/chat-composer.tsx` opens a member list above its input when the caret sits in an `@`-handle, from the same chapter roster, with the roles after the members as § Role mentions says. The candidates and the inserted label are web's, shared from `@repo/validation` (`mentionPickerEntries`, `mentionPickLabel`), so both clients offer the same members for the same text and a pick sends the same body. A plain `TextInput` has no editor plugin to say where a handle is, so `activeMentionQuery` reads it off the text before the caret, with the tokenizer's own lookbehind and opening letter: the list opens on a bare `@` and on a handle that could be read as a mention, and not inside an email address or on `@1`. A pick replaces the whole handle, past the caret too, since a picked mention is plain text that a caret can land inside. The filter reads iOS's curly apostrophe as a straight one, so `@O’Br` typed on an iPhone still finds "O'Brien". Like web's, it sends plain text, so the wire contract above is unchanged. The list opens only on text the member typed: text put in the box for them (an edit loading the message, a restored draft, a pick) leaves it shut until they type, so tapping Edit on a message ending in `@shawn` no longer pops the list over it (2026-11-11, as Discord's edit box behaves). Web's inline editor offers the same list as its composer and, like this one, opens it only once the member changes the text (`components.md` §11 § Editing (web)).

**Opening a member's profile.** On both clients, clicking or tapping a message author's name or photo, an `@` chip that names one member, or a row of the channel's member list opens that member's profile: the same sheet the Directory opens, read by `users.id` through `GET /v1/members/by-user/{userId}` (mobile 2026-11-07, web [#3726](https://github.com/pdcarlson/Frapp/issues/3726)). Which member, if any, is the shared answer in `packages/chat-core/src/profile-targets.ts`:

- **An author** opens unless the row has no member behind it: Frapp's own posts (`SYSTEM_SENDER_ID`), an imported author nobody has linked (`sender_id` null), and a sender the roster no longer lists, whose profile read would only 404 (`authorProfileUserId`).
- **A chip** opens only a member the message's own server-resolved `mentions` holds, matched with the resolver's tiers (`mentionedUserId`), so a click never opens someone the send did not notify. A role mention (`@Brothers`) expands to its holders, none of whom is named after the role, so it opens nothing and stays plain.
- On web the name and the chip are buttons, reached by Tab and pressed by Enter or Space; the photo is a pointer target beside the name and not a second Tab stop. What the sheet holds is [`members.md` § Profiles](../members.md#profiles) and, for web's sheet, [`web-dashboard/README.md` § Directory](../../ui/web-dashboard/README.md#directory).

**A message that mentions you is highlighted** (2026-11-06). The message read carries `mentions` to both clients (`ChatMessage.mentions` in `@repo/chat-core/types`, an empty list when the server sent none or masked it), and a row whose list includes the viewer wears the chapter accent ([components.md](../../ui/design-system/components.md) §11, "A row that mentions you"). The highlight reads that server list and never the body, so what lights up is exactly who was notified. The viewer's own message never lights up.

Two properties of *how* the roster is read are load-bearing, because both are easy to undo without any test noticing:

- **The body is parsed before the roster is fetched.** A message containing an `@` that yields no mention token — an email address, a bare `@` in prose, `@here` — issues **no roster query at all**. The gate is the same parser that resolves the tokens a moment later, so "has a mention" and "resolves a mention" cannot disagree.
- **The roster arrives as `user_id, display_name, role_ids` in one query** (`role_ids` since role mentions, 2026-11-06), joined against chapter membership. Resolution never sees a full `users` row, so `email`, `bio` and `graduation_year` are not marshalled on the send hot path — the same boundary the chat *display* path draws. The chapter scope lives in that join rather than in the caller, which is what makes it impossible to resolve a mention against a wider set than the sending chapter.

Ambiguity detection is why the roster is read whole rather than narrowed to the parsed handles: knowing that `@jan` matches two members requires seeing every member a tier matches, and the folding the tiers compare against is defined in application code, not in SQL.

#### Role mentions

*(Added 2026-11-06, owner direction: "roles should be attable", then "anyone can ping any role by default. officers can change defaults".)* `@Officers` mentions every member holding the Officers role: the API expands the role to its holders' `users.id` at send time and stores them in `mentions` with everyone else, so the push override, the mention badge and the row highlight need nothing new. The rules (`ChatMentionService`, `apps/api/src/application/services/chat-mention.service.ts`; matching in `resolveMentions` in `@repo/validation`):

- **A role matches only by its whole name, folded as a member's is**: `@VicePresident` and `@vice-president` reach "Vice President"; `@Off` reaches no role. A role named in full outranks a member's shorthand (first word, prefix), but not a member's own exact name: when "Rush" is both a role and a member's display name, the token is ambiguous and, like every ambiguity in § Mentions, reaches nobody. So do two roles whose names fold the same.
- **Any member may `@` any role, unless an officer switched it off.** Every role carries a `mentionable` switch, on by default ([`rbac.md`](../rbac.md) § roles). While it is off, only a member holding `channels:manage` or `roles:manage` (or the wildcard) can ping the role, the way Discord lets a moderator ping a role that is not mentionable; it is how a chapter keeps `@Member` from becoming a chapter-wide ping no mute stops. A token naming a role the sender may not ping is consumed and reaches nobody; it never falls through to a member who shares a prefix with it.
- **The sender's permissions are read only when a token names a role that is switched off**, the one case they decide, so an ordinary `@Officers` costs the send path the role list beside the roster and nothing more.
- **The pickers offer roles from `GET /v1/channels/mention-roles`**, which answers each role with whether the caller may ping it (the same rule), and leaves out a role nobody holds. Both composers list the matching members first, then at most three matching roles the viewer may ping (`mentionPickerEntries` in `@repo/validation`); a role row shows the Roles nav glyph and says "Role". Picking one inserts `@` and the role's name as a member's is inserted (`mentionPickLabel`: "Vice President" as written, a one-word or punctuated name reduced), which resolves through the folded whole-name match. The endpoint sends no membership: the server expands the role when the message lands.

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

**An import may leave out old history (#2858).** *2026-09-29, owner's
decision: a chapter need not import years it does not want, and every message
left out is media not copied, stored or paid for.* A bot import's review step
asks **How far back should we go?** before anything else, with one-tap
choices: Everything (the default, meaning all history), Last 4 years, Last 2
years, Last year, or Pick a date, which opens an **Import messages from** date
box. A preset counts back from today. The day starts at the admin's own
midnight. *2026-11-05, owner's request: the date box sat at the bottom of the
step and was easy to miss.* The worker reads each
channel newest first and ends it at the first older message, so nothing older
is read past that page, copied or stored. The date is fixed once the import
starts: a restart keeps it, and changing it is refused, because the channels
already done and the ones still to go would follow different rules. The
import's page says "messages since" the date, since a partial import must say
so. An upload has no such field, because its media is already uploaded by
then. Its range is set when exporting, with DiscordChatExporter's own
`--after <date>`, which the upload step suggests; the API refuses a cutoff on
an upload.

**The upload path is not deprecated and is offered every time.** It is what
keeps working if Discord ever throttles or refuses one shared bot across every
chapter, and it is the only path for a chapter that cannot install apps in its
own server. Either way a background job writes the rows, the admin sees
its progress, and can delete the whole import afterwards. A bot import's
progress is counted in channels and threads, a channel Discord no longer shows
the bot counting as done: its message total is only known once Discord has been
read, so a message count would read full from the first page (#2816). An upload's
is counted in messages. Neither reads 100% until the import has completed.

**One import per chapter (2026-11-06).** *Owner's decision (the import
redesign): a chapter moves off Discord once, so `/discord-import` is built
around its one import rather than a list of jobs.* The API refuses to create
or start an import (409, `Your chapter already has a Discord import. Delete it
before starting another.`) while another of the chapter's imports is queued,
running, finished, failed, stopped or being deleted: anything that holds, or
may still hold, messages. A draft holds nothing and is not counted, and once
an import is deleted the chapter may import again. Two creates racing each
other can both pass the check; it guards the ordinary path, not a
deliberate race. The page shows that one import in the state it is in:

- **Nothing imported yet:** what comes over (messages, threads and forum
  posts, files, reaction counts, categories if the admin wants them, private
  channels kept private) and what stays behind (DMs, voice, and who holds
  which role), with the two ways in as the wizard's first step. Picking one
  opens the wizard past it. An abandoned draft reads as nothing imported, but
  an upload's draft can hold its export, counted against the chapter's
  archive space, so the newest one is named with a Delete. The import last
  deleted is named in one line until the admin dismisses it.
- **Importing:** the messages counted in so far, channels and threads done
  out of the total, the percent, and Stop import. A bot import also names
  the channel or thread importing now, with its message count so far, and
  shows a tile per Discord category: its channels and threads done out of
  its total, any that failed, turning green once all are done. The channels
  in no category come first, then the categories in Discord's order; past
  eight, the last tile sums the rest ("+ N more"). A thread counts under its
  channel's category. A temporary error (the database, Storage or Discord
  briefly unreachable, a timeout, a migration still loading) pauses the
  import instead of failing it: the line under the count says it paused and
  when the next try starts, and the worker tries again after 1, 2, 4 and 8
  minutes, failing it only when the fifth try in a row hits one (#1692). A
  deletion waits out the same errors the same way. An error the admin must
  act on, or one that will not clear, fails it at once. The admin can leave: when
  the import completes or fails, the admin who set it up (`created_by`) is
  notified, if they still hold `channels:manage` in the chapter. One the
  admin stopped sends nothing. The notice itself is in
  [`../notifications.md`](../notifications.md#notification-triggers-complete-list).
- **Finished, or stopped part-way:** the messages and files that came over,
  and the channels and threads (all it read once completed, the ones it got
  through otherwise; a completed bot import counts channels and threads
  apart); Open chat, once it completed; Resume import, on one
  that failed, which starts it again from where it stopped (#2947);
  what didn't come over, grouped by reason in plain words, from the last 50
  warnings the import keeps; and Delete import. A deletion that failed
  part-way also leaves the import `failed`, and is titled as a failed
  deletion, with no Resume. A completed bot import also lists what came
  over by Discord category. A completed import shown within a week of
  finishing plays the landing, the import's signature moment (about 1.8s,
  never with reduced motion on), until it has played to the end once in
  that browser; otherwise the page rests on the moment's final frame. The
  rules and the catalog are in
  [`../../ui/design-system/README.md`](../../ui/design-system/README.md#signature-moments)
  § Signature moments (2026-11-06, #3493).
- **Deleting:** the messages counted down (below).

**Watching an import (#2857).** See every channel, on a bot import that is
queued or running, opens it channel by channel: how many channels and threads are done,
importing, waiting, failed or gone from Discord; the one importing now with its
message count so far; the last few finished; and the failures with their
reasons (at most 20 named), each linking to the Frapp channel it lands in once
there is one. A channel the import fails on is marked failed with the reason,
and a restart resumes it (Resume import on the page, for a failed import; #2947 tracks what a restart still gets wrong after a remap). The same panel opens on a finished bot import,
read once when the import stops rather than polled, and there a channel still
marked importing is where the import stopped. Hide channels closes the panel
and keeps the import's own progress live. Imported messages never arrive live in an open
chat, so the panel says that opening a channel shows what has landed so far.
An upload has no such panel: it works through export parts, and its channel
rows record neither their order nor a part it had to skip, so its progress
stays the message count above.

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
  nothing else. With only those it cannot post, edit, or remove anything; it
  gains more only if the chapter gives it a role that allows more, which the
  connect step warns about (below). One visible
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
  message. Before it writes anything, the import asks Discord whether the intent
  is on and stops with an error naming the fix if it isn't, rather than writing a
  chapter's whole history as empty bubbles, which would look like success. When
  Discord can't answer that, a count of blank messages is the only guard: it
  stops an archive that comes back blank at scale, not a small one, and its error
  says how many messages it had already written. What each check covers is in
  [`integrations.md`](../../../docs/ops/deployment/integrations.md) § 7A.
- **The whole path disappears when unconfigured.** With no Discord application
  set up for the environment, `GET /v1/discord/availability` answers
  `available: false` and the wizard offers only the upload flow.
- **It also withdraws itself when Discord proves the setup broken, and only
  then.** The API reads Discord's own record of the application and answers
  `available: false`, refusing to start a connect, when that record shows the
  flow cannot work: the redirect URI is not registered, the bot token is
  refused, or the token and the client id belong to different applications.
  That is reported to operators, so an admin gets a sentence in the wizard
  rather than Discord's error page. When Discord cannot be reached, or its answer
  does not settle the question, the flow stays offered: an outage of the check
  must not look like a broken setup. It comes back on its own once the setup is
  fixed, with no redeploy, with one exception: a refused bot token needs the new
  token and a restart of the API, because the token is only read at start and a
  refused one is not retried. What each check covers is in
  [`integrations.md`](../../../docs/ops/deployment/integrations.md)
  § 7A.
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
  therefore does not deduplicate against an earlier import, which is one reason
  a chapter holds one import at a time: delete the first one instead.
- **Deleting an import is not the same as clearing it.** Delete purges what the
  import brought in and keeps the job row as the record that it happened.
  Clear takes that record off the chapter's list, and is offered only once the
  import has been deleted (#2817), as Dismiss on the line that names it.
- **Where it lands is the operator's choice, per channel, starting from a safe
  default.** Every channel the bot can read starts as a *new* Frapp channel
  with its Discord name, or as a merge into a like-named one (below), so a
  server with no conflicts needs no per-channel clicks; the channels are grouped by Discord category, with bulk actions per
  category and for the whole server. *2026-09-28, owner's decision (#2787),
  replacing "always asked": the first real import (78 channels) had to be
  clicked through one by one.* **Like-named channels merge by default.**
  *2026-09-29, owner's decision (#2856), replacing "merging is still never
  inferred: a name that matches is listed as something to resolve".*
  - A channel the scan saw was public, with no private thread, starts as a
    merge into the Frapp channel of the same name, when exactly one
    whole-chapter (`PUBLIC`), unarchived channel the admin can see has it.
    The names compare ignoring case, punctuation and emoji, so
    `📢-announcements` finds `Announcements`. A merge takes the target's
    readers, so a channel that was, or may have been, private never merges
    by default (a manual merge of one is #2800), and an upload, which says
    nothing about privacy, never does either. Such a channel starts as a new
    channel, and a name clash, compared the same loose way, is listed as
    something to resolve: `chat_channels` has no unique constraint on
    `(chapter_id, name)`. The admin's DMs and group DMs are never a target,
    by default or by hand.
  - Channels of one import given the same new name land in **one** new
    channel when they agree on who reads it and whether it is read only; the
    worker reuses the channel the first of them created. Channels that share
    a name but not those settings would become separate channels of one
    name, so they are listed as something to resolve.
  - **Discord's categories can come across as the chapter's channel
    categories** (the sidebar's named sections, § Channels), when the admin
    turns on "Keep Discord's categories". It is off by default, so a chapter
    that arranged its sidebar finds nothing new; with it on, each category is
    kept unless the admin unticks it. Each new channel goes into the category
    named after its Discord one. Starting the import makes that name a
    category: the chapter's own of that name, compared trimmed and in any
    case, or else a new one, placed after the chapter's own. New ones keep
    Discord's order on a bot import, which the scan reads; an upload, whose
    export doesn't record it, places them A to Z. A merged channel stays
    where it is, and a thread follows its channel. Like-named channels bound
    for different categories don't share a channel, so they are listed as
    something to resolve, as above. A category is a name every member sees,
    which the switch says.

    An officer may rename or delete one at any time. A channel the import
    still has to make then lands in no category, until the import is started
    again: a restart resolves the name again, making the category again if
    it is gone, but never for a channel that already exists or will share
    one that does. A category a remap stops using, as after unticking one,
    stays until the import is deleted or an officer deletes it (#2882). *2026-11-05, owner's request: a
    78-channel server landed as one flat list.*

    Each Discord category on the step is one folded section with a summary
    line (its channels, the threads they hold on a bot import, how many are
    being imported, and what needs attention), so a server of 78 channels
    reads as a dozen decisions; it opens on its own when something in it
    needs attention. A thread never gets a row of its own. Above them, "What
    chat will look like" lists the channels the import will make under the
    sidebar sections they will land in, in the order starting the import
    creates them (no category first, then Discord's order, then by name;
    channels A to Z, marked private as the sidebar marks them), and re-groups
    as the admin keeps or drops categories. A category named like one of the
    chapter's own joins it, under the chapter's spelling and before the new
    ones, as starting the import places it. Merges aren't listed: they make
    nothing. *2026-11-06, the server map of the #2882 redesign.*
  - **A channel an import merges into stays an ordinary channel, which an
    officer can delete at any time (#2922)**: before the import starts, while
    it runs, or long after. Each import that merged into it keeps its mapping
    row, with no target. A merge names its channel when it is mapped, so
    before an import starts, the mapping step and Start refuse a merge whose
    channel is gone, and the admin picks another. An import that still has
    history to write into the channel when it is deleted **stops**, as
    `failed`, with the reason "The Frapp channel #… was importing into was
    deleted, so the import stopped."; a bot import also marks that channel
    failed in Watch. It never writes into a missing channel (the foreign key
    refuses the insert). A channel the import is done with (a bot import's
    channel finished, or skipped because Discord stopped showing it; an
    upload's whose parts have all been read) goes like any other, and the
    import carries on. Start refuses to resume an
    import that still has history for a lost merge; an upload can't tell
    which of its parts are left for a channel without reading them, so it
    counts every lost merge. Deleting the channel took the history already
    imported into it, as deleting any channel does, so the way to bring that
    channel in is to delete the import and import again, which is what the
    stop and Start both say. Remapping and restarting is not a way back
    (#2947): an upload resumes past the parts it already did, and a remap
    forgets the channels the import created, so the restart makes each of
    them again. *2026-09-30 (#2922): stopping rather than
    skipping the channel means its history never goes missing without anyone
    choosing that, and it is how the import already stops when a channel it
    writes into turns out to be a direct message, or has lost the readers its
    mapping asked for.*

  **Known gap (#2799):** the check runs against the admin's own
  channel list, so a clash with a channel hidden from them (a `PRIVATE`
  channel they are not in, or a `ROLE_GATED` one they cannot read) goes
  unflagged today, and a second channel with that name is created. Everything that blocks the step is listed in one place
  (Needs attention), and that list is also what keeps Continue disabled.
- **Nothing private in Discord becomes readable by the whole chapter by
  default.** A new channel is *whole chapter* (`PUBLIC`), *restricted*
  (`ROLE_GATED`, readable by members holding any of the permissions the admin
  picks), or *Same as Discord* (below). A channel counts as private in Discord
  when some member of the server could not read its history there:
  `@everyone` is denied View Channels or Read Message History, or any role or
  member overwrite denies either (the "hide it from pledges" shape, which
  Frapp has no way to express). The scan also records which threads were
  private threads. A private channel starts as Same as Discord when that is
  on offer for it. Otherwise a channel that was private, holds a private
  thread (whose messages land in it), or whose privacy the scan could not
  read (the roles read failed, which the scan reports) starts with no
  visibility, and the API refuses to create it until the admin chooses.
  Threads do not take a private channel's default away: every thread in one
  reads as private, because it inherits the channel's answer, and it lands
  with the channel's readers, who could see it in Discord. A genuinely private
  thread is read only when the bot can see it (it was added to the thread, or
  the chapter gave it Manage Threads, which listing archived private threads
  needs), and it lands there too. Scanning again re-asks any whole-chapter choice, or merge, whose
  channel has since turned private, and any Same as Discord choice whose
  readers the new scan no longer names. An
  uploaded export carries no permissions, so every new channel from one needs
  the same choice; the "Who can read" control on a category, or on the whole
  server, answers all its new channels in one go, and shows their shared
  answer, or Mixed when they differ.
- **Whoever could talk in a Discord channel can talk in the imported one.**
  *2026-11-08, #3697: until then every channel an import created was
  read-only, where only an `announcements:post` holder can post, so a chapter
  moved off Discord with channels its members could read and not use.* A new
  channel is postable by everyone who can read it, unless Discord made it
  read-only: none of its readers could talk there, and the channel is what
  stopped them. The readers are `@everyone` (when it can read the channel)
  and each role that can, each asked on its own. Two kinds are set aside: a
  role with Administrator, which overwrites pass over, and a role the channel
  itself allows to talk (the exec of an `#announcements`). The channel is
  read-only when none of the rest can talk, and either it took talking away
  from one of them that the server otherwise lets talk, or no reader can talk
  at all. So `#announcements` denying `@everyone`, or denying "Brothers" who
  talk only by inheriting from `@everyone`, is read-only. A channel where the
  brothers talk and only the pledges are denied stays postable (Frapp has no
  deny, so the pledges can post there), and a "Muted" role denied everywhere
  turns nothing read-only. Talking is Send Messages; in a forum, where that
  only creates posts, it is Send Messages in Threads. The scan records the
  answer per top-level channel (`read_only_in_discord`); a thread lands in its
  parent's channel and takes its answer. An uploaded export carries no
  permissions, and a scan that could not read the server's roles knows
  nothing either, so their channels are postable ("can read means can post").
  The channel step shows a Read-only switch on every new channel, set to
  Discord's answer, and the review step lists the channels that will be
  read-only. *Since #3722 (2026-11-11) the importer still writes the old
  read-only switch and `channels:read:<name>` gates, and the database turns
  them into the channel's who-can-see and who-can-post lists as it is
  created, from what each role holds then (§ [Who can see and
  post](#who-can-see-and-post)); the importer writing lists itself, which
  would close the gap below, is [#4286](https://github.com/pdcarlson/Frapp/issues/4286).* **Known gaps:** Discord
  answers per role and Frapp has only
  read-only or not, so the roles a read-only channel let talk in Discord can
  post in Frapp only if they hold `announcements:post`, which by default the
  two top tiers hold in a chapter created since #4071's second PR and only the
  President holds in an older one; the admin grants it in Settings → Roles. A channel that
  denies `@everyone` and allows a member role is indistinguishable from
  `#announcements` with an exec allow, and comes out read-only until the
  admin turns it off. The reverse: on a server that lets nobody talk by
  default and allows members per channel, an `#announcements` that allows
  only exec took talking from nobody, and exec can still talk there, so it
  comes out postable until the admin turns the switch on.
- **The bot reads only what its roles can see.** Discord lists every channel to
  a bot, including ones hidden from it, so the scan works out the bot's own
  access per channel from Discord's permission overwrites rather than finding
  out by failing. A channel it cannot read is listed separately and can only be
  skipped until the chapter lets the bot see it and scans again. So that the
  first scan is not mostly skips, the connect step asks the admin to confirm
  they have given the bot a role that can see the channels to import before
  anything is read (#2812). The bot is let in either by allowing its own Frapp
  role on the channel (a category allow reaches only channels still synced to
  it), which keeps the install read-only, or by giving it a role that can see
  the channel, which is quicker but lends the shared bot token whatever else
  that role can do, so the role comes off once the import is done ([`integrations.md` § 7A](../../../docs/ops/deployment/integrations.md#7a-discord-application-setup-the-archive-importers-bot-path)). Nothing is probed that is already known unreadable, because
  every refused request spends a rate-limit budget one bot token shares across
  every chapter. When access cannot be worked out (the bot's roles could not be
  read), each channel is probed once and a refusal is reported the same way.
- **Discord roles gate the imported private channels; they never assign
  anyone.** *2026-09-28, owner's decision (#2818), replacing "the Discord →
  Frapp role mapping grants nothing": 30 of the first real server's 33
  imported channels were private, and with visibility chosen by hand they
  had all been set to whole chapter.*
  - **Roles are mapped before channels**, bot path only (an export names no
    roles). Each Discord role becomes an existing Frapp role, a new role
    named after it, or nothing (Skip, stored as `ignore`; the wizard called it
    Ignore until 2026-11-06). The default is the Frapp role with
    the same name, ignoring case and punctuation (letters of any script
    count, so "ΔΔ Class" and "ΓΓ Class" differ); then a close match to a
    seeded role, read from the end of the Discord name ("Recording Secretary"
    is a Secretary, "Pledges" are New Members, but "Pledge Educator" is not a
    pledge), except Member, the widest role, which matches only a whole name
    ("Brothers", never "Board Member"), and except a name that starts by
    saying it is not the sitting officer ("Past Treasurer", "PC President",
    "Assistant Treasurer"), which only a same-name role matches; then a new
    role named after it.
    *2026-09-29, owner's decision (#2855), replacing "a new role if it could
    read a private channel, and Ignore if it could not, so colour, class-year
    and game roles create nothing": a role classifies people (a class year, a
    committee) even when it gates no channel, and the admin sets any role
    they don't want to Ignore.* A viewer who cannot manage roles, or cannot
    load the chapter's roles, keeps every role on Skip and can still import.
    `@everyone`, and the managed roles Discord gives bots and boosters, are
    not offered: the Frapp bot's own role is allowed on every channel it was
    let into.
  - **The scan records, for each private channel, the roles that could read
    it**, each asked on its own, from Discord's overwrites rather than from
    what the bot can read. A channel hidden only by a deny ("everyone but
    pledges") records none: every other role reads it by inheriting from
    `@everyone`, colour roles included, and Frapp has no deny to copy, so it
    needs a choice.
  - **Same as Discord** makes the channel `ROLE_GATED`, readable by the Frapp
    roles mapped from those Discord roles. It is on offer only for a channel
    the scan saw was private and named readers for, and counts as chosen
    only while one of them is mapped: a Discord role set to Skip is left
    out, which is narrower than Discord and never wider, and a channel none of
    whose readers is mapped needs a choice like any other private channel.
    Discord answers per combination of roles and Frapp's gate has no deny, so
    a member holding a reader role plus a role the channel denies reads it in
    Frapp.
  - **The gate is a permission per role.** `ROLE_GATED` gates on permission
    strings, so each mapped Frapp role gets its own `channels:read:<name>`,
    held by that role alone, and the channel requires any of them. A string
    is never reissued while a role holds it, a channel is gated on it (its role
    since deleted), or another import's saved mapping has it; starting the
    import checks this again and refuses rather than open a channel to a role
    nobody chose. A chapter edits the gate afterwards in chat admin like any
    other, which lists these strings with the roles that hold them.
  - **Starting the import creates the new roles and grants the read
    permissions**, and nothing else: a new role gets only the read permissions
    of the imported channels gated on it. It never touches a `members` row;
    imported authors are names on messages, not accounts, and people are put
    into roles by hand. Mapping anything but Skip, and starting an import
    that creates a role or grants a permission, need `roles:manage` as well
    as `channels:manage`, as Settings → Roles would.
    Deleting the import keeps the roles and permissions it made. Importing who
    holds each Discord role (the bot's Server Members intent) is out of scope,
    and a member linking their own Discord account (below) puts them in no
    role either.
- **Consent is a deliberate friction point.** The admin must confirm they posted
  an in-channel notice in their Discord server before an import can be created.
  The step hands them that notice ready to copy (`DISCORD_NOTICE` in
  `apps/web/components/discord-import/consent-step.tsx`); copying it is not
  the answer, the box is. Frapp cannot verify it — but
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
  [`docs/security/content-validation.md`](../../../docs/security/content-validation.md)
  § 3.
- **Deleting an import removes what it brought in**: its messages, including
  ones deleted since (a deleted imported message keeps its import id for this,
  since #2878; one deleted before that lost it and stays as a
  `[message deleted]` tombstone), cascading to
  attachments and reactions, and its objects in the `chat-archive` bucket,
  except any an unreleased chat report still holds as evidence: those stay
  until the report's release deletes them (§ Report and block → Report,
  #2481). Scoped by `metadata->>'discord_import_id'`, so purging one import that merged into a
  live channel leaves that channel's live messages — and any *other* import's
  messages — untouched. It then deletes each channel the import **created**
  (#2905) that is left holding nothing:
  - no message of any kind (live, deleted, a tombstone, or another import's);
  - no attachment;
  - no points-ledger row pointing at it;
  - no merge into it (a `use_existing` mapping row) by an import that isn't
    being or hasn't been deleted. A finished import's merge counts, as its
    record of where its history went. The import being purged, and any
    import already deleted, count for nothing (#2922).

  The worker records each channel it creates, so this holds even after a
  failed import was remapped through the API, which rewrites the mapping rows
  without their targets. For an import from before that record existed, a
  `create_new` row's target counts only if the channel is no older than the
  import and still carries the description the worker gives the channels it
  creates. An upload mapped before #2859 could name an existing channel there.

  A channel the import merged into goes only when this import, or another
  import being or already deleted, created it (#2922). When import A created
  a channel and import B merged into it, A's purge had to keep it, since it
  held B's messages or B's merge; B's purge then takes it under the same
  rules, even while A's own purge is still finishing. Any other channel the
  import merged into is never deleted, and neither is a created channel that
  still holds something. A channel an earlier purge kept that no later purge
  revisits stays until an officer deletes it, which works for any channel
  since #2922 (before it, deleting a channel an import had merged into failed
  the `discord_import_channels_target_present` CHECK).

  After its channels, the purge deletes each category the import created
  that is left with no channel in it and that no mapping row of an import
  that isn't being or hasn't been deleted points at; a finished import's row
  counts, as its record of where its channels went. A category another
  deleted import created, which this one's mapping still points at, goes
  under the same rules, as channels do; one a remap stopped pointing at stays
  until an officer deletes it. A category the chapter already had is never
  deleted, even when the import put channels into it.

  Before #2905 every created channel stayed. A bot re-import then merged a
  public leftover by default (#2856). A channel private in Discord, or any
  channel in an upload (which says nothing about privacy), was flagged as a
  name clash to resolve by hand. The clash reached the chapter as a duplicate
  only when the leftover was hidden from the admin (#2799), which #2905 does
  not change.

  The roles the import created stay either way, as the role mapping above
  says. This and a chat report's release (§ Report and block → Report) are the
  only deletion paths that reap the `chat-archive` bucket; there is no
  chapter-deletion path in the product.

  Delete asks first (#2944), in a dialog that names the import's message and
  attachment counts and says what goes and what stays in this section's words
  ([`writing.md` § Discord Import (dashboard)](../../ui/design-system/writing.md#discord-import-dashboard)). The
  purge runs in the background, 500 messages a round, so a large import takes
  many minutes. While it runs, the import's row counts down the messages left
  out of `imported_messages`, from `purged_messages`: the worker records that
  count with each lease renewal rather than anyone counting the rows left.
  The row says the import is deleted once its status is `purged`, never from
  the count, which can finish short of the total (a message deleted before
  #2878 lost its import id).

What follows is the behaviour the archive has once it is in.

- **Attribution without accounts, until the author links.** An imported message is written with `sender_id = null` and
  carries `author_name` (the display name as the export recorded it),
  `author_avatar_path` and `author_external_id` (the author's Discord id). The
  alternative — a `users` row per Discord handle — was rejected: a row in `users`
  is reachable from the chapter roster, the members directory, server-side
  mention resolution and `anonymize_user`, so it would publish non-members into
  all four to satisfy a foreign key. A DB constraint guarantees every message
  names its author through one column or the other. A member who links their
  own Discord account becomes the sender of what they wrote (§ Linking a
  member's Discord history, below).
- **`author_avatar_path` is served through its own signed-URL endpoint,
  `POST /v1/channels/{id}/messages/avatars`** (`ChatAttachmentService.resolveAuthorAvatars`,
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
- **Read-only.** `imported` is in `SERVER_ONLY_KINDS`: a client cannot post one,
  and `ChatService.editMessage` refuses to edit one, whoever its sender is
  (403 `Imported messages cannot be edited`). An unlinked row has `sender_id =
  null`, which matches nobody, so only a `channels:manage` moderator can delete
  it. A linked row's sender can delete it like any message of theirs.
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
  count is lost and no identity is invented. The web message row draws that summary
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
- **Discord's mention tokens are named at import (#2875).** *2026-09-29:
  decided at import rather than at render.* Discord stores a mention as a
  token and draws the name when it is viewed, so history read over its API
  says `<@&750151182395244584> we need numbers now`. The names come from what
  only the importer holds: the message's own mentioned users, the role
  mapping, and the import's channels. Resolving at render would ship all three
  to every client on every read, for rows that never change. Nothing in the
  archive rules requires imported text to stay byte-for-byte. **The rewrite is
  permanent, and the original text is not kept**: a copy on `payload` was
  rejected because deleting a message clears `content` and leaves `payload` (true until #1575, 2026-11-12, since when a delete clears `payload` too), so
  a moderator's delete would have left the removed words readable. Linking a
  user mention to a member (#2878) therefore cannot start from this row's text;
  it needs the user ids from Discord again (a bot re-read), or a store of them
  that a delete also clears. The rewrite is `rewriteDiscordMentions`
  (`apps/api/src/domain/utils/discord-mentions.ts`), run by the mapper both
  import paths share:
  - a user (`<@id>`, `<@!id>`) reads `@` plus the name the server showed them
    by: their server nickname, else their Discord display name, else their
    username. On the bot path the importer reads each author and mentioned
    user as a member of the server (`GET /guilds/{id}/members/{user}`, which
    needs no privileged intent), because Discord's messages name people only
    by their account; someone who has left the server reads by their account
    name, as Discord shows them. Their own messages are labelled from the same
    read, so a person reads the same in both places. An upload's entry is
    DiscordChatExporter's, which carries the nickname;
  - a role (`<@&id>`) reads `@` plus its Discord name. *2026-11-06: changed
    from the mapped Frapp role's name*, which made `@Brothers` read
    `@Member` and could not say which of several Discord roles mapped onto
    one Frapp role was meant. The Frapp name is used only when the mapping
    recorded no Discord name. `@everyone`'s role reads `@everyone`. An upload
    has no role mapping, so there it reads `@unknown-role`;
  - a user or role name is written in the reduced form, with everything but
    letters, digits and marks removed (`@TristanHatton`), so a client draws it
    as one mention chip with no roster to consult: the bare mention tokenizer
    stops at a space. (The composer's picker has written a current member's
    name with its space since 2026-11-09, § Mentions; an imported author may
    be on no roster, so the import keeps the reduced form.) A name that would not start with a letter that
    way is written as its plain name instead;
  - a channel (`<#id>`) reads `#name`, linked to the Frapp channel its messages
    landed in (`/chat?channel=<id>`). A thread links to its parent's channel.
    On the bot path a new channel of the import is made as soon as a page
    about to be written mentions it (a thread's mention makes its parent's),
    so every mention of an imported channel links. A channel no one mentions
    is made when the import reaches it, as before; one that is mentioned and
    then never reached (the import stops, or Discord stops showing it) stays
    in Frapp, empty. The link works on web, where like every message link it
    opens in a new tab. Mobile shows the name without a link, because it only
    links absolute URLs;
  - **a channel some members cannot read is never named**: it reads
    `#private-channel`, as Discord shows "No Access" to someone outside it. A
    thread is named only when Discord showed it to everyone, since a private
    thread may have had none of its messages imported. A channel with a Frapp
    channel is judged by that channel as it is now: named only when it is
    whole-chapter (`PUBLIC`). A channel with none (skipped, or never made)
    landed nowhere, and is named only when Discord showed it to everyone.
    Anything else, including a privacy nobody recorded, reads
    `#private-channel`;
  - a custom emoji reads `:name:`, a timestamp (`<t:…>`) an absolute UTC time,
    and a slash command `/name`;
  - an id none of that can name reads `@unknown-user`, `@unknown-role` or
    `#unknown-channel`, never the snowflake. That includes roles and channels
    deleted in Discord before the import, and the bot and booster roles the
    role step does not offer;
  - a token inside inline code or a fenced block, or escaped with a backslash,
    stays as written, as Discord shows it;
  - a name is inserted as plain text, since it is someone else's words inside
    another member's message. A user or role name keeps only its letters,
    digits and marks (above), so it cannot make a link at all. A channel name,
    and a user or role name written in full because it does not start with a
    letter, has brackets, angle brackets, backslashes, backticks, asterisks,
    underscores at a word's edge and bidirectional controls dropped. So a name
    cannot make a disguised link, restyle the words around it, or reorder
    them. A full name that is itself a URL stays one, and mobile links it,
    showing the address it opens.

  The web mention chip marks `@` plus one word, which is why names are written
  without their spaces (above). The `@unknown-*` placeholders are marked too,
  as they are in a member's own message.

  An upload has little to do: DiscordChatExporter's JSON already renders tokens
  as text unless it was run with `--markdown false`. For an import that ran
  before this, `apps/api/src/backfill-discord-mention-tokens.ts` applies the
  same rewrite to the rows already written. It runs only on an import that has
  stopped. While a failed or cancelled import has a new channel that was never
  made, it refuses unless told `--allow-unlinked`, since a rewritten mention
  can never be linked later: a failed import can be restarted first, and a
  cancelled one never will be. It names a user by the name the import stored on their own
  messages, since the mentioned-user lists were never kept: someone mentioned
  who never posted reads `@unknown-user`, and an upload's users read as their
  Discord username.

  A bot import written before the importer read members (2026-11-06) named
  people by their account and roles by their Frapp mapping.
  `apps/api/src/backfill-discord-import-people.ts` reads each of its authors
  from the server and rewrites their `author_name`, copies their avatar, and
  rewrites the mention text the old importer wrote for them and for each role
  to what it writes now. It works from text, since no token is left, so it
  reaches only people who posted in the import, and finds a role only under
  its Frapp role's current name. It leaves a name two people or roles shared
  (several Discord roles mapped onto one Frapp role) as it was, and an old name
  that is someone else's new one, which is also what makes a second run change
  nothing. Run after `backfill-discord-mention-tokens.ts` when both apply.

- **Moderating an archived message is not live.** The Realtime exclusion is a
  row rule, not an operation rule, so a soft-delete, pin or edit of an imported
  message reaches other members on their next channel read rather than
  immediately. Deliberate: the archive is static history and moderating it is
  rare, while the alternative reinstates the fan-out the exclusion prevents.

### Linking a member's Discord history

*2026-09-29, owner's decisions (#2878). The decision page compared three
models, two storage choices and the rights question; what follows is what was
chosen and why.*

After a chapter moves off Discord, a member's own years of history would
otherwise read like a stranger's: their Discord handle and a letter avatar. A
member fixes that by **linking the Discord account they used**, and from then
on their imported messages in that chapter are theirs.

- **Only the member links, by signing in to Discord.** Settings → Discord
  history (`/preferences?section=discord`) sends them through Discord's sign-in with the `identify` scope and
  nothing else (no bot, no server list), which proves the account is theirs.
  Rejected: *officer mapping*, where an officer matches Discord authors to
  members. It is faster at cutover, but an officer would be putting a member's
  name on words the member may not have written, and a wrong match publishes a
  false attribution to the whole chapter and aims blocks and reports at the
  wrong person. Also not built: *officer suggests, member confirms*. It keeps
  consent with the member but proves nothing, and needs a mapping screen, a
  suggestion state and a prompt that self-claim does not. It remains an option
  for members who no longer have their Discord account.
- **The handshake parks, then the member's own session confirms.** Discord's
  redirect is unauthenticated, so whoever approved on Discord need not be the
  member who started it: a member could send their authorize link to someone
  else and have that person's history attached to themselves. So the callback
  binds nothing. It parks the Discord account on the single-use handshake and
  returns the browser to that section with a one-time token, and
  `POST /v1/discord/author-link/confirm` links only for the member who
  started the handshake, in the chapter it was started in. It shares the bot
  connect flow's state table and its one registered callback URL
  (`/v1/discord/connect/callback`), tagged with a purpose so neither flow can
  spend the other's handshake.
- **A link is per chapter, and one account is one member.** Linking in one
  chapter attaches only that chapter's imported messages and is invisible to
  every other chapter; a member of two chapters links in each. Within a
  chapter, a Discord account links to one member (another member claiming it
  gets 409) and a member links one account (linking a different one replaces
  the first).
- **Linking makes the member the sender.** It sets `sender_id` on that
  author's imported rows in the chapter's channels, and rows imported later
  attach as they are written. Rejected: resolving a second "effective sender"
  at read time. Block masking, the shared client classifier, reply quotes,
  reports and own-message rights all key on `sender_id`, in about ten places
  on the server and the clients; a second identity field would have to reach
  every one of them, and missing one leaks a block. So a linked row is simply
  the member's message:
  - it renders with the member's current name, and their photo where chat
    draws member photos (#732 on web);
  - a member who blocked them stops seeing it, with the masking contract above
    applying unchanged;
  - a report on it names them as the reported sender, so the queue leaves it
    out for them. That includes reports filed before the link: linking points
    their reported sender at the member. Unlinking leaves reports as they
    are: the member proved the account was theirs, and a report about their
    words stays out of their queue either way;
  - they may delete it, and nobody may edit it (§ Imported archive messages,
    Read-only).
  Unread counts, push and mentions do not change: they key on `kind =
  'imported'`, not on the sender. The row keeps `author_name`,
  `author_external_id` and `author_avatar_path`, which is what lets an unlink
  put it back.
- **Unlinking** (`DELETE /v1/discord/author-link`) returns the member's
  imported rows in that chapter to their Discord name. Rows they deleted stay
  deleted.
- **Leaving the chapter keeps the link**, as it keeps the sender on the
  member's live messages. With the member off the roster, a linked row falls
  back to its Discord name, as every row does when the roster misses
  (`resolveAuthorName`).
- **Deleting the account removes the Discord identity.** `anonymize_user`
  deletes the member's links, clears the Discord name, avatar path and id on
  the imported rows attributed to them, and clears the Discord name on reports
  about those rows (the reported words stay, per
  [`data-retention.md`](../data-retention.md#individual-account-deletion)). Those rows keep the tombstone as
  sender, like the member's live messages; without the clear, the roster-miss
  fallback would show their Discord handle again and re-identify them.
- **Linking follows chat's billing rule.** The link routes are free-tier, like
  chat: a member can link or unlink for as long as they could delete the same
  messages. Account deletion, which removes the Discord identity outright, is
  never gated on billing.
- **User mentions (#2875).** No Discord id → member map is served. A linked
  row carries both its `author_external_id` and its `sender_id`, which is what
  a rendered Discord user mention can link from; a chapter-wide map would hand
  every member the Discord id of someone whose messages they cannot read, or
  who linked before anything was imported.
- **Imported authors keep their Discord avatar.** The bot path copies each
  author's server avatar, else their account's, into the import's archive
  beside its attachments, once per import, as a 128px PNG. A default avatar,
  or one Discord no longer serves, leaves initials. Mobile still draws none
  for authors nobody has linked.

## Message Kinds and Actions

`chat_messages.kind` extends the simple TEXT/POLL distinction:

| Kind | Description |
|------|-------------|
| `text` | Plain text message (default) |
| `event` | Event RSVP card (created by `/event` slash command) |
| `task` | Task assignment card |
| `poll` | Poll (inline vote) |
| `dues` | Dues reminder card — in the enum, but still renders the placeholder `ComingSoonCard` |
| `points` | Points grant or deduction notification (`/points`) |
| `hours` | Service hours log confirmation (created by `/hours log`) |
| `rush` | Recruitment candidate card (created by `/<vocab> add`; live votes and bid via GET), on web and mobile |
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
- **Reconnect indicator.** On loss of the realtime connection the client retries with capped backoff and says so in the app's one connection indicator: "Reconnecting…", or "Live updates paused" once it falls back to polling, while the app's own connection is healthy, and "Slow connection" or "Offline" when that is the cause ([`connection-state.md` § One indicator](../../ui/resilience/connection-state.md#one-indicator)). Until 2026-11-06 it was a pill near the channel header.
- **Resubscribe before backfill.** On reconnect the client resubscribes to realtime first and backfills only once the channel reaches `SUBSCRIBED`, reading from its last-seen message id. Backfilling first would drop every row written between the query and the listener attaching. Overlap is safe because the per-channel merge is idempotent on `client_message_id`, so nothing duplicates. Implementation: `packages/chat-core/src/realtime-manager.ts` (its test suite names this the subscribe-then-backfill gate).
- **Empty states are explicit.** No visible channels, no messages in a channel, no DM threads, and no search results each render a purposeful empty state rather than a blank pane.
- **Author and DM names resolve by id, client-side, from one narrow roster.** A message carries only `sender_id`; a DM channel carries only its server-generated `dm-<userA>-<userB>` / `group-dm-<epoch>` name plus `member_ids`. Both clients resolve those against a single cached chapter projection — `GET /v1/members/roster`, which returns `{ user_id, display_name, avatar_url, role_color }` and deliberately nothing else, so rendering a name never puts the chapter's contact details on a device. `role_color` is the palette color of the member's highest-ranked colored role, or `null`, and paints the author's name on both clients ([`rbac.md` § Role Lifecycle](../rbac.md#role-lifecycle), #3485). On both clients a message author's avatar is their profile photo from that roster (`avatar_url`, signed by the API), else initials of the resolved name (#732, mobile #2884); a row with a `sender_id`, a linked imported row included, draws only the member, never its Discord snapshot, and only an imported author nobody has linked draws their Discord avatar (`resolveAuthorAvatar`, #2878). On web a DM row in the channel list still draws initials only. Mobile draws the photo on every member avatar: message rows, the channel member sheet, the `@` picker, a 1:1 DM's row on Messages, the Directory and its member sheet (`MemberAvatar`, initials under the photo so a loading or failed photo never leaves a blank circle). Mobile caches each photo on disk by its storage path rather than its signed URL, so the API re-signing a photo doesn't download it again; a new photo is a new path, so it is never served stale. A 1:1 DM shows the other participant; a group DM keeps a chapter-supplied title and otherwise summarises participants. A sender that cannot be resolved — a deleted account, whose membership row `anonymize_user` purges — degrades to a truncated id rather than a blank name, and an empty stored `display_name` counts as unresolved because the column is `NOT NULL DEFAULT ''`. The system actor (`SYSTEM_SENDER_ID`: the welcome, the audit bridge, a poll's closing notice, an invite-accept DM) is on no roster, so it is named before any lookup: it reads "Frapp" (`SYSTEM_AUTHOR_LABEL` in `@repo/validation`, which `@repo/hooks`' `resolveAuthorName` and the activity feed's announcement actor both use) on every surface that names an author, including web's new-message announcement, and on both clients its avatar is the Frapp crest on the crest's own field, never initials, even before the image loads (#3347). Before that it fell through to the truncated id and read "Member 000000".
- **The name is deliberately not joined onto the message.** Messages reach the cache four ways, and the live one is a `postgres_changes` echo of the `chat_messages` row, which cannot carry a join. A join would therefore leave every live-arrived message unnamed for the whole session, not briefly: that handler advances the last-seen cursor, the `since` window below is exclusive, and both channel queries set `staleTime: Infinity`, so nothing re-fetches the row. Resolving by id is the only option that behaves the same on every path.

## Reconnect replay

`GET /v1/channels/{id}/messages?since=<message_uuid>&limit=<n>` returns the **newest** `n` messages created after that message, newest first. It is not the `n` right after it, so a page of exactly `n` rows may not reach back to the cursor (#2807). "After" is strictly later `created_at`; no write path today produces a row tied with one a cursor can sit on (#3055).

When no message in the channel has that id (one hard-deleted since, or another channel's), the answer is a 404 with the code `chat.since_not_found` (`CHAT_SINCE_NOT_FOUND_CODE` in `@repo/validation`), not the channel's newest page. The code is what tells it apart from the route's other 404, a channel the caller can't read.

Clients read it after resubscribing (Resubscribe before backfill, above). How they merge the page, a full one included, is [`message-delivery.md` § Receiving Messages](../../ui/resilience/message-delivery.md#receiving-messages-realtime).

## Web ↔ mobile parity

The mobile (Expo) chat experience shares web's realtime transport and outbox, so **the offline composer queue behaves the same across platforms**, both running the same `@repo/chat-core` code. Chapter presence is shared too since #3917: both run `@repo/hooks/use-chapter-presence` (§ Online/offline presence). Reactions round-trip on both, and both have a full picker: web's (`frimousse`) loads current emojibase data and offers what the browser can draw; mobile's, the long-press sheet's add-reaction cell after web's four quick reactions (2026-11-07), offers emojibase's Emoji 14 and older, so an emoji newer than that reacted on web shows on mobile but can't be picked there. Inline rich-message cards are at parity but for two kinds: web has a renderer registry (`apps/web/components/chat/renderers/`, `dues` still a stub), and mobile draws every card kind but `dues` and `loading` through `cardFor` in `apps/mobile/components/chat/thread-message-row.tsx` (#3185, #3383), with those two as their `content` text: web's `dues` card is a placeholder, and `loading` is the stand-in for a heavy write in flight: web's slash commands, and on both surfaces the composer's + forms for Task, Service hours and Event, which mobile draws as plain text ("Creating task …") until the server's card replaces it ([`integrations.md`](integrations.md)). Differences that are canonical:

- **Voice memos** would be mobile-native: recorded in the composer, uploaded to Storage, and sent as `kind="audio"` with waveform metadata, with web clients playing them back. **Specified, not built** — `audio` is not in `CHAT_MESSAGE_KINDS`, as the Message Kinds and Actions table above records, so this describes the intended behavior rather than a shipped one.
- **Presence lifecycle on mobile** — **specified, not built.** The chat-topic presence payload carries no status field: it is exactly `{ userId, ts }`, pinned by key-set equality in `presence-contract.spec.ts` because widening it silently breaks push suppression. Nothing binds `AppState` to presence on this topic. As designed it would map app state to presence: backgrounded → `idle`, force-quit → `offline` — statuses that today are derived from the age of `ts`, never written. (A *picked* Idle or DND is written, but on the chapter topic, never this one: § Online/offline presence, Member-set status. The *chapter* topic is bound to `AppState` since #3917: a phone switched away says `away`, reads Idle for five minutes, then leaves and reads Offline there: § Online/offline presence, On the phone.)
- The authenticated entry point on mobile lands directly on chat, with the channel list as the default tab.
