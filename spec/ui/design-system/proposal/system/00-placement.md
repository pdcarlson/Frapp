# Where things go

The parts were never the gap. The gap is that nothing says where a button goes, so each screen decides again. On the captured screens the same six jobs sit in three to seven different places (the table at the end). This page fixes a home for every action on both apps. The three templates under Components, in the Screens group, draw it: List page, Record page, Form page.

## The rule

**An action sits on the trailing edge of the thing it acts on. The body between the edges holds content, not buttons.**

Ask what the action acts on. That decides where it goes.

| It acts on | Web home | Phone home |
| --- | --- | --- |
| The page and its list | The page header, trailing | The floating glass plus, and the one header button |
| A record, or a form | That surface's header, trailing | The floating glass action bar |
| A group of rows | The section header's trailing edge; to add a line, the group's last row | The same |
| One row | The row's trailing edge (one control), and its menu | The same; the menu is a long-press |
| A piece of content: a file, a link, a code, a photo | A glyph at its own trailing edge | The same |
| A question | The dialog's bottom trailing edge | The same |

*The rule as one statement is Proposed. Most of its parts are already your rulings: page actions in the header (P8.1), the one New button (P8.2), rare controls behind More and delete last (2026-11-06, 2026-11-11), the commit at the header's trailing edge on web and in the glass action bar on the phone (2026-11-20), no full-width buttons (2026-11-20), one filled button per surface (P3.3), nothing reachable twice on one screen (P3.1).*

## Which button it is

Then ask what kind of action it is. That decides how it looks. Kind and home together leave no choice to make on the screen.

| # | The job | Look | Web | Phone | Says |
| --- | --- | --- | --- | --- | --- |
| 1 | Make a new thing of this page's kind | Action, with the plus | Page header, last before close | Floating plus | New event |
| 2 | The page's main action that isn't a create | Action, label only | The same slot | Floating plus | Log service · Upload · Invite member · Adjust points |
| 3 | A record's next step, or committing a form | Primary, Small. The only filled button | The record's or form's header, trailing | The action bar's pill | Mark done · Start · Host check-in · Post minutes · Create event · Send invite |
| 4 | Change a value | No button. The value opens its picker in place | Its property row | Its property row | |
| 5 | Add a line to a record | The add row: a plus and words in `muted-foreground` | The group's last row | The same | Add agenda item · Add subtask · Add attachment |
| 6 | Anything rare, and anything destructive | The More glyph, opening the menu | Header, just before the main action | In the action bar; the header button when the screen has no bar | Duplicate · Copy link · Delete, last |
| 7 | Act on one row | The row's menu; at most one control on the row | Row, trailing | Long-press | |
| 8 | Go somewhere else | A row with a chevron, or a link in running text. Never a button | In the list | In the list | Open event · Write minutes · Task board · Show all |
| 9 | An invitation inside content | Tinted, Small | Trailing edge of the row or card it belongs to | The same | Sign up · Vote |
| 10 | Copy, download, share, close | A glyph with a name | On the thing | On the thing | |
| 11 | Answer a question | Secondary, then Primary or Destructive | Dialog, bottom trailing | The same | Cancel · Rename; Cancel · Delete task |
| 12 | Leave | Back glyph at the leading edge of a record or form; close glyph in a page's trailing corner | | The glass back capsule | |
| 13 | Switch view, search, filter | Segmented; a glyph; Secondary "Filter" | Header, right after the title | Under the title: the switch, the search field, one Filters chip | |
| 14 | Act on many rows | A selection bar that takes the header's place | Header | Action bar | Assign · Delete |

## Order

- **Web page header:** title · view switch · search · Filter · More · main action · close.
- **Web record or form header:** back · title · why the commit is off · More · the one Primary.
- **Phone:** back capsule; title with one header button; content; the floating plus or the action bar, never both.
- **Action bar:** the labelled pill first, then at most two glyphs, More last.
- **Menu:** most used first, at most three groups, Delete last after a break.
- **Dialog:** Cancel, then the verb.

## Budget

- **One filled button per surface.** A page, a record, a form, a dialog each get one Primary at most. A list page usually has none.
- **One main action per page.**
- **One control per row.** A task's check, a switch, an attendance mark. A second action goes in the menu.
- **No button stands on a line of its own in the body.** If something in the body needs pressing, it is a row.
- **The plus glyph means New** and appears only on the New button, the floating plus and the add row.

## Never

- A filled button anywhere but a header, the action bar or a dialog.
- A button stretched across a card, a sheet or a page.
- A pencil in a header, or a button that says Edit. Values edit in place. (The phone's action bar may carry a glyph for a related option, as Paul picked on 2026-11-20; whether Edit is one of them is decision 31.)
- A bare trash glyph in a header. Delete is under More.
- A dashed "+ Add" chip, or an underlined "Add a link". Adding a line is the add row.
- A commit that says "Create", "Submit", "Done" or "Save". It names the thing: "Create event", "Post minutes".
- A Cancel beside a commit on a form. Back keeps the draft.
- A footer of hints under a form ("Ctrl + Enter to create", "Changes save as you make them").
- Navigation dressed as a button ("Open event").
- The same action twice on one screen.
- A different glyph on each page's main action.

## What the screens do today

Read from the captures of the seeded chapter. This is what was seen, screen by screen, not a count.

| Job | Where it sits today |
| --- | --- |
| Commit a form | A filled "Create" in the header (web New event). A filled button in a second header inside the body (web Minutes, "Post minutes"). A dialog footer (web Adjust points, "Submit adjustment"). Under the field (web Invite, "Send invite"). No visible commit at all (web New task). A pill in the sheet's header (phone New event). A full-width bar at the bottom of a sheet (phone New task, phone Log service). |
| A record's next step | A small Secondary in the body beside the status (web task, "Start"). A full-width filled button inside a card (phone event, "Host check-in"). A full-width outlined button inside a card (phone Activity, "Open event"). The glass action bar (phone task, "Mark done"): the one that is right. |
| Edit | A pencil in the header (event, both apps). An accent "Edit" link at a section's edge (web profile). A plain "Edit" (web Documents folders). An "Edit permissions" button on each of four sections (web Roles). An "Edit types" text button (web New event). A pencil in the action bar (phone task). In place, with no button (web task). |
| Delete | A bare trash glyph in the header (web event). Under More (web task, web profile). |
| Add a line | A plain row (event agenda, both apps). A row inside the group (web Roles). A dashed chip (profile roles and groups, both apps). Secondary buttons (web Minutes: "Add a date", "Add a decision", "Add an action item"; web task: "Add photos"). Accent or underlined links (event: "Add a link", "Attach from Chapter Files"; phone Minutes). |
| Filter | A header button (web Events, Tasks). A body button that says "Filters" (web Documents). Five dropdown pills (web Directory). Two select boxes (web Points). Two rows of chips (phone Documents). One Filters chip (phone Directory). |
| More | A ghost glyph in the header (web). A bare glyph (phone profile). A glyph in a circle (phone Minutes). In the action bar (phone task). On a card (phone Activity). |
| The main action's glyph | A plus on "Log service". Sliders on "Adjust points". An arrow and a split caret on "Upload". A person on a filled "Invite member". |

Rough counts behind it, each a pattern search and so a proxy: a pencil glyph in 17 web files and 9 phone files; a trash glyph in 18 web files; dashed borders in 15 web files; "Add a …" labels on 27 web controls in 19 files and 26 phone controls in 15 files; the phone's full-width sheet button 43 times in 34 files against 4 uses of the action bar. The measured rules that overlap are W5, W6, W7, W18, M5, M6 and M19 under Drift found.

## Why these homes

- **The thing and its action are read together.** An action at the edge of what it acts on needs no label saying what it applies to, which is why none of these homes needs a sentence.
- **A fixed place is learned once.** A member who has found New on Events knows where it is on every page.
- **Trailing is where the platforms already put it.** The comparables Paul names (Linear, Notion, Slack) put a page's actions at the header's trailing edge. On a phone the bottom edge is where a thumb reaches, which is why the create and the commit float there.
- **One filled button makes the next step obvious**, and keeps the chapter's colour rare.

The guideline families behind these are Apple's Human Interface Guidelines (the trailing end of a navigation bar for a screen's main action; bottom toolbars on a phone; destructive actions kept apart), Material's rule of one floating action per screen for its most important constructive action, and Nielsen Norman Group's guidance on consistent placement and on naming a button for what it does. These are cited from memory, not re-read for this pass; the UI system thread should check each against its source before the rules enter the rulebook.
