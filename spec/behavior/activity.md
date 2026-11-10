# Activity

The Activity page gathers, for one member, what is waiting on them and what they made, so they
don't have to look through channels and module pages to find it (#3897). It is an inbox beside
chat, not a home: chat stays the first screen ([`../product/surfaces.md`](../product/surfaces.md)).

This file owns the read behind the page, `GET /v1/activity`. The page itself (where it sits, how
a row opens chat's own card to act in place) is added to `spec/ui/` with the screens.

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

Events are not under "Made by you": an event does not record who created it (#3897 tracks adding
that).

**`needs_you_count`** is every "Needs you" row plus each event the member can check in to right
now and hasn't. It is counted before the list cap, so a badge built from it does not stop at 25.

## Rules

- **A module that is off contributes nothing.** Each section checks its own module
  (`tasks`, `hours`, `polls`, `events`, `documents`, `backwork`) and does not read it while the
  chapter has it off ([`../product/modules.md`](../product/modules.md)).
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
