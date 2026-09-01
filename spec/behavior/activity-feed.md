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

**Leaderboard name resolution** (retained rule; no web surface currently renders it — `apps/web/lib/activity-feed-leaderboard.ts` has no importer but its own test since the home screen was removed): leaderboard lines in the activity feed resolve member display names by trying every id shape the API may send (`user_id`, `member_id`, and generic `id`) against the chapter member list, so mismatched field names between points totals and `MemberProfileDto` do not silently fall back to a generic label.
