The surface content sits on: one step above its ground, with the hairline around it.

**Status:** Confirmed (Paul, 2026-11-20: content sits on a raised surface, not floating on the page; rulebook § 7 "every section has a hairline edge"). The step it takes on web is Proposed.

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/shared/settings-row.tsx`, `apps/web/components/ui/card.tsx` | `SettingsGroup`, `Card` |
| Phone | `apps/mobile/components/list-section.tsx`; steps from `apps/mobile/lib/surfaces.ts` | `ListSection` |

## Anatomy

- Fill: one step above what it sits on. On the page (`background`) it is `surface-1`. Inside a sheet, a dialog or a menu (`popover`) it is `card`.
- Edge: 1px `border` on all sides.
- Radius: `radius-lg` (14). A large card that holds a whole record's summary takes `radius-xl` (16).
- Rows are separated by a `border` hairline that stops 16 short of each side.
- No shadow. No padding of its own: the rows carry it.

## You provide

The rows. A group has no title of its own: its name is the section header above it.

## Rules

- Nothing a member reads or presses sits straight on `background` except a page title and a section header.
- A list that grows is a group too. It can be long; it still has an edge.
- Never a card around each row. One group, many rows.
- Never a group inside a group. What needs its own edge inside a group (a field, a lead tile, a chip) takes the next step up.
- Two groups are 24 apart, with the next section header between them.

## Web and phone

The system keeps the phone's version on both: `surface-1` on the page, 14 radius, inset dividers. Web's `Card` and `SettingsGroup` paint `card` on the page today, two steps up, and disagree on radius (16 and 14). Paul's rule for the phone on 2026-11-13 was one step, not two ("it's almost too much contrast"); the system applies it to web.

This reverses one earlier ruling: `spec/ui/mobile/patterns.md` § Rows says a list that grows "stays flat on the screen background, split by hairlines". See Decisions.

## Drift

W12: 60 on web in 37 files. The shared list recipe `denseListClassName` (`apps/web/components/shared/table-controls.ts`) has no fill and no edge, so all nine list pages float on the page; it is the single point to change. 31 hand-written card strings sit outside `Card`. M11: 10 phone screens draw rows straight on the page (Tasks, Dues, Notifications, Study, Events, Directory, Messages, Chat home).
