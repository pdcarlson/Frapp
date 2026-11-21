import Svg, { Path } from "react-native-svg";
import { FRAPP_CREST_PATH, FRAPP_CREST_VIEW_BOX } from "@repo/theme/crest";

/**
 * The crest as a glyph in a colour the caller gives it, `height` tall and
 * five sixths as wide. Decoration: every place that draws it says "Ask Frapp"
 * in words beside it.
 *
 * Only Ask's front doors draw the crest this way (#4702, Paul 2026-11-13),
 * and there it takes the chapter accent. The mark itself stays the fixed gold
 * raster everywhere else (`spec/ui/brand-identity.md` §2).
 */
export function FrappCrest({
  height,
  color,
}: {
  height: number;
  color: string;
}) {
  return (
    <Svg
      width={(height * 5) / 6}
      height={height}
      viewBox={FRAPP_CREST_VIEW_BOX}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Path d={FRAPP_CREST_PATH} fill={color} />
    </Svg>
  );
}
