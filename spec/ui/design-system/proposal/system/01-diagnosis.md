# Where today's UI falls short

This page is the reading behind the system: what the running app looks like today, why it reads as a generic dashboard, and what the system does about each cause. It was written from screenshots of the seeded demo chapter on both apps (captured 2026-11-20 at `main@bb0805b`), not from the pasted list of gripes. The measured counts are in **Drift found**.

## The short version

Today's Frapp has good parts and no grammar. The tokens are careful, the glass tab bar and the lead-tile card on the phone's Chat home have a look of their own, and the status wording under a task ("To do", "In progress", "Overdue") already states facts. But each screen arranges those parts its own way, on a black page with nothing under them, and reaches for the same three devices every dark dashboard uses: an all-caps tracked label, an outlined chip, and a gold fill. Nothing on a screen says "this is Frapp" or "this is your chapter" except the gold.

## Six causes

### 1. Content has no ground

On web, every page draws its content straight on the black page: the Events calendar and list, the Tasks rows, the Points leaderboard, the Directory table, every Settings form. Only hairlines between rows hold it together. The phone's Chat home shows the alternative on the same screen: Up next is a raised group with an edge, and it reads as a designed object, while the channel rows under it float.

**The system:** the page is `background` and is never where content sits. Content sits in a **raised group** one step up, with the `border` hairline around it. Paul's ruling of 2026-11-20 confirms it; the phone's rule that a growing list stays flat on the page is reversed by it (see Decisions).

### 2. Hierarchy is done with capital letters

Structure is carried almost entirely by one device: 12.5px, semibold, uppercase, tracked 0.12em. One Events screenshot has three of them (CHAPTER, RESOURCES, UPCOMING); Settings has six. It is the single most recognisable mark of a template dashboard, and it shouts while saying little. Meanwhile the page title ("Events", "Points") is the same size as a row title, so a page has no anchor, and the phone already writes its channel sections in sentence case ("Chapter", "Committees") a few points under an all-caps UP NEXT.

**The system:** no all-caps anywhere. A **section header** is sentence case in `label`, `muted-foreground`, with its count beside it. Hierarchy comes from the six type roles used for what they are for: `title` for the page, `headline` for a record, `display` for the one figure.

### 3. One job, several dialects

In four web screenshots the job "switch between two or three views" is drawn four ways: an accent-tinted segmented control (Tasks: My tasks / Everyone's), an underlined tab row (Directory: Actives / Alumni), a second accent-tinted segmented control in the body (Directory: List / Grid), and pill buttons (Points: All time / Semester / Month). "Filter this list" is one Filter button on Events and Tasks, five dropdown pills on a row of their own on Directory, and two select boxes on Points. The main action is an outlined accent button on Events and Tasks, a filled gold pill on Directory ("Invite member"), and filled gold buttons mid-page in Settings ("Save profile", "Save mark"). Control corners run from 12px to fully round on the same page.

**The system:** one component per job, named in Components, with the anatomy fixed. Corners come from the radius scale; a fully round control exists only in the phone's glass chrome.

### 4. The row has no fixed grammar

On the Events page alone, an event is a tinted card with a coloured bar and a task is a circle and two lines. Tasks on its own page is one line with an avatar, a name, a date and two outlined chips ("In progress", "+5 pts"). A Directory row right-aligns three facts and a number. A leaderboard row repeats "#3" eleven times. Each is reasonable alone; together a member relearns the row on every page.

**The system:** one **list row**: lead, title, one meta line, trailing. Facts go in the meta line in a fixed order, separated by a middle dot. At most one status, as a **status word**. Chips are not metadata.

### 5. The accent is doing too many jobs

In a single Tasks screenshot the chapter's colour marks the active sidebar row, the selected segment, the New button, and the in-progress ring; in Settings it also fills two Save buttons and the selected rail row; on the calendar it fills today. As a fill it is `accent-subtle`, which for the house gold is a muddy brown that covers a large area of the sidebar. When the accent is everywhere it stops meaning "act here" or "you are here".

**The system:** the accent keeps the seven uses the foundations already list, and the system proposes one tightening: a view switch's selected segment goes neutral, so on a list page the accent appears twice, where you are and what you can make.

### 6. The screen explains itself

Settings carries sentences such as "Shown in the nav and on mobile's Chat home: your logo, or else your short name, or else your Greek letters." and "Paints primary buttons, your own name in chat and the active nav item." Empty states and notifications do the same. The owner's rule is the opposite, and it is the most distinctive thing Frapp has: say what is, who did it, and when.

**The system:** the content rules in the brand book, the **state line**, the one notification shape, and a fixed status vocabulary.

## The phone, specifically

The phone is closer to the system than web, and shows where it will land. Settings is already grouped rows in raised groups with one trailing thing each. The long-press glass menu already has the right order, the red Delete last after a break, and a glyph per action. Chat home's Up next is the raised group with lead tiles.

What breaks it, seen on the same captures:

- **Tasks** floats its rows on the page under all-caps THIS WEEK and LATER, draws a square checkbox, and abbreviates "+5 pts".
- **New task** is a near-full-height sheet over the list with seven stacked fields, a row of date chips used as a form field (the chosen one in solid accent), a "pts" placeholder, a helper sentence under each of two controls, and a full-width "Create task" bar. By the rules it is a pushed screen with property rows and the glass action bar.
- **Filter actives** is a full-height sheet of all-caps group labels and solid accent chips, 20 chips before the first role.
- **Type:** list rows are 14 and 12.5, but every sheet and menu row is 16 in a 48 row, so the same job changes size as soon as a sheet opens. Two-line rows carry 12 of vertical padding and land near 60. That, not the type scale itself, is what reads as "too big".

## What is already Frapp's own, and stays

- The violet near-black ladder with soft steps and a strong hairline.
- The chapter accent engine: the colour is the chapter's, not Frapp's.
- The square tile: the chapter mark, the lead tile, the emblem's own field. People are circles; places and things are rounded squares.
- The phone's floating glass chrome, with haptics.
- Figtree at three weights.
- Statuses and dates in whole words.

## The idea that ties it together

Frapp is the chapter's house, kept in order. Three things follow, and each is checkable on a screenshot:

1. **Rooms, not a void.** Everything sits in a raised group with an edge. The hairline does the separating.
2. **The record speaks plainly.** One title, one meta line, one status word; who did it and when. No instructions, no capitals, no abbreviations.
3. **The colour is the chapter's, and it is rare.** It marks where you are and the one thing to do. Frapp's own gold stays on Frapp's own mark.
