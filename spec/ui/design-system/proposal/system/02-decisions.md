# Decisions for Paul

Everything in the system that is not already one of your rulings. Each line is a recommendation, already built into the previews so you can see it. Say yes, no, or change it; a yes moves the line into the rulebook.

## Proposed

### Layout

Drawn in Page types, Standing page, Browse page and Record page, each beside today's capture, and written out under Screen layouts.

| # | Proposal | Today | Why |
| --- | --- | --- | --- |
| 39 | **Six page types** (Standing, Browse, Record, Form, Settings, Conversation). Every route is one, and the type fixes the skeleton. | Each page invents its arrangement. | A new screen starts from a type, not from a blank page. |
| 40 | **One column, at most 720 wide, from the title's left edge.** No columns inside a page; one aside for context only when the page is wide. | Events, Points, Documents and Settings split an 826 page in two; records sit in an inner column a third narrower. | Text stops truncating on a mostly empty screen, and the phone becomes the same page. |
| 41 | **A standing page opens on one figure.** | Three figures on Service hours, two the same; pills on Points. | Activity already does this and is the best screen in the app. |
| 42 | **A fixed order of sections:** the answer, To review (officers), yours, the chapter's. | Differs by page; the queue is last on Service hours and second on Activity. | One order for three people. |
| 43 | **Events is one column:** a week strip, a group per day, Month as a view, tasks and birthdays as layers off at rest. The phone matches and is called Events. | A month grid beside an agenda on web; a full month on the phone, called Calendar. | The biggest web and phone mismatch in the captures. |
| 44 | **Points, Service hours, Study hours and Dues share one skeleton**, and the window switch moves into the header. | Four arrangements; your 2026-11-19 ruling keeps Points' switch in the body. | It fits the header once the page is one column. |
| 45 | **An attendance row has one control**, a status that opens a picker, with "Mark the rest absent" under More. | Four buttons on each of 26 rows. | One control per row. It costs a click per member; your call as the one who takes roll. |
| 46 | **The phone's week strip keeps single weekday letters**, the one exception to the no-abbreviations rule. | Already so. | Seven written-out names don't fit. |
| 47 | **The phone gets the pages it lacks:** a Points screen, standings on Service hours. | Web only. | Parity. This is new surface, so it waits on you under the baseline-first rule. |

### Placement

Drawn in the List page, Record page and Form page templates, and written out under Where things go.

| # | Proposal | Today | Why |
| --- | --- | --- | --- |
| 29 | **One rule for every action: it sits on the trailing edge of the thing it acts on, and the body holds no free-standing buttons.** | Each screen decides. The same six jobs sit in three to seven places. | Most of the parts are already your rulings; this joins them so there is nothing left to decide per screen. |
| 30 | **A record's next step is its one filled button, in the header on web and the action bar on the phone.** | "Start" is a small button in the body; "Host check-in" and "Open event" are full-width buttons inside cards. | Your action-bar pick and "no giant buttons", applied to every record. |
| 31 | **No Edit button and no pencil. Values edit in place.** | Seven ways to edit, including a pencil in headers and "Edit permissions" on each of four sections. | "Edit a thing where you're looking at it." One exception to rule on: the pencil in the phone's action bar, which you picked on 2026-11-20. I'd fold it into More. |
| 32 | **Adding a line is always the group's last row.** | A row, a dashed chip, Secondary buttons and underlined links, five ways in all. | One fix lands on every record. |
| 33 | **Going somewhere is a row with a chevron, never a button.** | "Open event", "Write minutes" and "Task board" are buttons. | Buttons then always mean "do". |
| 34 | **On the phone, More sits in the action bar when there is one, else it is the header button.** | Five placements. | |
| 35 | **A fixed order in the web header:** title, view switch, search, Filter, More, main action, close. | Varies by page. | |
| 36 | **The plus means New.** A main action that isn't a create is label only. | A plus on "Log service", sliders on "Adjust points", an arrow and a caret on "Upload". | |
| 37 | **A commit names the thing:** "Create event", "Post minutes", "Send invite". | "Create", "Submit adjustment", "Submit for approval". | Your 2026-11-20 rule for web, extended to the phone and to dialogs. |
| 38 | **No Cancel beside a commit on a form, and no footer hints.** | "Cancel" in sheet headers; "Ctrl + Enter to create" and "Going back keeps your draft" under the web form. | Back already keeps the draft. |

### Structure

| # | Proposal | Today | Why |
| --- | --- | --- | --- |
| 1 | **A raised group is `surface-1` on the page on web too**, 14 radius, dividers inset 16. | Web cards are `card` on the page (two steps up) at 16 or 14 radius; the phone is `surface-1`. | Your 2026-11-13 call for the phone was one step, not two. One rule for both apps. |
| 2 | **Lists that grow sit in a raised group** on both apps. | `spec/ui/mobile/patterns.md` § Rows keeps them flat on the page; every web list floats. | Your 2026-11-20 ruling says content sits on a raised surface. This makes it explicit that long lists are included. |
| 3 | **A section header is sentence case, 14/600, `muted-foreground`, with its count.** | All-caps tracked eyebrow, 209 uses across both apps. | Removing the eyebrow is your ruling; this is the replacement. The phone already writes Chat home's "Chapter" and "Committees" this way. |
| 4 | **Web's page title takes the `title` role (18/600).** | 14/700, the same size as a row title. | A page needs an anchor. The phone's screen title is already 24/700. |
| 5 | **One shared list row on web**, with the phone's grammar: lead, title, one meta line, trailing. | Nine hand-rolled row files in three shapes. | One fix lands everywhere. |
| 6 | **A two-line row takes 8 of vertical padding on the phone** (about 54 tall). | 12, about 60 tall. | This is the measured cause of "rows too big". Up next and Minutes rows already use 8. |
| 7 | **One row type size**: 14/600 title, 12.5 meta, in lists, sheets and menus alike, except a picker's and a menu's options at 16. | The same row job is 14 in `ListRow` and 16 in 37 sheet and menu row styles. | The rest of "type too big". |
| 8 | **A task's check is a circle on both apps.** | Web 20 circle; phone 24 rounded square. | The square checkbox already means "select this row" in tables. |

### Colour and controls

| # | Proposal | Today | Why |
| --- | --- | --- | --- |
| 9 | **A view switch's held segment is neutral** (`popover`, `foreground`). The accent stays for a choice inside a form. | Held is the accent tint everywhere on web; the phone adds an accent border. | On a list page the accent then appears twice: where you are and what you can make. Web's `quiet` variant already draws it. |
| 10 | **One "on" look on both apps:** `accent-subtle` with `accent-text`. Solid accent only for the primary button, a switch and a checked box. | The phone paints a selected chip solid accent. | Three "selected" languages today. |
| 11 | **At most one chip in a row.** A status is a word in the meta line. | Chip soup on 6 web rows and 2 phone rows; four chip families on the phone. | Your 2026-11-20 call on chip soup, made countable. |
| 12 | **The phone's delete confirm is Frapp's own dialog**, with a haptic. | The system alert, 21 call sites. | The last step before a delete should look like Frapp. Until built, all go through one helper. |
| 13 | **The phone picker loses its title, gains search past 8 options, and the chosen row keeps its size.** | `OptionSheet` requires a title, never searches, and shrinks the chosen row from 16 to 14. | The rulebook already says no title; the rest stops the list jumping. |
| 14 | **One shared phone `Button`** with web's variant names, and the full-width sheet button retired in favour of the glass action bar. | No shared button; `SheetPrimaryButton` has 43 uses. | The action bar is your pick; this names what it replaces. |
| 15 | **The glass menu's corner is 20**, the scale's ceiling. | 22. | One fewer off-map radius. Low stakes. |
| 16 | **An empty group is one fact and the first action on the same line**, from one shared component per app. | 147 hand-written sentences; none shared. | "Empty states keep the real layout at zero", made buildable. |
| 17 | **One error card, sized to its content.** The phone's opacity pulse is accepted as its loading motion. | Web's card has a fixed 208 minimum; web shimmers, the phone pulses. | The shape and colour match, which is what the rule protects. |

### Words

| # | Proposal | Today |
| --- | --- | --- |
| 18 | **Durations are written out:** "45 minutes", "1 hour 5 minutes", "18.5 hours". | Eleven shapes on web and eight on the phone, including "1h 5m", "2.4 hrs", "18.5 h". |
| 19 | **Points are "10 points" and "+10 points".** | `formatPointsChip` prints "+10 pts" at 14 call sites. |
| 20 | **Status picks where two words ship:** Sent back (not Needs changes) · Done (not Confirmed or Completed, for a task) · Declined (not Rejected) · Past due for money on both apps (web says Overdue) · Mandatory (not Required) · Check-in is closed (not Closed). | 12 states have more than one word. |
| 21 | **Label picks:** Try again (not Retry) · New event in the header, Create event on the commit · Delete a thing, Remove from a set, Discard a draft · Cancel (not Close or Dismiss). | 9 action families have several labels. |
| 22 | **The order of facts in a meta line** is fixed per kind of thing (the table in the brand book). | Orders differ by screen. |
| 23 | **"Pending" means only "waiting on a person's decision".** | Six meanings. |

### Tokens and type

| # | Proposal | Today |
| --- | --- | --- |
| 24 | **The control size scale becomes tokens** (`control-chip` 24, `control-row` 32, `control-small` 36, `control-field` 40). | Values in foundations § 9, written as raw classes. |
| 25 | **The five non-body line heights become tokens on both apps** (1.15, 1.2, 1.3, 1.3, 1.35). | Literals in web's Tailwind preset; the phone uses the platform default. Open as L-09. |
| 26 | **"A rounded square is a thing or a place; a circle is a person"** becomes a stated rule. | True of the radius map, never written. |
| 27 | **The state line becomes a shared component** on both apps. | Your 2026-11-20 rule; each screen writes it by hand. |
| 28 | **Weight 500 leaves web.** | `font-medium` on settings rows, task rows, read notifications. The system ships 400, 600 and 700. |

## Two questions only you can answer

1. **Greek letters.** Your note says never on screen. The code stores a chapter's letters and shows them by default (`packages/validation/src/chapter-mark.ts`, the "Show Greek letters" switch), and the rulebook's line is about organisations that forbid them. Recommendation: Frapp's own strings never contain them (four Greek-letter placeholders go), and a chapter's own letters stay behind the switch, off by default.
2. **The Messages short date.** Your note bans "Nov 26"; the rulebook keeps `formatConversationTime` ("Nov 6") as an exception for the Messages list (#5519). Recommendation: keep the exception there and nowhere else, as WhatsApp and iMessage do.

## Changed

Earlier rulings this system reverses, with both sides, so the record and the code don't silently disagree.

| Was | Now | Where the old ruling lives |
| --- | --- | --- |
| The section label is the uppercase eyebrow: caption, 600, tracked 0.12em. | No all-caps. Named as slop 2026-11-20. | `apps/web/components/ui/typography.ts` (`EYEBROW`), `apps/mobile/components/eyebrow.ts`, `spec/ui/design-system/components.md` § 2 |
| A list that grows stays flat on the screen background, split by hairlines (2026-11-12). | Content sits on a raised surface (2026-11-20). | `spec/ui/mobile/patterns.md` § Rows |
| A sheet or a flow step ends with a full-width 48 Primary button. | No giant full-width buttons; the phone commit is the floating glass action bar (2026-11-20). | `spec/ui/design-system/foundations.md` § 9, the Primary step |
| Errors and copy "say what happened and what to do". | State facts, never narrate directions (2026-11-20). An error still gives one way out, as a button. | `spec/ui/design-system/writing.md` § 1 and § 4 |
| "Tap + to upload one." and "…will appear here." are approved empty-state strings. | An empty line states one fact. | `writing.md` § 4 rule 2 and the § 7 string tables |
| `Nov 6`, `Fri` and `+10 pts` are approved formats. | No abbreviations (2026-11-07), restated 2026-11-20. | `writing.md` § 5a and line 367 |
| A delete on the phone "asks in the platform alert first". | Proposed above (#12). | `spec/ui/mobile/patterns.md` § Long-press item menu |
| The hairline is 12% white. | 18% since 2026-11-20. The token moved; three docs still say 12% or 8%. | `components.md` line 233, `packages/theme/src/glass.ts` comments |
