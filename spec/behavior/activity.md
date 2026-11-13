# Activity

The Activity page gathers, for one member, what is waiting on them and what they made, so they
don't have to look through channels and module pages to find it (#3897). It is an inbox beside
chat, not a home: chat stays the first screen ([`../product/surfaces.md`](../product/surfaces.md)).

This file owns the reads behind the page, `GET /v1/activity` and its
[standing](#standing), `GET /v1/activity/standing`. The page itself (where it sits, how
a row opens chat's own card to act in place) is
[`../ui/web-dashboard/README.md` § Activity](../ui/web-dashboard/README.md#activity) on web, and
the phone's screen, the Activity tab (#4610), is in
[`../ui/mobile/screens.md`](../ui/mobile/screens.md) (supporting routes).

Not to be confused with two other things that use the word:

- [`activity-feed.md`](activity-feed.md), `GET /v1/activity-feed`: a feed of what happened in the
  chapter (new members, announcements, uploads). No screen renders it.
- The points activity log (#3715): a member's points history, inside Points.

## What the read returns

A read-only aggregation with no table of its own. Every row comes from the module that owns the
record, through that module's service and under that module's rule for who may see it. The read
itself requires `members:view`. A section whose module asks for more checks that too: the two
officer queues need their own permission, as below.

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
- **Sign-ups and forms** (`cards`): open sign-up sheets, headcounts and forms from other members
  that the caller hasn't answered, soonest closing first, then newest; one with no end time last.
  See [Sign-ups and forms](#sign-ups-and-forms).

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
- `check_in_needs_location` is whether checking in needs the member's location: the event has a
  check-in zone ([`events.md`](events.md) § Check-In). The zone itself is not served here. A
  client that can't supply a location (web) leaves Check in off the row and opens the event,
  which says to use the phone; the phone checks in from the row and asks for the location then
  ([#4427](https://github.com/pdcarlson/Frapp/issues/4427)).
- `check_in_needs_code` is whether checking in needs the code on an officer's screen: one is live
  for the event ([`events.md`](events.md) § Check-In). Read only while `check_in_open` is true;
  false otherwise. No screen location is served. A client that can't scan (web) leaves Check in
  off the row and opens the event, which says to point the phone's camera at the code; the phone
  checks in from the row and asks for the code if the press is refused
  ([#4808](https://github.com/pdcarlson/Frapp/issues/4808)).

**Made by you**

- **Polls:** poll cards the caller posted, newest first: up to 25 open and the 25 most recently
  posted closed ones, each cut separately so a run of closed polls never pushes an open one out
  ([#4258](https://github.com/pdcarlson/Frapp/issues/4258), Shawn, 2026-11-11: the page lists the
  open ones and archives the closed, per
  [`../ui/web-dashboard/README.md` § Activity](../ui/web-dashboard/README.md#activity)). The
  caller's 100 newest poll cards are read to find them.
- **Tasks:** tasks the caller assigned, newest first. Only while the caller still holds
  `tasks:manage`: without it `GET /v1/tasks/:id` refuses them a task they don't hold, and a row
  that opens to a refusal is worse than no row.
- **Files:** none. The read listed the chapter documents and backwork the caller uploaded
  (#3897's ask, "documents and backwork you uploaded"). `made_by_you.files` is still served,
  always empty and marked deprecated, so a client built before the change (an open web tab, a
  phone's over-the-air bundle) does not fail on its absence; its removal is tracked separately.
  Changed in [#4291](https://github.com/pdcarlson/Frapp/issues/4291) by `pdcarlson` for Shawn,
  2026-11-11: removed from the page and the read ("I don't think that files uploaded by you
  needs to be a part of the activity page"). No ability went with it: a member's uploads are in
  Documents and Backwork.
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
It is what the member can act on now, and so is not the week ring's "left", which also counts
events still ahead ([Week](#week), settled 2026-11-13).

**`week`** is how much of the caller's week is done, by kind, for the ring at the top of the
page on both clients. See [Week](#week).

## Rules

- **A module that is off contributes nothing.** Each section checks its own module
  (`tasks`, `hours`, `polls`, `events`) and does not read it while the
  chapter has it off ([`../product/modules.md`](../product/modules.md)). Links, sign-ups and forms
  come from chat, which has no switch, so they are always read.
- **Each list carries at most 25 rows**, except Made by you's polls: 25 open and 25 closed.
- **One section failing does not fail the page.** The sections are read independently. One that
  fails is served empty and named in `unavailable`, so a client can say that part couldn't load
  rather than show it as empty.
- **Names are never invented.** A task's or entry's member who can no longer be resolved has an
  empty name, the same convention as the roster.

## Week

`week` on `GET /v1/activity` is the member's week as done of total, by kind
([#4766](https://github.com/pdcarlson/Frapp/issues/4766); Paul, 2026-11-13: the count tiles "tell
me no information", "maybe there's like a percentage or like a dial"). The count tiles said how
much was waiting; this says how far along the member is, which needs what they already finished,
and nothing else in the read carries that. Both clients draw it as one ring
([`../ui/mobile/screens.md`](../ui/mobile/screens.md),
[`../ui/web-dashboard/README.md` § Activity](../ui/web-dashboard/README.md#activity)).

- **The week is the Study screen's:** Sunday at the member's local midnight to the next. The
  client names it (`week_start`) as it does for [Standing](#standing): a start from eight days
  back to a day ahead is accepted, and Sunday at midnight UTC is used when none is given. A start
  outside that range is not refused here as Standing refuses it: the default week is counted
  instead, because this read is the whole page and the tab's badge, and a phone with a wrong
  clock must not lose its list over the number at the top. Only a value that is not a date-time
  is a 400. `week.start` and `week.end` say what was counted.
- **The member's own things only.** What waits on their review (confirmations, hours approvals)
  is never counted: reviewing is an officer's queue, not their week.
- **Each kind is `{ done, total }`,** where `total` is `done` plus what is still open, so a ring
  drawn from it never passes full. Counted before any list cap.
- **Events** that start in the week and invite the member. Done: marked present or late. Still
  open: a required event not attended, ahead or missed (a missed one stays open, so the ring
  does not close on a week with an absence in it). An optional event counts while its check-in
  has not closed and is dropped once the member has skipped it: skipping something optional is
  not a miss. An excused event is left out of both, as [Standing](#standing) leaves it out of
  `required`. Required is the absence sweep's rule, and two members are held to less, as Standing
  holds them: an alumnus the event invites only by its default is counted only when marked
  present, since check-in refuses them and the event is never theirs to do; and a required event
  from before the member joined does not hold them.
- **Tasks** the member holds. Done: marked done since the week began (`completed_at`), confirmed
  or not, since the member's part is finished. Still open: not done and due before the week ends,
  overdue ones included, however old. Every task has a due date.
- **Polls** from other members that the caller can read. Done: voted on since the week began,
  by when the vote was last changed, which is the only time a vote keeps (a change rewrites it,
  ADR-07). So a pick changed this week on a poll first answered earlier counts as one done this
  week. Still open: every open one they haven't voted on (`needs_you.polls`, before its cap).
- **Cards** (sign-up sheets, headcounts and forms from others). Done: first answered since the
  week began; a sign-up given up and taken again keeps its first time. Still open: every
  `needs_you.cards` row, before its cap.
- **A module that is off is `null`**, and so is a part whose read fails, which is also named in
  `week.unavailable` (`events`, `tasks`, `polls`, `cards`). A client draws a failed part as
  unknown and says "at least", never as zero and never as a finished week. Polls and cards share
  a line on both clients, and when one of the two failed and the other has nothing this week the
  line is unknown too: a dash, never "0 of 0".
- **A client keeps the count current between reads.** A poll or a card the read listed as open
  whose closing time has passed since leaves the client's To do list within a tick of its clock
  ([#4258](https://github.com/pdcarlson/Frapp/issues/4258)), and leaves the week's `total` on the
  same tick (`activityWeekSummary` takes the clock), as the next read would leave it out. The ring
  never says "1 left this week" over a list that says nothing is.
- **It adds little to the read.** The week's events come from the one events read Coming up
  already makes, widened to reach back to the week's start. The rest is a count of finished
  tasks, the member's attendance on those events, one more read of the member's claims on
  sign-up sheets that have closed, and the vote and form-answer reads the poll and card sections
  already make, widened to closed polls and forms so an answer given this week on one that has
  since ended still counts. That matters because the page is read on every app open, when the
  phone sends its largest burst of requests.

Five of these rules were open points until 2026-11-13, when Paul left them to the build ("make an
educated choice", [#4793](https://github.com/pdcarlson/Frapp/issues/4793)). Each was kept as built,
judged for an average member, a committee chair and the president
([`principles.md` § Three people](../ui/design-system/principles.md#three-people)):

- **The week starts Sunday, not Monday.** The Study hours gauge under the ring is "this week" too,
  and a weekly study goal already resets on Sunday; two different weeks on one screen would be
  worse than either. It is also the week a US calendar draws. To do lists by day whatever the week
  is, so a weekend that straddles two weeks is still read in order.
- **A skipped optional event is not a miss.** Optional means not owed. If skipping one kept the
  ring open, a member who goes to everything required could never finish a week with a social in
  it, and officers already have the word for what counts: required.
- **The tab's badge is not the ring's "left", and the two are not meant to match.** The badge
  (`needs_you_count`) is what the member can act on right now: their open tasks, unanswered polls
  and sign-ups, an event open for check-in, and, for who reviews, what waits on their sign-off. It
  falls with each thing they do and reaches zero. The ring is the week, which also counts events
  that have not happened yet, and nobody can clear those today: a badge built from it would sit at
  3 until Saturday and stop being read. Review items stay in the badge because a member's points
  wait on that confirmation, though they are never in the ring.
- **Polls and sign-ups share one line on the card.** Both are an answer the member owes, and the
  server still counts them apart (`week.polls`, `week.cards`). A fourth line would be a zero for
  most members most weeks, on a card already tight at a phone's width.
- **A poll counts as done in the week its vote was last changed.** A vote keeps only that time
  (ADR-07). A pick changed this week on an older poll adds one done and one to the total, which
  moves the ring by a sliver; a first-voted time would cost a schema change to remove it.

## Standing

`GET /v1/activity/standing` is how the member is doing this semester, the "This semester" block of the page (under the week card on both clients since #4766; Evan, 2026-11-12: "a dashboard page that tracks all your outstanding tasks, deadlines, commitments, and upcoming things with progress bars"). It is a separate read from `GET /v1/activity`, so either can fail without the other. It requires `members:view`, as the page does, and every number is the caller's own, read through the module that owns it.

- **This semester** is the points window's: everything after the latest archived semester's last day, or everything so far when the chapter has never rolled over ([`semester-rollover.md`](semester-rollover.md)).
- **Points:** the caller's semester total and their place on the semester board, equal totals sharing a place, as [`points.md` § Leaderboard](points.md#leaderboard) ranks them, out of how many the board ranks. No place when they are not on the board (an alumnus with no points this semester).
- **Required events:** events that hold the caller to them by the absence sweep's rule (`memberAttendance`: required for them by their roles, and never an alumnus by the event's default alone), read with the caller as viewer so an event that leaves them out never counts. Only events since the semester began and since the caller joined. An event counts once its check-in has closed, or as soon as they checked in, even before it starts. `attended` is marked present or late; an event they were excused from is counted as `excused` and left out of `required`, so "6 of 8" is out of the events that held them.
- **Service:** approved and pending minutes on the caller's entries dated from the day after the archived semester's last day (that day is the archive's).
- **Study:** minutes from the caller's sessions that started this week and have ended, the way the Study screen counts its week. The read settles nothing: a paused session whose grace ran out counts once Study settles it. The client names where its week begins (`week_start`, Sunday at local midnight); the server accepts a start from eight days back to a day ahead, and uses Sunday at midnight UTC when none is given.
- **A module that is off is `null`**, and so is a part whose read fails, which is also named in `unavailable`. If the semester itself can't be read, the parts that depend on it fail rather than count all-time.
- **Goals.** Each of points, service and study carries the caller's goal (`points.goal`, `service.goal_minutes`, `study.goal_minutes`), or `null` when the chapter sets none ([§ Goals](#goals)). A part with a goal reads "42 of 60" and draws a ring toward it, closed once the goal is met; a part without one draws no ring. Required events always have a target, the events themselves. If the goals can't be read, every goal is `null` and the numbers still show.

## Goals

What a chapter holds its members to, so a bar has an end ([#1062](https://github.com/pdcarlson/Frapp/issues/1062); Paul picked officer-set goals per role, 2026-11-12). Officers set them on the module pages in Chapter settings: a points goal on Points, and a service hours goal and a study hours goal on Service hours. `GET /v1/goals` reads them (`chapter-config:view`) and `PUT /v1/goals/:metric` replaces one measure's (`chapter-config:view` and `chapter-config:manage`); `chapter_goals` stores them, one row per chapter and measure. A member reads only their own: on the standing, or through `GET /v1/goals/mine` (`members:view`), which the phone's Study screen and More row use so they needn't read the whole standing.

- **The window.** Points and service are per semester, the standing's window; study is per week, Sunday at local midnight, the Study screen's week.
- **One goal for everyone, and roles set apart.** Each measure has an optional goal for every member and any number of roles with their own (pledges owing more study hours, say), up to 50. A role set apart with no number is held to no goal, which is how alumni or an officer role is exempted while everyone else owes hours. A member who holds several roles set apart is held to the goal on their highest-ranked one (lowest display order, then name, as the Roles page ranks them); a member holding none is held to everyone's, or to nothing.
- **Units.** Points are points. Hours are stored as minutes and typed in whole hours: up to 500 a semester for service and 80 a week for study, and up to 100,000 points (`GOAL_TARGET_MAX` in `@repo/validation`). A save naming a role the chapter doesn't have, or one role twice, is refused.
- **A deleted role** drops out of the goals when they are next read, and the next save leaves it out.
- **Where a member sees it.** Activity's "This semester" block draws the ring ([§ Standing](#standing)); on the phone the Study screen's THIS WEEK line reads "4.5 of 6.0 hrs" over a meter and More's Study hours row reads "4.0 / 6.0 hrs" ([`../ui/mobile/screens.md`](../ui/mobile/screens.md)).
- **Audit.** Each save writes a `chapter_goals_updated` row to `chapter_audit_log`, with the measure's goals before and after as its diff.

## Unread

Each row that waits on the member carries `unread`, so a client can mark what is new with a dot,
the way Slack and Linear mark their inboxes (#4173; Shawn picked "unread until opened" over "new
since your last visit", 2026-11-11). Web and the phone draw the dots (#4405, 2026-11-12; how each
draws one is [`../ui/web-dashboard/README.md` § Activity](../ui/web-dashboard/README.md#activity)
and [`../ui/mobile/screens.md`](../ui/mobile/screens.md)). Opening a row from Activity (its panel
or sheet, or on web the link itself) records the open, and the dot clears at once; so does acting
on it from its row (Confirm, Approve or Check in, [#4426](https://github.com/pdcarlson/Frapp/issues/4426) on
web, [#4437](https://github.com/pdcarlson/Frapp/issues/4437) on the phone). A client that
gets `unread_since: null` begins the member's dots (below).

- **Which rows.** Everything in Needs you, Coming up and Links. Nothing in Made by you: the member
  made it, so it never waited on them. For the same reason a task they assigned to themselves and
  an event they made (`created_by`, served on each event row) are never unread.
- **Until opened.** A row stays unread until the member opens that item from Activity, or acts on
  it from its row (Confirm, Approve, Check in): the client
  records it with `POST /v1/activity/reads`, naming the item's kind and id (`task`, `hours_entry`,
  `poll` by its message id, `event`, `link`, `signup` for a sign-up sheet or headcount and `form`
  for a form, each by its message id), up to 100 at a time. Scrolling past a row doesn't
  clear it, and neither does opening the same item elsewhere in Frapp (voting on the poll in its
  channel); acting on an item usually takes it off the list anyway.
- **Since it appeared.** A row is unread when it appeared after the member last opened it. It
  appears when it starts waiting on them: a task confirmation when the task was completed, the
  member's own task when it was assigned or an officer last sent it back (`sent_back_at`,
  [`tasks.md`](tasks.md)), anything else when its record was made (an entry submitted, a poll or
  link posted, an event made). So a task an officer opened before its assignee finished it is
  unread again in their confirmations, and a task its assignee opened is unread again when an
  officer sends it back. Taking back one's own completion is not a send-back.
- **Nothing older than the member's dots.** Until a client that draws dots opens Activity for
  them, no open of theirs could be recorded, so every row is read and `unread_since` is null. That
  client then calls `PUT /v1/activity/unread-since`, which records the moment once per member per
  chapter; a row that appeared before it is never unread. So a member's first visit with dots is
  not a page of them for things they had already seen, whenever their client gained dots.
- **Per member, never shared.** A member's opens live in `activity_item_reads` and their start in
  `activity_unread_starts`, which only the API reads, filtered on the member. The route checks no access: a read names an item for its member
  alone, and an item they can't see is never served to them, so recording one reveals and changes
  nothing. Deleting an account deletes both ([`data-retention.md`](data-retention.md)).
- **A hint, not a section.** When the opens can't be read, every row is served as read and the
  failure is reported; the page doesn't fail and nothing lands in `unavailable`.

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
  poll" and is not listed), and it is open until it is closed early (by its creator or a `channels:manage` holder) or its closing time
  passes. A card with no closing time, or one that doesn't parse, stays open, since a vote on it
  is still accepted; it sorts last.
- "Hasn't voted" is checked over the chapter's 100 newest poll cards. An open poll older than
  that is rare; if one exists it is not listed here and is still in its channel.
- Only poll cards (`kind = 'poll'`) are read. The older poll format ([`polls.md`](polls.md)) is
  one no client creates or can draw as a card, so it is not listed.

## Sign-ups and forms

A sign-up sheet, a headcount and a form are chat cards ([`polls.md`](polls.md) has the poll card
they're built on; #3926), so they wait on a member the way an unvoted poll does, under the same
channel rules (#3926 step 4):

- A card is listed only from a channel in the caller's own chat channel list, never the caller's
  own, and never one whose author the caller has blocked. They share the block list with polls
  and links, so when it can't be read this section fails too (`cards` in `unavailable`).
- Only open cards: not closed early and not past their end time, by the rule the claim and
  answer routes apply.
- **Answered** means a sign-up claim that holds at least one slot (a claim that gave every slot
  back is not an answer, as a cleared vote is not a vote), either answer to a headcount
  (Going or Can't make it), or any saved form response. Answers to a form are private
  ([`chat/README.md`](chat/README.md)), so the read asks only which forms have a response of
  the caller's, never what it says.
- **A full sheet no longer waits.** When every slot of a sheet has a limit and has reached it,
  nobody else can sign up, so it leaves Needs you for everyone who holds no slot (a headcount has
  no limits, so it is never full). Telling needs every member's claims on the open sheets, which
  the channel already reads on the card, so this reads nothing private.
- A row carries the card's kind (`signup`, `headcount`, `form`), title, channel, end time, and
  how many slots or questions it has; never anyone's claims or answers. It is answered on the
  card, so a client opens the message in chat rather than drawing the card on Activity.
- "Hasn't answered" is checked over the chapter's 100 newest cards of each kind, as polls are.
- They count toward `needs_you_count`. On both clients they are on the To do list by their end
  time, as polls are, and share the week card's "Polls and sign-ups" line with them
  (Changed in #4766 by `pdcarlson`, 2026-11-13: until then they were Now within a day of their
  end time, and showed under the All and Needs you chips with no chip or tile of their own).

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
  Calendly (`calendly.com` itself, not a subdomain). What is gathered is decided by
  `activity_action_links` in the database, which is flagged for Paul to change or widen. The list
  has two copies: that SQL, and `signUpLinkKind` in `@repo/validation`, and a widening changes
  both and adds a row to `packages/validation/sign-up-link-fixtures.json`, which both are tested
  against (#4215). The TypeScript copy names each row's kind ("Google Form", "Calendly") on the
  page and decides what the name read below may open. A host added to the database alone is
  gathered and titled by its bare host, and its read is refused, which is a definite answer, so a
  link posted before the TypeScript copy catches up never gets a name. Any other link is not gathered, and neither is a URL with a user name
  in it (`https://calendly.com:1@evil.example/`): a browser opens the host after the `@`, so the
  one before it would be a trusted label on somewhere else.
- **How they are found.** A trigger on chat messages indexes every write path the same way (a
  member's send, the Discord importer, the bridge): an edit drops the links it removed and keeps
  the rest, a deleted message takes its links with it, and when a Discord author link or detach
  changes a message's sender the links' poster follows. The index went in with the last 30 days
  of history.
- **Names** (#4187: Shawn, 2026-11-11; fetching approved by Paul the same day, with the guards
  below). A row is titled by the page's own name, the form's or sheet's title, with its kind
  leading the detail ("5K volunteer shifts", then "Google Form · Olive · #rush · Tue 3:00 PM").
  A link with no name keeps today's row, titled by its kind. The API reads each name **in the
  background** and stores it on the link (`title`); `GET /v1/activity` only serves what is
  stored and never opens a link. A sweep on the API reads up to 10 links a minute, newest first,
  a budget the whole API shares across every chapter (links in a channel left out of Activity
  spend it too, since an officer can bring the channel back). Each link is claimed just before
  its read with a compare-and-set on its try count (`title_attempts`), so one replica reads it
  at a time. A **definite answer** ends it for good: a name, or a page with none (refused, off
  the list, a 4xx, not HTML, a sign-in page). A read that **broke on the way** (a timeout, a
  network or TLS error, a 5xx or rate limit, the API restarting mid-read) is tried again an hour
  later, three tries at most, and a sweep tick whose reads broke reports it
  (`link-title-sweep-read`), so a fault that breaks every read is seen. An edit that keeps a URL
  keeps its row and its name; a new URL is a new row. The same URL posted in several messages
  in one tick is read once. The read is the API's only request to a URL a member posted, and
  every hop of it is guarded:
  - **Allowlist.** Only the sign-up hosts and paths above. An `http` link is read over `https` on
    the same host; a user name or password, a non-default port, or an IP literal is refused.
  - **Network safety.** The host is resolved in the connection's own lookup, and the connection is
    refused if any address it resolves to is not public: private, shared (CGNAT), loopback,
    link-local (cloud metadata), multicast, reserved and documentation ranges, and any IPv6
    outside global unicast or carrying an IPv4 address (mapped, NAT64, 6to4, Teredo). Checking
    in the connection itself leaves no gap for a DNS answer to change between check and connect.
  - **Redirects** are followed by hand, at most three, each held to the same allowlist and
    address checks. One that leaves the list ends the read with no name.
  - **Limits.** Five seconds over the whole read, redirects included; at most 512 KB of page,
    counted after decompression; only a `200` HTML page is read, and reading stops where the
    page's head ends, in the charset the page names (UTF-8 otherwise). A response that is not
    the page itself (a redirect, an error) is closed, not read. A `GET` with no cookies or
    credentials, on a fresh connection each hop.
  - **What counts as a name.** The page's `og:title`, else its `<title>`, without the product's
    name around it (" - Google Sheets"). No name: a sign-in page (a private Sheet or Doc
    redirects to Google's sign-in, which is off the list, or serves "Sign in" in place), an
    access request, an error or closed form, or a title that is only the product ("Microsoft
    Forms") or Google's "Untitled form". Only the first 2,000 characters of a title are looked
    at; control and bidirectional-override characters and broken surrogate pairs are dropped,
    and a name is cut at 200 characters, never through a character.
  - **Access.** A name is served only on a link the caller already sees: it is a field of the
    link, under the same rule as the rest of the row.
- **How long one shows.** 30 days from when it was posted.
- **Who sees one.** Only a member who can read the channel it was posted in, through the same
  predicate every chat read uses, with their block list applied, enforced on the server. Never a
  link from a channel set to **Leave out of Activity**: an officer (`channels:manage`) sets that
  per channel (`activity_excluded` on `PATCH /v1/channels/{id}`, refused on a DM or group DM),
  for channels like #advertising whose links are not chapter business. Every other channel feeds
  Activity by default.
- **Never the caller's own.** A member's own links are not listed to them: they posted it, so it
  is not waiting on them.
- **The list.** Newest first, at most 25, each row carrying the link, its host, its name when
  one was read, the message it
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
