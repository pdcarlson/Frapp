# Activity Feed

> **Surface note.** The standalone *web* home screen this feed was written for was removed in the
> chat-first redesign: `/dashboard` redirects to `/chat`, and `/` does too once a Supabase session
> exists. The aggregation itself is unchanged and still live on the **mobile Home tab**
> (`apps/mobile/app/(tabs)/index.tsx`).
>
> It is *not* the source of the web chat catch-up card. The pulse card
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
