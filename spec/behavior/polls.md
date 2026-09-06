# Polls and Voting

- **Channel-access enforcement.** A poll is a chat message (`type: POLL`) and is governed by the same channel-access invariant as the rest of chat (`chat/README.md`, "Channel-access enforcement"). Every poll operation authorizes through the shared `ChannelAccessService` (`canAccessChannel` predicate) before doing anything else, in addition to its `@RequirePermissions` gate:
  - `createPoll` authorizes as a **`post`** to the poll's channel (it authors a message); `vote`, `removeVote`, and `close` authorize as a **`vote`**; `getPoll` authorizes as a **`read`**. `vote` clears the same read-only / `announcements:post` gate as `post`, but is exempt from the Alumni lifecycle rule — alumni are restricted from posting, not from participating in a poll they can already read, so they may vote and retract votes but not create polls. `close` is gated as a `vote` for the same reason, deliberately: an open-ended poll (no `expires_at`) with an Alumni creator must stay closeable by that creator, not get stuck open forever the moment they lose post rights. The creator-only check is separate and always enforced regardless — `close` authorizing as a `vote` widens *whose channel state* clears the gate, never *who* may call it. See [`alumni.md`](alumni.md).
  - An operation on a poll in a channel the caller cannot access returns **403** (or **404** when the poll/channel id does not resolve within the caller's chapter). The `polls:create` / `members:view` permission is necessary but not sufficient — channel visibility (`PRIVATE` / `ROLE_GATED` / `DM`) is enforced independently, so a member cannot read or vote in a restricted channel they are not in.
  - `GET /v1/polls` is **not a side-channel:** beyond the `polls:view_all` gate, it excludes polls in channels the caller cannot read (filtered via `ChannelAccessService.filterAccessibleChannelIds`). Filtering is applied after the result `limit`, so a page may contain fewer than `limit` rows; the list is never widened to backfill hidden polls.
- Users with `polls:create` permission can create polls in any channel they have access to.
- `GET /v1/polls` (chapter-wide list with aggregate tallies) requires `members:view` (controller baseline) **and** `polls:view_all` on the list route.
- `PermissionsGuard` merges class- and handler-level `@RequirePermissions` so both apply together.
- **Default role mapping:** `polls:view_all` is **not** on the Member role; it is on Treasurer, Vice President, Secretary (and President via `*`). Vice President and Secretary also carry `members:view` in the default seed so the guard chain succeeds.
- **Backfill migrations:** `20260417140000_backfill_polls_view_all_system_roles.sql` (VP/Secretary inserts include both permissions) and `20260417150000_backfill_members_view_vp_secretary.sql` (idempotent repair for environments that ran an older revision without `members:view` on those roles). The exact migration filenames may move to a dedicated migrations changelog in a later cleanup pass.
- Chapters may grant `polls:view_all` through custom roles if needed.
- **Dashboard `/polls` list:** `usePolls` does not fire without `polls:view_all` (`enabled: !!chapterId && polls:view_all`). A member without that permission must see the denied copy (`<Can>` plus the same copy on the disabled-query branch), never a spinner. TanStack Query v5 leaves a disabled query `isPending` forever with `fetchStatus: "idle"`; the page gates the spinner on `isLoading` or `fetchStatus === "paused"` (offline, no data) and treats a pending-and-idle query as denied.
- Query parameters for `GET /v1/polls`: optional `channel_id`; optional `active` as a boolean string (`true`, `false`, `1`, or `0`); optional `limit` (default 50, clamped 1–200).
- A poll has a question, 2-10 options, and an optional expiration time.
- Members in the channel can vote. One vote per member per poll (single-choice by default; multi-choice is a poll option).
- When a member submits a new vote, the system treats it as a full replacement of that member's prior selection set for the poll.
- For multi-choice polls, the replacement flow atomically replaces all existing votes for that `(message_id, user_id)` pair with the newly selected options — no intermediate state where the member has zero votes is observable to other clients.
- Results are visible in real-time as votes come in.
- Once expired (or manually closed by the creator), the poll is locked — no more votes. **Manual close:** `POST /v1/polls/:messageId/close` (`polls:create` gate, matching `createPoll`) stamps `metadata.closed_at`/`closed_by`; only the poll's own sender may call it, and only while the poll is still open (closing an already-expired or already-closed poll 400s). `vote`, `removeVote`, `getPoll`'s `isExpired`, and `GET /v1/polls`'s `active` filter all treat a poll as closed the moment either `expires_at` passes **or** `closed_at` is set — a poll closed early with a still-future `expires_at` is excluded from `active=true` and included in `active=false` exactly like a deadline-expired one.
- Polls are stored as a special message type (`type: POLL`) in `chat_messages` with poll data in `metadata`, plus a `poll_votes` table for individual votes.
- **Expiry announcement.** A scheduled sweep (`ScheduledJobsService.sweepExpiredPolls`, every 5 minutes) posts a `system_audit` message — `Poll "<question>" has closed.` — into the channel of every poll whose `expires_at` has passed and that was not manually closed early (a manual `close` needs no announcement; the creator already knows). Like the other sweeps it claims a `scheduled_notification_dispatches` row (`entity_type: 'POLL'`, `threshold: 'EXPIRED'`) before posting, so it fires exactly once per poll across replicas and ticks. `system_audit` messages render in the channel timeline without sending a push notification (`push-rules.ts`), matching the pattern already used for invite-acceptance and chapter-welcome notices.

## Anonymous polls

Anonymity is not built, and the obvious fix does not work. The design position below is **intent for unscheduled work**; the code state it rests on is an **observation**, measured against `main` on 2026-09-05 by reading the migrations, RLS policies and tally paths named inline. The negatives are the part that ages fastest — re-run them rather than trusting this paragraph:

```sh
# no sub-feature key is read anywhere — expect zero hits
rg -n 'enabled_modules\.[a-z]+\.[a-z]|enabled_modules\[' apps packages
# poll_votes reaches TS only through the API repository — expect every other
# hit to be a comment, a type, or a test; a real query anywhere else falsifies
# the "client read: none" row below
rg -n 'poll_votes' --type ts apps packages
```

**No poll is anonymous today.** There is no anonymity flag in `PollMetadata`, no `anonymous` column anywhere, and no code path that treats one voter differently from another. The `polls.anonymous` entry in the module catalog (`packages/org-archetypes/src/index.ts`, `subFeatures`) is a **label with no storage**: `chapters.enabled_modules` is a flat `{module: boolean}` jsonb, no sub-feature key is written or read by anything, and the Settings Modules tab renders sub-features as read-only text under its own note that per-feature toggles are not built. Anything that reads `polls.anonymous` as configuration is reading a catalog string. This is true of every sub-feature key, not just this one (#1760).

### There are two poll systems, and they fail anonymity in opposite ways

The split is not a discovery of this section — `apps/mobile/components/chat/poll-card.tsx` already records it in its header, including the detail that keeps the two disjoint: `PollService.createPoll` leaves `kind` at its `'text'` default, so a REST-created poll never reaches the card renderer, and the `/poll` slash command is the only thing that writes a `kind: 'poll'` message.

| | `/v1/polls` (REST) | Chat card (ADR-07) |
| --- | --- | --- |
| Poll body | `chat_messages.type = 'POLL'`, `metadata` | `chat_messages.payload`, `kind: "poll"` |
| Votes | `poll_votes` (`message_id`, `user_id`, `option_index`) | `chat_message_actions` (`action_type = 'vote'`, `payload.option_id`) |
| Tally computed | **Server-side** — `get_poll_vote_option_totals` / `get_poll_user_votes_for_messages` | **Client-side** — `tallyPollVotes` in `packages/chat-core/src/polls.ts` |
| Client read of vote rows | **None.** RLS on, zero policies → default-deny; only the API's `service_role` reads it | **Granted** by `chat_message_actions_select` — predicate owned by [`AUTHORIZATION_MODEL.md`](../../docs/internal/security/AUTHORIZATION_MODEL.md) |
| Realtime | Not published | In the `supabase_realtime` publication |

**The REST path is already voter-private by construction.** `PollWithResults` projects per-option counts plus `userVotes` — the caller's own selections — and nothing else. No report, export or dashboard surface reads `poll_votes`. Adding anonymity there is a display concern, not a data-exposure one.

**The chat-card path cannot be made anonymous by hiding a field.** The client is the tallier: `apps/web/lib/chat/use-chat-channel.ts` selects `chat_message_actions` directly, Realtime streams row changes as they happen, and `tallyPollVotes` counts `message.actions` locally so the per-option breakdown and the viewer's own choice need no round trip. The table's read exposure is not specific to polls and is not restated here — [`AUTHORIZATION_MODEL.md`](../../docs/internal/security/AUTHORIZATION_MODEL.md) owns the policy, and [`chat/catch-up.md`](chat/catch-up.md) works the same consequence for card dismissals. **What is specific to polls is that the exposed row *is the ballot*:** for a reaction, knowing who reacted is the feature; for a vote, it is the thing anonymity exists to prevent. That read is deliberate — it is what makes the card's tally instant and offline-tolerant — so anonymity here is a **direct trade against the ADR-07 hot path**, not an oversight to patch.

Making it anonymous takes two changes, not three. **The SELECT policy is the single lever for both the direct read and the live stream** — `20260816140000_realtime_carrier_repair.sql` states it outright: *"Realtime evaluates the SAME RLS policy PostgREST does."* So narrowing `chat_message_actions_select` to withhold an anonymous poll's vote rows suppresses the change events too, and the publication does not need touching. (It could not be scoped anyway: `alter publication ... add table` is table-level, so there is no per-poll exclusion to make.)

The second change is the expensive one: **the tally has to move server-side**, behind an aggregate the client can subscribe to, because withholding the rows is exactly what breaks `tallyPollVotes`. That is a re-architecture of the card's vote path, and it should be costed as one.

### Hard vs soft anonymity — the decision this rests on

**Soft anonymity** keeps `user_id` on the vote row and hides it from clients. Vote change, one-vote-per-member, and the `idx_chat_message_actions_dedupe` unique index all keep working unchanged. But the link is permanent: `service_role` sees every voter, and account deletion tombstones a user rather than removing them (`anonymize_user`), so the vote stays joined to a stable id forever. Telling a member a poll is anonymous while retaining that link is a promise the data model does not keep.

**Hard anonymity** stores no voter identity — at most a per-poll nullifier that proves "this member has voted" without revealing what for. It keeps the promise, and it costs: no vote change or retraction without a second construction, no per-member audit of who participated, and `idx_chat_message_actions_dedupe` / `poll_votes`' `unique (message_id, user_id, option_index)` both need replacing, since each is keyed on the identity being removed.

**This choice is open and is not settled here** (#1759). It is a product and trust call, and it is the one the privacy-and-minors concern raised in #382 actually turns on — a chapter running a rush ballot is exactly the case where "anonymous" being soft would matter to the people voting.

### Recommendation: anonymity is per-poll, fixed at creation

Recorded as a **recommendation for review**, not a settled decision.

Anonymity should be a property of the individual poll — set when it is created, immutable once the first vote lands — rather than a chapter-level setting:

- **A chapter is not uniformly one or the other.** The same chapter runs named quorum votes (where the record of who voted is the point) and anonymous rush ballots. A single chapter switch cannot describe both, and the driving use case in the module catalog — recruitment — is the minority case, so whichever way the switch defaulted would be wrong for real polls in the same channel.
- **Anonymity is a promise made to the voter at the moment they vote.** It has to be a visible property of the poll in front of them. A setting an officer can flip afterwards can retroactively expose votes cast under the opposite promise, which is the failure mode worth designing out rather than documenting.
- **It leaves the catalog entry meaning what every other sub-feature means.** `polls.anonymous` with `defaultOn: true` then reads as *the default for new polls in this chapter* — the same relationship `defaultOn` already implies elsewhere — rather than as a mode the chapter is in. That needs the sub-feature persistence path that does not exist yet, so an implementation that lands before it should default to named and let the creator opt in per poll.

### Surfaces that must hide voter identity

For a poll marked anonymous, every one of these is in scope. The first two are where it is currently impossible, not merely unimplemented:

1. **`chat_message_actions` SELECT policy** — the client's direct read of vote rows.
2. **The `supabase_realtime` publication** — live row events carry `user_id`.
3. **`tallyPollVotes`** (`packages/chat-core/src/polls.ts`) and both card renderers (`apps/web/components/chat/renderers/poll-card.tsx`, `apps/mobile/components/chat/poll-card.tsx`) — they must consume a server aggregate instead of raw rows.
4. **`PollWithResults.userVotes`** — correct as-is (the caller's own vote), but it must stay the caller's own and never be widened to other members.
5. **`polls:view_all`** — grants the chapter-wide list. It must not become a way to see who voted; today it does not, and that has to stay true by test rather than by accident.
6. **Any future poll export or report** — none exists today, which is the cheapest moment to write the constraint down.

Not in scope, and worth stating so it is not re-derived: `poll_votes` needs no RLS change. It has no policies, so it is already unreadable by clients.
