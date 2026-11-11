# Activity

The Activity page gathers, for one member, what is waiting on them and what they made, so they
don't have to look through channels and module pages to find it (#3897). It is an inbox beside
chat, not a home: chat stays the first screen ([`../product/surfaces.md`](../product/surfaces.md)).

This file owns the read behind the page, `GET /v1/activity`. The page itself (where it sits, how
a row opens chat's own card to act in place) is
[`../ui/web-dashboard/README.md` § Activity](../ui/web-dashboard/README.md#activity) on web, and
the phone's screen, reached from the More hub, is in
[`../ui/mobile/screens.md`](../ui/mobile/screens.md) (supporting routes).

Not to be confused with two other things that use the word:

- [`activity-feed.md`](activity-feed.md), `GET /v1/activity-feed`: a feed of what happened in the
  chapter (new members, announcements, uploads). No screen renders it.
- The points activity log (#3715): a member's points history, inside Points.

## What the read returns

A read-only aggregation with no table of its own. Every row comes from the module that owns the
record, through that module's service and under that module's rule for who may see it. The read
itself requires `members:view`. A section whose module asks for more checks that too: Backwork
needs `backwork:upload` or `backwork:admin`, and the two officer queues need their own
permission, as below.

**Needs you**

- **Tasks:** the caller's open tasks (not yet completed), soonest due first. An overdue task
  stays here.
- **Task confirmations:** completed tasks waiting for a confirm, longest waiting first. Only for a
  `tasks:manage` holder, and never their own completion, which the confirm route refuses
  ([`tasks.md`](tasks.md)).
- **Hours approvals:** pending service entries, oldest first. Only for a `service:approve` holder,
  and never their own entry, which the approve route refuses
  ([`service-hours.md`](service-hours.md)). There is no assigned approver: every approver sees
  every pending entry.
- **Polls:** open poll cards from other members that the caller hasn't voted on, soonest closing
  first. See [Polls and channel access](#polls-and-channel-access).

**Coming up:** events that invite the caller and start within 14 days, or whose check-in is
still open, soonest first, at most 10. Events are read as the caller, so an event that leaves the
member out contributes no row ([`events.md` § Event creation](events.md#event-creation)). That
holds for an `events:update` holder too: the events list shows them every event so they can edit
it, but an event that doesn't invite them is not coming up for them. Each row carries the
member's own answer, not the event's default:

- `attendance` is `required` or `optional` as attendance by role decides it for this member. An
  alumnus the event's default alone would require is `optional`, since the absence sweep never
  holds them to it ([`alumni.md`](alumni.md)).
- `check_in_open` is whether this member can check in right now: the window is open
  ([`events.md`](events.md)) and check-in would not refuse them. It is false for an alumnus
  unless the event lists a role of theirs, the rule check-in itself applies.
- `checked_in` is read only while `check_in_open` is true.

**Made by you**

- **Polls:** poll cards the caller posted, newest first, open or closed.
- **Tasks:** tasks the caller assigned, newest first. Only while the caller still holds
  `tasks:manage`: without it `GET /v1/tasks/:id` refuses them a task they don't hold, and a row
  that opens to a refusal is worse than no row.
- **Files:** chapter documents and backwork the caller uploaded, newest first. Backwork only
  while the caller can still open Backwork (`backwork:upload` or `backwork:admin`).
- **Events:** events the caller made that invite them and whose check-in has not closed (15
  minutes after the end, as for Coming up), soonest first, whatever their date. A recurring series
  is one row, its next meeting. Making an event grants nothing: it lists only under the rules
  Coming up applies, so an event that leaves its maker out is not here (an `events:update` holder
  finds it on the Events page). That keeps every row's card honest, since chat's event card offers
  Check in from the event's times alone. A row opens the event; editing it there needs
  `events:update`, whoever made it ([`events.md`](events.md)). Events record their maker only since
  2026-11-11 (`events.created_by`, [`events.md` § Event Creation](events.md#event-creation)); older
  events have none and are never listed here.

**Links:** sign-up links posted in channels the caller can read, newest first. See
[Links](#links).

**`needs_you_count`** is every "Needs you" row plus each event the member can check in to right
now and hasn't. It is counted before the list cap, so a badge built from it does not stop at 25.

## Rules

- **A module that is off contributes nothing.** Each section checks its own module
  (`tasks`, `hours`, `polls`, `events`, `documents`, `backwork`) and does not read it while the
  chapter has it off ([`../product/modules.md`](../product/modules.md)). Links come from chat, which has no
  switch, so they are always read.
- **Each list carries at most 25 rows.**
- **One section failing does not fail the page.** The sections are read independently. One that
  fails is served empty and named in `unavailable`, so a client can say that part couldn't load
  rather than show it as empty.
- **Names are never invented.** A task's or entry's member who can no longer be resolved has an
  empty name, the same convention as the roster.

## Polls and channel access

A poll card is a chat message, so the page must not become a way around a channel's access rule,
the same rule search and the poll list follow
([`chat/README.md`](chat/README.md), "Search is not a side-channel").

- A poll is listed only when its channel is in the caller's own chat channel list, which is
  filtered through the predicate every chat read uses (`ChannelAccessService`). That holds for
  the caller's own polls too: a poll they posted in a channel they have since lost is not listed.
- A poll whose author the caller has blocked is left out
  ([`chat/README.md` § What a block does and does not hide](chat/README.md#what-a-block-does-and-does-not-hide)). If
  the block list cannot be read, the polls section fails (empty, named in `unavailable`) instead
  of listing unmasked. The other sections are chapter records, which a block leaves alone.
- A row is the poll's chat message (`message`, as chat serves it) plus what a list shows: the
  question, the channel, when it closes, whether the caller voted. It carries **no tallies**. A
  client reads its votes the way chat does and draws chat's own poll card from it, so the same
  access rule and the same live updates apply, and the card counts the votes.
- A card counts as a poll, and as open, by the rules chat's card and the vote route use: it needs
  a question and two options with an id and a label (a card without them draws as "Malformed
  poll" and is not listed), and it is open until its creator closes it or its closing time
  passes. A card with no closing time, or one that doesn't parse, stays open, since a vote on it
  is still accepted; it sorts last.
- "Hasn't voted" is checked over the chapter's 100 newest poll cards. An open poll older than
  that is rare; if one exists it is not listed here and is still in its channel.
- Only poll cards (`kind = 'poll'`) are read. The older poll format ([`polls.md`](polls.md)) is
  one no client creates or can draw as a card, so it is not listed.

## Links

Sign-up links posted in chat, gathered so a member stops scrolling channels for them (#3897:
Shawn, 2026-11-09). **Status 2026-11-11: the index is in the database
(`20261111030000_activity_links.sql`), the API serves it (`links` on `GET /v1/activity`, and
the routes below), and the Activity page draws it on web and the phone, with the channel switch
on web ([`../ui/web-dashboard/README.md` § Activity](../ui/web-dashboard/README.md#activity)).**

- **What counts.** An http(s) URL in a message body whose host is a sign-up host: Google Forms,
  Sheets and Docs (`docs.google.com/forms/…`, `/spreadsheets/…`, `/document/…`, with or without a
  Workspace account's `/a/<domain>` prefix, and `forms.gle`), Microsoft Forms
  (`forms.office.com`, `forms.microsoft.com`, `forms.cloud.microsoft`), Typeform, SignUpGenius and
  Calendly. The list lives once, in `activity_action_links` in the database, and is flagged for
  Paul to change or widen. The page names each row's kind ("Google Form", "Calendly") from
  `activityLinkKind` in `@repo/hooks`, which knows the same hosts: a host added to the database
  alone is gathered and titled by its bare host until it gets a name there. Any other link is not gathered, and neither is a URL with a user name
  in it (`https://calendly.com:1@evil.example/`): a browser opens the host after the `@`, so the
  one before it would be a trusted label on somewhere else.
- **How they are found.** A trigger on chat messages indexes every write path the same way (a
  member's send, the Discord importer, the bridge): an edit drops the links it removed and keeps
  the rest, a deleted message takes its links with it, and when a Discord author link or detach
  changes a message's sender the links' poster follows. The index went in with the last 30 days
  of history.
- **How long one shows.** 30 days from when it was posted.
- **Who sees one.** Only a member who can read the channel it was posted in, through the same
  predicate every chat read uses, with their block list applied, enforced on the server. Never a
  link from a channel set to **Leave out of Activity**: an officer (`channels:manage`) sets that
  per channel (`activity_excluded` on `PATCH /v1/channels/{id}`, refused on a DM or group DM),
  for channels like #advertising whose links are not chapter business. Every other channel feeds
  Activity by default.
- **Never the caller's own.** A member's own links are not listed to them: they posted it, so it
  is not waiting on them.
- **The list.** Newest first, at most 25, each row carrying the link, its host, the message it
  was posted in (for "Open in chat"; a thread reply also carries its thread root, since the
  channel's timeline doesn't show replies), the channel and the poster. An imported author with no
  Frapp account has no poster id and an empty name. The rows are chosen from the 200 newest
  showing links in the caller's channels, so a member would need 175 of their own, blocked or
  settled links inside 30 days to lose a row to it.
- **Not counted in `needs_you_count`.** A link may or may not be for this member, and Frapp
  can't tell when one is filled in, so a badge built on links would rarely clear. They are their
  own group, not "Needs you".
- **Officer remove.** A `channels:manage` holder can remove one link from everyone's Activity,
  for the one or two that slip through (`PUT /v1/activity/links/{id}/removed`), and undo it
  (`DELETE` on the same path). Like chat's other `channels:manage` actions it is scoped to the
  chapter, not to channels the officer can read. The message itself stays in chat.
- **Done and Hide.** Each member can mark a link Done (they filled it in) or Hide it (not chapter
  business for them). Both are per member and clear it from their own list; they read
  differently because they mean different things (`PUT /v1/activity/links/{id}/state` with
  `done` or `hidden`; `DELETE` clears it). Either needs the member to read the link's channel;
  one they can't read answers 404, as a missing link does. Frapp can't see whether a member filled in an
  outside form, so this is the only way one leaves the list (#3926 and #3927 track Frapp's own
  sign-up cards and a Google Forms connection). Deleting an account deletes the member's states
  ([`data-retention.md`](data-retention.md)).
