# Polls and Voting

- Users with `polls:create` permission can create polls in any channel they have access to.
- `GET /v1/polls` (chapter-wide list with aggregate tallies) requires `members:view` (controller baseline) **and** `polls:view_all` on the list route. `PermissionsGuard` merges class- and handler-level `@RequirePermissions` so both apply together. By default `polls:view_all` is **not** on the Member role; it is on Treasurer, Vice President, Secretary (and President via `*`). Vice President and Secretary also carry `members:view` in the default seed so the guard chain succeeds. Existing databases are backfilled via migration `20260417140000_backfill_polls_view_all_system_roles.sql` (VP/Secretary inserts include both permissions). Migration `20260417150000_backfill_members_view_vp_secretary.sql` is an idempotent repair for environments that ran an older revision of the backfill without `members:view` on those roles. Chapters may grant `polls:view_all` through custom roles if needed.
- Query parameters for `GET /v1/polls`: optional `channel_id`; optional `active` as a boolean string (`true`, `false`, `1`, or `0`); optional `limit` (default 50, clamped 1–200).
- A poll has a question, 2-10 options, and an optional expiration time.
- Members in the channel can vote. One vote per member per poll (single-choice by default; multi-choice is a poll option).
- When a member submits a new vote, the system treats it as a full replacement of that member's prior selection set for the poll.
- For multi-choice polls, the replacement flow clears existing votes for `(message_id, user_id)` in a single scoped delete operation before inserting the newly selected options.
- Results are visible in real-time as votes come in.
- Once expired (or manually closed by the creator), the poll is locked — no more votes.
- Polls are stored as a special message type (`type: POLL`) in `chat_messages` with poll data in `metadata`, plus a `poll_votes` table for individual votes.
