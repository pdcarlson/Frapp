A settings page in chunks: named groups of rows, each row one label and one trailing thing, saved as it changes.

**Status:** Confirmed (rulebook § 9 "settings", Paul's pick 2026-11-20; Paul 2026-11-20: chunked like Discord's channel settings, details behind a disclosure).

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/shared/settings-row.tsx` | `SettingsGroup`, `SettingsRow` |
| Phone | `apps/mobile/components/list-section.tsx`, `apps/mobile/components/toggle.tsx` | `ListSection`, `ListRow`, `Toggle` |

## Anatomy

- **Page (web):** full width, the one page that is. A rail of sections on the left with sentence-case group names; the active row wears `accent-subtle`. The content column is at most 672 wide.
- **Page (phone):** a pushed screen per section, one scrolling list.
- **Group:** a section header, then a raised group.
- **Row:** 44 floor, 16 of side padding. A label in `label` (14/600), at most one line under it in `caption` `muted-foreground`, and one trailing thing:
  - a switch (36 by 22 on a mouse, 50 by 30 on touch; on is `primary`),
  - a value in `muted-foreground` that opens the picker,
  - or a chevron that opens a sub-page or unfolds the detail.
- A destructive row's label is `destructive-text` and it sits in the last group.

## You provide

`label`, an optional `description`, and one of `checked` with `onCheckedChange`, `value` with `onClick`, or `href`.

## Rules

- Settings save on their own: a switch or a pick the moment it changes; typed text on Enter or on leaving the field, with a quiet "Saved"; Escape puts the old text back. No Save button on a settings page.
- No sentence under a row whose label already says it. The line under a label lists what is covered, it does not explain the switch.
- A setting names the outcome, not the mechanism: "Notify me about every message".
- Show nothing for an option that is off (quiet hours off shows no times).
- Rare or advanced detail sits behind a chevron, not on the page.
- One setting, one place. Never the same setting on two pages.
- Never a wide form of stacked fields with a filled button at the bottom.

## Web and phone

Same groups, same rows, same words, same order. The phone is already built this way. The system keeps the phone's row weight (600; web's shared row uses 500, a weight Frapp doesn't ship) and the raised group's `surface-1` step.

## Drift

Web's `SettingsGroup` and `SettingsRow` have 2 consumers. W16: 67 controls in settings folders sit outside the shared row, and 20 Save buttons ship in 13 files ("Save profile", "Save mark"). The same hint sentence, "Changes are written to the chapter audit log", appears six times. Phone: the settings screens comply; M15 finds 11 of their sheets that don't (6 with a Save).
