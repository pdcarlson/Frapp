# Polls and Voting

- Users with `polls:create` permission can create polls in any channel they have access to.
- **Channel-access enforcement (multi-tenancy + RBAC invariant).** Every poll operation — create, vote, remove-vote, single-poll read, and the chapter-wide list — is authorized through the same trusted channel → chapter → membership predicate as chat (`canAccessChannel`, via the shared `ChannelAccessService`), never from a client-supplied chapter/channel field. `polls:create` / `polls:view_all` are necessary but **not sufficient**: the caller must also be able to access the poll's channel (e.g. be a member of a `PRIVATE`/`DM` channel, or hold a `ROLE_GATED` channel's permission). Creating posts a `chat_messages` row, so it additionally clears the read-only gate (`post`); voting/reading require channel visibility (`read`). Acting on a poll in a channel the caller cannot access returns **403** (or **404** when the id does not resolve within the caller's chapter).
- `GET /v1/polls` (chapter-wide list with aggregate tallies) requires `members:view` (controller baseline) **and** `polls:view_all` on the list route. **The list is not a side-channel:** it excludes — and never computes tallies for — polls in channels the caller cannot read, using the same predicate (mirrors `GET /v1/search`).
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
