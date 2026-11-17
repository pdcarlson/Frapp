import { Circle, Path, Rect } from "react-native-svg";
import { Frame, paint } from "@/components/glyph-recipe";

/**
 * A camera, transcribed from `canvas-screens.dc.html` s20's "Add photo proof"
 * row: the duotone body (the stroke color at 16%, iconography.md §1's
 * emphasis fill, where the canvas draws 10%, behind a 1.6 stroke), the lens,
 * and the viewfinder bump. The color arrives as a prop so it follows the
 * chapter accent rather than the drawn gold. Drawn in the §1 stroke recipe
 * (`components/glyph-recipe.tsx`, #3428), and left in the accessibility tree:
 * the control it sits in names itself.
 */
export function CameraGlyph({
  color,
  size = 17,
}: {
  color: string;
  size?: number;
}) {
  const { body, detail } = paint({ color });
  return (
    <Frame size={size} hidden={false}>
      <Rect x={3.5} y={6.5} width={17} height={13} rx={3} {...body} />
      <Circle cx={12} cy={13} r={3.4} {...detail} />
      <Path d="M8.5 6.5L10 4h4l1.5 2.5" {...detail} />
    </Frame>
  );
}
