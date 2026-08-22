import { FOCUS_RING } from "@/components/ui/focus";

/*
 * Class recipes for the native controls the dashboard tables use directly — a
 * `<select>` filter and an `<input type="checkbox">` row selector — which are
 * plain elements rather than Radix primitives and so cannot reuse the `ui/`
 * components.
 *
 * They live under `components/` rather than `lib/` because Tailwind scans by
 * `content` glob (`./app/**`, `./components/**`), and a class token that
 * appears in no scanned file is never generated. That is a constraint on the
 * *directory*, not on this file: `FOCUS_RING` is imported rather than re-typed
 * here, and its literals are found in `components/ui/focus.ts` where they are
 * written. (An earlier draft claimed the strings had to be literal in this file
 * for the scanner — they do not, and re-typing them would have left a copy that
 * silently stops tracking the recipe.)
 *
 * The filter takes `components.md` §4's field recipe at the Inline height so it
 * lines up with the buttons in the same toolbar row. The checkbox takes §4's
 * 24x24 at radius 7 and paints through the browser's own `accent-color`, which
 * is what `accent-primary` sets — the previous 16px box was half that, and its
 * `text-primary` did nothing at all, since the text colour of a checkbox is not
 * what fills it.
 *
 * §2's ≥44px hit area is not satisfied by the control alone: the checkbox is
 * 24px inside a `TableCell`, whose `p-2` brought the tappable area to 40px, and
 * the cells were pinned `w-10` so widening the padding overflowed the column
 * before it reached 44 (#1187). The Directory & Finance slice of #920 owns
 * those tables, so the pair below settles it here rather than four times over.
 *
 * The hit area is made **real** rather than overhanging. A pseudo-element or a
 * negative-margin overlay large enough to reach 44 would reach ~10px past the
 * visible box on every side, and where rows or cells sit closer together than
 * that, the later sibling swallows the earlier one's clicks — the defect the
 * chat slice found under its reaction chips. So the `<label>` *is* 44x44, and
 * only where 44 is the rule: `pointer-coarse` is §2's own carve-out that
 * "compact 38px controls are web/pointer-only", read in the other direction.
 * A mouse keeps the 24px box and the 48px column; a finger gets a real 44px
 * target and the column is already wide enough to hold it.
 *
 * The cell recipe is `w-12` (48), which is the width a *pointer* gets: 24px of
 * control plus `TableCell`'s 2x8px padding, with room to spare. It is not a
 * clamp — `width` on a `<td>` is a minimum hint to the table layout algorithm,
 * so on a coarse pointer the column simply grows to fit the 44px label rather
 * than clipping it. Measured in Chromium at a 375px viewport: 48px column with
 * a 24x24 label under `(pointer: fine)`, 60px column with a real 44x44 label
 * and the 24px box still centred under `(pointer: coarse)`. The table sits in
 * `Table`'s own `overflow-auto` wrapper, so those 12px scroll the table rather
 * than the page and the 375px floor is unaffected.
 */
export const dashboardFilterSelectClassName = [
  "h-11 rounded-md border border-input bg-surface-1 px-3.5 text-sm text-foreground transition-colors",
  FOCUS_RING,
  "disabled:cursor-not-allowed disabled:border-border disabled:text-disabled",
].join(" ");

export const dashboardTableCheckboxClassName = [
  "h-6 w-6 rounded-[7px] border-input accent-primary",
  FOCUS_RING,
].join(" ");

/**
 * The `<th>`/`<td>` that hosts a row-select checkbox. Replaces the `w-10` these
 * cells used to pin; see the hit-area note above for why 48 and not 44.
 */
export const dashboardCheckboxCellClassName = "w-12";

/**
 * Wraps a `dashboardTableCheckboxClassName` input so the *tappable* area clears
 * §2's 44px floor on touch without changing the 24px box a pointer sees.
 */
export const dashboardCheckboxHitAreaClassName = [
  "flex h-6 w-6 cursor-pointer items-center justify-center",
  "pointer-coarse:h-11 pointer-coarse:w-11",
].join(" ");
