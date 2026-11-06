import Svg, { Circle, Path } from "react-native-svg";

/**
 * A map pin, for an event's location on its chat card. Geometry matches web's
 * `LocationGlyph` (`apps/web/components/chat/chat-glyphs.tsx`): the pin body
 * on the 24-unit grid and a stroke-only centre dot, at the iconography §1
 * 1.6 stroke with rounded caps and joins.
 *
 * Colors arrive as props rather than baked hexes, for the reason
 * `components/tab-glyphs.tsx` states. Decorative: the location text beside it
 * says everything, so the glyph is never an accessibility element.
 */

const STROKE_WIDTH = 1.6;
/** iconography.md §1's inactive fill. */
const INACTIVE_FILL = "rgba(255,255,255,0.06)";

export function LocationGlyph({
  color,
  size = 16,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M12 21s-6.5-5.6-6.5-10.4a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={INACTIVE_FILL}
      />
      <Circle
        cx={12}
        cy={10.5}
        r={2.4}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        fill="none"
      />
    </Svg>
  );
}
