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
 * §2's ≥44px hit area is NOT satisfied by the control alone, and this comment
 * used to imply otherwise: the checkbox is 24px inside a `TableCell`, whose
 * `p-2` brings the tappable area to 40px. Widening it is the table layout's
 * call — the cells it sits in are pinned `w-10` — so it belongs to the screen
 * families that own those tables rather than to this constant.
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
