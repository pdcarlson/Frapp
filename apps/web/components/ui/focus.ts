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
 * Those controls take `FOCUS_RING_OFFSET`, which puts an accent step in an
 * offset ring *around* the control and leaves its border alone. It uses
 * `--accent-text` (accent-11) at full opacity rather than `--primary` or
 * `--ring`, because with no border to swap the ring has to clear the 3:1 floor
 * by itself on every chapter seed — see that constant.
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
 * It draws in `--accent-text` (accent-11), **not** `--primary` (accent-9) and
 * no longer `--ring` (accent-8). Measured against `--background` across all 19
 * seeded chapter accents (`components/ui/focus-contrast.spec.ts`):
 *
 * | Role | Worst seed | Clears 3:1 |
 * | --- | --- | --- |
 * | `--primary` (accent-9) | 1.87:1 | no, fails on 4 |
 * | `--ring` (accent-8) | 2.94:1 | no, fails on 4 |
 * | `--accent-text` (accent-11) | 8.48:1 | yes, on all 19 |
 *
 * `--ring` was the token here until the greenfield surface ladder
 * (foundations.md §2) lifted `--background` from `#0E0D0B` to `#131211`. Its
 * margin was always thin — 3.05:1 against a 3.0 floor on `#4B0082` — and the
 * lighter base consumed it, dropping `#4B0082` to 2.94 and the three achromatic
 * seeds (`#000000`, `#C0C0C0`, `#FFFFFF`, which all derive ring `#606060`) to
 * 2.98. That is a keyboard user on four chapters with no conforming indicator,
 * which is the exact defect this recipe was created to fix, so the token moved
 * up the scale rather than the guard moving down.
 *
 * accent-11 is the accent engine's text role: `accent-engine.md` §8 gates it at
 * 4.5:1 as text, so 3:1 as non-text UI has real headroom under it. That is why
 * it is robust where accent-8 was merely passing.
 *
 * ## Why `ring-[var(--accent-text)]` and not a preset colour key
 *
 * Do not "tidy" this into an `accent-text` key on the shared Tailwind preset.
 * That preset is read by `apps/landing` as well as `apps/web`, and
 * `tailwind.config.spec.ts` asserts every token it reads is defined in the
 * LEGACY `globals.css` `:root`. `--accent-text` is a Signet accent role that
 * has no legacy counterpart, so adding the key would either fail that guard or
 * force a Signet token onto the frozen landing surface — which
 * `foundations.md` §1 forbids outright. An arbitrary value keeps the token on
 * the one surface that defines it.
 *
 * ## `ring-offset-background` is load-bearing — do not "simplify" it away
 *
 * The offset band is what makes the comparison above the right one: the ring's
 * inner edge abuts that 2px band of `--background`, so `--background` is the
 * surface it is measured against. Dropping the offset would leave the ring
 * depending on whichever ladder step hosts the control, which is both a weaker
 * and a varying comparison. Keep it even though accent-11 has margin — the
 * margin is what makes the recipe robust, not a budget to spend.
 */
export const FOCUS_RING_OFFSET =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"

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

/**
 * A "Skip to X" link: invisible until it is the focused element, then pinned
 * to the top-left corner. `dashboard-shell.tsx`'s app-wide skip link and any
 * route that needs its own past a sub-navigation (chat's channel rail, per
 * #396) share this — a hand-copied className string is exactly the kind of
 * recipe this file exists to keep in one place; see the top-of-file comment.
 */
export const SKIP_LINK_CLASSES =
  "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
