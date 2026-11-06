import Svg, { Circle, Path, Rect } from "react-native-svg";
import { tint } from "@/lib/theme";

/**
 * A camera, transcribed from `canvas-screens.dc.html` s20's "Add photo proof"
 * row: the duotone body (the stroke color at 16%, iconography.md §1's
 * emphasis fill, where the canvas draws 10%, behind a 1.6 stroke), the lens,
 * and the viewfinder bump. The color arrives as a prop so it follows the
 * chapter accent rather than the drawn gold. The stroke width and the
 * emphasis fill are matched by hand to `components/more/more-glyphs.tsx`
 * until #3428 gives the glyphs one shared recipe.
 */
export function CameraGlyph({
  color,
  size = 17,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect
        x={3.5}
        y={6.5}
        width={17}
        height={13}
        rx={3}
        stroke={color}
        strokeWidth={1.6}
        fill={tint(color, 0.16)}
      />
      <Circle
        cx={12}
        cy={13}
        r={3.4}
        stroke={color}
        strokeWidth={1.6}
        fill="none"
      />
      <Path
        d="M8.5 6.5L10 4h4l1.5 2.5"
        stroke={color}
        strokeWidth={1.6}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
