Switching between a few named sets, and narrowing a list.

**Status:** Confirmed (rulebook § 9 "filtering a list"). The neutral held segment for a view switch, and one "on" look across both apps, are Proposed.

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/ui/segmented.tsx`, `apps/web/components/shared/filter-menu.tsx` | `SegmentedChoice`, `FilterMenu`, `ActiveFilterChips` |
| Phone | `apps/mobile/components/segmented.tsx`, `apps/mobile/components/filter-chips.tsx` | `Segmented`, `FilterChips`, `Chip`, `SearchField` |

## Segmented control

For 2 to 4 short choices that stay visible.

- Track: `surface-1` fill, `control-edge` edge, `radius` (12), 2 of padding.
- Segment: `control-row` (32) tall, 44 on touch, `radius-sm` (10), 12 of side padding, 14/600. Idle text `muted-foreground`.
- Held, as a **view switch** in a page header (My tasks / Everyone's, Actives / Alumni): `popover` fill, `foreground` text. Neutral, because the sidebar already says where you are in the accent.
- Held, as a **choice in a form** (a setting you picked): `accent-subtle` fill, `accent-text` text.

## Filtering

- **Web:** search, one Filter button with its count, and the view switch, all in the page header. Filters that are on show as removable chips in a row under the header, with Clear all once two are on. Sort is a row in the menu.
- **Phone:** the search field, one Filters chip, and a sheet with the same rows in the same order, ending in a count ("Show 23 members").
- Applied chip: `control-chip` (24) tall, `radius-xs`, the `border` edge, the filter's name in `muted` then its value, and a close glyph.
- A chip that is on: `accent-subtle` fill, `accent-text` text, on both apps.

## You provide

Segmented: `options`, `value`, `onChange`, and a label for assistive tech. Filters: the list of filters with their options and current values.

## Rules

- Two or three named sets people switch between all day are a segmented control. Everything else is a filter.
- One Filter button. Never a row of dropdown pills, one per filter.
- A list opens on the viewer's own items.
- A filter that is on is always visible.
- No tabs with an underline for switching a list's set: that is the segmented control's job.
- No pills. Chips and controls take their corners from the radius scale.

## Web and phone

The system keeps web's geometry (12 track, 10 segments, 14/600 labels); the phone's track is 8 with 12.5/400 labels and an accent border on the held segment. It keeps web's "on" look (the accent tint) for chips; the phone paints a selected chip solid accent, which is reserved for the primary button, a switch and a checked box.

## Drift

`FilterMenu` and `ActiveFilterChips` have 2 call sites each; the older pill `FilterChip` has 14 in 4 files, and Directory's row of five dropdown pills is the largest. `ActiveFilterChips` and `FilterChip` are fully round today. `Tabs` (4 uses) and pill buttons (Points) do the view switch's job. The phone's shared filter sheet is not built; `FilterChips` has 17 uses, 8 of them as a form field.
