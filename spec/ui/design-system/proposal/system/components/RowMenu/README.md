Acting on a thing: one menu per item, opened by right-click or its menu button on web and by long-press on the phone.

**Status:** Confirmed (rulebook § 3 and § 9; Paul 2026-11-18 and 2026-11-20: no iOS native menus, the custom glass menu with haptics).

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/shared/row-menu.tsx`, `apps/web/components/ui/dropdown-menu.tsx` | `RowMenu`, `ActionMenuButton` |
| Phone | `apps/mobile/components/item-actions-menu.tsx`, `apps/mobile/components/glass-menu.tsx` | `useItemMenu`, `GlassMenu` |

## Anatomy

**Web.** `popover` fill, the `border` hairline, `radius`, 4 of padding, at least 220 wide. Rows `control-row` (32) tall, `radius-xs`, 14 text, a 16 glyph leading, `card-hover` under the pointer. Groups are split by a hairline. The row's own menu button is a 36 ghost icon button that appears on hover and focus.

**Phone.** The glass menu: 260 wide, beside the press, over a 40% scrim. A caption names the item. Rows 48 tall in 16 text with the glyph at the trailing edge, as iOS draws its menus. A 6 dark band comes before the destructive group. It opens with the medium impact haptic and a small lift (opacity 140ms, scale from 0.92 over 180ms; a plain fade with Reduce Motion).

## You provide

The entries: `label`, `glyph`, `onSelect`, and `destructive` where it applies. On web also the name of the item for the button's label ("Actions for Book the banquet hall deposit").

## Rules

- Most used first. At most three groups.
- Delete is `destructive-text`, last, after a break, and always confirmed.
- Right-click and long-press are shortcuts, never the only way in. The screen's main action is a visible button.
- A menu of one or two items becomes buttons.
- Rare controls live here, not on the header or the row: rename, move, mute, report, settings.
- Never the iOS system action sheet, never an alert with three or more buttons, never a bottom sheet of actions. A chat message's long-press sheet with its reaction row is the one exception.
- A screen reader gets every action by name without a long-press.
- No title bar and no Cancel row.

## Web and phone

Opaque with a leading glyph on web; glass with a trailing glyph on the phone. Both are kept: each matches its platform's menus. The system holds the order, the wording and the red-last rule the same on both. Proposed: the glass menu's corner goes from 22 to `radius-2xl` (20), the scale's ceiling.

## Drift

W9: 16 web files build their own more button and menu (the lint rule's grandfather list); `ActionMenuButton` has no call sites. M8: 15 on the phone, including 7 callers of the system action sheet (`lib/action-menu.ts`) and 5 alert menus. M17: 11 long-press openers with no haptic. Web's `RowMenu` leaves order and red to the caller; the phone enforces both in code.
