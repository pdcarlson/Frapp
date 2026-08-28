/**
 * The Signet focus recipes, spelled once.
 *
 * `spec/ui/design-system/foundations.md` §10: a 3px ring of the accent ring
 * step (`--ring`, accent-8) at ~25% opacity, with the control's border
 * switching to the accent solid (`--primary`, accent-9). components.md §2
 * applies it to *every* focusable control, which is why these are constants
 * rather than strings copied into a dozen `cva` bases — the copies drift, and a
 * focus indicator missing on one control is an accessibility release gate
 * failure (README §6), not a cosmetic one.
 *
 * ## The border swap is the load-bearing half
 *
 * Worth knowing before "simplifying" either recipe: the ring alone does not
 * carry the indicator. `--ring` (`#86692B`) at 25% composites to ~1.3:1 against
 * every step of the surface ladder, well under README §6's 3:1 floor for
 * non-text UI. It is the border going solid accent — 8.7:1 and up — that makes
 * focus visible. The ring is the halo around it, not the signal.
 *
 * That is also why `FOCUS_RING` is wrong for a control whose border already
 * encodes something. On a `Switch` the border carries on/off, and on a
 * `TabsTrigger` the bottom border IS the selected indicator — so swapping it on
 * focus either loses the state or, worse, paints the exact visual that means
 * "selected", leaving a keyboard user unable to tell focus from selection.
 * Those controls take `FOCUS_RING_OFFSET`, which puts the accent ring step in
 * an offset ring *around* the control and leaves its border alone. It uses
 * `--ring` at full opacity rather than `--primary`, because with no border to
 * swap the ring has to clear the 3:1 floor by itself — see that constant.
 *
 * `focus-visible` rather than `focus`: a pointer click on a button should not
 * leave a ring behind it. Controls that are focusable but not clickable — the
 * `role="status"` gate notice — use `FOCUS_RING_ALWAYS`, since they are only
 * reached programmatically and `:focus-visible` does not match a scripted
 * `.focus()` in every engine.
 *
 * ## Why these are not `disabled:`-safe on their own
 *
 * Tailwind breaks same-specificity ties by its own fixed variant sort order,
 * not by the order classes appear in the string. `focus-visible:border-primary`
 * and a `data-[state=…]:border-…` are both one class plus one
 * pseudo-class/attribute, so the `data-` rule — emitted later — wins silently.
 * Anywhere a state variant touches a property one of these recipes also
 * touches, the state variant must be scoped with `enabled:` (mutually
 * exclusive, so no tie can arise) rather than left to source order.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/25"

/**
 * For controls whose own border encodes state — `Switch` (on/off) and
 * `TabsTrigger` (selected). The accent moves off the control so it cannot be
 * confused with, or overridden by, the state border.
 *
 * ## Here the ring IS the indicator, which is why the token differs
 *
 * `FOCUS_RING` can afford a diluted `ring-ring/25` because its solid border
 * carries the signal. This recipe has no border to swap — that is the whole
 * reason a control lands on it — so the ring is the entire indicator and must
 * clear README §6's 3:1 non-text floor on its own.
 *
 * It draws in `--ring` (accent-8), **not** `--primary` (accent-9). Measured
 * against `--background` across all 19 seeded chapter accents
 * (`components/ui/focus-contrast.test.ts`): `--primary` fails on five of them
 * — `#800000` at 1.77:1, `#8B0000` 1.94, `#1F4E79` 2.24, `#006400` 2.61,
 * `#8B4513` 2.74 — while `--ring` clears the floor on all nineteen. On those
 * five chapters the accent-9 ring meant a keyboard user got no conforming
 * focus indicator at all.
 *
 * The margin is real but thin: `--ring`'s worst seed is `#4B0082` at 3.05:1
 * against a 3.0 floor. The guard pins it, so a palette change that erodes it
 * fails the suite rather than shipping.
 *
 * ## `ring-offset-background` is load-bearing — do not "simplify" it away
 *
 * The offset band is what makes the comparison above the right one. The ring's
 * inner edge abuts that 2px band of `--background`; its outer edge abuts
 * whatever surface the control sits on, and against the deeper ladder steps
 * `--ring` does *not* clear 3:1 (worst seed: 2.86 on `--surface1`, 2.69 on
 * `--card`, 2.48 on `--popover`). Dropping the offset would leave the ring
 * depending on its host surface and reintroduce the failure this recipe was
 * fixed to remove.
 */
export const FOCUS_RING_OFFSET =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

export const FOCUS_RING_ALWAYS =
  "focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-ring/25"

/**
 * For a container that owns the focus indicator on behalf of the control inside
 * it — the chat composer, whose editable surface is a ProseMirror node inside a
 * framed well.
 *
 * `focus-within` rather than `focus-visible`: the ring belongs on the well, and
 * the well is never the focused element. There is no `:focus-visible-within`, so
 * the trade is a ring that also appears on a pointer click into the composer —
 * which is the right trade here, because the alternative shipping today is no
 * focus indicator at all (the editor sets `focus:outline-none` and nothing
 * replaced it), and that is a README §6 release-gate failure.
 */
export const FOCUS_RING_WITHIN =
  "focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring/25"
