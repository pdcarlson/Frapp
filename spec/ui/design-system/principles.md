# UI principles

> Seven rules every Frapp screen is checked against, on web and mobile alike, written as yes/no checks so a screenshot can pass or fail them. They came out of the owner's design asks of 2026-11-04 to 2026-11-06: each ask traced back to one of these seven causes, so a screen that passes them shouldn't need the ask. The detailed recipes stay where they are ([`components.md`](components.md), [`foundations.md`](foundations.md), [`writing.md`](writing.md), [`../mobile/patterns.md`](../mobile/patterns.md)); this page links to them rather than restating them.

**How to use it.** Before a UI change ships, walk each changed screen through the checks below at real scale (§5's numbers) on both platforms. A failed check is fixed in the change, or filed per [`file-follow-up`](../../../.claude/skills/file-follow-up/SKILL.md) and named in the PR. Cite a check by its id (`P3.2`). [`README.md`](README.md) §8 makes this list part of the quality gate.

**House rules that bind every check** (owner rules, 2026-11-05 and 2026-11-06):

- No emoji anywhere: product UI, copy, mockups, proposal pages. Icons are drawn glyphs ([`iconography.md`](iconography.md)).
- Controls are compact: every height is a step of [`foundations.md`](foundations.md) §9's control size scale, never a bigger one picked for emphasis.
- The accent marks only the six things [`foundations.md`](foundations.md) §6 lists.
- Mobile chrome is the floating glass direction ([`foundations.md`](foundations.md) §15): glass tab pill, round glass +, nothing glass inside content.
- Be bold. The old design system was flawed, so an existing pattern is not a precedent; a rule here beats a pattern already on screen.
- Every visual change is drawn as a before/after and recorded in these docs in the same change.

---

## P1. Design, don't explain

A screen shows what it is through its layout. Words that describe the screen, teach it, or stand in for a missing design are a defect.

| Check | Fails when |
| --- | --- |
| P1.1 | A line under a title restates the title or says what the page is for ("Manage your chapter's events here"). |
| P1.2 | A helper sentence sits under a control whose label, placeholder or glyph already says it. |
| P1.3 | A screen at zero data shows a card or an illustration with a sentence instead of its real layout ([`components.md`](components.md) §10 Empty; the first action sits where the first item will go). |
| P1.4 | A feature a member can't use yet (not set up, no permission) shows a page explaining that, rather than being hidden or pointing at the one step that turns it on. |
| P1.5 | A dialog or sheet opens with a paragraph before the first thing to do. |
| P1.6 | A notice or banner stays on screen after the member has acted on it or can't act on it. |

## P2. Never expose internals

The member sees the chapter's words, never the system's.

| Check | Fails when |
| --- | --- |
| P2.1 | A permission key, enum or status constant shows (`events:create`, `IN_PROGRESS`, `ROLE_GATED`, `PRESIDENT`). [`writing.md`](writing.md) §3 has the replacement copy. |
| P2.2 | An id, uuid, hostname, file path, storage key, or a raw filename where the content itself is the point (an image) shows. |
| P2.3 | An error shows its HTTP status, server message or stack, rather than [`writing.md`](writing.md) §3's what-happened-and-what-to-do. |
| P2.4 | A placeholder identity shows: "Member 000000", "Unknown", an account handle where the chapter knows the person's name, an empty avatar where an image exists. |
| P2.5 | A setting names the mechanism, not the outcome ("Enable push channel override" rather than "Notify me about every message"). |
| P2.6 | Branding the chapter has turned off shows (Greek letters for an organization that forbids them, the house gold inside a chapter that picked its own accent). |

## P3. One place for each thing, and only what's needed now

Each action, title and setting appears once, at the depth that matches how often it's used.

| Check | Fails when |
| --- | --- |
| P3.1 | The same action is reachable twice on one screen (a header button and a row button that both create, two closes). |
| P3.2 | A title is drawn twice: in the top bar and again as a heading in the body, or a sheet title that repeats the button just pressed. |
| P3.3 | A surface has more than one primary (filled accent) button. |
| P3.4 | A setting, or the state a setting is in, sits on a header or a row rather than a couple of taps away behind `⋯` ([`components.md`](components.md) § Chrome weight). |
| P3.5 | Every option is out at once: more than about five actions or filters visible in one row, where a menu would hold the rare ones. |
| P3.6 | Chrome is heavier than the job: a card around every list row, a box around media, a worded button whose glyph already says it, a Cancel on a picker ([`components.md`](components.md) § Chrome weight, § Icon-only actions). |
| P3.7 | Two screens do the same job by different routes, so a member can't tell which is the real one. |

## P4. Controls confirm their state, and nothing jumps

A tap is answered where it happened, at once, and the layout around it holds still.

| Check | Fails when |
| --- | --- |
| P4.1 | A control gives no visible answer within 100 ms of a press (no pressed state, no optimistic change). |
| P4.2 | Pending work adds a row, a spinner or a banner that moves other content. Pending is gray text or a dim in place ([`components.md`](components.md) §10 Pending states). |
| P4.3 | Loading draws a different shape from what it becomes (a centered spinner for a list, a skeleton of the wrong height), so the page jumps when data lands. |
| P4.4 | Moving between screens moves chrome that should stay put (a sidebar, a header, a tab bar that changes width or position). |
| P4.5 | A form shows an error while the member is still typing; errors wait for blur or submit ([`components.md`](components.md) § Text input). |
| P4.6 | A toggle, filter or selection doesn't show it's on: the member has to remember what they picked. |
| P4.7 | A success is only a toast, when the change itself could show on screen. |

## P5. Built for a real chapter, not a demo

Every list, row and label is checked at the size of a real imported chapter. The reference volumes are the owner's own chapter, imported from Discord (prod, 2026-11-06):

| Thing | Real scale |
| --- | --- |
| Members (imported authors) | 58; plan for 150 |
| Roles | 109, names up to 28 characters |
| Channels | 38 in 9 categories, names up to 24 characters |
| Messages | 21,700 over a year; 4,000 in the busiest channel |
| Message length | median 28 characters, 95th percentile 137, longest 1,940 |
| Mentions and replies | about 1 message in 10 each |

| Check | Fails when |
| --- | --- |
| P5.1 | A long name, title or role label breaks the row: wraps into a second line that wasn't designed, pushes a control off the edge, or overlaps. |
| P5.2 | A list over about 15 items has no way to find one (search, filter, jump, or grouping). |
| P5.3 | A set of chips, badges or avatars has no cap: 10 roles on a member draw 10 chips. Show the first one or two and a count. |
| P5.4 | A long list renders everything at once and stutters, or a long message has no "more" and floods the screen. |
| P5.5 | A count isn't formatted for its size: a raw 21718, or an unread badge that keeps growing instead of stopping at 99+. |
| P5.6 | A picker for a big set (roles, members, channels) is a flat unsorted list. |

## P6. One product across web and mobile

Web and mobile are two views of one app. A member who uses both should never relearn a name, a color or an order.

| Check | Fails when |
| --- | --- |
| P6.1 | The same thing has different names on the two (a tab, a status, a button). |
| P6.2 | The same status is a different color or shape (Mandatory red on one, accent on the other). |
| P6.3 | The same list sorts or groups differently without a platform reason. |
| P6.4 | A change landed on one platform and the other has no matching change or filed issue. |
| P6.5 | Copy for the same moment differs (empty, error, confirmation). Shared strings live in a shared package. |

## P7. Standard affordances work everywhere

Whatever a member's thumb or keyboard expects from their platform works, on every screen.

| Check | Fails when |
| --- | --- |
| P7.1 | Mobile: a pushed screen doesn't swipe back, or Android back doesn't go back or close the sheet on top. |
| P7.2 | Mobile: content sits under the notch, the home indicator or the tab bar; the keyboard covers the field being typed into ([`../mobile/patterns.md`](../mobile/patterns.md) § Keyboard avoidance). |
| P7.3 | Web: Escape doesn't close the top layer, or a click outside a popover doesn't. |
| P7.4 | A list item that has actions has no long-press (mobile) or right-click / hover menu (web) to reach them. |
| P7.5 | A touch target is under 44 points, or a pointer target is under the §9 scale. |
| P7.6 | A date or time is typed rather than picked with the platform's picker, or text that a member would copy (a code, an address) can't be selected. |
| P7.7 | A list that updates from the server has no pull to refresh (mobile), or a link that looks like one doesn't open. |
