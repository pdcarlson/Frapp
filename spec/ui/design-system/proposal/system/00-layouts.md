# Screen layouts

The components and the button homes sit inside layouts, and the layouts themselves are a large part of why the app reads as a generic dashboard. This page judges today's layouts from the captures and replaces them with six page types. Three screens are redrawn in full beside today's capture, under Components in the Screens group: Standing page (Service hours), Browse page (Events) and Record page (an event). Page types shows all six skeletons.

Everything on this page is **Proposed** unless a ruling is cited.

## What is wrong with today's layouts

1. **Each page is a small dashboard squeezed into a narrow column.** Beside chat at 1440 the page is 826 wide, and Events splits it into a month grid and an agenda, Points into a leaderboard and a history each with its own search field, Documents into folders and files, Settings into a rail and a form. Every half is about 400 wide, so text truncates on a screen that is mostly empty.
2. **Pages don't open on an answer.** Events opens on a month grid. Points opens on three pills. Service hours opens on three figures, two of them the same number. Only Activity opens by answering its question ("2 left this week"), and it is the screen built for the three-people ruling.
3. **Sections have no fixed order.** Service hours runs your hours, your log, the chapter's board, then the officers' review queue at the bottom. Activity puts To review second. A member and an exec get the same stack.
4. **Record pages put a column inside the column.** An event, a task, a profile and Invite all start their content about 100 in and a third narrower than the page, with the title at the far left above it. Values wrap beside empty space.
5. **A row tries to be a toolbar.** Each of 26 attendance rows carries four buttons. Each day heading on Events carries a link.
6. **The phone is often a different page, not the same page smaller.** Events is an agenda beside a month on web and a full month over one day's rows on the phone, titled Calendar. Service hours on the phone has no standings and no queue. Points has no phone screen at all.
7. **Forms are pages on web and tall sheets on the phone**, so the same task has two shapes and two commits.

## The grammar

1. **Six page types.** Every route is one of them, and the type fixes the skeleton. A new screen picks its type before anything is drawn.
2. **One column.** A page is a single column, at most 720 wide, starting at the title's left edge. No columns inside a page, and no narrower column inside the column.
3. **One aside, only when wide.** With chat closed and the page wider than about 1100, context may sit beside the column in an aside about 280 wide: the month beside the agenda, the standings beside your log, folders beside files. It never holds the page's main content, and it drops under the column when narrow and on the phone.
4. **Answer first.** A standing page opens on one figure in a raised group: the number, its unit in words, and one line of context.
5. **A fixed order of sections.** The answer; To review, for officers only, five rows at most with Show all; yours; then the chapter's. A member never sees the queue, and never sees a zero in its place. *The fold and the hiding are confirmed: P5.8 and #4766.*
6. **Lists by day read as days.** One group per day under a written-out heading ("Tomorrow", "Sunday, November 22"). A week strip is the only calendar on an agenda. The month is a view.
7. **One control per row.** A row never carries a set of buttons.
8. **The phone is the same page.** Same type, same groups, same order, same words, same name. The aside becomes the next group down. *Confirmed as a rule, 2026-11-19, P6.*

## The six types

| Type | The question it answers | Skeleton, top to bottom | Screens |
| --- | --- | --- | --- |
| **Standing** | Where do I stand? | Header with the window switch and the main action. One figure. To review (officers). Yours. The chapter's. | Activity · Points · Service hours · Study hours · Dues · You |
| **Browse** | Which one? | Header with view switch, search, Filter, New. The list from the first line, in groups by day or kind. | Events · Tasks · Meetings · Documents · Directory · Backwork · Notifications · Messages · Chat home |
| **Record** | What is this, and what's next? | Header with back, the next step. State line. Properties. What it holds. Who. History. | An event · a task · a set of minutes · a member · a document · a role |
| **Form** | Make one. | Header with back and the commit. A borderless title. Property rows in groups. | New event · New task · Log service · Invite members · Adjust points · New channel |
| **Settings** | How should it work? | Sections. Named groups of rows, one trailing thing each. Saved as it changes. | Chapter settings · Roles and groups · your Settings |
| **Conversation** | Talk. | Header. Messages from the bottom up. The composer pinned. | A channel · a direct message · Ask Frapp |

## Three people, per type

| Type | A member | A chair or an exec | Someone with nothing |
| --- | --- | --- | --- |
| Standing | The figure, yours, the chapter's | The same, with To review after the figure | The figure reads zero, and the first action sits where the first item would |
| Browse | Opens on their own items | The same, with the view switch to everyone's | One fact line in the group |
| Record | The next step they can take ("Check in") | The step for their role ("Host check-in", "Confirm") | No button, rather than a disabled one |
| Form | Only the rows they may set | Every row | |

## What changes, screen by screen

| Screen | Today | Becomes |
| --- | --- | --- |
| **Events** | Month grid and agenda side by side; events as tinted cards, tasks as circles; a link on each day heading; the phone a full month called Calendar | Browse. One column: a week strip, then a group per day, one row per event. Month is a view. Tasks and birthdays are layers under Filter. The same on the phone, called Events. *Drawn.* |
| **Service hours** | Three figures, log, board, queue; a switch mid-page; the phone one number and a history | Standing. One figure, To review, your log, standings; the switch in the header. The same on the phone. *Drawn.* |
| **Points** | Pills, a balance, then two columns each with search and selects; "#3" eleven times; no phone screen | Standing, the same skeleton as Service hours: one figure ("60 points · 2nd of 23"), your history, standings. A tie shows its rank once. |
| **Study hours, Dues** | Their own arrangements | Standing, the same skeleton. Dues' figure is the amount due and its date. |
| **An event, a task, a member** | An inner narrow column; a pencil and trash in the header; a next step in the body or missing; loose property lists; four buttons per attendance row | Record, filling the column. *The event is drawn.* An attendance row shows its status word and opens one picker. |
| **Documents** | Folders and files side by side inside the page | Browse. Folders are the aside when wide; otherwise the first group, or a Filter. |
| **Directory** | Tabs, two rows of controls, a select-all row, then the table | Browse. Actives and Alumni are the view switch; everything else is one Filter. |
| **Minutes** | Breadcrumb, a second header in the body, large boxes | Record while it is read; Form while it is drafted, with "Post minutes" as its commit. |
| **New event, New task, Log service** on the phone | Tall sheets with a full-width bar or a header pill | Form: a pushed screen with the action bar. |
| **Chat home, a channel** | | Unchanged. The team's read on 2026-11-12 was that chat is fine. |

## Rulings this touches

- **Points' window switch stays in the body** because it needs the page's width (rulebook § 2, 2026-11-19). In one column with three short options it fits the header; proposed to move.
- **Events shows tasks and birthdays as calendar layers.** Proposed to keep the layers and turn them off at rest.
- **Attendance marks are four buttons a row.** One picker a row costs an officer a second click per member; check-in by code already covers most of the room, and a bulk "Mark the rest absent" belongs under More. Worth your read as the person who takes attendance.
- **Weekday letters on the phone's week strip** (F, S, S) are the one place a weekday is a single letter. Seven written-out names don't fit 288 wide; web's strip writes them out. Proposed as the only exception to the no-abbreviations rule, for a calendar's column heads.
- **Pages beside chat stay** (2026-11-11, 2026-11-12). Nothing here removes the split.

## What is not drawn yet

Only Events, Service hours and an event record are redrawn in full. Points, Study hours, Dues, Documents, Directory, Minutes, a task and a member are assigned a type and described in the table above, not drawn. Chat and Ask are left as they are.
