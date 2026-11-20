Choosing one value: the field shows it, a list sized to its options opens, a tap picks and closes.

**Status:** Confirmed (rulebook § 9 "picking a value"; Paul 2026-11-20: a picker sizes to its content, no Done button, no full-screen picker sheets).

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/ui/select.tsx`, `apps/web/components/shared/searchable-picker.tsx`, `ui/date-field.tsx`, `ui/time-field.tsx` | `Select`, `SearchablePicker`, `DateField`, `TimeField` |
| Phone | `apps/mobile/components/option-sheet.tsx` | `OptionSheet` |

## Anatomy

**Web field.** `control-field` (40) tall, `surface-1` fill, `control-edge` edge, `radius`, 12 of side padding, the value in 16, a 16 chevron at the trailing edge. Open or focused: the edge goes to `accent-text` with the focus spread.

**Web list.** `popover` fill, the `border` hairline, `radius`, 4 of padding. Rows are `control-row` (32) tall with `radius-xs`, 14 text, `card-hover` under the pointer. The chosen row shows a 16 check at the trailing edge and keeps its weight. Past 8 options a search field heads the list.

**Phone.** The value sits in the row's trailing slot with a forward chevron. The sheet's rows are 44 tall in 16 text. The chosen row goes to 600 and shows a 20 check in `primary`. Sized to its content up to 8 rows; past that it scrolls at 70% and gets a search field.

## You provide

The options (`value`, `label`, an optional mark and detail), the selected value, `onSelect`, and an accessible name for the list.

## Rules

- The field always shows the current value. Nothing to remember.
- No title bar, no Done, no Save, no Cancel.
- Never full height for a short list.
- 2 to 4 short choices that should stay visible are a segmented control, not a picker. A look (accent, background, density) is swatches.
- Never a hand-drawn radio list. Never filter chips as a form field.
- Dates and times: `DateField` and `TimeField` on web, the platform's own picker on the phone. No native date or select on web.
- A setting picked here saves at once.

## Web and phone

An anchored dropdown on web and a sheet on the phone, by platform. The system keeps web's "check, same weight" and the phone's "check in the accent"; it drops the phone's size change on the chosen row (16/400 to 14/600 today), which makes the list jump.

## Drift

`OptionSheet` has only 7 call sites in 4 files. M9: 30 hand-rolled pickers in 24 files (13 hand-drawn radio lists, 8 filter-chip form fields, 9 with Done or Save), and 11 pickers open at full height. `OptionSheet` requires a title today and has no search. W10: 31 on web in 25 files (10 native date or time inputs, 13 radio sites, 3 pickers with Done or Apply).
