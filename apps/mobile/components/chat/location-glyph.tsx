import { Circle, Path } from "react-native-svg";
import { Frame, paint } from "@/components/glyph-recipe";

/**
 * A map pin, for an event's location on its chat card. Geometry matches web's
 * `LocationGlyph` (`apps/web/components/chat/chat-glyphs.tsx`): the pin body
 * on the 24-unit grid and a stroke-only centre dot, in the §1 stroke recipe
 * (`components/glyph-recipe.tsx`) with its neutral fill.
 *
 * Colors arrive as props rather than baked hexes, for the reason
 * `components/tab-glyphs.tsx` states. Decorative: the location text beside it
 * says everything, so the glyph is never an accessibility element.
 */

export function LocationGlyph({
  color,
  size = 16,
}: {
  color: string;
  size?: number;
}) {
  const { body, detail } = paint({ color, neutral: true });
  return (
    <Frame size={size} hidden={false} accessible={false}>
      <Path
        d="M12 21s-6.5-5.6-6.5-10.4a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z"
        {...body}
      />
      <Circle cx={12} cy={10.5} r={2.4} {...detail} />
    </Frame>
  );
}
