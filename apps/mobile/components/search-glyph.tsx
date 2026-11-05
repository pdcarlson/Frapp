import Svg, { Circle, Path } from "react-native-svg";
import { MORE_GLYPH_SIZE, STROKE_WIDTH } from "@/components/more/more-glyphs";
import { tint } from "@/lib/theme";

/**
 * iconography.md §1's emphasis fill. A copy of `more-glyphs.tsx`'s private
 * `EMPHASIS_FILL_ALPHA`: see the recipe note below.
 */
const EMPHASIS_FILL_ALPHA = 0.16;

/**
 * The magnifier, for a search or a filter that matched nothing. Geometry is
 * web's `SearchGlyph` (`apps/web/components/layout/nav-glyphs.tsx`), so one
 * intent draws one shape on both surfaces
 * (`spec/ui/design-system/iconography.md` §6.2).
 *
 * The recipe is iconography.md §1 as the More hub's glyphs draw it, and it
 * lives in `components/more/more-glyphs.tsx`: its `paint()` (a body filled
 * with its own hue at `EMPHASIS_FILL_ALPHA`, stroked at `STROKE_WIDTH` with
 * round joins; a detail stroke-only with round caps and joins) and its
 * `Frame` (a 24 grid at `MORE_GLYPH_SIZE`, hidden from screen readers).
 * `paint` and `Frame` aren't exported, so this matches them by hand: the
 * lens is the body, the handle the detail. A change to that recipe has to
 * reach this file too, until the recipe moves out of `more-glyphs.tsx` into a
 * module both import.
 *
 * It replaces the "⌕" character the empty-state tiles drew, which Figtree
 * doesn't carry, so Android drew it from a fallback font.
 */
export function SearchGlyph({
  color,
  size = MORE_GLYPH_SIZE,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      // Decorative: the words beside it say what happened.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle
        cx={10.5}
        cy={10.5}
        r={6.2}
        fill={tint(color, EMPHASIS_FILL_ALPHA)}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <Path
        d="M15.2 15.2l4.3 4.3"
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
