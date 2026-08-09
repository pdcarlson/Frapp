# Activity Feed

> **Re-homed.** The standalone home screen this feed was written for was removed in the chat-first
> redesign — `/` and `/dashboard` both redirect to `/chat`. The aggregation described here is
> retained as the source list for the inline chat catch-up artifact specified in
> [`chat/catch-up.md`](chat/catch-up.md), which selects an actionable subset of it. Read "the feed"
> below as the aggregation, not as a screen.

The activity aggregation for the user's active chapter covers:

- Recent events: new event created, event starting soon.
- Backwork: new resource uploaded.
- Points: points awarded or deducted (own).
- Members: new member joined.
- Announcements: latest announcement.

Feed items are pulled from existing data (events, point_transactions, backwork_resources, members, chat_messages where channel = announcements). This is a **read-only aggregation view**, not a separate data store.

**Web dashboard:** Leaderboard lines in the activity feed resolve member display names by trying every id shape the API may send (`user_id`, `member_id`, and generic `id`) against the chapter member list, so mismatched field names between points totals and `MemberProfileDto` do not silently fall back to a generic label.
