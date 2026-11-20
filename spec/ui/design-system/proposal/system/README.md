Frapp is a fraternity chapter's app: chat, events, tasks, meetings and minutes, points and documents, on a web dashboard and a phone app that are one product. Three people open every screen: a member with a few things a week, a committee chair, and an exec with a queue. Build for all three, and for the member with nothing at all.

Every rule below carries a status. **Confirmed** cites the owner's ruling. **Changed** reverses an earlier ruling and cites both. **Proposed** is a recommendation that needs the owner's yes; the full list is under Decisions. Where the code disagrees with a rule, the rule wins and the code is listed under Drift found.

## What makes it Frapp

Frapp is the chapter's house, kept in order. Check every screen against these three.

1. **Rooms, not a void.** Everything a member reads or presses sits in a raised group with the `border` hairline around it. The page (`background`) is the floor, never the place content sits. *Confirmed, 2026-11-20.*
2. **The record speaks plainly.** One title, one meta line, one status word. Say who did it and when. No instructions, no capitals for emphasis, no abbreviations, no emoji. *Confirmed, 2026-11-20.*
3. **The colour is the chapter's, and it is rare.** `primary` and its family belong to the chapter and mark only where you are and the one thing to do. Frapp's own gold stays on Frapp's own mark. *Confirmed, foundations § 6, 2026-11-05.*

Two shapes carry the rest. **A rounded square is a thing or a place** (a lead tile, the chapter's mark, the emblem's field). **A circle is a person.** Nothing is a pill except the phone's glass chrome, a switch and a meter. *Proposed as a stated rule; it is already true of the radius map.*

## Content

### Voice

- **Indicate, don't narrate.** Show the state. Write "Moiz Steenhuis marked it done today at 12:05 AM", "Draft · Shawn Klein", "Winston Hewitt is recording". Never give directions: not "send it back if something's off", not "Tell the secretary if you object", not "A draft, not posted yet". The screen's own controls are the next step. *Confirmed, 2026-11-20.*
- **Design, don't explain.** No line under a title that says what the page is for. No sentence under a control whose label already says it. *Confirmed, P1.*
- **Don't repeat a word.** Under a meeting's title, write "Draft", not "Meeting minutes for this meeting: a draft". *Confirmed, 2026-11-20.*
- **Use the chapter's words**, not the system's and not invented ones. Never show a permission key, an enum, an id, a status code or a provider's error. *Confirmed, P2.*
- **Sentence case everywhere**: titles, buttons, section headers, notifications. Never all capitals, never Title Case. *Changed: the all-caps eyebrow was the documented section label; named as slop 2026-11-20.*
- **Address the member as "you"** only where a sentence needs a subject. Frapp never says "we".
- **Real identity.** Real names and real photos. Never "Member 000000", "A member" or a handle. *Confirmed, 2026-11-06.*

### Never on screen

- No emoji in anything Frapp draws or writes. Members' own emoji are their content. *Confirmed, 2026-11-05; lint.*
- No abbreviations: not "pts", "hrs", "min", "Thu", "Nov 26" or a class year as "'28". *Confirmed, 2026-11-07.*
- Never the word "Signet". The product is Frapp. *Confirmed, 2026-11-04.*
- Never Greek letters in Frapp's own chrome, copy, examples or placeholders. *Confirmed, 2026-11-04. Whether a chapter may still show its own letters is a decision under Decisions.*

### The meta line

A row has a title and one meta line. Put the facts people decide by in it, in a fixed order, joined by a middle dot.

| Thing | Order of facts | Example |
| --- | --- | --- |
| Event | status, time, place, points | Check-in is open · 7:00 – 8:30 PM · Great Room · 10 points |
| Task | status, due, who, points | In progress · Due Friday · Devin Okafor · 15 points |
| Minutes | status, who, day | Draft · Shawn Klein · Sunday, November 15 |
| Invoice | status, amount, due | Past due · $240.00 · Due November 1 |
| Member | role, class | Secretary · Class of 2027 |
| Document | folder, in effect | Policies · In effect November 1 |

Read the facts through the shared helpers (`taskRowFacts`, `formatTimeRange`, `CHECK_IN_OPEN_LABEL` in `@repo/validation`), so both apps print the same words. *Confirmed, 2026-11-19. The orders in this table are Proposed.*

### Status words

One state, one word, one tone, on both apps. The word comes from `STATUS_LABELS` in `packages/validation/src/status-labels.ts`. *The picks marked with a dagger are Proposed where today's code has two words.*

| Thing | Words | Tone token |
| --- | --- | --- |
| Task | To do · In progress · Waiting on an officer · Sent back† · Done† · Overdue | `muted-foreground` · `info-text` · `warning` · `warning` · `success` · `destructive-text` |
| Event | Mandatory · Check-in is open · Check-in is closed† | plain chip · `success` · `muted-foreground` |
| Attendance | Present · Late · Excused · Absent · Unrecorded | `success` · `warning` · `muted-foreground` · `destructive-text` · `muted-foreground` |
| Excuse | Pending · Excused · Declined | `warning` · `success` · `destructive-text` |
| Service hours | Pending · Approved · Declined† | `warning` · `success` · `destructive-text` |
| Minutes | Drafting · Draft · Posted | `info-text` · `muted-foreground` · `success` |
| Invoice | Draft · Open · Paid · Past due† · Void | `muted-foreground` · `warning` · `success` · `destructive-text` · `muted-foreground` |
| Study session | Active · Completed · Expired · Outside zone | `info-text` · `success` · `muted-foreground` · `warning` |

"Pending" means one thing: waiting on a person's decision. Don't use it for a payment that is confirming or a message that is sending; those are shown as pending in place, without a word.

### Notifications

One shape. The title says what happened; the body says which item and who. See Push notification.

- "Minutes recording uploaded" / "Recruitment meeting · Winston Hewitt"
- "Moiz Steenhuis finished: Book the venue" / "1 photo · 10 points"

The body never restates the title and never gives an instruction. *Confirmed, 2026-11-20.*

### Dates, times, numbers

Format through `@repo/formatting`. Never format a date in a screen.

| Kind | Write | Not |
| --- | --- | --- |
| Day | Today · Tomorrow · Friday (within the week) · November 14 · November 14, 2027 (only when the year differs) | Fri · Nov 14 · 11/14/2026 |
| Time | 7:00 PM · 7:00 – 8:30 PM | 19:00 · 7pm |
| Due | Due Friday · Due November 14 at 5:00 PM · Overdue by 2 days | Due 11/14 |
| Acted | today at 12:05 AM · yesterday at 4:12 PM | 12:05a |
| Points | 10 points · +10 points | 10 pts · +10 pts |
| Duration | 45 minutes · 1 hour 5 minutes · 18.5 hours (a total) † | 1h 5m · 2.4 hrs · 18.5 h |
| A running timer | 4:12 | 04:12 min |
| Money | $240.00, tabular numerals | $240 · 240 USD |
| Class | Class of 2027 | '27 |
| Count badge | 1 to 99, then 99+ | 128 |

The Messages screen's last-sent time is the one compact format (`formatConversationTime`: "4:46 PM", "Yesterday", then a short date). *Confirmed, #5519. Paul's 2026-11-20 list names "Nov 26" as not allowed; whether this exception stays is under Decisions.*

### Buttons and labels

| Job | Label | Not |
| --- | --- | --- |
| The page's create action | New event | Add event · + Create task |
| Commit a create form | Create event | Create · Submit · Done |
| Leave without doing it | Cancel | Close · Dismiss · Never mind |
| Destroy a thing | Delete task | Remove · OK · Yes |
| Take something out of a set | Remove member | Delete (for a person) |
| Drop a draft | Discard | Delete draft |
| After an error | Try again | Retry · Retry now |
| Put off a prompt | Not now | Later · Skip |

Words are for primary verbs only: Download, Copy and Close are glyphs with an accessible name. *Confirmed, 2026-11-05. The picks in this table are Proposed where two labels ship.*

### Empty and error wording

- Empty: one fact. "No tasks this week." Never where things will appear, never which button to press.
- Search miss: "No tasks match "banquet"."
- Error: what happened, then one way out. "Couldn't load tasks" / "The connection dropped while loading." / Try again. Start a permission error with "Your role can't".

## Colour

### The ladder

Four fixed steps and a hairline. The fills step softly (about 1.08 to 1.15 between steps); **the line does the separating**.

- `background`: the page. Only a page title and section headers sit on it.
- `surface-1`: a raised group on the page; web's sidebar and fields; the fill under the phone's glass.
- `card`: a group inside a sheet, a dialog or a menu; what needs its own edge inside a group; the Secondary button.
- `popover`: menus, dialogs, sheets, a held segment.
- `card-hover`: every hover, pressed and keyboard highlight. Never an accent tint.
- `border`: every pane edge, group edge and divider. `control-edge`: the edge of a control a member has to find. `input`: the quiet edge of things meant to recede.
- No shadows. Elevation is a lighter step plus the hairline.

A group is one step above what it sits on. Never two.

### Text

`foreground` for titles, values and figures. `muted-foreground` for the meta line, section headers and labelling glyphs. `muted` for timestamps, placeholders and the dots of a meta line. `disabled` only for disabled labels. All but `disabled` clear 4.5:1 on every step and on `card-hover` (measured; see each token).

### The accent

`primary`, `primary-hover`, `primary-foreground`, `accent-subtle`, `accent-border`, `accent-text` and `ring` come from the chapter's one seed through the accent engine. Never use the seed hex. The values shown here are the house default.

The accent marks only:

1. The one primary action of a screen, sheet or card.
2. A control the member switched on: a checked box, a switch, a selected option, an active filter.
3. Focus, through `ring`.
4. A link in running text, in `accent-text`.
5. The chapter's own mark, where the chapter is the subject.
6. Where the member is: the active row of a navigation list.
7. A chat row that addresses the member.

Everything else is neutral: names (your own included), labels, section headers, numbers, icons, hovers, spinners, done states. *Confirmed, 2026-11-05 and 2026-11-06.*

**One "on" look.** A selected chip, option or navigation row is `accent-subtle` with `accent-text`. Solid `primary` is for the primary button, a switch that is on, and a checked box. *Proposed: the phone paints selected chips solid today.*

**A view switch is neutral.** The held segment of a view switch in a page header is `popover` with `foreground`. *Proposed.*

### Status

`success`, `warning`, `destructive` and `info` state a fact and never decorate. As text, danger is `destructive-text` and info is `info-text`. A status fill is always its tint token (`success-tint` and the others), never an alpha utility. Ink on a solid status fill is the matching `-foreground`.

`mention` means one thing: you were addressed. It is the count badge on a mention or a direct message and nothing else. A channel with plain unread shows a bold title and a `foreground` pip, with no number.

### Hues

The ten `hue-` tokens name a place, a role or a person: a lead tile on the You tab, a folder, a role's colour, an initials avatar. Paint them as a tile, the hue at 14% over `card` with the glyph in the hue. A hue never means a state and is never the accent. Rows that show a state (Activity, Up next, Calendar) keep neutral tiles. *Confirmed, 2026-11-12.*

### Frapp's gold

`gold-house` and the `gold-ask-` family are Frapp's own and never take a chapter's colour. Use them only where Frapp speaks as itself: Ask's source markers. Never show house gold inside a chapter that picked its own accent.

## Type

Figtree, at 400, 600 and 700. No other weight: web's 500 is drift. Italic only in chat.

| Role | Use it for |
| --- | --- |
| `display` 32/700 | The one figure of a screen: a points total, a timer, hours this term. Tabular numerals, `foreground`, the unit written out beside it in `caption`. At most one. |
| `headline` 24/700 | A record's own title on its page. The screen title on the phone. |
| `title` 18/600 | The page title in web's header (*Proposed; 14/700 today*). A dialog's or sheet's title. |
| `body` 16/25 | Anything a member reads as prose or types. Never smaller. |
| `label` 14/600 | A row's title, a button, a tab, a section header. |
| `caption` 12.5 | A row's meta line, a timestamp, a chip. Never a paragraph. |

- Sizes come from the scale. No arithmetic on a role, no literal size in a screen.
- `mono` is for a join code or an invite token. Money, points and timers are Figtree with tabular numerals.
- Line heights: `body` is 25. The other five take 1.15, 1.2, 1.3, 1.3 and 1.35 on web; the phone leaves them to the platform. *Proposed: make these five the tokens on both apps.*
- In a row with an icon, centre every item. In a text-only row, align baselines. Text is centred in its box.

## Shape and size

- Radius from the map: `radius-xs` 8 chips and small tiles · `radius-sm` 10 navigation rows and segments · `radius` 12 controls · `radius-lg` 14 groups and cards · `radius-xl` 16 large cards · `radius-2xl` 20 sheets and dialogs, the ceiling.
- No pills on rectangles. A full round is a switch track, a meter, an avatar and the phone's glass chrome.
- Spacing on the 4 grid: 8 inside a component, 16 between components, 24 between sections.
- Control heights from the scale: `control-chip` 24, `control-row` 32, `control-small` 36, `control-field` 40. Anything a finger lands on is at least `touch-min` 44. Never pick a bigger step for emphasis. *Confirmed, 2026-11-05.*
- A button is as wide as its label. Full width only on sign-in, setup and payment. *Confirmed, 2026-11-20.*
- Rows are compact: a one-line row is 44 on the phone and 36 on web; a two-line row lands near 54 and 48. *The two-line padding is Proposed.*

## Layout

### Page types

Every screen is one of six types, and the type fixes its skeleton on both apps: **Standing** (opens on one figure, then To review for officers, yours, the chapter's), **Browse** (the list from the first line, in groups), **Record** (state, next step, properties, contents, people, history), **Form** (a borderless title and property rows, one commit), **Settings** (sections of grouped rows) and **Conversation**. *Proposed.*

- One column, at most 720 wide, starting at the title's left edge. No columns inside a page.
- One aside for context, only when the page is wide. It drops under the column when narrow and on the phone.
- A row has one control.
- The phone is the same page: same type, groups, order, words and name.

The types, the route table and the redrawn screens are under Screen layouts.

### Where actions go

**An action sits on the trailing edge of the thing it acts on. The body holds content, not buttons.** *Proposed as one rule; its parts are confirmed.*

- The page: its header on web, the floating plus on the phone.
- A record or a form: its header's trailing edge on web, the glass action bar on the phone. One filled button, and it is the next step.
- A group: its section header's trailing edge; to add a line, its last row.
- A row: one control at its trailing edge, and its menu.
- A piece of content: a glyph on the thing.
- A question: the dialog's bottom trailing edge, Cancel then the verb.

Never a button on a line of its own in the body, a full-width button in a card, a pencil in a header or an Edit button, a bare trash glyph in a header, a dashed add chip, or a commit that says only "Create" or "Submit". The full map, the order and the budgets are under Where things go; the List page, Record page and Form page templates draw it.

### Web

- A page sits beside chat and can always close. Only Settings is full width.
- The page header holds the title and every page action. Nothing sits between it and the first item at rest.
- A list opens on the viewer's own items.
- A record or a form docks in the page's own column. A short question is a centred dialog. A quick list is a dropdown under its button. **No card slides over the page from the side.**
- Rare controls sit behind the more button. Destructive actions sit there too, last.
- Edit a thing where you're looking at it. One setting, one place.

### Phone

- Chat is home. Four tabs in the floating glass bar, with the quick-actions plus beside it.
- A pushed screen has a glass back capsule, a `headline` title that scrolls, at most one header button, and the floating glass plus for its create action.
- A sheet is for one short pick or action and is as tall as its content. Several sections to fill in is a pushed screen.
- Menus are Frapp's own glass menu, opened by long-press with a haptic. Never the system action sheet.
- A form commits from the floating glass action bar.
- Swipe back everywhere; Android back closes the top sheet; pull to refresh on every list that updates.

### One product

Every change lands on both apps: the same structure, options, wording and order. Shared words and orders live in `@repo/validation` and `@repo/formatting`. A platform that can't follow yet gets a filed issue. *Confirmed, 2026-11-19, P6.*

## Glass

Glass is the phone's chrome and nothing else: the tab bar, the back capsule, the floating plus, the action bar, the menu, the quick-actions panel, and the blur under a scrim. `surface-1` at `glass-fill-alpha` over a `glass-blur` blur, a `glass-edge` edge, a sheen from `glass-specular` to nothing by `glass-specular-stop`. No glow, no shadow. Never a sheet, a card or a field: those stay solid so their text keeps its measured contrast. With Reduce Transparency on it is plain `surface-1` with the hairline.

## Motion and haptics

Four classes, from tokens, never a one-off number.

- `duration-micro` for a press, a hover, a switch.
- `duration-standard` for a menu or popover opening, rows sliding apart.
- `duration-context` for a panel docking, a sheet rising, a pushed screen.
- `duration-signature` on `easing-settle` only for a signature moment from the catalog: one per flow, plays once, over within `duration-signature-total`, and each new moment needs the owner's sign-off.

Hover changes colour only. Pending never moves the layout. Everything respects reduced motion.

On the phone, haptics come from the three helpers in `apps/mobile/lib/haptics.ts`: the selection tick for a pick or a toggle, the medium impact for a long-press menu, the success notification for something done. A menu never opens silently.

## Iconography

- Glyphs are drawn, never typed, and one meaning has one glyph across both apps.
- **Place glyphs** (navigation, lead tiles) are the duotone set in `packages/theme/src/nav-glyphs.ts`: a 256 grid, the silhouette at 20% (30% when active) under the outline. 20 in a 32 tile.
- **Control glyphs** (close, plus, check, chevrons, search, filter, more) follow one recipe: a 24 grid, 1.6 stroke, round caps and joins; the back and forward chevrons at 2.2. 20 by default, 16 inside a Small control. The phone draws them in `apps/mobile/components/control-glyphs.tsx`; web takes the same shapes from `lucide-react`, at that library's own stroke of 2.
- A labelling glyph is `muted-foreground`, and `foreground` on hover. Only a place's hue or the active navigation row colours one.
- The emblem is not an icon. See Logos.

## Accessibility

- Text is at least 4.5:1 on its ground; a control's edge, a focus ring and a meaningful glyph at least 3:1. Each token's note names its grounds and figures.
- Known misses, kept exact: the count on a `mention` badge is 3.91:1; `success` on its tint over `card-hover` is 4.41:1; the scrollbar thumb is a recorded exception. Solid `info` and solid `destructive` are not text colours: use `info-text` and `destructive-text`.
- One focus recipe: the control's edge goes to `accent-text` with a `focus-ring-width` spread of `ring` at `focus-ring-opacity`.
- Colour never carries meaning alone: a status always has its word.
- Every icon-only control has a name that says what it acts on ("Close Tasks", "Actions for Book the banquet hall deposit").
- Anything reachable by long-press or right-click is also reachable by name.
