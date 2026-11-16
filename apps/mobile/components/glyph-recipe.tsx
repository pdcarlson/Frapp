import type { ReactNode } from "react";
import Svg from "react-native-svg";
import { tint } from "@/lib/theme";

/**
 * The §1 stroke recipe (`spec/ui/design-system/iconography.md` §1) for the
 * phone's stroke-recipe glyphs: a 1.6px stroke on a 24px grid, the silhouette
 * at 16% of the stroke hue (6% white when neutral), and secondary strokes
 * unfilled. One definition, so a glyph can't drift off it while looking like
 * it complies (#3428); web's is `apps/web/components/ui/duotone.tsx`.
 *
 * The tab bar, the chat cards' eyebrows and the composer + sheet's rows draw
 * a deliberate second recipe, `glyphPaint` / `GlyphFrame` in `tab-glyphs.tsx`,
 * whose active fill is 18%, so a card's eyebrow and the tab it belongs to read
 * as one family. It shares this file's stroke width and neutral fill.
 */

export const STROKE_WIDTH = 1.6;

/** iconography.md §1: the emphasis fill is the stroke hue at 16–18%. */
const EMPHASIS_FILL_ALPHA = 0.16;

/**
 * iconography.md §1's neutral fill, "white at 6%" (also the tab bar's inactive
 * fill). A literal rather than a token read because no token carries it: the
 * nearest, `border.hairline`, is 8% and semantically a border, so borrowing it
 * would drift the glyph the next time hairlines are retuned.
 */
export const NEUTRAL_FILL = "rgba(255,255,255,0.06)";

/** §2's size for a list row's leading icon, {@link Frame}'s default. */
const DEFAULT_SIZE = 20;

export type GlyphPaintProps = {
  /** The stroke hue: a neutral text step, a place hue, or an accent. */
  color: string;
  /** `true` draws §1's neutral fill rather than the stroke hue's tint. */
  neutral?: boolean;
};

/**
 * The recipe's strokes and fills: `body` for the primary silhouette, `detail`
 * for a secondary stroke.
 */
export function paint({ color, neutral = false }: GlyphPaintProps) {
  const fill = neutral ? NEUTRAL_FILL : tint(color, EMPHASIS_FILL_ALPHA);
  return {
    body: {
      fill,
      stroke: color,
      strokeWidth: STROKE_WIDTH,
      strokeLinejoin: "round" as const,
    },
    detail: {
      fill: "none",
      stroke: color,
      strokeWidth: STROKE_WIDTH,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
    },
  };
}

/**
 * The 24 grid at a §2 size. Hidden from screen readers by default, for a glyph
 * whose label sits beside it; `hidden={false}` leaves that to the caller (a
 * glyph inside a control that names itself), and `accessible={false}` is
 * passed through for one that only opts out of being an element.
 */
export function Frame({
  children,
  size = DEFAULT_SIZE,
  hidden = true,
  accessible,
}: {
  children: ReactNode;
  size?: number;
  hidden?: boolean;
  accessible?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...(hidden
        ? {
            accessibilityElementsHidden: true,
            importantForAccessibility: "no-hide-descendants" as const,
          }
        : null)}
      {...(accessible === undefined ? null : { accessible })}
    >
      {children}
    </Svg>
  );
}
