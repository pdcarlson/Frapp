# Activity Feed

The home screen shows a unified activity feed for the user's active chapter:

- Recent events: new event created, event starting soon.
- Backwork: new resource uploaded.
- Points: points awarded or deducted (own).
- Members: new member joined.
- Announcements: latest announcement.

Feed items are pulled from existing data (events, point_transactions, backwork_resources, members, chat_messages where channel = announcements). This is a **read-only aggregation view**, not a separate data store.

**Web dashboard:** Leaderboard lines in the home activity feed resolve member display names by trying every id shape the API may send (`user_id`, `member_id`, and generic `id`) against the chapter member list, so mismatched field names between points totals and `MemberProfileDto` do not silently fall back to a generic label.
