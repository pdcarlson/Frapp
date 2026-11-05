import Svg, { Circle, Path } from "react-native-svg";
import { tint } from "@/lib/theme";

/**
 * The magnifier, for a search that matched nothing. Geometry is web's
 * `SearchGlyph` (`apps/web/components/layout/nav-glyphs.tsx`), so one intent
 * draws one shape on both surfaces (`spec/ui/design-system/iconography.md`
 * §6.2), in the §1 recipe the More hub's glyphs use: a 1.6px stroke on a 24px
 * grid, the lens filled with its own hue at 16%, the handle stroke-only.
 *
 * It replaces the "⌕" character the More screens' no-results tiles drew,
 * which Figtree doesn't carry, so Android drew it from a fallback font. Chat
 * home's channel search still passes the character.
 */
export function SearchGlyph({
  color,
  size = 20,
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
        fill={tint(color, 0.16)}
        stroke={color}
        strokeWidth={1.6}
      />
      <Path
        d="M15.2 15.2l4.3 4.3"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}
