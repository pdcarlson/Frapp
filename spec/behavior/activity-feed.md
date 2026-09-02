# Activity Feed

> **Surface note — the API exists; no client renders it.**
>
> `GET /v1/activity-feed` (`ActivityFeedController`/`ActivityFeedService`) implements the
> aggregation below, and `@repo/hooks`' `useActivityFeed` wraps it — but neither web nor mobile has
> a home surface to put it in, by later, more specific product decisions than this spec: the *web*
> home screen it was written for was removed in the chat-first redesign (`/dashboard` and `/` both
> redirect to `/chat` once a Supabase session exists), and **mobile**'s `(tabs)/index.tsx` is no
> longer a Home tab at all — the Signet mobile rebuild ([#937](https://github.com/pdcarlson/Frapp/issues/937))
> made it `ChatHomeScreen`, chat's own home route. Wiring this feed into an actual screen needs an
> IA decision (a new mobile tab, undoing the web redirect, or something else) that this issue's own
> scope didn't license — tracked separately rather than decided silently.
>
> It is also *not* the source of the web chat catch-up card. The pulse card
> ([`chat/catch-up.md`](chat/catch-up.md)) is a **separate** aggregation that reuses the
> read-only-view rule below but not this list: three of its five signals (tasks, service approvals,
> dues) are absent here, and points — an item below — is explicitly excluded from it. Do not build
> one from the other.

The activity aggregation for the user's active chapter covers:

- Recent events: new event created, event starting soon.
- Backwork: new resource uploaded.
- Points: points awarded or deducted (own).
- Members: new member joined.
- Announcements: latest announcement.

Feed items are pulled from existing data (events, point_transactions, backwork_resources, members, chat_messages where channel = announcements). This is a **read-only aggregation view**, not a separate data store.

**Implementation notes** (`ActivityFeedService`):

- "New event created" only surfaces events created within the last 14 days — otherwise a chapter's
  entire history would read as "new" forever. A recurring event's regenerated future occurrences
  (`parent_event_id` set) never count as "created," since editing a series' time regenerates them
  with a fresh `created_at` that has nothing to do with a member's sense of "something new happened."
- Event rows are resolved **through the caller's own visibility**, not a chapter-wide read: a
  role-targeted event (`required_role_ids`) contributes no row to a member whose roles don't
  intersect it, matching what `GET /v1/events` returns them. This is load-bearing, not incidental —
  a feed row carries the event's name and location, so a chapter-wide read here would republish
  exactly what the role gate hides. See [`events.md`](events.md#event-creation).
- Each domain contributes at most 10 rows before the merged, newest-first list is capped to the
  caller's requested `limit` (1–50, default 20) — except events, which draws from two separate
  10-row buckets ("starting soon" and "created," see above), so it alone can contribute up to 20.
- The five domains are fetched independently: one domain failing (a transient DB error) degrades
  that domain to an empty contribution rather than failing the whole feed.
- An `actor` whose `user_id` cannot be resolved against the current chapter roster (a member who has
  since left) still appears with an empty `display_name` rather than being dropped or given an
  invented placeholder — the same "empty means unresolved" convention `MemberRosterEntry` uses
  elsewhere.

**Leaderboard name resolution** (retained rule; no web surface currently renders it — `apps/web/lib/activity-feed-leaderboard.ts` has no importer but its own test since the home screen was removed): leaderboard lines in the activity feed resolve member display names by trying every id shape the API may send (`user_id`, `member_id`, and generic `id`) against the chapter member list, so mismatched field names between points totals and `MemberProfileDto` do not silently fall back to a generic label.
