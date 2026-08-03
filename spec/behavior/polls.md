# Polls and Voting

- **Channel-access enforcement.** A poll is a chat message (`type: POLL`) and is governed by the same channel-access invariant as the rest of chat (`chat/README.md`, "Channel-access enforcement"). Every poll operation authorizes through the shared `ChannelAccessService` (`canAccessChannel` predicate) before doing anything else, in addition to its `@RequirePermissions` gate:
  - `createPoll` authorizes as a **`post`** to the poll's channel (it authors a message); `vote` and `removeVote` authorize as a **`vote`**; `getPoll` authorizes as a **`read`**. `vote` clears the same read-only / `announcements:post` gate as `post`, but is exempt from the Alumni lifecycle rule — alumni are restricted from posting, not from participating in a poll they can already read, so they may vote and retract votes but not create polls. See [`alumni.md`](alumni.md).
  - An operation on a poll in a channel the caller cannot access returns **403** (or **404** when the poll/channel id does not resolve within the caller's chapter). The `polls:create` / `members:view` permission is necessary but not sufficient — channel visibility (`PRIVATE` / `ROLE_GATED` / `DM`) is enforced independently, so a member cannot read or vote in a restricted channel they are not in.
  - `GET /v1/polls` is **not a side-channel:** beyond the `polls:view_all` gate, it excludes polls in channels the caller cannot read (filtered via `ChannelAccessService.filterAccessibleChannelIds`). Filtering is applied after the result `limit`, so a page may contain fewer than `limit` rows; the list is never widened to backfill hidden polls.
- Users with `polls:create` permission can create polls in any channel they have access to.
- `GET /v1/polls` (chapter-wide list with aggregate tallies) requires `members:view` (controller baseline) **and** `polls:view_all` on the list route.
- `PermissionsGuard` merges class- and handler-level `@RequirePermissions` so both apply together.
- **Default role mapping:** `polls:view_all` is **not** on the Member role; it is on Treasurer, Vice President, Secretary (and President via `*`). Vice President and Secretary also carry `members:view` in the default seed so the guard chain succeeds.
- **Backfill migrations:** `20260417140000_backfill_polls_view_all_system_roles.sql` (VP/Secretary inserts include both permissions) and `20260417150000_backfill_members_view_vp_secretary.sql` (idempotent repair for environments that ran an older revision without `members:view` on those roles). The exact migration filenames may move to a dedicated migrations changelog in a later cleanup pass.
- Chapters may grant `polls:view_all` through custom roles if needed.
- Query parameters for `GET /v1/polls`: optional `channel_id`; optional `active` as a boolean string (`true`, `false`, `1`, or `0`); optional `limit` (default 50, clamped 1–200).
- A poll has a question, 2-10 options, and an optional expiration time.
- Members in the channel can vote. One vote per member per poll (single-choice by default; multi-choice is a poll option).
- When a member submits a new vote, the system treats it as a full replacement of that member's prior selection set for the poll.
- For multi-choice polls, the replacement flow atomically replaces all existing votes for that `(message_id, user_id)` pair with the newly selected options — no intermediate state where the member has zero votes is observable to other clients.
- Results are visible in real-time as votes come in.
- Once expired (or manually closed by the creator), the poll is locked — no more votes.
- Polls are stored as a special message type (`type: POLL`) in `chat_messages` with poll data in `metadata`, plus a `poll_votes` table for individual votes.
