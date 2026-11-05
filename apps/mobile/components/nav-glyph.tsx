import Svg, { Path } from "react-native-svg";
import {
  GLYPH_BACK_OPACITY,
  GLYPH_VIEW_BOX,
  type DuotoneGlyphPaths,
} from "@repo/theme/nav-glyphs";

/**
 * Draws one entry of the shared nav set (`@repo/theme/nav-glyphs`), the shapes
 * the web sidebar draws too: the silhouette in `color` at reduced opacity, then
 * the outline at full strength (`spec/ui/design-system/iconography.md` §1).
 *
 * Decorative: every caller sits beside a label that names the destination.
 */
export function NavGlyph({
  paths,
  color,
  size,
  active = false,
}: {
  paths: DuotoneGlyphPaths;
  color: string;
  size: number;
  /** Lifts the silhouette from 20% to 30%, the selected state. */
  active?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={GLYPH_VIEW_BOX}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d={paths.back}
        fill={color}
        fillOpacity={
          active ? GLYPH_BACK_OPACITY.active : GLYPH_BACK_OPACITY.rest
        }
      />
      <Path d={paths.front} fill={color} />
    </Svg>
  );
}
