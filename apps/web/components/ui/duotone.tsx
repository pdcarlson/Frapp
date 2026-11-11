/**
 * The Signet duotone icon recipe, in one place.
 *
 * `spec/ui/design-system/iconography.md` §1: 1.6px stroke on a 24px grid with
 * rounded caps and joins; the glyph's primary silhouette carries a low-opacity
 * fill of its own hue — white at 6% when neutral, the stroke hue at 18% when
 * active — and detail strokes (clock hands, calendar rules, checkmarks, bell
 * clappers) stay stroke-only. A state change recolors the one glyph; there is
 * no second, filled variant to swap to. The one exception is `markFillProps`
 * below, for Documents' Star and Pin (§1 rule 1's note, #4289): the same
 * glyph, filled solid while on.
 *
 * This module holds only the recipe. The glyphs themselves live with the
 * surface that owns their intents — `components/layout/nav-glyphs.tsx` for the
 * shell's top bar, `components/chat/chat-glyphs.tsx` for chat — because the intent → glyph
 * map in `iconography.md` §6.2 is organised the same way. Two copies of the
 * recipe would be two chances for a surface to drift off it, which is the whole
 * failure mode §1 rule 1 exists to prevent.
 *
 * The sidebar nav glyphs are the exception: they draw the two-tone nav set
 * shared with mobile (`@repo/theme/nav-glyphs`, iconography.md §1.1), not
 * this recipe.
 */

export type DuotoneGlyphProps = {
  className?: string;
  /**
   * Emphasis state. The parent that knows selection passes it down; the fill
   * hue follows `currentColor`, so the accent comes from the text color the
   * parent already sets.
   */
  active?: boolean;
};

export type DuotoneGlyphComponent = (props: DuotoneGlyphProps) => React.ReactNode;

/** Silhouette fill per state: white 6% neutral, stroke-hue 18% active. */
export function fillProps(active: boolean | undefined) {
  return active
    ? { fill: "currentColor", fillOpacity: 0.18 }
    : { fill: "#FFFFFF", fillOpacity: 0.06 };
}

/**
 * Documents' Star and Pin: solid in their hue while on, the neutral
 * silhouette while off. The one exception to §1
 * rule 1's "recolor, never fill", because at 18% an on mark read as the off
 * outline in another colour (#4289). Path data is unchanged: the same glyph,
 * filled.
 */
export function markFillProps(active: boolean | undefined) {
  return active
    ? { fill: "currentColor", fillOpacity: 1 }
    : fillProps(false);
}

export const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const detail = { ...stroke, fill: "none" } as const;

export function Svg({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
