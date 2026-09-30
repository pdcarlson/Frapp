/**
 * The Signet focus recipes, spelled once.
 *
 * `spec/ui/design-system/components.md` §2: a 3px ring of the accent ring step
 * (`--ring`, accent-8) at ~25% opacity, with the control's border switching to
 * the accent text step (`--accent-text`, accent-11). It applies to *every*
 * focusable control, which is why these are constants rather than strings
 * copied into a dozen `cva` bases — the copies drift, and a focus indicator
 * missing on one control is an accessibility release gate failure (README §6),
 * not a cosmetic one.
 *
 * ## The border swap is the load-bearing half
 *
 * Worth knowing before "simplifying" either recipe: the ring alone does not
 * carry the indicator. `--ring` (accent-8; `#796938` on the house seed) at 25%
 * composites to 1.18–1.31:1 against the step it sits on — measured across all
 * 19 seeded accents on all four ladder steps, and 0 of those 76 pairs clear
 * README §6's 3:1 floor for non-text UI. It is the border going solid accent
 * that makes focus visible. The ring is the halo around it, not the signal.
 *
 * ## Why the border is accent-11 and not `--primary` (L-07, closed 2026-09-30)
 *
 * The border drew in `--primary` (accent-9) until #2398, which is what the
 * committed framework board draws ("gold border"). Paul's 2026-09-18 decision
 * moved it to `--accent-text`, the token `FOCUS_RING_OFFSET` below already
 * uses, for two reasons that `focus-contrast.spec.ts` pins:
 *
 * - **A primary button had no focus change at all.** `buttonVariants` gives
 *   every variant `border-transparent`, and on the `default` variant the fill
 *   is `bg-primary`, so swapping the border to `--primary` repainted it in the
 *   fill's own colour. The 25% halo was the whole indicator.
 * - **Headroom.** accent-9 used to fail 3:1 on 9 of 19 seeds over `--popover`.
 *   Since #2541 the engine holds it to 3:1 on every ladder step, but 3:1 is all
 *   the floor guarantees (3.78:1 at the worst seed). accent-11 is the engine's
 *   text role, gated at 4.5:1 as text, and its worst seed × ladder step is
 *   6.81:1. One token for both recipes also means one number to watch.
 *
 * The token alone did not fix the primary button. The one surface accent-11
 * does not stand out on is accent-9 itself (1.09–2.07:1 across the 19 seeds,
 * the reason `signet.css` rejects it for `::selection`), and with the default
 * `border-box` background clip the fill paints under the transparent border.
 * So focus would only have moved that 1px from accent-9 to accent-11. The
 * `default` variant therefore clips its fill to the padding box
 * (`bg-clip-padding`): at rest the border shows the surface behind the button,
 * and on focus it turns accent-11, a change of 6.81:1 or better. Any other
 * filled control over a transparent border needs the same clip.
 *
 * That is also why `FOCUS_RING` is wrong for a control whose border already
 * encodes something. On a `Switch` the border carries on/off, and on a
 * `TabsTrigger` the bottom border IS the selected indicator — so swapping it on
 * focus either loses the state or, worse, paints the exact visual that means
 * "selected", leaving a keyboard user unable to tell focus from selection.
 * Those controls take `FOCUS_RING_OFFSET`, which puts the same accent-11 in an
 * offset ring *around* the control and leaves its border alone — see that
 * constant.
 *
 * The swap only draws where there is a border to swap. A host with no border
 * class (`border-0`) gets the diluted ring alone, which is no indicator — give
 * it `border border-transparent`, as `buttonVariants` does.
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
 * not by the order classes appear in the string.
 * `focus-visible:border-accent-text` and a `data-[state=…]:border-…` are both
 * one class plus one pseudo-class/attribute, so the `data-` rule — emitted
 * later — wins silently. Anywhere a state variant touches a property one of
 * these recipes also touches, the state variant must be scoped with `enabled:`
 * (mutually exclusive, so no tie can arise) rather than left to source order.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25";

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
 * | `--primary` (accent-9) | 4.70:1 | yes, and 3.78:1 on `--popover` |
 * | `--ring` (accent-8) | 2.98:1 | no, fails on 3 |
 * | `--accent-text` (accent-11) | 8.48:1 | yes, on all 19 |
 *
 * `--primary` failed on 4 seeds (worst 1.87:1) until #2541, when the engine
 * began lifting a dark fill until it clears 3:1 on every ladder surface
 * (`accent-engine.md` §8). The floor guarantees 3:1 and nothing more, and a
 * seed that already clears it keeps its fill: the worst is `#800000`, whose
 * generated `#F42F22` the engine leaves as it is. So accent-9 still has
 * nowhere near accent-11's headroom as a whole indicator.
 *
 * `--ring` was the token here until the greenfield surface ladder
 * (foundations.md §2) lifted `--background` from `#0E0D0B` to `#131211`. Its
 * margin was always thin — 3.05:1 against a 3.0 floor on `#4B0082` — and the
 * lighter base consumed it, dropping `#4B0082` to 2.94 and the three achromatic
 * seeds (`#000000`, `#C0C0C0`, `#FFFFFF`, which all derive ring `#606060`) to
 * 2.98. That is a keyboard user on four chapters with no conforming indicator,
 * which is the exact defect this recipe was created to fix, so the token moved
 * up the scale rather than the guard moving down. (`#4B0082` has cleared since
 * #2541 lifted its fill and with it the whole scale; the achromatic three
 * have not.)
 *
 * accent-11 is the accent engine's text role: `accent-engine.md` §8 gates it at
 * 4.5:1 as text, so 3:1 as non-text UI has real headroom under it. That is why
 * it is robust where accent-8 was merely passing.
 *
 * ## The `accent-text` key is a shared-preset key, as of #2371
 *
 * `ring-accent-text` resolves through `packages/theme/src/tailwind.config.ts`.
 * It used to live in `apps/web/tailwind.config.ts` and was unmovable: the
 * shared preset was also read by the frozen `apps/landing`, and
 * `tailwind.config.spec.ts` asserted every preset token was defined in the
 * legacy `globals.css` `:root`, which had no `--accent-text`. #2366 removed
 * both halves of that — landing ships `signet.css`, the legacy stylesheet is
 * deleted, and that spec now reads `signet.css` — which made the move merely
 * UNDONE work rather than forbidden. #2371 did it, with both apps' compiled
 * stylesheets diffed byte-for-byte either side.
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
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const FOCUS_RING_ALWAYS =
  "focus:outline-none focus:border-accent-text focus:ring-[3px] focus:ring-ring/25";

/**
 * `FOCUS_RING_OFFSET`'s recipe, delegated to a container the way
 * `FOCUS_RING_WITHIN` delegates `FOCUS_RING`'s.
 *
 * For a well whose focusable control is visually hidden inside it — the upload
 * sheet's file field (`components/shared/upload-sheet.tsx`), where the
 * `<input type="file">` is `sr-only` so a `<label>` can carry the affordance.
 * The input is what takes focus, so `focus-visible` on it would draw a ring
 * around nothing a sighted keyboard user can see.
 *
 * The **offset** recipe rather than `FOCUS_RING_WITHIN`, for the reason
 * `FOCUS_RING_OFFSET` exists: that well's border already encodes its error
 * state, and `FOCUS_RING_WITHIN` swaps the border, so focusing an invalid
 * field would erase the one thing the border was saying.
 *
 * **The offset is `--popover`, not `--background`, and that is the one line
 * that differs from `FOCUS_RING_OFFSET`.** Tailwind's ring-offset is a literal
 * band of colour, not a hole punched through to whatever is really behind the
 * element. `FOCUS_RING_OFFSET` names `--background` because its hosts sit on
 * it; this recipe's host is a well inside a sheet, so the band falls on
 * `--popover`. Painting `--background` there put a third dark tone between the
 * well and the sheet, measurably distinct at 1.245:1 rather than the 1.000:1 a
 * matched band gives — a visible seam around the control, in the one state
 * that exists to make the control obvious.
 *
 * Moving it costs contrast the ring can afford. Against `--popover` the house
 * seed's accent-11 measures 9.21:1, and the worst of the 19 seeded accents
 * — the one `focus-contrast.spec.ts` records at 8.48:1 against `--background`
 * — scales to 6.81:1. README §6's floor for non-text UI is 3:1, so the margin
 * is more than doubled even at the worst seed.
 *
 * Spelled out rather than derived from `FOCUS_RING_OFFSET` at runtime. A
 * `.replace()` over that constant produces the right string and the wrong
 * build: Tailwind scans source text, so a class that never appears literally is
 * never emitted, and the ring silently does not exist — the same failure mode
 * the top-of-file comment describes for an unknown variant.
 */
export const FOCUS_RING_OFFSET_WITHIN =
  "focus-within:outline-none focus-within:ring-2 focus-within:ring-accent-text focus-within:ring-offset-2 focus-within:ring-offset-popover";

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
  "focus-within:border-accent-text focus-within:ring-[3px] focus-within:ring-ring/25";

/**
 * A "Skip to X" link: invisible until it is the focused element, then pinned
 * to the top-left corner. `dashboard-shell.tsx`'s app-wide skip link and any
 * route that needs its own past a sub-navigation (chat's channel rail, per
 * #396) share this — a hand-copied className string is exactly the kind of
 * recipe this file exists to keep in one place; see the top-of-file comment.
 */
/**
 * The shell's focus recipe: the ring alone, with no border swap.
 *
 * Several shell controls (the nav row, the Ask pill, the account avatar)
 * already encode state in their border, so `FOCUS_RING`'s border swap would
 * fight that state rather than add to it.
 *
 * **This is not a conforming indicator.** The diluted ring is 1.18–1.31:1 on
 * every ladder step (see the top-of-file comment), and it is all this recipe
 * draws. It predates L-07, whose closing moved `FOCUS_RING`'s border to
 * accent-11 and left this recipe alone. #2965 tracks giving the shell a real
 * indicator, most likely `FOCUS_RING_OFFSET`'s solid accent-11 ring.
 *
 * Exported because the greenfield shell needs it in six places. The literal was
 * hand-copied into each of them first, which is exactly what the top-of-file
 * comment says this module exists to prevent: when the recipe moves, a grep
 * for `FOCUS_RING` has to find every consumer, and six anonymous string copies
 * are invisible to that grep.
 */
export const FOCUS_RING_SHELL =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25";

export const SKIP_LINK_CLASSES =
  "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm";
