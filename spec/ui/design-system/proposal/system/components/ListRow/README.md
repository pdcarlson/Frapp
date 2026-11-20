One row for every list: a lead, a title, one meta line, and a trailing slot.

**Status:** Confirmed on the phone (`spec/ui/mobile/patterns.md` § Rows, 2026-11-12; rulebook § 3). Proposed for web, which has no shared row.

| | File | Component |
| --- | --- | --- |
| Web | none shared today. Proposed home: `apps/web/components/shared/list-row.tsx` | `ListRow` |
| Phone | `apps/mobile/components/list-section.tsx`, `history-row.tsx`, `lead-tile.tsx` | `ListRow`, `PressableRow`, `HistoryRow`, `LeadTile` |

## Anatomy

- **Lead** (optional): a 32 tile with `radius-xs` for a thing or a place, a 32 circle for a person, or the round task check. One, never two.
- **Title:** `label` (14/600), `foreground`, one line, truncated.
- **Meta:** `caption` (12.5), `muted-foreground`, one line, truncated. Facts in a fixed order, joined by a middle dot in `muted`. At most one status word, first.
- **Trailing** (optional): a value in `muted-foreground`, or one chip, then on the phone the forward chevron (16, `muted-foreground`) when the row opens something.
- **Height:** phone 44 floor with 16 of side padding; a two-line row takes 8 of vertical padding and lands near 54. Web 36 floor (`control-small`), 16 of side padding, 6 of vertical padding; a two-line row lands near 48.
- **Hover and held:** `card-hover` on web; on the phone the row lifts one surface step while held.
- **Done:** the title drops to `muted-foreground` at 400 with a line through it. Finished work is the quietest thing on a list.

## You provide

`title`, the meta facts (through the shared helpers: `taskRowFacts`, `formatTimeRange`, `CHECK_IN_OPEN_LABEL`), an optional `lead`, an optional `trailing`, `onPress`, and the row's menu entries.

## Rules

- One title, one meta line. Never a third line, never metadata as a row of chips.
- The same facts in the same words and order on both apps.
- A row with actions has a menu: right-click and a menu button on web, long-press on the phone (see Row menu).
- No card around a row. Rows sit together in a raised group.
- Text is neutral. The only colour in a row is its status word, its lead's hue, and the task check when started.
- Weights are 400, 600 and 700 only. Web's 500 on row titles goes.
- A task's check is a circle on both apps; the square checkbox means "select this row".

## Web and phone

The system keeps the phone's grammar and gives web the same component. It keeps web's round task check (the phone draws a 24 rounded square today). It keeps `muted-foreground` for the meta line on both; `muted` is for timestamps.

## Drift

Web: nine hand-rolled row files in three shapes with heights of 36, 40, 44 and 56 and title weights of 500 and 600. Phone: `ListRow` has 117 uses, but two-line rows take 12 of vertical padding and land near 60, and the same row job is 14 in `ListRow` and 16 in sheets and menus (37 row styles).
