import { FOCUS_RING } from "@/components/ui/focus";

/**
 * The chat chip — reaction chips, the add-reaction chip, and the hover-row
 * actions that share their geometry.
 *
 * `components.md` §11 draws it at **height 26 / radius 9**, and §5's badge
 * recipe supplies the two paints: the reacted chip is the Accent badge
 * (`accent-subtle` fill, `accent-border`, `accent-text`), the add chip is the
 * same geometry in the elevated step with no border and muted text.
 *
 * **26 and 9 are off the token scales, deliberately.** foundations.md §8 maps
 * badges/chips to radius 8–10 and this is the drawn value inside that band, but
 * neither 26px nor 9px has a Tailwind key, so both are arbitrary values here.
 * `signet.css.spec.ts` cannot guard them — if the drawn geometry ever changes,
 * it changes here and nowhere else, which is why this is a module and not four
 * copies of a class string.
 *
 * The neutral chip carries `border-transparent` rather than no border at all:
 * without it the accent chip would stand 2px taller than the add chip beside
 * it, and §11 draws them the same height.
 */
export const CHIP = {
  base: [
    "inline-flex h-[26px] shrink-0 items-center rounded-[9px] border px-2.5",
    "text-[12.5px] font-semibold transition-colors",
    FOCUS_RING,
  ].join(" "),

  /** "I reacted" — the §5 Accent badge. */
  accent: "border-accent-border bg-accent-subtle text-accent-text",

  /**
   * Everything else. The hover lift is `enabled:`-scoped because these chips
   * also carry `disabled:` rules that set the same two properties, and Tailwind
   * breaks a same-specificity tie by its own variant sort order rather than by
   * the order the classes appear in the string — the class of bug the primitives
   * slice found four of (`components/ui/focus.ts`).
   */
  neutral: [
    "border-transparent bg-popover text-muted-foreground",
    "enabled:hover:text-foreground",
    "disabled:cursor-not-allowed disabled:text-disabled",
  ].join(" "),
} as const;

/**
 * The 44px floor (§2), on the surfaces the floor is actually about.
 *
 * §2 requires ≥44px **on touch surfaces**, and the drawn chip is 26. Mobile
 * closes that with `hitSlop`; the web equivalent people reach for first is an
 * `::after` overlay overhanging the chip — and it is wrong here. Chips sit 6px
 * apart and 6px under the bubble, so a 9px overhang covers ~3px of the *visible*
 * chip above it and, being later in the DOM with no z-index, wins the hit test:
 * aiming at the bottom edge of an existing 😂 toggles the 👍 below it. Trading a
 * missed tap for a wrong reaction is not a fix.
 *
 * So the chip simply *is* 44px where 44px is the rule — `pointer-coarse`, the
 * touch case — and stays 26px for a mouse, where the drawn geometry is the
 * spec and a pixel-accurate pointer needs no help. Nothing overlaps in either
 * mode, because the height is real in both.
 */
export const CHIP_HIT_AREA = "pointer-coarse:h-11";

/**
 * The card eyebrow — the small uppercase label above a rich message card's
 * title, and above the rail's section headings.
 *
 * `signet.css` used to ship this as an `.eyebrow` component class at 11px. It
 * had zero consumers (the chat renderers composed their own `font-mono
 * text-[10px]` variant instead), and 11px and 10px are both off the §7 scale,
 * so the class went with this slice and the recipe settled here at the
 * `caption` role. Twelve copies of a four-part class string is how the eleventh
 * and the twelfth quietly become different eyebrows.
 *
 * **Not `font-mono`.** foundations §7 reserves mono for numeric, status and
 * code-like strings; "EVENT" is a label. `system-audit-card.tsx` is the one
 * renderer that legitimately keeps mono, because an audit row *is* a permission
 * key and an action name.
 */
export const EYEBROW =
  "text-[12.5px] font-semibold uppercase tracking-[0.12em]";

/**
 * Rich-message card chrome, §8 at the dense radius.
 *
 * Composed with `<Card>` rather than instead of it: `card.tsx` owns the fill,
 * the hairline and the shadow ban, and a message card that hand-rolls them is a
 * card that silently stops following §8 the next time §8 moves.
 */
export const MESSAGE_CARD = "mt-1 rounded-lg p-4";
