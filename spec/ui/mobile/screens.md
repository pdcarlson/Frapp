> **TARGET SPEC (partially built).**
> Every route below now exists in `apps/mobile`.
> `check-in` (from an event) and `host-check-in` (role-gated) are registered without an inbound link from the frozen tab layout's cluster list — `join` and `welcome` are now routed to by the auth gate (`lib/auth-gate.ts`) rather than waiting on an inbound link.
> `ask` no longer is: the Ask Frapp bar above the tab bar presents its sheet (for a member who has Ask; the bar was inside the + panel until #4702), and the route file survives only because the frozen tab layout registers it.
> Implementation is tracked in GitHub Issues — do not file spec-vs-implementation drift issues against these documents ([`README.md`](README.md)).

# Mobile Screen Inventory (s01–s23)

> The 23 locked Canvas screens mapped to expo-router paths, plus the pre-Signet screens they replace.
> The mapping is total: every current file under `apps/mobile/app` is accounted for.

Visual truth: [`../design-system/reference/canvas-screens.dc.html`](../design-system/reference/canvas-screens.dc.html).
Screen ids (`s01`…`s23`) and Canvas labels below match that file's `data-screen-label` attributes exactly.

## Route conventions

- Routes live under `apps/mobile/app`.
  `(app)/` holds everything a member does inside a chapter: the four tabs in `(app)/(tabs)/`, and every other screen pushed on a stack above them ([`navigation.md` § Going back](navigation.md#going-back)).
  `(auth)/` holds everything before that point — which is **not** the same as "signed out": `chapter-picker` and s02/s03 are reached while authenticated.
  The group's gate keys on chapter context, not on session alone, so a member with no resolved chapter stays here (`apps/mobile/lib/auth-gate.ts` holds the single decision both layouts read).
- Routes not in the 4-tab bar live in `app/(app)/`, pushed on the stack over the tabs and reached by navigation only ([`navigation.md` § Going back](navigation.md#going-back)).
- **Filename contract:** `event-details.tsx` MUST never be renamed.
  `frapp://event-details` is baked into every `.ics` file members exported before the export was withdrawn (#3708), so renaming the route breaks calendar entries already sitting on members' devices.
  The whole contract (route, URL and `id` param) is in [`navigation.md` § Deep links](navigation.md#deep-links).
- All other renames land together in a single PR so typed routes never half-break — see [`navigation.md`](navigation.md).
- Bottom-sheet screens (marked *sheet* below) are `@gorhom/bottom-sheet` components hosted by a parent screen, not router routes — see [`patterns.md`](patterns.md). s17 is both: a sheet the tab bar's quick-actions host presents, and a route file the frozen tab layout's registration requires (see the status legend).

## Inventory

Status legend — **Live**: route exists and carries real content.
**Routed, stub**: the route exists and is reachable, but the drawn screen is not built — the nav restructure pre-created it so later slices only add files (see the hotspot freeze in [`navigation.md`](navigation.md)).
**Sheet**: gorhom sheet component hosted by a parent screen.
It normally has no route of its own — s17 is the single exception, and honestly so: `(app)/_layout.tsx` registers `ask` on the stack, and `lib/routes.spec.ts` holds that every registration there has a backing file, so `ask.tsx` stays (it also keeps a stale `frapp://ask` link landing somewhere real) and presents the same sheet the pill does rather than drawing a second copy of s17
— or, in a build without Ask, redirects to Chat home.

| ID | Canvas label | Route (`apps/mobile/app/`) |
| --- | ------------ | -------------------------- |
| s01 | [Sign-in](#s01-sign-in) | `(auth)/sign-in.tsx` |
| s02 | [Join chapter](#s02-join-chapter) | `(auth)/join.tsx` |
| s03 | [First-run + notifications](#s03-first-run--notifications) | `(auth)/welcome.tsx` |
| s04 | [Chat — channels (landing)](#s04-chat--channels-landing) | `(app)/(tabs)/index.tsx` |
| — | [Messages](#messages) | `(app)/(tabs)/messages.tsx` |
| s05 | [Chat thread](#s05-chat-thread) | `(app)/chat-thread.tsx` |
| s06 | [Events list](#s06-events-list) (the Calendar) | `(app)/events.tsx`, and one day at `(app)/calendar-day.tsx` |
| s07 | [Event detail](#s07-event-detail) | `(app)/event-details.tsx` |
| s08 | [Tasks + points](#s08-tasks--points) | `(app)/tasks.tsx` |
| — | [Task](#task) | `(app)/task-details.tsx` |
| s09 | [You (was the More hub)](#s09-you-was-the-more-hub) | `(app)/(tabs)/you.tsx` |
| s10 | [Study hours](#s10-study-hours) | `(app)/study.tsx` |
| s11 | [Dues](#s11-dues) | `(app)/dues.tsx` |
| s12 | [Documents](#s12-documents) | `(app)/documents.tsx` |
| s13 | [Directory](#s13-directory) | `(app)/directory.tsx` |
| s14 | [Notifications](#s14-notifications) | `(app)/notifications.tsx` |
| s15 | [Profile (on the You tab)](#s15-profile-on-the-you-tab) | `(app)/(tabs)/you.tsx`, `components/you/profile-sections.tsx` |
| s16 | [Settings](#s16-settings) | `(app)/preferences.tsx` |
| s17 | [Ask sheet](#s17-ask-sheet) | *sheet* from the Ask Frapp bar above the tab bar (`components/ask/ask-bar.tsx`, hosted by `components/quick-actions/quick-actions-host.tsx`), plus `(app)/ask.tsx` |
| — | [Minutes](#minutes) | `(app)/minutes.tsx`, `(app)/minutes-details.tsx`, `(app)/minutes-transcript.tsx`, `(app)/minutes-series.tsx` |
| — | [Suggested](#suggested) | `(app)/suggested-tasks.tsx` |
| s18 | [Check-in](#s18-check-in) | `(app)/check-in.tsx` |
| s19 | [New task sheet](#s19-new-task-sheet) | *sheet* from the tab bar's quick actions (`components/quick-actions/quick-actions-host.tsx`), or from a chat's + (s05), which posts the task's card in that channel |
| s20 | [Log service hours sheet](#s20-log-service-hours-sheet) | *sheet* on `service-hours.tsx` (`components/service-hours/log-hours-sheet.tsx`) |
| s21 | [Upload document sheet](#s21-upload-document-sheet) | *sheet* on `documents.tsx`, or from the tab bar's quick actions with no folder picked ([`navigation.md` § Quick actions](navigation.md#quick-actions)) |
| s22 | [Host check-in (admin)](#s22-host-check-in-admin) | `(app)/host-check-in.tsx` |
| s23 | [Adjust points sheet (admin)](#s23-adjust-points-sheet-admin) | *sheet* on `you.tsx` |

Supporting routes with no drawn Canvas screen: `(app)/invite.tsx` — Invite members: invite by email, setup's share-first link, and the chapter's invites with resend and revoke, as web's panel has them;
Live since 2026-11-06, email and the list since 2026-11-09 (#3828) ([`navigation.md` § Inviting members](navigation.md#inviting-members))
— and `(auth)/chapter-picker.tsx` — chapter selection, reached from You's Switch chapter ([`navigation.md` § You](navigation.md#you-s09-and-s15)) or a `frapp://chapter-picker` link, reusing s02's visual language;
it marks the open chapter `Current`, and a tap on that row selects it again like any other, since the mark reads the token's claim and the server's active chapter can differ;
a switch the server refuses (403: the member is no longer in that chapter) stays on the list, on any row and the Current one too, with an error that says to pick another ([`writing.md` § Chapter picker (mobile)](../design-system/writing.md#chapter-picker-mobile)), because the tabs would refuse every request for the same reason, and fetches the list again, so that chapter drops off it and, when it was the member's only one, the empty state's Join or start a chapter appears in place of the error;
when a re-select of Current fails any other way (offline, say) it still goes on to the tabs, unless the last switch the picker saw land on the server since it opened was to another chapter and its session refresh failed (the server then holds that chapter, and the next token would move the member there), in which case it shows the error and stays, as a failed switch to another chapter always does;
a switch it can't see leaves the same way as no switch: one made on web that the token hasn't caught up with, or one the server applied whose answer was lost, and the next token then follows the server;
opened from You it draws `‹ You`, held while a switch is in flight — and `(auth)/create-chapter.tsx`
— first-officer setup (`POST /v1/chapters/onboard`), Live: find, confirm and color, then the live moment with the seeded channels and an optional logo, `Pick your chat display` (s03's display beat, the phone's current display preselected, #4056), the `Turn on notifications` step when the build can push and push is off, and the invite step ([`../../behavior/onboarding.md`](../../behavior/onboarding.md), #3351), each step showing `Signed in as <email>` with `Sign out` (#3782)
— and `(auth)/terms.tsx`, the Terms prompt (#2302), Live.
The auth gate pins a member here who hasn't accepted the Terms version the server enforces, ahead of s03.
It carries the shared checkbox, and, like s02, sign-out and **Delete account**, because Settings is unreachable while the gate holds a member here (Apple 5.1.1(v)).
Its copy is `writing.md` § 7, Terms prompt.

**`(app)/chapter-settings.tsx`, `(app)/chapter-roles.tsx`, `(app)/role-tier.tsx` and `(app)/role.tsx`**, Chapter settings and its Roles screens ([#4074](https://github.com/pdcarlson/Frapp/issues/4074)), are supporting routes with no drawn Canvas screen, live since 2026-11-12, reached from You → Admin.
[`navigation.md` § Chapter settings](navigation.md#chapter-settings) owns what each holds.

**`(app)/(tabs)/activity.tsx`, Activity** ([#3897](https://github.com/pdcarlson/Frapp/issues/3897)), has no drawn Canvas screen.
Live since 2026-11-11, and tab 2 since 2026-11-12 ([#4610](https://github.com/pdcarlson/Frapp/issues/4610)).
It is on the read web's `/activity` uses ([`../../behavior/activity.md`](../../behavior/activity.md)) and opens the same records, and since 2026-11-13 it is laid out around the member's week ([#4766](https://github.com/pdcarlson/Frapp/issues/4766); Paul, 2026-11-13, on the summary's count tiles at a real chapter's scale: "too many little cards that tell me no information", "a completely paradigm-shifted way of displaying this", "maybe a percentage or like a dial").
Web's page took the same shape, from the same model in `@repo/hooks`, later that day ([`../web-dashboard/README.md` § Activity](../web-dashboard/README.md#activity)), so the two are one page again ([`principles.md`](../design-system/principles.md) P6).
The screen is drawn and checked for four people ([`principles.md` § Three people](../design-system/principles.md#three-people)): a member with nothing due, an average member, a committee chair and the president.
Top to bottom:

- **The week strip** (`components/activity/week-strip.tsx`; model `activityWeekStrip` in `@repo/hooks`; [#5310](https://github.com/frapplive/Frapp/issues/5310), Paul's direction B, 2026-11-17: "I hate the calendar page", "I'm open to a paradigm shift").
  Seven columns, today and the six days after it, each its weekday initial, its date and a dot per kind due that day (one dot however many of that kind): events sky and tasks green, the hues their Notifications tiles wear, and polls and sign-ups violet. These are the first kind hues on Activity, which [`foundations.md` § A place's hue](../design-system/foundations.md#a-places-hue-2026-11-12) kept neutral until Paul's direction B (its note records the change).
  Fantastical's DayTicker and Things' Upcoming strip are the comparables: the dots say how the week is shaped before a word is read.
  It starts today rather than on Sunday because every day on it is a day To do lists, so any of them can be pressed; what is past due is To do's Overdue, not a dot on a day gone by.
  Pressing a day with something on it scrolls To do to that day (to Now first, for today's open check-ins), and to the top when the day's one thing is the week card's Next; a narrowed list shows everything first. A day with nothing is drawn but not pressable.
  The picked day wears the month grid's selected-day look (an accent tint and an accent border, never the solid fill Next's button holds), so the dots keep their hues; until a day is pressed, today is picked, and its weekday and date are in the accent either way. The initials are the month grid's (`lib/calendar-weekdays.ts`).
  It counts every to-do the member hasn't snoozed, whatever line of the week card narrows the list.
- **The week card** (`components/activity/week-card.tsx`; model `activityWeekSummary` and `activityAgenda` in `@repo/hooks`).
  One ring, done of total this week, from the read's `week` ([`../../behavior/activity.md` § Week](../../behavior/activity.md#week)), with the count inside it ("5" over "of 8") and a headline beside it ("3 left this week").
  Apple Fitness's rings and Bevel's daily dial are the comparables: one figure that closes as the work is done.
  Under the headline, a line per kind that has anything this week (Events, Tasks, "Polls and sign-ups"), each with the poll card's meter and its count.
  A kind the chapter has off, or with nothing this week, has no line: "Polls 0 of 0" would be the zero tile again.
  Under a hairline, **Next**: the one thing to do next (an event open for check-in, else the first overdue task, else whatever is soonest), as a row that opens its sheet.
  Its ask (`Check in`, `Vote`) is the one filled accent button on the screen ([`foundations.md` § Where the accent goes](../design-system/foundations.md#where-the-accent-goes-2026-11-05)); over an event open for check-in the caption reads **Happening now** in the accent.
  - **Nothing due:** the ring is its groove with a quiet check, and the headline says "Nothing due this week".
    Never "0 of 0".
  - **Everything done:** the ring and the headline take the success hue; Next shows what is first next week.
  - **A part couldn't load:** its line draws a dash, the headline says "At least N left this week", and a warning line names the part.
    A failed read is never a zero and never a finished week.
  - **An API from before `week`:** no ring; the card is only Next.
- **Snooze** ([#4982](https://github.com/pdcarlson/Frapp/issues/4982), Shawn, 2026-11-14; the rule is [`../../behavior/activity.md` § Snooze](../../behavior/activity.md#snooze)). A long press on a row that waits on the member (To do, To review, Links, the week card's Next) opens the platform's own sheet, "Snooze until" with Gmail's fixed times (Later today, Tomorrow, This weekend, Next week); Android's dialog holds three, so it offers the first three. VoiceOver and TalkBack get it as the row's named action "Snooze". The row leaves at once. Snoozed rows wait behind a **Snoozed (N)** text control at the foot of the screen, soonest back first, each reading "Back Tomorrow · 8:00 AM"; a tap opens the record and a long press asks to **Unsnooze**. A snoozed row comes back on the screen's own clock, and the screen reads Activity again then, so its dot and the tab's badge return with it. Gmail's app is the comparable: a long press, then Snooze.
- **The card at the top** (`components/activity/nudge-card.tsx`; #4781 on 2026-11-13, rebuilt 2026-11-18 by [#5464](https://github.com/frapplive/Frapp/issues/5464); rules in [`../../behavior/ai.md` § The card and its tray](../../behavior/ai.md#the-card-and-its-tray)). Under the week card, for every member whatever their AI answer, from `POST /v1/activity/card`: the one most useful thing waiting on them, and never the week card's Next a second time (the tray's first takes its place). A tile in the kind's colour with its glyph (events info blue, a mention red, an announcement or the officer's queue house gold, a sign-up or task green, the study goal amber), the thing's own name, and its time or count, in the kind's colour when pressing. With AI on, one sentence under it on Frapp's gold rule; without, nothing more (Paul's pick, 2026-11-18: show, don't write). One outlined button that settles it (Open event, Open, Sign up, Read, Review oldest, Start studying, See the task, or Thanks for a word of thanks), and "Ask about this" beside it where the member has Ask. Under them, a tray of up to three chips, each its kind's glyph and colour with a count or a word ("Tonight", "2", "Due Fri"); pressing one brings it into the card in place, with no sheet (Paul picked the spotlight with a tray over the spotlight alone). "···" offers Hide this one and Turn these off; Preferences' "Nudges on Activity" turns it back on, offered to every member since the card needs no AI. Bevel's daily card is the reference, with Linear's Inbox tiles and Apple Fitness's coloured stats. No card leaves no gap, no skeleton and no empty state.
- **"Last week"** (`components/activity/recap-card.tsx`, [#4983](https://github.com/pdcarlson/Frapp/issues/4983); Shawn, 2026-11-14), on Sunday to Tuesday only, under the week card and the nudge card: the web card on the phone ([`../web-dashboard/README.md` § Activity](../web-dashboard/README.md#activity)), from the same model (`activityRecapCard`) and [`../../behavior/activity.md` § Recap](../../behavior/activity.md#recap).
  A section header "Last week" with the week's days as its count, then one hairline card of figures in a wrapping row ("2 events", "+30 points"); Slack's and Linear's weekly digests are the comparables.
  Only what the member did is drawn, and a week with nothing to show draws no card.
  Its close glyph (16, hit slop 12, as the push reminder's) hides it until next week's recap, remembered per phone, per chapter and week; the screen reads the stored dismissals as it mounts, so a closed card isn't drawn for a frame first.
- **A line of the week card narrows the To do list** to that kind, and reads as selected (accent text; `selected` to a screen reader).
  Pressing it again, or the list's "Show everything", clears it.
  The narrowing is never stored: it lasts while the app stays open and a fresh launch shows everything.
  It ends for good when its line leaves the card (its module turned off, or nothing of its kind left in the week's count, as on a new week), so the list never narrows itself again when the line comes back. Finishing the last item keeps the line, at "3 of 3", and the list says nothing of that kind is left; a list that is empty because its read failed never says that.
  This replaces the filter chips and the remembered chip (#4402): Changed in #4766 by `pdcarlson`, 2026-11-13.
- **"This semester"** (`components/activity/semester-strip.tsx`; `activityStandingGauges`): the member's points, required events, service hours and study time as up to four gauges in one card, two across (four across cut "3h 57m of 4h" short at a phone's width), from [`../../behavior/activity.md` § Standing](../../behavior/activity.md#standing).
  It began as a card of four rows with meters (2026-11-12, Evan's dashboard idea); the gauges are that card in a third of the height.
  A gauge draws a ring only when its number has a target (required events always; points and hours when the chapter sets the member a goal, [§ Goals](../../behavior/activity.md#goals)), full and in the success hue once met.
  A number that is zero with nothing to aim at is left out, and with none left the strip is not drawn ([#4679](https://github.com/pdcarlson/Frapp/issues/4679) item 2).
  A gauge opens the screen that owns its number: Calendar as a tab, and the task board (where the points card is), Service hours and Study hours pushed.
  It is read again whenever the member comes back to the screen.
- **To review** (`components/activity/review-card.tsx`; `activityReview`): what waits on an officer's sign-off, finished tasks to confirm then service hours to approve, as one card with one count, as Google Classroom gives a teacher one "To review" apart from their own work.
  It is drawn only when something waits, so a member, and an officer with an empty queue, sees no card and no zero.
  The week ring never counts it.
  A queue of three or fewer is drawn open; a longer one opens on a press, five rows then "Show all N".
  Open or closed is decided once, when the card first has rows, and after that only a press changes it, so a queue that grows past three mid-way does not close under the officer.
  Its rows carry `Confirm` and `Approve` as below.
- **To do**: the member's own events, open tasks, and unanswered polls, sign-ups and forms, **by day**, as Things' Today and Todoist's Upcoming list them and as this app's Events lists do: Overdue (in the warning hue, never cut), then Today, Tomorrow, each weekday of the coming week, Later, and No deadline.
  A day draws three rows, then "Show N more", so the president's Saturday does not bury Sunday.
  Under a day a row says only its time and an event leads with its glyph; under Later it keeps its date.
  A task says its state only when that is news (overdue, or sent back for changes): "To do" on every row of a list named To do is noise (P3).
  An event the member has checked in to leaves the list.
  The row on the week card is not repeated here, and when it was the only one the section is not drawn.
  With nothing at all it says "Nothing to do right now."
- **Calendar** ([#5310](https://github.com/frapplive/Frapp/issues/5310)): one row under To do that opens the chapter's month (s06), optional events included: the Events glyph in a lead tile in the Events hue (a place, so it keeps one hue), the word Calendar and a chevron. It needs none of Activity's read, so it is drawn while the page loads and under its error too. Calendar folds into Activity this way: the row pushes the month (`router.push("/events")`), which left the tab bar in #5310 step 2.
- **Reminders** (#4957; what is listed is [`../../behavior/activity.md` § Reminders](../../behavior/activity.md#reminders)): the member's reminders on chat messages, a due one first with a `Due` badge. A row opens a sheet like a link's: the message's words, `Open message` (chat at the message, its thread for a reply) and `Done`, then the five presets under `Snooze` (`Change the time` while it still waits). A row whose channel the member lost shows only a note and Done.
- **Waiting on others**, then **Links**: what the member made (the polls they posted, the events they made, the tasks they assigned, by kind, three of each then "Show all N"; open polls and unconfirmed tasks only) and the sign-up links posted for them, from the shared `activityGroups`.
  "Waiting on others" is the old "Made by you" renamed for what the member wants from it, on web too.
  A poll the member posted, while open, and an event they made, once its check-in opens, carry how far along they are under the detail: a thin bar on the week card's line recipe and "41 of 60", said with the title ("41 of 60 voted"), as Google Forms counts responses on its list and GitHub says "2 of 3 approvals" ([#4792](https://github.com/pdcarlson/Frapp/issues/4792); counts in [`activity.md` § Progress](../../behavior/activity.md#progress)). The groove is the card step, not the meter's `--background`, since these rows sit on the screen's floor; a finished count is the success hue. No count, no bar: never "0 of 0".
  Each is left out when it holds nothing, rather than drawn as an empty line, and both step back while the list is narrowed.
- **Gone from the phone, and from web** (Changed in #4766 by `pdcarlson`, 2026-11-13): the "N things need you" headline and its count tiles (#4173), the filter chips and the Needs you chip (#4402), the Now and Later split, and the Coming up group, whose events are now on their days in To do.
  "Needs you" as a name went with them (Paul: not a fan of it).

What else differs from web:

- **Tab 2** since 2026-11-12, whose tab carries the count of things waiting on the member ([`navigation.md` § Tab bar](navigation.md#tab-bar--4-tabs-locked)).
  Before that it was More's first row and went back to More.
  Its title row's **Task board** control pushes the task board (s08), which left the tab bar for it.
- **A row opens a tall sheet drawn with chat's own card** (`components/activity/activity-sheet.tsx` over `components/chat/{task,event,poll,hours}-card.tsx`), the sheet [`patterns.md` § Bottom sheets](patterns.md#bottom-sheets) gives a whole record.
  The sheet stays open after an action, a review included, so the member sees the result; the list is read again when it closes.
- **A poll's Open in chat opens the channel on the poll** (`/chat-thread` with `focusMessageId`), as web's links to its message.
  Until #3926 step 4 it opened only the channel, since the phone's channel screen had no jump to one message.
- **A sign-up sheet, headcount or form row opens no sheet** ([#3926](https://github.com/pdcarlson/Frapp/issues/3926) step 4): it pushes the channel (`/chat-thread` with `focusMessageId`), which scrolls to the card, paging older history for it as the Important strip's jump does, since the card is answered there.
  Its row is web's.
- **An event's Open event opens its event details screen**, where a member with `events:update` edits it.
- **Approve and Reject sit under a pending service entry's card.**
  This sheet is the phone's only place to review hours.
  Reject asks first with the platform's alert and sends no comment, since that alert has no text field on Android; a comment is still web's.
- **`Confirm` and `Approve` are buttons on a To review row, and `Check in` on a To do row**, as on web ([#4437](https://github.com/pdcarlson/Frapp/issues/4437), Shawn, 2026-11-12; Check in [#4427](https://github.com/pdcarlson/Frapp/issues/4427), 2026-11-13; `components/activity/activity-row-action.tsx`).
  They are drawn in the ask's place with its look, and their hit area reaches the touch floor.
  One tap does what the sheet does, through the same hooks and in the same words (`useConfirmTask` with the task card's failure line; `useReviewServiceEntry` with the hours sheet's; `useCheckIn` with the chat event card's): it records the item as read and re-reads, and the row leaves the To review card or the To do list.
  Once its write lands the button reads "Confirmed", "Approved" or "Checked in" and stays disabled until the re-read takes the row away, so a second tap can't repeat it.
  Where each write stands is held by the screen, not the row, so a row drawn again still knows, and the sheet opened from that row shows the approval recorded instead of a second Approve.
  A refusal is the platform's alert, named for the item; one from the plan or the module gate also withdraws the buttons, as a chat card withdraws its controls, until the member comes back to the screen or the app.
  The rest of the row still opens the sheet, where Reject and the record stay.
  To a screen reader the button isn't a second stop inside the row: the row offers it as a named action (swipe up on VoiceOver, TalkBack's actions menu), as the Tasks row offers its checkbox, and a screen reader hears "Confirmed", "Approved" or "Checked in" when it lands.
  These are paid-chapter writes.
  While the plan refuses them (the plan's own verdict, `lib/activity/row-action.ts`), no row draws a button and each opens its sheet, whose card puts the refusal into words.
  Offline, or while the chapter loads, the button is drawn dimmed (offline, the row's hint says why), and a tap on it opens the sheet as the ask did.
  `Vote` stays the row's ask and opens the sheet.
  **`Check in` is on the row of any event the member can check in to now** (open and not yet on the list), a zoned one included, since the phone can send the location web can't.
  The tap asks for the phone's position when the read says the event has a zone (`check_in_needs_location`), as the chat event card does, and otherwise sends the plain check-in; if the server answers that the event needs a location (a zone drawn since the read), it asks then and sends once more.
  A 409 means the member already has a row, which may be an officer's excused or absent mark, so the alert says only "You're already on the attendance list for this event." and the screen re-reads, after which the row shows which.
  A location the member refuses, or a position outside the zone, is the alert in the card's words; once an officer's screen has shown the code, the alert offers Scan code, which opens s18 on that event with its viewport up.
- **Archive is an accent text button at the touch floor** at the foot of the screen, as Show all is ([#5127](https://github.com/frapplive/Frapp/issues/5127), Shawn, 2026-11-15; it replaced #4258's Archived polls). It swaps the screen's body for the Archive, web's ([`../web-dashboard/README.md` § Activity](../web-dashboard/README.md#activity)), until `‹ Activity` or Android's back button takes it back; pull to refresh re-reads the Archive while it is shown. Its rows open the same sheets.
  There are no file rows any more ([#4291](https://github.com/pdcarlson/Frapp/issues/4291)), so every row opens a sheet.
- **A refusal is a line under the card**, since the phone has no toast.
- **A sign-up link opens a sheet, not the link.**
  Every other row opens a sheet, and a phone row has no room for web's Done and `⋯` beside it.
  The sheet names the link (its page's name when the API read one, else its kind; with a name, the kind leads the line under it, #4187), who posted it where, and its address, then **Open link** (the in-app browser, as a link tapped in chat), **Done**, **Hide**, **Open in chat** (a thread reply opens its thread) and, for a `channels:manage` holder, **Remove for everyone**.
  Done, Hide and Remove close the sheet and float the tasks board's "· Undo" bar for five seconds; a failure is the platform's alert, since the sheet has already gone.
- **The row's lead (the face of who a row is from: [#4463](https://github.com/pdcarlson/Frapp/issues/4463), 2026-11-12), the detail line's "closing soon" phrase in the warning hue (#4463), the ask and the unread dot are web's** (the dot: [#4405](https://github.com/pdcarlson/Frapp/issues/4405), 2026-11-12; a screen reader hears "Unread:" before the title), with these phone differences.
  A row's title may take two lines (web's takes one), since at a phone's width one line cut most task names short; its detail stays one line, as web's and the Events list's do, and is read in full to a screen reader (the week card's Next row may take two, so "Due in 2 hours" is never cut).
  Rows are **flush on the screen background, split by hairlines**, as the phone's Events and Tasks lists draw theirs, not in a rounded card ([#4138](https://github.com/pdcarlson/Frapp/issues/4138)'s pick); the week card's row and the To review card's rows sit in their card.
  A section's count is a separate muted number after its caption, and a "Couldn't load …" line is in the warning hue.
  The ask (`Vote`, `Confirm`, `Approve`, `Check in`) uses the tinted recipe (the chapter's subtle accent fill, border and text) at a badge's height, filled only on the week card.
  **Show all N** and **Show N more** are accent text buttons at the touch floor.

### s01 Sign-in

Route: `(auth)/sign-in.tsx`.

Live — the house-gold mark over the `Frapp` wordmark and the `Everything your chapter needs is already in chat.` tagline ([`../design-system/writing.md`](../design-system/writing.md#7-approved-state-microcopy) § 7, the Sign-in `Idle (mobile s01)` row, which says why it is not the brand tagline).
The board's s01 still draws "Ask your chapter anything."; that line is superseded, not drift to restore from the board ([#2298](https://github.com/pdcarlson/Frapp/issues/2298)).
One surface, no card (#3349): the mark, wordmark and tagline over a straight stack of three drawn product cards (`components/auth/sign-in-moments.tsx`, decorative; untilted on purpose, since a fanned stack read as staged), with the actions at the bottom.
The phone's own account leads as the one filled button (Apple on iOS with Google beside it; Google elsewhere, with Apple behind `Other ways to sign in`, `signInProviderLayout` in `lib/auth-providers.ts`), then `Continue with email`, which opens the password / magic-link form at the top of the column.
The column sits in a `KeyboardAvoidingArea` ([`patterns.md` § Keyboard avoidance](patterns.md#keyboard-avoidance)), which pads it by the keyboard on Android, so on a short screen the form scrolls instead of sitting under the keyboard (#3346).
The Hide My Email membership hint sits under the buttons wherever a Continue with Apple button is showing.
Android's back button closes the email form rather than leaving the screen.
The column scrolls under a safe area: folded it fits a 6.1" phone, and a smaller screen or the open form scrolls rather than clipping (before 2026-09-22 a centred non-scrolling column left "Sign in" below the bottom edge of a 375×667 screen).
The board's s01 layout (email and password up front, then `or`, then Apple) is superseded by this one, owner-approved 2026-11-04 (#3348), not drift to restore from the board.
Renders nothing (not the form, and no redirect) when already authenticated, rather than jumping to `(tabs)`, so the auth gate owns the next hop and s03 stays reachable

### s02 Join chapter

Route: `(auth)/join.tsx`.

Live — an authenticated session with zero memberships is routed here.
One surface (#3350), with a card only for the one object on the confirm step: it asks `How are you getting in?` with two large answers, and above them, when no invite link opened the screen, one row per pending invite emailed to the account (`GET /v1/invites/mine`, #3782), which opens the confirm step on that invite.
`I have an invite` opens the invite step on the same route, and `I'm starting our chapter` opens `(auth)/create-chapter` for first-officer creation.
The invite step is invite-token entry plus invite-link autofill (`?token=` / `?invite=` / `?code=` / `frapp://join?token=`).
Canvas draws six cells for a shared code; joining is single-use invite tokens ([`../../behavior/onboarding.md`](../../behavior/onboarding.md)), so the field accepts a pasted token or URL.
The step carries the Hide My Email membership hint, and its pinned `Continue` opens the confirm step (#3352), where an opened link lands directly: `Join <chapter>?` over one card with the chapter mark, name and school, the inviter and the role, read by `POST /v1/invites/preview` without using the invite up.
A preview that can't be read for any reason but a dead invite leaves a card for the bare invite, which still joins; a dead invite (410), whether the preview or the redeem finds it, says so and disables `Join chapter`.
A user who hasn't accepted the current Terms sees the shared Terms checkbox there and can't join until it's ticked (#2302); one who has isn't asked again.
`Join chapter` is pinned above the keyboard and the inset.
A house-gold `‹ Back` row, and Android's back button, step back one view: confirm to the field (the invite kept), then the field to the question; from an offered invite's confirm step, straight back to the question, with whatever invite the field held before the offer put back.
The board draws the invite field as the whole screen, with `Join chapter` under it; the question in front of it, and the confirm step after it (with `Continue` on the field), are owner-approved (2026-11-04, #3348 and #3352), not drift.
Every view shows `Signed in as <email>` with `Sign out` under its header (#3782), and a destructive **Delete account** control sits in the Account menu in the top corner, on every view: this is the screen a zero-membership account is pinned to, and the only surface reachable in that state that offers deletion (`/create-chapter` and `/chapter-picker` are also permitted while the gate reads `join`, but neither deletes an account), so it is where Apple 5.1.1(v) is satisfied for that state (#2295, [`../../behavior/data-retention.md`](../../behavior/data-retention.md)).
Under the two answers, one quiet line, `Already in a chapter? Use a different account`, signs out in one tap for someone who signed in with another account than the one they joined with.
It shows only when the gate sent the account here (never to a member who opened Join from the picker), no invite link opened the screen, and the emailed-invites read answered with none.
It replaced the `New account created` card (#4769) on 2026-11-15.
Copy: [`writing.md` § Already in a chapter](../design-system/writing.md#already-in-a-chapter-pre-auth).

### s03 First-run + notifications

Route: `(auth)/welcome.tsx`.

Live — up to five beats on one route, then chat with the first-run tour over it ([`onboarding.md` § Behavior](../../behavior/onboarding.md#behavior)).
Nothing is drawn while the profile and push reads come back (given up on after 4 seconds); a member with a photo, a real name, push on, Frapp AI answered and no role to join sees only the display beat.
The `You're in.` card that opened s03 (the chapter, its school and the auto-joined channels) was removed on 2026-11-07; the tour's first stop says it over the real channels.
First, only when the member has no photo or no real name yet: `How the chapter sees you`, the profile photo control and a `Your name` field ([`writing.md` § Profile step (mobile s03)](../design-system/writing.md#profile-step-mobile-s03)); the photo is optional, the name is required when there isn't one, and a changed name is saved (`PATCH /v1/users/me`) before the beat moves on.
Second, for every member: `Pick your chat display`, Settings' three Chat density cards with the phone's current display preselected, Cozy on a fresh phone (#3787, [`writing.md` § Display step (onboarding)](../design-system/writing.md#display-step-onboarding)).
Third, only when the chapter has a role the member can join and the read is back as they leave the display beat: `Pick your roles` ([`../../behavior/rbac.md` § Self-assignable roles](../../behavior/rbac.md#self-assignable-roles), #4958, [`writing.md` § Pick your roles](../design-system/writing.md#pick-your-roles)), the Add roles sheet's switches, each saved on the tap, over a gold `Continue` (`Go to chat` when no beat follows) that waits while a pick is saving.
Fourth, only when the server has AI on and the member never answered it: `Meet Frapp AI` ([`../../behavior/ai.md` § Consent](../../behavior/ai.md#consent), #4790), its three lines and the companies line over a gold `Continue` and a quiet underlined `Not now`; either answer moves on, and a Continue that fails to save keeps the member here with the reason.
Fifth, only when the build can push and push is off ([#2299](https://github.com/pdcarlson/Frapp/issues/2299); [`patterns.md`](patterns.md#push-notifications) § Push notifications): `Turn on notifications`, with its three rows and the gold `Turn on notifications` (or `Open Settings` when no OS prompt can appear) over a quiet `Not now`, both pinned above the inset;
Android's back returns to the beat shown before it (Meet Frapp AI, then roles, then display, then profile, skipping any not shown).
Either answer leaves for chat, PATCHing `has_completed_onboarding` (#3352).
The notifications beat was a card under the channels until 2026-11-07, which the board drew with `Go to chat` outlined beside it; it is its own step now so every member decides.
The auth gate sends a member here when that flag is false.

### s04 Chat — channels (landing)

Route: `(app)/(tabs)/index.tsx`.

Live — chat is home, so the screen is titled by the chapter, its mark and name (`ChapterMark`, [`../../behavior/branding.md`](../../behavior/branding.md) § Chapter mark), not by the word "Chat".
The board draws no title there, and [`navigation.md` § Tab bar](navigation.md#tab-bar--4-tabs-locked) records the departure.
Real channel list on `GET /v1/channels`, with, above the UP NEXT strip, the **While you were away** card (#5464, 2026-11-18; Paul picked the Chat tab over Messages, which holds only direct messages; `lib/chat/use-chat-away.ts`): after eight hours or more off Chat (the last visit is kept on the phone per member and chapter, read when Chat comes into view, on focus or when the app returns to the foreground on it, and written again every few minutes while it shows), up to three channels with something newer than the member's last visit: a mention first (most mentions first), then the announcements channel, then the busiest, skipping a muted channel unless the member was named, and every plain channel while the muting is still unknown. Each row is a tile in its kind's colour (mention red, announcements house gold, a busy channel info blue), the channel, and its last message as the channel list draws it (`channelPreviewLine`). Only a mention row carries a count, the red badge; a plain unread channel carries no number ([`../design-system/foundations.md`](../design-system/foundations.md) §5). It opens on the channels it found and keeps to them, so it leaves once they are read, or on its close mark, and never fills back up; a chapter switch drops it, and it waits out the launch jump as the checklist does. It has no generated words, so it reads the same with or without AI. Slack's catch-up and Activity are the comparables. Then the UP NEXT strip, an officer's setup checklist under it ([`../../product/modules.md` § Setup checklist](../../product/modules.md#setup-checklist)), then, for a member whose push is off, one `Notifications are off` reminder row ([`patterns.md`](patterns.md#push-notifications) § Push notifications), then, in the title row, the Search round (#5139, 2026-11-16, where the Threads button was; it pushes the Search screen, [`navigation.md` § Search](navigation.md#search)), then the inbox's bell (the Messages door sat between them from 2026-11-07 until #5310 made Messages the third tab; the ✦ Ask pill sat there until 2026-11-12, and Ask is the bar above the tab bar since #4702, s17) with its house-gold count (#3839; from 2026-11-07 until then the member's avatar with a Status, Profile, Notifications and Settings menu, which became the You tab; the board draws neither, [`navigation.md` § Global entries outside the tab bar](navigation.md#global-entries-outside-the-tab-bar) records them), and server unread/mention badges.
Under each channel row sit its active threads, indented with a connector as Discord's channel list draws them, and nothing under a channel with none (#5277, 2026-11-17; until then the list opened with an always-drawn Threads row and sheet, #5139) ([`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Message threads).
The list holds channels only; direct and group messages, and Hidden conversations, are on the Messages screen (2026-11-07).
Channels are grouped by chapter category (#1684): Pinned, then Channels (anything unfiled), then one section per category in the server's order.
Empty sections are omitted.
Headings are sentence case with a drawn chevron at the right edge (2026-11-07); for `channels:manage` the Channels heading and each category heading also carry a + before it that opens the New channel sheet in that section (#3838, as Discord and Slack draw it).
Changed in [#4679](https://github.com/pdcarlson/Frapp/issues/4679) by `pdcarlson`, 2026-11-13: the chevron sits beside the section's name, as Slack and Discord draw a section's fold, and the whole heading still folds; the + is the last thing on its heading, its glyph's right edge on the gutter, so it runs in one column down the list. Until then the filter took the far right of the first heading, which put that heading's + and chevron one slot left of every other heading's.
Each member arranges the list (#2877, [`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Sidebar arrangement): rows inside a section sort by the member's Sort, the chapter's order by default;
a header tap folds its section, and a folded header keeps its unread badge; a Sort (Chapter order, Recent, A–Z; #2877) on top and Unread only and Hide muted as two switches below it, in a menu behind the filter button on the first section heading (`Sort and filter channels`: left of that heading's + for someone who has one, and at the heading's end otherwise, #4679), which shows a dot in the chapter accent while one is on, with a line under the heading saying so and a Show all that clears both (2026-11-06; they were two chips above the list); the menu's right edge sits under the glyph's;
every row is one line, the name and its badge, with no preview and no time (owner 2026-11-07, after a day of previews: [`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Channel list previews), and a read name is grey and an unread one white and bold (it stayed bright from 2026-11-07 until #4147, 2026-11-11; [`../design-system/components.md`](../design-system/components.md#sidebar-item) § Sidebar item, "Mobile channel rows");
each section heading pins at the top while its rows scroll under it ([`../design-system/components.md`](../design-system/components.md#sidebar-item) § Sidebar item, "Pinned section headings", 2026-11-07);
a muted row stays in place, its name drawn dim unless it addresses the member, its count badge kept, with a crossed-out speaker after its name (web's `MuteGlyph`; a bell until #4738);
a long press taps (`pressHaptic`) and opens the row's own glass menu beside it (`components/chat/channel-actions-menu.tsx`, owner 2026-11-06, in place of the system alert it used to open): Mark as read on an unread row, Pin to top or Unpin from top, Notifications (opens the three levels in the menu), and for `channels:manage` Edit channel (a sheet: name, description, category), Arrange channels (the Arrange channels screen, `(app)/arrange-channels.tsx`: drag a channel by its handle, #3838) and Delete channel (a sheet that asks for the channel's name typed exactly), the rule web's right-click menu reads ([`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Sidebar arrangement, "Row menu").
The row carries Channel actions, Pin and Hide as named accessibility actions.
The rules are `groupChannelsByCategory` and `arrangeChannelSidebar` in `@repo/hooks`, which web's rail also uses.
DM rows resolve the other participant from `member_ids` against the roster projection, so no row shows a uuid

### Messages

Route: `(app)/(tabs)/messages.tsx`.

Live (2026-11-07, owner decision; the board draws no such screen) — the member's direct and group messages, **tab 3** since #5310 (2026-11-17, Paul's direction B; [`navigation.md` § Tab bar](navigation.md#tab-bar--4-tabs-locked)), so it draws no back row. The tab's badge counts conversations with anything unread in mention red ("Messages, 2 unread conversations"). Until #5310 it was a pushed screen (`‹ Chat`) behind a door on Chat home and a swipe left on it (#3774).
Under a group DM's row sit its active threads, as under a channel on Chat home (#5277, 2026-11-17); search results draw none.
A DM the member pinned leads (pins are shared with web), then newest conversation first by its latest message (`GET /v1/channels/latest`, the list waiting on its skeleton until that answers so it never reorders under a thumb), each row the other member's initials, their name, the badge (mention red for anything unread, since a DM addresses the member) and the last line under it (`channelPreviewLine`, [`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Channel list previews), held blank while it loads;
no time.
Changed in [#5519](https://github.com/pdcarlson/Frapp/issues/5519) by `pdcarlson`, 2026-11-18: each row says when its last message was sent at the end of the name line (`formatConversationTime`: "4:46 PM", "Yesterday", "Friday", "Nov 6"), the badge moves to the end of the last line under it, and the member's own last line leads with a sent check or a read double check in the chapter accent in place of "You:" (WhatsApp's inbox; [`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Read Receipts → Shown to the sender). Settings › Chat adds the Read receipts switch under Chat density.
A long press on a 1:1 DM offers Hide conversation (#2303); hidden ones sit behind a Hidden conversations toggle at the end, and opening one unhides it.
A search field heads the list (#4668, asked by Shawn 2026-11-12), drawn while the list loads and after it fails too, the Directory's `SearchField` with its magnifier, reading "Find or start a conversation": a name narrows the screen to the member's matching conversations (a group DM on any member's name), then everyone else it matches under a **Start a conversation** heading, drawn as the same rows with no last line;
tapping one opens your DM with them through `POST /v1/channels/dm`, creating it, or reopening one you hid, and a failure says "Couldn't message <name>" in an alert as the member sheet's Message does.
Who is offered and the order are web's people search exactly ([`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Direct Messages, `searchDirectMessages` in `@repo/hooks/dm-search`): never a member you blocked, and no member until the block list is read, which a line under the rows says, with Try again when the read failed;
a roster still loading, waiting for the network or failed says so the same way, never "no one matches".
Equal matches are newest first, without the list's pins, as on web.
One start runs at a time, and one that finishes after the member picked something else or left Messages opens nothing; a tap on a result works with the keyboard up.
Comparable apps: Instagram's and iMessage's inbox search.
The pencil at the top right focuses that field, as iMessage's and Instagram's open a "To:" search (until #4668 it opened the Directory), and an empty list says "No messages yet.
Search for someone above to start one."
`lib/chat/messages-screen.spec.tsx`

### s05 Chat thread

Route: `(app)/chat-thread.tsx`.

Live — real messages on `@repo/chat-core`: realtime, optimistic send, outbox retry/discard, reactions, typing, card messages (`components/chat/`, on the shared `ChatCardShell`): poll voting (`PollCard`, #528), sign-up sheets drawn as the poll card is, a tap on a slot taking it, with who holds which, or a headcount's Going / Can't make it with a note on the viewer's answer, an optional end time, and Close sign-ups and Export (a CSV to the share sheet, #3926 step 4) for its creator or a `channels:manage` holder (`SignupCard`, #3926, opened from the + sheet's Sign-up sheet row as the New sign-up sheet, `components/chat/new-signup-sheet.tsx`, with a Sheet | Headcount switch and an Ends at a set time toggle on s19's date and time pickers; [`integrations.md` § Sign-up sheet cards](../../behavior/chat/integrations.md#sign-up-sheet-cards)), event and task cards (#3185) with inline Check-in and the task lifecycle actions, the read-only points, service hours (with the entry's live review status), announcement cards, `#chapter-audit` entries as one-line audit lines (no card since 2026-11-06, [`../design-system/components.md`](../design-system/components.md) §11), and the recruitment candidate card with inline Vote and Extend bid under the chapter's own word for recruitment (#3383), on web's rules (`@repo/chat-core/cards`, `taskCardControls`, `service-entry-card.ts` and `rush-card.ts` in `@repo/hooks`);
form cards with Fill out or Edit your answers, opening a full-screen page over the thread, and for the form's creator Responses, a page of the same kind with a Summary
Role picker cards (#4958, `components/chat/role-picker-card.tsx`): the officer's title, then each listed role with Join or Leave for the viewer, or "No longer open to join"; an officer who manages roles posts one from the + sheet's New role picker (`components/chat/new-role-picker-sheet.tsx`); [`../../behavior/chat/integrations.md` § Role picker cards](../../behavior/chat/integrations.md#role-picker-cards).

**`@Frapp` asks Frapp from the channel** (added in #4713 by pdcarlson, 2026-11-13; [`../../behavior/ai.md` § Asking from a channel](../../behavior/ai.md#asking-from-a-channel)).
For a member with Ask the composer's `@` list offers Frapp as its first row, with the crest in the chapter accent on the accent's tint where an avatar goes (`components/chat/mention-picker.tsx`; the row's look is [`../design-system/components.md`](../design-system/components.md)'s).
While the draft names `@Frapp`, the typing line's slot above the composer reads "Only you will see this question and Frapp's answer.", so nothing moves, and the send button is named Ask Frapp; no typing ping is sent for such a draft.
Send asks instead of posting; a refusal (photos attached, no question, too long, still answering) is the composer's hint line in the error tone, and the text stays. The line goes when the draft changes or when what it was about does (the photos come off, the first answer finishes).
While the app does not yet know whether the member has Ask (its reads are in flight, or failed), a message naming `@Frapp` is held the same way, "Still checking Ask Frapp. Try again in a moment, or take @Frapp out to post this.", and never posted.
The answer is drawn under the message that was newest when it was asked (`components/ask/ask-in-channel.tsx`; [`../design-system/components.md`](../design-system/components.md) §11 owns the row), for this member alone, with Dismiss; it is the same turn the Ask sheet (s17) shows, since both read one conversation held above the screens (`lib/ask/ask-conversation.tsx`).
The list's `renderItem` does not change when an answer arrives: each row reads its answers from a small store (`useAskTurnsPlacement`), so no message row is drawn again.
A source opens as it does from the Ask sheet, and Report and Meet Frapp AI open as sheets over the channel.
Not while editing a message, and not in a thread: the thread screen refuses a reply that names `@Frapp` with "Ask Frapp from the channel, not from a reply." in its hint line and keeps the words.

**A long press on Send schedules the message** (added in #4956, 2026-11-14; Shawn asked; [`../../behavior/chat/README.md` § Scheduled messages](../../behavior/chat/README.md#scheduled-messages)), as Slack's phone app does, and a screen reader gets "Schedule message" as an action on Send. It opens Schedule message (`components/chat/schedule-send-sheet.tsx`): the draft (or "2 photos" when there is no text), then Tomorrow and Monday at 9, then Custom time with the platform's date and time pickers. Uploaded photos and a staged reply go with it (#4971). A photo still uploading or one that failed, a draft naming `@Frapp`, or offline still opens it, with the reason and the rows greyed, and the draft stays. The draft clears on the tap and comes back if scheduling fails. While the member has messages scheduled in the channel, a caption line above the input says how many and when the next goes ("2 scheduled messages · next tomorrow at 9:00 AM", with "· 1 not sent" in the error tone); a tap opens the Scheduled list, a tall sheet where each row has Edit (text and time, in place), Send now and Delete (`components/chat/scheduled-messages-sheet.tsx`). Not while editing a message. In a thread (#5005) the same long press schedules the reply into that thread, and the line lists that thread's scheduled replies alone; offline a thread doesn't offer it, since its Send is off (a reply has no outbox).

### s06 Events list

Route: `(app)/events.tsx`, a pushed screen (`‹ Activity`), opened from the Calendar row at the foot of Activity's To do; one day's hour grid is `(app)/calendar-day.tsx`.

Live — titled **Calendar** since 2026-11-12 ([#4610](https://github.com/pdcarlson/Frapp/issues/4610); the route stays `events`, so links and notification targets keep working), on real `useEvents()` data.
The screen is the month and the picked day's list under it, with nothing above the month but its own row (`‹`, the month and year, `›`): no switcher and no chips ([#5310](https://github.com/frapplive/Frapp/issues/5310) step 2, Paul 2026-11-17: "I hate the calendar page ... the list and the calendar and like all of those options ... bars up top is not great"; [`../design-system/README.md`](../design-system/README.md), no view switchers).
*History:* until #5310 step 2 it was the third tab, a **List** (#3707) and a **Calendar** under a List | Calendar switch, the Calendar a Month, 3 days or Day under a second switch (#4818), with chips that switched each kind off (#4144, #4959). They went because Paul found the stack of bars clunky and Activity's To do is the list now; the 3 days range went with its switch, and Day survives as its own screen.
**The month** (#3792): a grid (`@repo/formatting`'s `monthGrid`: weeks from the Sunday on or before the 1st, as web's grid draws them, though web's `buildMonthGrid` is still its own copy; the weeks at the end with no day of the month are left off, so the phone's month is four to six weeks tall) that writes each day's events by title in its square, every occurrence of a series on its own day (#4987, Shawn, 2026-11-14: "I can't really read anything. I have to click on stuff or go to other views"; option B of the [proposal page](https://claude.ai/artifact/LpDY5WXz2y98CdnzUFMaRY), from Apple Calendar's detailed month and Google Calendar's phone month). A square holds two titles, events in order of start and then the day's birthdays, keeping one for a birthday when the day has one; each is a one-line 11pt chip ending in an ellipsis (below the 12.5 caption role on purpose: at 12.5 a title shows five letters). An event required of the viewer and a birthday take the chapter accent. One line under them folds the rest into `+N` and counts the tasks due (`2 tasks`, or `Overdue` in the destructive text hue); with no task and one title over, that line is the third title. A day of the month before or after draws all of it dimmed. A day's spoken label names every event and birthday on it, not only those its square has room for (`lib/events/month-cell.ts` holds the summary).
Chevrons or a sideways swipe turn the month, and the chosen day's events list under it (`components/events/events-calendar.tsx`). Until the member moves it, the calendar follows the clock to today's month and day.
**The picked day** takes a written-out heading (Today, Tomorrow, the weekday inside the week, then November 14: `formatDayHeading`), in sentence case, caption / 600 in the foreground tone (`DayHeading` in `components/list-section.tsx`), with a chevron after it: pressing it pushes that day's hour grid (below), as Apple Calendar's month opens a day. Under it the day's events sit flush on the background, hairline-split, each the one row anatomy ([`patterns.md` § Rows](patterns.md#rows)), the row Activity's To do draws for the same event: the Events glyph in a 40pt lead tile, the name in the label role (a series with its cadence after the name, "Chapter · Every Sunday", `seriesCadenceOf`), the meta line (time, place, points written out), Mandatory, then the drawn chevron of a row that opens (`EventRowFlat`, `components/events/event-rows.tsx`, #4679). Mandatory is the hairline chip (`HairlineChip`) when the event requires this member ([`events.md` § Attendance by role](../../behavior/events.md#event-creation)), as web's list draws it (#4132).
**Every kind shows, always.** Under the day's events: the member's own tasks on their due day and the tasks they assigned (#4144), and members' shared birthdays all day (#4959), read through `useCalendarItemsByDay` (`lib/events/calendar-items.ts`; the rules are `@repo/hooks/calendar-tasks`, which web's calendar reads too). A task leads with a round mark for where it stands in the 40pt lead tile (an empty ring to do, red when overdue; a ring with a check waiting on an officer; a filled green check confirmed), so a day's events and tasks share one text column (`CalendarTaskRow`). One task handed to many members is one row, `Assigned by you · 8 of 20 done`, which opens in place to list each assignee and their status (`DisclosureGlyph`: right while hidden, down while shown); the member's own task, and one they handed a single member (since #5492), ends in the chevron of a row that opens and pushes its screen ([§ Task](#task)). A birthday is a cake in the lead tile, their name and "Birthday".
**A long press** (#5492, [`patterns.md` § Long-press item menu](patterns.md#long-press-item-menu)) on an event row opens Edit, Duplicate and Delete for a viewer the API lets use each (`useEventMenu`): Edit opens Edit event over the Calendar, the sheet s07's pencil opens; Duplicate opens New event filled in from it as a new one-time event, moved on by whole weeks if it has started; Delete asks as the Edit sheet's Delete does, this one or all upcoming on a series. On a task row it opens the task's menu (`useCalendarTaskMenu`, as on [§ s08](#s08-tasks--points)), by [`tasks.md` § Long press on the phone](../../behavior/tasks.md#long-press-on-the-phone), which also says what a row for every copy of a group task offers. The day screen's event blocks, its All day chips and its task chips take the same menus.
With nothing current or upcoming in the chapter (a chapter whose events are all past included), the day list is one line where the rows go, `Nothing scheduled yet. Tap + to add the first event.` (a viewer who can't create reads only the first sentence; empty-states plan rule 7, 2026-11-07); otherwise an empty day reads `Nothing on this day.`
**The day screen** (`calendar-day.tsx`, titled with the day written out, `‹ Calendar`; its `day` param is the local day, `YYYY-MM-DD`, and a missing or malformed one draws today): one day's hour grid, drawn as web's Day is (`components/events/events-time-grid.tsx`, placement from `@repo/hooks/calendar-time-grid`), with 48pt hours opened scrolled to 8 AM, each timed event a block at its start and as tall as it lasts, events that overlap side by side, an All day strip for the day's tasks, birthdays and any event of 24 hours or more, and a red line at the time now when the day is today, from the same ticking clock. A viewer who can create events taps an hour that isn't over to open New event starting then (`calendarHourStart`).
The header carries **Subscribe** (#3322) and, for a viewer who can create events (`events:create`, plus the `members:view` the events controller also requires), a round **+** after it, its glyph in the chapter accent (#5113, shawnatomklein-eng, 2026-11-15), as Apple Calendar and Fantastical put add at the top right. It opens the New event sheet starting on the picked day at the sheet's usual 7 PM, or, for today once 7 PM has passed, at the next quarter hour rather than the sheet's roll to tomorrow (`pickedDayStart`); with a past day picked it takes the sheet's own default. The tab bar's quick-actions + offers New event too ([`navigation.md` § Quick actions](navigation.md#quick-actions)), but a member can take it off their panel, so the screen doesn't rely on it.
While "This time last year" has events waiting for this officer, one row at the foot of the screen (`components/events/suggested-events-entry.tsx`, "2 events from this time last year") opens the Suggested list (2026-11-12, #3930).
The + opens the New event sheet (`components/events/new-event-sheet.tsx`, no Canvas screen; owner ask 2026-11-06): name, Starts and Ends as one grouped field the way Calendar sets them (day and time from the platform's own pickers, `@react-native-community/datetimepicker`: the compact pickers on iOS, the system date and time dialogs on Android), and a place, as `/event` creates events.
A hand-drawn grid was tried first and dropped the same day at the owner's word.
Moving the start moves the end with it.
Who's coming by role, points, how many minutes early check-in opens (default 10, #3703), Repeat, a description and notes (#4934) sit behind More options; only the check-in zone stays on the web editor.
Checks run on Create, not per keystroke, and refuse a start that has passed.

### s07 Event detail

Route: `(app)/event-details.tsx`.

Live — reads an `id` param; **filename contract, never rename**.
No RSVP control: no RSVP model exists server-side ([`../../behavior/events.md`](../../behavior/events.md)), so the drawn row is omitted.
It used to render disabled; removed under Guideline 2.1 (#2300), and returns with the endpoint (#1035).
AGENDA and ATTACHMENTS sit below DETAILS, then the event's notes, labeled NOTES (MEETING MINUTES while the meetings module is off), as web's sheet labels them; every member the event invites reads all three, so none is called internal (#4934, [`events.md` § Agenda and attachments](../../behavior/events.md#agenda-and-attachments)). An `events:update` holder edits the agenda and attachments in place on this screen; the New event and Edit event sheets carry a Notes field under More options.
An occurrence of a repeating series lists the series' other upcoming dates under its cadence ("EVERY SUNDAY"), each opening that occurrence (#3707), since the list draws a series once; an occurrence renamed on its own carries its name there.
**Editing:** a viewer with `events:update` (plus `members:view`) gets a pencil in the back row for any event, not only their own; it opens the New event sheet as "Edit event", filled in, with Delete event at its foot for `events:delete`.
A repeating event asks on save, in the platform alert, "This event only" or "All upcoming events" (a Repeat change is always the series; an event already under way edits and deletes only itself, since a series write never reaches a started event; an occurrence whose parent can't be read edits only itself but still asks on delete, which needs no parent; an "All upcoming events" save the server refuses says what to do instead and keeps Save);
a series time change from a generated occurrence is sent to the parent as the same shift.
Only changed fields are sent.
After a series save that rebuilds the occurrence on screen, or a delete, the screen returns to Events (`lib/events/edit-event.ts`, sharing `event-edit.ts` in `@repo/validation` with web).
**Check-in card (#3703):** before the window it says only "Check-in opens at 7:50 PM" (with the day when it isn't today);
a viewer who may host (`events:update`) gets Host check-in (s22) as the card's button, from before the window opens, with a quieter "Check myself in" under it while the window is open and they aren't in, which checks them in right there with no code (2026-11-17; it used to open s18 to type the code their own screen showed);
a member who has checked in sees "Checked in at 7:52 PM" and the points instead of the camera line, and one an officer marked sees "Marked excused" (or absent, present) and no check-in, while a guest sees one line saying to scan the officer's code here or with the phone's camera and Scan code as the card's button (2026-11-17; a quieter link before), which opens s18 with its viewport up (2026-11-13), read from their own row (`GET /v1/events/:eventId/attendance/me`)

### s08 Tasks + points

Route: `(app)/tasks.tsx`.

Live — a pushed screen since 2026-11-12, no longer a tab ([#4610](https://github.com/pdcarlson/Frapp/issues/4610), [`navigation.md` § Tab bar](navigation.md#tab-bar--4-tabs-locked)): it goes back to Activity and draws its own floating + for New task. real `useTasks()` rows filtered to the viewer, grouped TODAY (overdue first) / THIS WEEK / LATER (#4295 step 5, 2026-11-15, by the shared rule in [`tasks.md` § Views](../../behavior/tasks.md#views); DUE THIS WEEK / LATER until then), each heading only when it has a task, as flush, hairline-split rows rather than a card per task (owner pick 2026-11-05, matching web's lists) (Changed in [#4582](https://github.com/pdcarlson/Frapp/pull/4582) by shawnatomklein-eng, 2026-11-12: the rows stay the default List, and a Grid of task cards is offered beside them), with the absorbed points balance + house rank card.
A List / Grid round at the title row's trailing end ([`components.md` § Segmented control](../design-system/components.md#segmented-control), #4175; a segmented control until 2026-11-17) lays each group's tasks out two to a line as cards, each the row stood on end (the box and points chip over the title and due line), with the row's two targets: the box completes, the rest pushes the task's screen ([§ Task](#task)), where an officer's Edit sits.
**A long press** on a row or card (#5492, [`patterns.md` § Long-press item menu](patterns.md#long-press-item-menu)) opens the task's menu (`lib/tasks/use-task-menu.tsx`): Mark done or Mark not done, Edit, Reassign, Remove people, Duplicate, then Delete and Delete for everyone, red and last. Who gets which is [`tasks.md` § Long press on the phone](../../behavior/tasks.md#long-press-on-the-phone)'s; Edit and Reassign open the Edit task sheet (Reassign with Assign to's picker over it), Remove people the task's screen in its select mode, Duplicate New task filled in from the task, and the deletes ask first, as on the task screen.
New task (s19) opened only from the tab bar's quick actions from 2026-11-06 until the board left the bar (#4610); it now also opens from the board's own +, which confirms a create in a line under the points card ("Added to your tasks." or "Assigned to Sam.").
With nothing assigned, the board is one line under the points card: `Nothing on your plate.`, then `Next up: {event}, {when}.` when Events is on and an event is ahead, then ` Tap + to assign a task.` for a holder of `tasks:manage` and `members:view` ([`writing.md` § Tasks](../design-system/writing.md#tasks-dashboard), 2026-11-07).
Completing a `TODO` is two writes: the server has no `TODO → COMPLETED` transition

### Task

Route: `(app)/task-details.tsx`, with an `id`. It has no link of its own to copy or share: the web has no page for one task yet, so a phone-only link would read as dead text in chat.

Live — one task as a pushed screen (#5492, Paul, 2026-11-18: "I'm not a super fan of the sheet that pops up when you do tap on a task. I think that's lazy"), where the task detail sheet rose until then. Built like s07: `ScreenShell`, the task's title, `‹ Tasks`. It opens from a row or card on the board, from the Calendar's task rows, and from a task push through the board (`/tasks?task=<id>`, which pushes it once the board's read holds the task).
Top to bottom, each part drawn only when the task has it, so a one-line task is a short screen: the status as a colour chip in the shared words (`taskStatusLabel`, the hues of the chat task card); a row of three facts, Due (red when overdue), Points (green once awarded) and From, as Linear's issue page lists them; on a group's copy where Who has it doesn't show, For on a line of its own: who it went to and how far its copies are ("Everyone in Philanthropy · 2 of 6 done", `taskGroupLabel`) over a meter (`components/meter.tsx`, the accent, green once all are done); the description, selectable; the checklist; the photos and proof (`TaskProof`); for a `tasks:manage` holder on a task for everyone, **Who has it**: each member's face, name and their copy's status, who it went to and "3 of 12 done" under the heading ("Everyone in Philanthropy · 3 of 12 done") over the same meter, overdue and to-do copies first, collapsed to five with "N more" that opens the rest in place (the copies are read off the board's `GET /v1/tasks`, which holds the chapter's every task for an officer); then **History**, lines read off the task's own timestamps (Assigned by, Marked done with no name since the read doesn't say who, Sent back with its reason, Confirmed), as Todoist's task page lists its activity.
Its controls float at the bottom in a glass bar, as Things 3 keeps a to-do's (`components/tasks/task-action-bar.tsx`): **Mark done** (`markDoneLabel`, "Mark done with a photo" where proof is asked) is the one thing to do and the screen's only chapter-accent control, a pill with a check and its verb, shortened to "Mark done" beside two or more rounds so it never truncates on a 320pt phone (the proof it asks for is then its spoken hint, and its sheet asks for it first); **Edit** (pencil), **Remove people** (minus, a group's copy only) and **More** (ellipsis) are ghost rounds at the 44pt touch step with spoken labels. More opens the system action menu: Mark not done when the assignee may take it back (`canReopenOwnTask`), Give it back on a task they took from Up for grabs until it is done, Delete (this copy), and Delete for everyone last on a group's copy; never more than three, which Android's dialog can draw. More shows only when it holds something, and the bar only when it holds a control. Each control shows only to a viewer the API lets use it: Mark done the assignee or `tasks:manage` (and only on a status this build can move), Mark not done the assignee, Edit (not once confirmed), Remove people and the deletes `tasks:manage`. A member's own open task shows Mark done alone.
Mark done and Mark not done are the board box's moves (`lib/tasks/use-task-toggle.tsx`): two writes from To do, Mark done's sheet first where the task asks for proof or was sent back, "Marked done · Undo" over the bar for the assignee only (taking a completion back is theirs alone; an officer who marked a member's copy done gets no Undo), and a gate refusal or a refused take-back said on the screen. Edit opens the board's Edit task sheet on this copy. Delete, and taking out the copy on screen, go back to where the member came from (the board or the Calendar). Give it back goes to the board, which says "It's back on Up for grabs." in its line (`/tasks?released=1`).
Remove people turns Who has it into a select mode on the screen, as Apple Mail's Edit does ([`tasks.md` § Tasks for everyone](../../behavior/tasks.md#tasks-for-everyone)). A row's long-press Remove people (#5492) pushes this screen with `select=1`, and it opens in that mode once Who has it is read.

### s09 You (was the More hub)

Route: `(app)/(tabs)/you.tsx`.

Live — the You tab (#3839): s15's profile head, a Status row, the hub's rows, then s15's Details and Bio, on one screen ([`navigation.md` § You](navigation.md#you-s09-and-s15)).
`‹ More` on the board reads `‹ You`.

### s10 Study hours

Route: `(app)/study.tsx`.

Live — real sessions on `GET /v1/study-sessions`, geofenced ([`patterns.md`](patterns.md)).
The live session is recovered from the list on mount, so a relaunch mid-session does not strand the member.
`AppState` mirrors foreground state to `/pause` and `/resume`; the 5-minute heartbeat runs foreground-only at `Accuracy.Balanced`.
The timer displays **credited** time re-derived from the session's own `last_heartbeat_at` watermark, never an accumulated counter.
Start is gated behind a contextual location primer.
Before Start, the card and the zone picker say how far each zone is and offer the one the member is in ([`patterns.md` § Study sessions](patterns.md#study-sessions-s10)).
During a session the card offers a Focus timer and Keep screen on (same section).
The drawn `THIS WEEK · 5.4 of 6.0 hrs` line reads the member's weekly study goal (`GET /v1/goals/mine`) and draws its meter (groove in the card tint, since the line sits on the screen) only when the chapter sets one ([`../../behavior/activity.md` § Goals](../../behavior/activity.md#goals), #1062); without one it keeps the week's total and session count

### s11 Dues

Route: `(app)/dues.tsx`.

Live — the viewer's own invoices from `GET /v1/invoices` (the route serves a `billing:view` holder the whole chapter, so the screen filters), balance from OPEN rows (listed one per row under the card when two or more are open, since HISTORY holds settled rows only), and Stripe PaymentSheet behind the `isStripeAvailable` guard in `lib/payments/stripe.ts`.
A completed sheet shows **payment received, confirmation pending** and flips to Paid only when the webhook has written it, per [`billing.md`](../../behavior/billing.md) § Member payment flow, which owns that rule.
The hold on that invoice ends when the list reads it as no longer OPEN (PAID, VOID, or dropped), when a list read taken after the sheet completed says the payment failed (**Your payment didn't go through**, #3460), on a chapter switch, or when the app closes; leaving the screen or the app and coming back doesn't end it.
Pay stays live under the line once the post-sheet confirming window (about 24s) is over, for a failure the server hasn't recorded yet; the states and copy are [`writing.md`](../design-system/writing.md) § Dues (mobile, s11).
Pay settles one invoice at a time — a PaymentIntent is per invoice.
The drawn payment-plan link, payment-method sub-labels and receipts line are omitted: none has a backing model, and the method detail lives on a `billing:view`-only route

### s12 Documents

Route: `(app)/documents.tsx`.

Live — real folders and documents; web's search, Uploaded by, Date added, File type, Pinned and Starred filters and sort, run by the same shared code over the whole library ([`chapter-docs.md` § Search](../../behavior/chapter-docs.md#search), #3938). Each filter is its own chip in one row under the folder chips, as Google Drive's Type, People and Modified chips are on a phone: Type, Uploaded by and Date added each open their choices in a sheet with a check on the current one and name the pick once set (lit, with a trailing chevron); Starred and Pinned toggle in place; Clear leads the row while any filter is set. The order sits across from the count over the list ("Name A–Z ⌄"), as Files, Drive and Dropbox put theirs, and opens its own sheet (#5278, Paul 2026-11-17: "sort and filter on mobile, it just sucks for documents"; until then all of it sat behind a "Sort & filter" chip at the far end of the folder row, opening a panel of chip rows);
rows read "Uploaded Aug 12 by … · folder · type"; PINNED and STARRED cards above the list on All, folder chips ordered pinned, starred, then the rest and walking the folder tree a level at a time ([`chapter-docs.md` § Structure](../../behavior/chapter-docs.md#structure), #5337, Shawn's pick 2026-11-17), and a long press on a chip, card or row opening a sheet with Star, Pin for the chapter (`chapter_docs:manage`) and, on a file, Delete document after a confirm (`chapter_docs:manage`) ([`chapter-docs.md` § Pinned and starred](../../behavior/chapter-docs.md#pinned-and-starred), #3934); a copy of a file in the chapter's Google Drive folder reads "From Google Drive, added Aug 12 · …" and has no Delete document, since Drive owns it ([`chapter-docs.md` § Google Drive folder](../../behavior/chapter-docs.md#google-drive-folder), #5157; connecting the folder is web only);
a tap downloads the file and presents the system share sheet, to save it to Files or open it in an app that reads it, never opening it as a page ([`chapter-docs.md` § Two links](../../behavior/chapter-docs.md#two-links-inline-and-saved), #4409).
A List / Grid round at the title row's trailing end ([`components.md` § Segmented control](../design-system/components.md#segmented-control), #4175; a segmented control until 2026-11-17) lays the files out two to a line as tiles, each a panel naming the file's type over its title and the row's meta line, wearing its pin and star, with the row's tap and long press; an upload in flight stays a row above them.
The floating create button (Upload document) opens s21, drawn only for a viewer holding `chapter_docs:upload`.
Upload closes s21 at once: the upload heads the list as a row with its title and a gray "Uploading…" until the filed document arrives in the list's order (Name A–Z by default, so not necessarily the same slot, since #3938), or "Didn't upload.
Tap to try again." in the destructive hue, which reopens s21 on the kept draft (2026-11-07) ([#3399](https://github.com/pdcarlson/Frapp/issues/3399); it sat at the far end of the `‹ More` row until 2026-11-05, [`patterns.md` § Create actions](patterns.md#create-actions))

### s13 Directory

Route: `(app)/directory.tsx`.

Live — actives + alumni chips and member search ([`../../behavior/members.md`](../../behavior/members.md)).
The Actives chip and list leave out every member flagged `is_alumni`, so no member is counted on both chips ([`../../behavior/alumni.md`](../../behavior/alumni.md#alumni-directory), #2484).
Search spans both lists.
A member's pledge class leads their row's meta line when they have one, and for a chapter that keeps classes or order numbers the Actives tab's chip row ends with a chip, "Sort:" and the chapter's word for a member's order number, that lists the actives in fraternal order while it is on, where the Alumni tab's row ends with Filters;
Canvas draws no sort here, and [`members.md` § Directory](../../behavior/members.md#directory) owns when the chip and the class appear (#3939).
The Actives tab's chip row also carries a Filters chip, before that sort, that opens a tall sheet of web's four Directory filters: Status, Graduation year, the chapter's pledge class (under its own word, when it keeps any) and Role, the last a list of every role but Alumni that is searched by typing and scrolls, for a chapter with 100+ roles.
Each pick applies at once, one value per filter; the chip counts the filters set, the Actives count stays the chapter's total, and a miss says "No actives match these filters." with Clear filters ([`members.md` § Directory](../../behavior/members.md#directory) owns the rules, #3971).
The Alumni tab also filters by self-reported graduation year, city, and company, behind a Filters chip at the end of the chip row that opens the fields and counts the ones set; the "Alumni · N" chip omits its count while any of those filters are set, since the badge's job is the chapter's total and a filtered number would misread as one after switching tabs.
Opts out of `ScreenShell` for a `FlatList`, because nothing here paginates.
A List / Grid round at the title row's trailing end (#4175, [`components.md` § Segmented control](../design-system/components.md#segmented-control); a segmented control until 2026-11-17) lays the same rows out as two-to-a-line tiles, each the member's face larger with the name and the row's meta line under it, for both chips and a search.
Tapping a row or a tile opens a `MemberDetailSheet`, the one member profile on mobile: chat opens the same sheet from a sender's name or photo, an `@` chip, or a row of the channel's member list (2026-11-07), and it reads a member by `users.id` (`GET /v1/members/by-user/{userId}`).
It leads with the member's photo, name, and grad year, then Message as the sheet's one accent button, then a contact group of Phone (when set; a tap offers Call or Text, `lib/directory/phone-actions.ts`), Email (a tap starts an email), Birthday ("March 4", only when they share it with the chapter, #4959) and Member since, written out in full, then their roles as chips in the chapter's role order with each role's color (#3710 owns that order), then the member's pledge class and order number under the chapter's own words, each only when set (#3939; an officer who sets them sees both, below).
The chapter's custom fields that have a value sit behind a More details row, closed on each opening (#3711, 2026-11-12: contact first, logistics a tap away); with none set the row is not drawn (#1749).
It is a sheet (name, email, member since, self-reported major/bio/graduation/city/company when set, and any chapter-defined custom fields the viewer's tier can see (#1158)) rather than a route: the tab layout is frozen, so a route-based member detail is not an option.
The role chips are the member's roles from `GET /v1/roles` (custom roles became ordinary roles in #4075, so there is no second list).
For a viewer holding `roles:manage` (the gate on `PATCH /v1/members/{id}/roles`) the Roles heading's Edit opens a stacked, searchable sheet of every chapter role, where each tap adds or removes one and saves; it is the one place on mobile roles are edited (no press-and-hold or second entry point, 2026-11-07).
It changes `role_ids`; President is shown locked (it moves with Transfer presidency); and taking away a member's last role carrying `members:view` asks first (`apps/mobile/lib/directory/role-editor.ts`; copy in [`writing.md` § Edit roles (mobile s13)](../design-system/writing.md#edit-roles-mobile-s13)).
The same `roles:manage` viewer always sees the pledge class and order number rows ("Not set" when unset), and tapping either opens a stacked sheet with the number field and the chapter's classes as a pick list, None first (a class deleted since the profile was read shows as None), saved together with Save through `PUT /v1/pledge-classes/assignments` (#3991, `components/directory/member-class-sheet.tsx`; web's profile sheet sets the same two fields).
No point balance — `GET /v1/points/members/{userId}` needs the officer-only `points:view_all`, which most viewers of this sheet do not hold.
Another member's sheet offers **Message** (#2773), which opens your 1:1 DM with them, creating it if none exists (`POST /v1/channels/dm`).
This row owns who it is offered for: never on your own profile or the system actor's, or before the viewer's own id has loaded, and never for a member on your block list.
Until the block list has been read, the row stays but can't start a DM, because the list could be missing a block made earlier or on another device.
It says it is checking the list, waits for the network while offline, or offers to re-read a list whose read failed (copy: [`../design-system/writing.md`](../design-system/writing.md#start-a-dm-mobile-s13) § Start a DM; implemented in `apps/mobile/lib/directory/start-dm.ts`).
Edit name and graduation year, offered where the profile read says `viewer_can_edit_profile` (#4367; opens a stacked sheet, `components/directory/member-correction-sheet.tsx`, with the rules in [`members.md` § Profiles](../../behavior/members.md#profiles)), Block / Unblock (#2257), offered under the same own-profile, system-actor and unknown-viewer rules, and Remove from chapter, offered where the profile read says this viewer may (`viewer_can_remove`, as web), are rows in the `⋯` beside the header's X (an action sheet on iOS, a dialog on Android; `apps/mobile/lib/directory/member-menu.ts`), each confirmed before it acts;
with none of them, the `⋯` is not drawn, so your own profile has none ([`components.md` § Shared rules](../design-system/components.md#2-shared-rules)).
*(Changed 2026-11-11: Block was a red row at the foot of the sheet, and mobile had no removal.)*
A viewer holding `members:invite` gets the floating + "Invite members", which opens `(app)/invite.tsx` ([`navigation.md` § Inviting members](navigation.md#inviting-members)).
Each row and tile carries the member's presence dot on the avatar and their custom status line under the name, as web's Directory and the member sheet draw them, off chapter presence and absent until it has synced (#4137, Shawn, 2026-11-12).
The search field leads with a magnifier and reads "Search members", web's words, because `GET /v1/members/search` matches more than the name; Documents and Roles take the same glyph.
Deliberately different from web (#4137): a 40pt avatar in a touch-height row (44pt and up) where web draws a 24px avatar in a 36px dense row;
the meta line is class · company · city · year, what a member looks someone up by on a phone, where web's officer roster reads role · class · joined · email;
and the placeholder takes `text.muted` as every phone field does (it clears 4.5:1 since the 2026-11-09 ladder), where web's take `--muted-foreground`.
Web's Directory shows each member's points and the phone's doesn't.
Any member who can open the Directory could read them (web takes them from `GET /v1/points/leaderboard`, behind `members:view`), so this is a layout call, not a permission: web's points are a column of its wide officer roster, and a phone row already carries the face, dot, name, status line and meta line, so points stay on the Points leaderboard.

### s14 Notifications

Route: `(app)/notifications.tsx`.

Live — real in-app history grouped TODAY/EARLIER on the device's local calendar day of `created_at` (not the UTC date), unread dot, tap-to-read, and a Mark all read that is one request (`POST /v1/notifications/read`, #3929; it was a per-row fan-out before).
Each row draws who it is about and what kind of notice it is (#4346, Shawn 2026-11-11), as the web drawer does, from `@repo/hooks/notification-rows`: the sender's or new member's picture (photo or tinted initials) with a kind badge (@ for a mention of you, in the mention chip's fixed gold; # for a channel; a bubble for a DM; a megaphone for an announcement; + for a join), or a rounded tile in the kind's role-palette hue for a task, event, dues, points, service, report or import notice;
the title with the person's name in their role colour and the time beside it; the preview with chat's mention chips and no U+FFFC.
A mention is not a tinted row: the list stays flat.
The unread dot is `--foreground`, as on web (it was the chapter accent until #4346), and a read row's title drops to regular weight and the body's tone.
The category word that sat under each row until #4346 was derived from `data.target.screen`; the badge and the row's spoken label carry it now.
Since 2026-11-13 (#3948) a conversation's rows are one row, its newest, with how many messages it stands for under the preview ("14 messages") and in its spoken label, and an All / Unread segmented control spans the top of the list (shown once there is a row, and kept under Unread when it empties the list, so All is a tap away); [`notifications.md` § The in-app list](../../behavior/notifications.md#the-in-app-list) owns the rules.
A long press offers Clear in a one-tap alert (Clear or Cancel), and a screen reader gets Clear as a named action; a conversation's row clears the whole conversation (#3948).
A tap marks the row read (every unread row a conversation's row stands for) **and** deep-links: the destination comes from `lib/notifications/targets.ts`, the same resolver the push handler uses, so an in-app tap and a push tap cannot name different screens.
An unrecognized target resolves to this screen, so the row marks itself read and stays put rather than guessing

### s15 Profile (on the You tab)

Route: `(app)/(tabs)/you.tsx`, `components/you/profile-sections.tsx`.

Live — drawn on the You tab since #3839, not a screen of its own.
Identity and the backed profile fields; no stat cards since 2026-11-17 (#5281, Paul: "a lot of space just to say 0 points", and service hours that read zero most of the semester).
The member's points are a quiet `60 pts` at the top right beside the title (label role, muted foreground, never the accent), drawn when it isn't zero (a negative balance from a fine shows) and while the chapter has Points on, and `— pts` when the read failed; approved service hours are the Service hours row's value (`2.5 hrs`, formatted as Study's), drawn only when it doesn't round to zero and `—` when the read failed, and the row leaves the hub when the chapter has Service hours (`hours`) off. Study hours says nothing at zero unless the member has a weekly goal (`0.0 / 6.0 hrs`).
Until then the head drew two cards, points and approved service hours (#4137).
The profile photo shows in the avatar, and the avatar is its control, marked by a camera badge in the chapter accent (#732, `components/profile/profile-photo.tsx`; square-cropped with `expo-image-picker`): with no photo it opens the picker, and with one it offers Choose photo or Remove photo in the native action sheet (an alert on Android), and Remove asks to confirm before anything is removed.
Without an active chapter it offers Remove photo alone and says a chapter is needed to add one: the upload routes carry `ChapterGuard` and `DELETE /v1/users/me/avatar` does not.
Every field is its own control (#3711, 2026-11-12; the Edit pencil at the far end of the `‹ More` row is gone, and so is the row: the profile is a tab): a tap on the name, on the Phone, Birthday ("March 4", with "· Only you" while it isn't shared), Major, Graduation, City or Company row ("Not set" when empty), or on the bio (a Bio "Not set" row when there is none) opens the sheet at that field, scrolled into view with its input focused and the keyboard up (the birthday at its month; #5280, as Slack's and LinkedIn's profile editors open at the field tapped).
The City and Company rows follow the sheet: they are drawn only when it shows their fields (`showsAfterGraduation` on the stored profile, below), and the sheet keeps them while the stored year says so, even under a year typed ahead, so no row opens a sheet without its field (Paul's pick on #5280, 2026-11-17; the 2026-11-06 rule that an undergrad doesn't see them stands). It scrolls only as far as the field needs, so the first fields open with the header still in view.
The sheet holds the name, phone, major and graduation year (one row), the birthday (month, day and an optional year as digits, one row, then, once a month and day are typed, a **Share my birthday with my chapter** switch with a line of who sees what, #4959; a Your chapter / Only you segmented control until #5282, 2026-11-17), bio, and, under an "After graduation" heading shown from the member's graduation year on, as typed or as stored (or while either already holds a value, `showsAfterGraduation`), city and company (#3387, `components/profile/edit-profile-sheet.tsx`; regrouped and Major added 2026-11-06);
it sends only the fields that changed, and refuses a blank name, a graduation year outside `GRADUATION_YEAR_MIN`–`GRADUATION_YEAR_MAX`, or a birthday `birthdayDraftProblem` refuses, on the part that is wrong (all in `@repo/validation`), before any request, showing the refusal once the member leaves the field or presses Save, never while they type ([`components.md` § Text input](../design-system/components.md#text-input)).
A swipe or scrim close outside a save drops the edits, on purpose: of the form sheets [`patterns.md` § Bottom sheets](patterns.md#bottom-sheets) covers, s19–s21 keep a draft across a close and this one resets, and that section says why.
The drawn "96% attendance" stat and the Big brother row are omitted — no member-readable source exists for either (Phone has one since #3711).
The Pledge class row is drawn after Graduation, labelled with the chapter's word, with the member's order number under it, each only when an officer has set it (#3939; `pledge_class_id` and `order_number` on the viewer's member profile, `GET /v1/members/by-user/{userId}`, and `GET /v1/pledge-classes` for the name): unlike the rows around it, it never reads "Not set", because the member can't set it and the chapter may keep neither

### s16 Settings

Route: `(app)/preferences.tsx`.

Live — drawn title is "Settings"; route filename stays `preferences.tsx` (settled, see notes).
Six sections, two as drawn: NOTIFICATIONS (a **Push notifications switch**, quiet hours, a **Chat messages** row naming the chapter-wide chat level, which opens a sheet of All messages and Mentions and DMs only ([`notifications.md`](../../behavior/notifications.md) § Chapter-wide chat level, 2026-11-11, [#3840](https://github.com/pdcarlson/Frapp/issues/3840)), and a switch per shared category, labels only, over a footnote that a channel or DM is muted from the chat itself and announcements can't be switched off here).
Quiet hours is a grouped list: its switch alone while off, and From and To rows with the native time picker while on, plus a Time zone row only when the stored zone isn't the phone's (2026-11-06; it was a card of typed start, end and zone fields shown even while off).
There is no Chat switch since 2026-11-06 ([`notifications.md`](../../behavior/notifications.md) § Preference sync), CHAT (one **Chat density** row naming the current density, which opens a sheet of the three densities (cozy, compact, bubbles, 2026-11-10) drawn as shapes; a tap saves and closes.
Per phone; [`components.md`](../design-system/components.md) §11 § Density, 2026-11-06, [#2252](https://github.com/pdcarlson/Frapp/issues/2252)), ACTIVITY (**Nudges on Activity**, for every member since #5464, because the card it turns off shows without AI; it sat in the AI section, once Frapp AI was on, until then), CHAPTER · ADMIN, which moved whole to Chapter settings on 2026-11-12 ([`navigation.md` § Chapter settings](navigation.md#chapter-settings), [#4074](https://github.com/pdcarlson/Frapp/issues/4074); it had held the accent row, 2026-11-04, [#3370](https://github.com/pdcarlson/Frapp/issues/3370), the chat background and Study zones), LINKED APPS (2026-11-17, [#5407](https://github.com/pdcarlson/Frapp/issues/5407): a **Google Calendar** row whose trailing mark is a green check once connected, a grey circle before and red once expired; a tap connects, and on a connected or expired row offers Open Google Calendar (or Reconnect) and Disconnect; a **Calendar apps** row opening the Subscribe sheet; and a **Discord** row showing the chapter's Discord link, which is made on web), SIGN IN (email, Google and Apple, each marked by whether the account has it, read from Supabase Auth; adding one is a follow-up), AI (Paul, 2026-11-17, [#5292](https://github.com/pdcarlson/Frapp/issues/5292): "maybe we just make an AI section"; only where the server has AI: the member's **Frapp AI** switch, captioned with what it does and never the companies it works with, which Meet Frapp AI names when the switch is turned on; and, for a member who can open Chapter settings, a **Chapter AI** row naming how many of the chapter's switches are on and opening Chapter settings; under it a line linking the privacy policy; until then the two switches sat under ACCOUNT and the caption named the companies), ACCOUNT (Appearance as static text, an undrawn **Blocked members** row that opens a sheet listing blocks with Unblock — the durable undo `../../behavior/chat/README.md` § Block requires (#2257) — an `alumni:post`-gated "Support the Chapter" donation-link row shown when the chapter has `donation_url` set (#299) — seeded on the Alumni role alone, so it also reaches any wildcard-permission holder per the standard `can()` convention, not literally every non-alumni excluded — the Terms/Privacy/FERPA links from #275, sign out, and delete account from #713).
ACCOUNT also has a **What's new** row under Appearance (2026-11-07) that opens `(app)/whats-new.tsx`: the changelog in members' words, one dated card per entry, read from `RELEASE_NOTES` in `@repo/validation` (the same list web's account menu opens and `npm run release-notes` prints for testers).
It also opens by itself, once, after an update brings a newer entry (2026-11-09, [#3804](https://github.com/pdcarlson/Frapp/issues/3804)): a tall sheet over whatever is on screen, hosted beside the first-run tour in the tab layout (`components/whats-new/whats-new-host.tsx`), holding just the entries newer than the last one this phone showed, or that day's entry again once a later release adds lines to it (rewording a line doesn't count).
The phone keeps which version of the newest entry it showed (`lib/whats-new.ts`); showing it records it, so it never shows twice.
It never shows on a fresh install's first launch, during onboarding (which is outside the tabs), or on a launch the first-run tour is due; those record the newest entry without showing it.
An install from before this existed (no marker, but chat state on the phone at launch) gets the newest entry once.
**Once per account, not per device** (2026-11-11, [#4043](https://github.com/pdcarlson/Frapp/issues/4043); changed in #4043 by shawnatomklein-eng, 2026-11-11, where #3804 had it once per device): the account records the newest entry any of the member's devices has shown (`users.whats_new_seen_version`, a `releaseNoteVersion`, through `GET`/`PUT /v1/users/me/whats-new`, moved forward only).
A device that would open the notes asks first, waiting a few seconds at most; when the account has already seen the newest entry (another device showed it), it records the entry without opening and the What's new row here carries the neutral unread dot, as web's account menu does, until What's new is opened on this phone.
Versions are compared, not a yes or no, because web deploys at once and the phone updates later.
Showing the notes, or opening the What's new screen, tells the account.
Offline or with no answer, the device goes by its own marker as before, so nothing ever opens twice on one device; the no-show cases above record without a dot.
**The latest update's lines stand out** (Paul, 2026-11-16: on a big day of changes, see what is new since your last update): in the sheet and on the screen, the lines this update brought that the update before it didn't have are semibold in the foreground color, and a caption under the entry's title says "Lines in bold came with your latest update."
Each phone remembers the newest entry as its last update had it (`lib/whats-new-fresh.ts`, worked out once per launch; the rule is `nextReleaseNoteSnapshot` in `@repo/validation`, shared with the web), so the marks are per device and last until the next update with news, however often the notes are opened.
An entry whose every line is new marks none, since its date already says it is new; a phone with nothing remembered yet (a fresh install, or the first launch with this) marks nothing; a reword alone isn't marked (one shipped with new lines is, since nothing tells the two apart), and a marked line keeps its mark when reworded.
Web opens it by itself too, by the same rule (2026-11-09, [#3943](https://github.com/pdcarlson/Frapp/issues/3943); this line said web didn't, for want of a "you updated" moment, until Paul asked for it there: the moment is a newer entry in the list): [web dashboard § What's new](../web-dashboard/README.md#whats-new).
Deploy production warns when a release ships something members could notice without telling them ([`ci-cd.md` § How Deployments Are Gated](../../../docs/ops/deployment/ci-cd.md#how-deployments-are-gated)); how to write an entry, and why a same-day entry only grows, is the header of `packages/validation/src/release-notes.ts`.
The push row is the drawn switch, showing the device's notification settings: on only when the OS will show a push (on Android 13+ a granted permission with the app's notifications blocked reads off, and on any Android so does its push channel, "Chapter notifications", switched off), re-read on every foreground.
A tap asks the OS while a prompt can still help (the tap counts as accepting the primer, [`patterns.md`](patterns.md) § Push notifications) and otherwise opens the OS settings, since an app can't revoke its own permission and iOS never re-prompts (2026-11-05; it used to open the OS settings on every tap).
Whenever a tap would open the OS settings, on or off, a line under the row says so.
Settings keeps a caption only where the control can't say it (a tap that leaves the app, a change that reaches the whole chapter, where a read-only value is changed, or a problem); the rest went 2026-11-05 (the owner's "we don't need to narrate stuff").
In a build that can't push it is a status row reading Unavailable with the reason.
"Mandatory events only" is still not built (no backing field on `events`, no preference key).
The drawn "Join code" row is omitted: no such field exists

### s17 Ask sheet

Route: *sheet* from the Ask Frapp bar above the tab bar (`components/ask/ask-bar.tsx`, hosted by `components/quick-actions/quick-actions-host.tsx`), plus `(app)/ask.tsx`.

Live — Ask Frapp (`components/ask/ask-sheet.tsx`), a gorhom v5 **tall sheet** (full height under the status bar, closed by its header's X or the grabber; [`patterns.md`](patterns.md)) over whatever tab the member is on, opened from the Ask Frapp bar above the tab bar ([`navigation.md` § Global entries](navigation.md#global-entries-outside-the-tab-bar)).
Changed in #4702 by pdcarlson, 2026-11-13: until then it was a fixed 78% detent opened from a bar at the top of the + panel (and until 2026-11-12 from a ✦ pill on s04 and s06).
Its header is the crest in the chapter accent and "Ask Frapp" once the thread has a turn; before it, only the close X over the opening's large crest (#4904, below).
**It is drawn on the page's background (`surface.background`), not a sheet's `popover` grey** (#4702; Paul, 2026-11-13, on the first captures: at full height it is a screen, and his reference, Bevel's assistant, talks on the app's own dark background), so a suggestion, the field and a proposal card take the page's `surface1`.
The field is a capsule like the bar that opened it, and the send button is round and the chapter's solid accent.
**Dictation** ([#5276](https://github.com/frapplive/Frapp/issues/5276), 2026-11-17, Paul's pick on the [design page](https://claude.ai/artifact/XiFoe6wthVWRXCnZWaKqZt), after Bevel's assistant field, ChatGPT's dictation and Wispr Flow; `components/ask/ask-dictation.tsx`, `lib/dictation/`): a mic sits inside the field's right end, so dictating adds to words already typed and send never moves; no mic is drawn in Expo Go, on web, or where the phone has no recogniser. While it listens the field takes the chapter's colour and becomes the voice's waveform, with cancel at its left and the elapsed time at its right, the words heard so far run faint above it, and send becomes a Done check. On Done the heard words pulse in the field while Frapp's AI tidies them (no fillers or false starts, punctuation added; [`../../behavior/ai.md` § Dictation](../../behavior/ai.md#dictation)), then the tidied words land in the field to read, edit and send, with an Original chip above it that puts back the words as spoken until the member types or sends. Nothing is sent by speaking. A refused microphone says so in a caption line above the field with Open Settings; nothing heard says "Didn't catch anything."; closing the sheet or sending clears the line. The field grows to five lines, so a dictated paragraph shows whole, and send sits at its foot. Listening stops itself after two minutes, or once the words fill what is left of the question's 1,000 characters; words past that are cut at a word and the line says "That's all that fits in one question." Return on the keyboard sends and leaves the keyboard up, as the send button does.
**One conversation in one field** ([`../../behavior/ai.md` § One conversation](../../behavior/ai.md#one-conversation); changed in #4699 by pdcarlson, 2026-11-13: until then it showed one question at a time, said so under the field, and had an Ask / Do switch beside the title for a member who could have Frapp act).
The title row is pinned, with a New conversation button once there is a turn; the thread scrolls under it and follows the newest words unless the member has scrolled up, including as the keyboard opens and closes; a thread shorter than the room sits at its bottom, on the field, so what was just sent shows right above it, keyboard up or down (#5426, 2026-11-17: on iPhone a question sent with the keyboard up was drawn above the window until the keyboard moved); dragging the thread puts the keyboard away (#5429, 2026-11-17: under the sheet library's interactive dismissal the keyboard moved with the finger and the field floated over an empty band); the field is pinned above the keyboard and reads "Ask Frapp anything" ("Search or ask Frapp" from #4904 until #5139). A host may open it with words already in the field (`initialDraft`): the Search screen's "Ask Frapp about …" row does, and Activity's nudges.

**History: the field searched too, from #4904 until #5139** (changed in #4904 by pdcarlson, 2026-11-13; Paul's pick, one field for search and Ask; undone in #5139, below). From three characters, the channels, members, messages and events that match what is typed are listed just above the field, grouped, at most three a group, each one line with its hint at the right (`components/ask/ask-find.tsx`, off the list web's Find dialog builds, `@repo/hooks` `find-results.ts`). The list sits between the thread and the field, ending where the composer begins, so a row never runs under the field (changed in #5082, 2026-11-15: it used to hang over the thread from the composer's top edge, and on an iPhone with the keyboard up its rows ran on under the pill); the thread above gives it the room, at most a heading and four rows; the last settled list stays up while the next search is out; with nothing found there is no list. A tap closes the sheet and opens the channel, the message in its channel, the directory or the event's details; what was typed is dropped, and nothing is asked. Send asks Frapp, whatever is listed. Backwork is not listed (the phone has no screen for it), nor Events while the module is off, nor DMs. The Google app, Arc Search and Perplexity offer places while typing and an answer on Send in the same way.

> Changed in #5139 by pdcarlson, 2026-11-16: the field no longer searches, and `ask-find.tsx` is gone. Paul: "take mobile search out of the ask frapp", with "a system wide search somewhere else". Search is its own screen pushed from Chat home, which every member has ([`navigation.md` § Search](navigation.md#search)); it ends in a row that opens this sheet with its words.
Each turn (`components/ask/ask-turn.tsx`) is what the member typed in a bubble on the right (the chapter's solid accent since #4702, `surface1` before), then Frapp on the left with no frame: the steps it takes while it works, one row each with an icon and what it found, folded into one row from the answer's first word (#5427, [`../design-system/components.md`](../design-system/components.md) §11), then the answer with a numbered gold marker after each cited sentence and a wrapping row of source chips under it (36pt drawn, the number then the name; kind and date are in the chip's spoken name).
After the chips (until #5427 a caption line between the answer and its chips said what Frapp read) sit two muted icons, Copy and Report, where the words "Report this" were (#4702; Paul, 2026-11-13; [`../design-system/components.md`](../design-system/components.md) §11).
A chip opens the real thing: a document in the in-app browser over the sheet, minutes on the minutes screen, a channel message's channel, live data on its screen (`lib/ask/source-route.ts`); a source this build has no screen for is a plain chip.
A turn says in plain words when Ask can't answer: not found, refused, off for the chapter, over the month's allowance, or Frapp AI not on, which offers Meet Frapp AI.
For a member who chose Not now, Meet Frapp AI is offered at the first question, not when the sheet opens (`components/ai/meet-frapp-ai.tsx`; #4790).
Before the first turn the sheet opens on the crest (`components/ask/ask-opening.tsx`): 88pt in the chapter's colour over a radial glow of that colour that breathes (94% to 106%, 4.2s; still with Reduce Motion), then the day in caption grey and a greeting in the headline role ("Good evening, Marcus."), and no header name, since the bar that opened it says "Ask Frapp" (changed in #4904 by pdcarlson, 2026-11-17, Paul's pick on the [design page](https://claude.ai/artifact/NCtLdmLop59itrbC6Uku5d): until then the sheet opened every time on "Ask about your chapter" and a paragraph about where answers come from). With the keyboard up the crest steps down to 44pt beside the greeting (or the first open's hello) at the top, and only the last two rows stay, the ones nearest the field. On a member's first open on the phone the greeting gives way to "Hey Marcus, I'm Frapp." over the "What can you do?" exchange ([`../../behavior/ai.md` § What Ask opens with](../../behavior/ai.md#what-ask-opens-with); `useAskStarter` in `@repo/hooks`, kept by `lib/ask/starter-seen.ts`). The header's crest and "Ask Frapp" come back with the first turn.
At the bottom, above the field, it offers what this member could ask about their own account right now: up to three questions and one request the server builds from their records, as full-width rows led by a ↳ in muted grey with a hairline between them, 48pt at least (Paul, 2026-11-17: "like kind of arrows"; bordered cards until #4904; a fixed list of things to try until #4700).
They are read once the sheet is open and fade in where nothing sits below them to move; with nothing to suggest the crest and the greeting stand alone.
Nothing sits under the field; while the beta diagnostics window is on, one caption line above the field says questions and answers are saved and until when ([#4315](https://github.com/pdcarlson/Frapp/issues/4315)), and because the composer is anchored to the sheet's bottom its arrival never moves the field. A short thread sits on the field, so it moves up by the line's height (changed in #5426, 2026-11-17: until then the thread was drawn from the top and the line moved neither).
Whether a member has Ask is the server's answer (`lib/ai/availability.ts`); without it nothing is drawn and `ask.tsx` goes to Chat home ([#2259](https://github.com/pdcarlson/Frapp/issues/2259)).
Web's twin is the Ask card over the chat (the Ask panel until #4702), and both read `ASK_COPY`.
Draws no Cancel word: its header's X and the grabber are the dismissal (the grabber and the scrim were, as drawn, until #4702 made it a tall sheet).
**A request** (2026-11-12, #718, [`../../behavior/ai.md` § Asking Frapp to do something](../../behavior/ai.md#asking-frapp-to-do-something)) typed in the same field comes back as a card in the thread (`components/ask/ask-proposal.tsx`) saying exactly what would happen and to whom, with a ··· menu (Dismiss, Report this) in its top line and Edit beside one named action ("Create event", "Give 5 points"); every card in the thread stays live (changed in #5148 by pdcarlson, 2026-11-16: until then Cancel, Edit and Confirm). Details are rows led by small marks, an event's day sits in a date tile, and an event whose points could not be filled shows an outlined points field the action waits on.
Edit (#5117) opens New event (filled in from the card, More options open) on an event card, the New task sheet on a task card, and turns a points card's amount and reason into fields; a series adds a repeat row ("Every Sunday until February 7, 2027", "13 times" under it).
A points card lists its members (folded behind Show when more than five), each with a remove control, and Add a member opens the roster in a tall sheet with a search field; "Which event?" is a list of the recent events to pick from.
A task card's who and when open the New task sheet (s19) on the proposal, and Confirm opens it when either is missing.
After the action or Dismiss the card stays in the same frame, greyed (struck through when dismissed), under one line saying what was done (with how many were skipped when only some went through), and a link to Tasks or to the event itself (#5148).
The members an officer left on a points card are kept through a close and reopen.

### Minutes

Route: `(app)/minutes.tsx`, `(app)/minutes-details.tsx`, `(app)/minutes-transcript.tsx`, `(app)/minutes-series.tsx`.

Live (2026-11-12, #4415; the board draws no such screens), hidden while the `meetings` module is off for the beta.
You gains a **Minutes** row; an event's page ends in a row to its minutes; a "minutes posted" push opens them.
The list (`(app)/minutes.tsx`, #5290; Granola's notes list and Fireflies' channels for recurring meetings the models) draws each minutes as a row with a tile in its meeting type's hue (the chapter accent for Chapter, semantic info for Exec, semantic success for Committee, neutral for Other), the title, the time on the right, and tags worked out from the minutes, never typed: the type in words where the title doesn't already say it and the list isn't showing only that type, Draft, Recorded, and how many decisions and action items (`components/minutes/minutes-row.tsx`). With eight minutes or fewer it is Your drafts (Drafts when they include someone else's), then This week and Last week by the calendar (from Sunday), then months; a row this week gives its weekday and time, any other its date. Past eight it gains a search (name or type), the types as chips with their counts and a dot in their hue (a tap shows only that type; a second tap, or All, shows them all again; not a view switcher), a **Series** section (a repeating event with two or more minutes as one row: its name, how it repeats, how many, the last date) while nothing narrows the list, then month groups (`lib/minutes/minutes-list.ts`). A series' minutes also stay in their months, as the design page's long list draws them: the Series row is a way to browse, not a fold that hides them. An officer who records minutes gets the floating "+", which opens the + panel's New minutes, Record first.
A Series row opens `(app)/minutes-series.tsx`: the series' name, how it repeats and how many, the action items still open across all its posted minutes, newest meeting first (who, when due, how a task for everyone is going, from which meeting; a line once none is open), then its minutes by year. Open is Tasks' answer (#5482; Paul's pick, 2026-11-18): an item is open until the task it became is done, and one nobody made a task of stays open ([`meetings.md` § Suggested tasks](../../behavior/meetings.md#suggested-tasks)). The server answers it for the whole series in one read, refreshed by a pull and on returning to the app (`useSeriesOpenActionItems`).
Changed 2026-11-18 (#5482): the section listed the action items of the series' latest three posted minutes, done or not.
`minutes-details` is a document to read: the event's name over a row of chips (Draft or the day it was posted, when, the type, how many checked in, Everyone or Invited only), then an eyebrow over each section the chapter's template keeps, no cards ([`../../behavior/meetings.md` § Who can read minutes](../../behavior/meetings.md#who-can-read-minutes)).
An officer who may edit a draft gets it as a note (#5288): the event's name, a row of chips (Draft, when, the type, how many checked in, Everyone or Invited only), then a box typed in on the page and saved as they type: the officer's notes (`components/minutes/notes-panel.tsx`) where the server offers drafting, else the minutes' Summary (`components/minutes/summary-note.tsx`), with a line that decisions and action items are added on the web. One thing is pinned at the bottom (`ScreenShell`'s `footer`, which rises with the keyboard here, `avoidKeyboard`): while it records, the recorder's bar (`components/minutes/recorder.tsx`: round pause or carry on, a pulsing dot, the live input level, the clock, round stop); else **Post** once the minutes or the Summary have words, which posts at once without asking first (Paul, 2026-11-16); else **Draft minutes** once notes are typed; else **Record** ([`../../behavior/meetings.md` § Recording in the app](../../behavior/meetings.md#recording-in-the-app)). After Stop a card ticks off the upload's percent and the transcript. A ready transcript opens on the page under a row, with the recording's play control (`components/minutes/recording-player.tsx`) while the audio is kept.
Changed 2026-11-17 by pdcarlson (#5381): Draft minutes used to open a tall sheet, and the transcript another; Paul: "I don't want a pop-up sheet for everything."
Changed 2026-11-17 (#5288): the recorder was a large clock over two 72pt round controls, and with nothing written and no drafting one line said to write the minutes on the web.
An event's row reads Record minutes where the phone can record, else Write minutes, for every holder of `meetings:record`.

### Suggested

Route: `(app)/suggested-tasks.tsx`.

Live (2026-11-12, #4415; no such screen on the board) — tasks suggested from posted minutes ([#4313](https://github.com/pdcarlson/Frapp/issues/4313)), listed only for someone who could accept them.
Each shows who, the due day written out, and the line of the minutes it came from, with **Dismiss** and **Create task** (it read Accept until 2026-11-18, when Paul found it read as "this is mine").
**Report this** (`components/ai/report-ai-sheet.tsx`, [#4315](https://github.com/pdcarlson/Frapp/issues/4315)) sits quietly to their left, as it does under an Ask answer and at the foot of the Draft minutes sheet, for a member who holds `ai:use`.
Create task makes the task at once when the minutes named who and when; otherwise, or on a tap of the row, it opens the New task sheet (s19) filled in, titled "Change before creating".
Nothing becomes a task until a person creates it.
Reached from the `ai_suggestions` push, a row under posted minutes, and a row at the foot of Tasks (s08) shown only while some are waiting.
No Create all on the phone.
Titled **Suggested** since 2026-11-12 (it was "Suggested tasks"), because it now also holds **This time last year** ([#3930](https://github.com/pdcarlson/Frapp/issues/3930), [`../../behavior/ai.md` § This time last year](../../behavior/ai.md#this-time-last-year)): under that heading and its one-line introduction, each event the chapter held around now last year (name, and "Held on April 13, 2025.
I don't see it on this year's calendar.") with **Already planned** and **Add to calendar** as its two buttons and a quiet line under them holding Report this and **Not this year**; then last year's finished tasks, with Already planned and Create task, and Dismiss on the quiet line.
Add to calendar reads last year's event and opens the New event sheet filled in from it on the same weekday this year, as a one-time event; nothing is added until Create, and the suggestion then records the event.
An officer who can't create events sees no Add to calendar.
The route keeps its name, `suggested-tasks`, so the pushes already sent still land.
Also reached from a row at the foot of Events (s06)

### s18 Check-in

Route: `(app)/check-in.tsx`.

Live — opened by the check-in link the phone's camera reads (`?event=…&t=…`, sent once per code, latched), or by the event's Scan code with its viewport up; Scan code hands a code it reads to the screen as that link's parameters, and the typed code is a sheet; asks for location in context ([`patterns.md`](patterns.md))

### s19 New task sheet

Route: *sheet* from the tab bar's quick actions (`components/quick-actions/quick-actions-host.tsx`), or from a chat's + (s05), which posts the task's card in that channel.

Live — gorhom v5 sheet, gated on `tasks:manage` and `members:view` (the route's grants, `PLUS_MENU_PERMISSIONS`), opened over any tab from the + ([`navigation.md` § Quick actions](navigation.md#quick-actions); it was the Tasks screen's own floating button until 2026-11-06).
A create says where the task went above the tab bar, over whatever screen the officer is on ("Assigned to X." or "Added to your tasks.").
Title, points and a roster assignee picker as drawn.
The due date field is the platform's date picker ([`components.md` § Time and date pickers](../design-system/components.md#time-and-date-pickers), #3597; `components/tasks/due-date-field.tsx`), any day from today on, with the preset chips under it as quick picks.
The draft outlives a close, not a Cancel ([`patterns.md` § Bottom sheets](patterns.md#bottom-sheets)); while a create runs it is also read-only.
The host mounts a fresh sheet per chapter because the assignee is a member of the chapter the draft was started in.
A kept draft reads its due chip against the day it is filed (the host re-reads its clock each time the sheet opens and on a return to the app): "Today" and "Tomorrow" are relative and re-derive from that day; "Friday" and "Next week" name a date, and the draft holds the date they resolved to when picked, shown as whichever chip resolves to it that day (on Thursday a kept Friday shows as Tomorrow).
A held date that has passed falls back to Today

### s20 Log service hours sheet

Route: *sheet* on `service-hours.tsx` (`components/service-hours/log-hours-sheet.tsx`).

Live — gorhom v5 sheet on the host route ([`../../behavior/service-hours.md`](../../behavior/service-hours.md)), opened from the floating create button ([`patterns.md` § Create actions](patterns.md#create-actions)), or from the tab bar's quick actions over any tab ([`navigation.md` § Quick actions](navigation.md#quick-actions)), or from a chat's + (s05), which logs through `postHours` and posts the entry's card in that channel.
The drawn −/hrs/+ stepper in half hours (half an hour to a day), a description, and the date as chips from today back three days (the board draws a date row; s19 moved to the native picker on 2026-11-06, and s20 has not yet).
The caption under Submit is omitted.
The entry outlives a close, not a Cancel ([`patterns.md` § Bottom sheets](patterns.md#bottom-sheets)).
A kept entry reads its date chip against the day it is filed (the host re-reads its clock when the sheet opens and when the app comes back to the foreground, so a sheet left up overnight moves too): "Today" and "Yesterday" are relative and re-derive from that day; a weekday chip names a date, and the entry holds the date it resolved to when picked, shown as whichever chip resolves to it that day.
A held date that has left the chip window falls back to Today, because the chips are the only place s20 shows its date.
The drawn "Add photo proof" row, photos only (`lib/more/service-proof.ts`, on the shared pick/PUT pipeline): the picked photo's thumbnail with Remove, and the photo goes up on Submit (mint, PUT, then the create with its `proof_path`), so a photo removed or abandoned before Submit leaves nothing in the bucket.
One uploaded for a create that then failed is kept for the retry; given up after that, it stays in the bucket until an orphan sweep exists ([#2197](https://github.com/pdcarlson/Frapp/issues/2197)).
A held path the API turns down is dropped, so the next Submit uploads again, and the host mounts a fresh sheet per chapter.
The row reads "optional" until the API refuses an entry for want of proof (`wf_hours_receipt`, which a member can't read beforehand; the sheet matches the refusal's `service_entry.receipt_required` code), then "required" for the visit, with Submit held until a photo is attached.
A PDF waits for a decision: the picker is in 0.13.0 for s21, and whether proof takes a PDF from Files is [#5149](https://github.com/frapplive/Frapp/issues/5149)

### s21 Upload document sheet

Route: *sheet* on `documents.tsx`, or from the tab bar's quick actions with no folder picked ([`navigation.md` § Quick actions](navigation.md#quick-actions)).

Sheet ([#3399](https://github.com/pdcarlson/Frapp/issues/3399), [#3401](https://github.com/frapplive/Frapp/issues/3401)): with nothing picked, two rows, Choose a file (PDF, Word, Excel, PowerPoint or text, up to 25 MB) and Choose a photo, as Slack's and Google Drive's upload menus put them; then the picked file's card ("1.2 MB · from Files" or "· from Photos") with Change, which shows the two rows again with a Keep row for the file already picked (the pick, and any retry held for it, stay until a new pick lands, so backing out of a picker loses nothing); a title (blank files it under the file name, as web does), folder chips, a Who can see row, Upload.
Choose a file opens the system picker: on iOS, Files, which lists iCloud Drive and any installed cloud app with a Files extension (Google Drive, OneDrive, Dropbox); on Android, the document picker, which lists Drive too. It offers only the `document` allowlist (plus HEIC, turned into JPEG on the pick, as a photo is), so a Pages, Numbers or Keynote file is greyed out, and one that slips through reads "Export a Pages, Numbers or Keynote file as PDF first." A file over 25 MB is turned down before anything is sent.
A store build from before #3401 has no file picker, so its sheet draws the photo card alone, as before.
Mint, PUT and confirm all run on Upload, so a sheet cancelled before Upload leaves no object behind.
Upload closes the sheet at once and the upload carries on behind it, shown by s12's pending row or the quick-action capsule; a failure keeps its reason here for the visit that row reopens (2026-11-07).
A photo larger than 2560 px, from Photos or from Files, is shrunk before it is sent ([`navigation.md`](navigation.md), the `expo-image-picker` note), and a retry after a failed confirm files the bytes already sent rather than uploading a second copy, with the title, folder and Who can see list they were sent with (unless that folder is gone, below), which hold still until a new file or photo is picked.
The draft (photo, title and folder) outlives a close, not a Cancel ([`patterns.md` § Bottom sheets](patterns.md#bottom-sheets)): Cancel is held while an upload runs, in a visit reopened mid-upload too, and comes back when the upload settles, whether it filed the document or failed; Cancel or an upload that files it gives the draft up.
A close keeps any held retry with the draft, and a new pick gives that up; s12 mounts a fresh sheet per chapter, since the held path was minted under it.
A kept folder an officer has since deleted or renamed falls back to s12's filter when that folder still exists and to None otherwise, as an s12 filter naming a deleted folder does, and a held retry's folder that is gone falls back to None, where a deleted folder's documents go, so Upload never files into a folder no chip shows as selected (the API would create it again).
The board's "Officers only" toggle is a Who can see row under the folder chips, reading Same as folder (Everyone with no folder), which opens the channel picker's step for chosen tiers, roles and groups; the rules are [`chapter-docs.md` § Who can see](../../behavior/chapter-docs.md#who-can-see).
_Changed 2026-11-16 (#5216):_ this line said there was no toggle because `chapter_documents` had no visibility column.
_Changed 2026-11-16 (#3401):_ "from Files" is in 0.13.0 with `expo-document-picker`, and reaches members with that version's store build (none yet on 2026-11-16); until then this line said it waited for one.

### s22 Host check-in (admin)

Route: `(app)/host-check-in.tsx`.

Live — rotating QR, `events:update`-gated.
Reached from the event's own page (s07), where a viewer who may host gets Host check-in in place of the camera line (#3703), and from the You tab's admin section, which resolves the next hostable event and passes its `eventId`.
Closes with the glass close s18 also uses (`components/glass-close-button.tsx`)

### s23 Adjust points sheet (admin)

Route: *sheet* on `you.tsx`.

Sheet — **not built**, and the You tab has **no** Adjust points row until it is: the sheet needs a member picker plus amount/category/reason, and a permanently disabled row was removed under Guideline 2.1 (#2300).
Server rules (reason required, audit-logged) stand: [`../../behavior/points.md`](../../behavior/points.md)

## Removed screens

These pre-Signet screens had no Canvas counterpart and have been **deleted**:

| Removed route | Why removed |
| ------------- | ----------- |
| `(app)/(tabs)/index.tsx` (old Home) | There is no Home tab — chat is home (s04). The `index.tsx` path is reused by the chat list. |
| `(tabs)/points.tsx` | Absorbed into Tasks (s08): points balance + house rank render at the top of the task board. **Landed.** The rank denominator is the board's own count: every current member who isn't an alumnus (listed at 0 until they earn points), plus anyone who left or graduated with points in the window ([`points.md` § Leaderboard](../../behavior/points.md#leaderboard), 2026-11-06). |
| `(tabs)/points-details.tsx` | Absorbed into Tasks (s08) and Profile (s15) stat cards (s15's since folded into a points figure beside the You title, #5281); the ledger stays authoritative in [`../../behavior/points.md`](../../behavior/points.md). The s08 half has landed as the balance + house-rank card; no standalone leaderboard list replaced the deleted one, by design. |
| `(tabs)/notification-targets.tsx` | Notification preferences live in Settings (s16); opt-in happens via the contextual primer (s03 and [`patterns.md`](patterns.md)). |
| `(tabs)/onboarding-tour.tsx` | Replaced by the first-run screen (s03) — join flow behavior in [`../../behavior/onboarding.md`](../../behavior/onboarding.md). |
| `(tabs)/documents-reports.tsx` | Split: documents become s12; reports remain web-only and do not return to mobile. |

## Renames

Both have landed.

| Former file | Now | Screen |
| ----------- | --- | ------ |
| `(tabs)/chat.tsx` | `(app)/(tabs)/index.tsx` | s04 — chat list is the home/index route |
| `(tabs)/task-center.tsx` | `(app)/(tabs)/tasks.tsx`, then `(app)/tasks.tsx` (#4610) | s08 |

All renames and removals above shipped in one PR, as the typed-routes rule requires ([`navigation.md`](navigation.md)).
Stale deep links into the removed paths land on `app/+not-found.tsx`, which redirects to home rather than drawing a dead end.

## Notes

- Every screen implements the skeleton/empty/error states family — rule stated once in [`README.md`](README.md), not per row.
  The shared pieces are in `apps/mobile/components/state-block.tsx`, built to [`../design-system/components.md`](../design-system/components.md) §10: each screen draws its own loading skeleton from them (`SkeletonRegion`, `SkeletonText`, and the row and card placeholders beside their components), and the generic `SkeletonLines` card is left only for states that are themselves one card, plus two list-shaped sheets still owed their own (member detail and blocked members, [#3522](https://github.com/pdcarlson/Frapp/issues/3522)).
  It adds a fourth member: a **"no chapter selected"** state, because a token with no `active_chapter_id` claim (no membership yet, or the hook disabled as incident mitigation) leaves every chapter-scoped query disabled and that is what a member actually sees.
  The screens predating it still carry their own inline loading/error blocks.
- **s17 has no mock.**
  Until 2026-11-12 Ask answered from a hand-written keyword table behind a build flag (`EXPO_PUBLIC_ASK_ENABLED`), with a note here on how that squared with the omit-don't-fake rule below.
  The note ended "the moment the flag can be turned on for a real chapter, that file must be gone rather than extended", and it is: the table, the flag and `app.config.js`'s production fence were deleted when Ask got a real API (#4415), and nothing on the phone answers from invented data.
- **Elements drawn in Canvas that have no backing data are omitted, not faked.**
  In this cluster: s16's "Join code" (chapters have no join code — joining runs through single-use, expiring invite tokens), s15's "96% attendance" and its Big brother row (its Pledge class row is drawn since #3939, and Phone since #3711), and s11's payment plan, payment-method sub-labels (`Visa ··4242`) and receipts-email line.
  Each carries a `TODO-DESIGN:` at its site and a filed issue. s08's study task row and s14's study reminder both draw a weekly goal's remainder; the goal exists since #1062, but neither surface is built, so both rows are simply left out.
- s16's drawn title is "Settings" while the route file is `preferences.tsx`.
  The filename is not part of any external contract.
  **Settled: it stays `preferences.tsx`** — it did not join the rename PR, and the registration carries the drawn title instead.
  Cite `preferences.tsx` for the route and "Settings" for anything a member reads.
