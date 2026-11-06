import { Path } from "react-native-svg";
import { Frame, paint } from "@/components/more/more-glyphs";

/**
 * The image viewer's own controls (`image-viewer.tsx`): the two step
 * chevrons (`spec/ui/design-system/iconography.md` §6.1.4). Its close and
 * share are the app-wide `CloseGlyph` and `ShareGlyph` in
 * `components/control-glyphs.tsx`, drawn at {@link VIEWER_GLYPH_SIZE}. They
 * are control furniture, a verb on a button, so they draw only the stroke
 * recipe's detail strokes, with no silhouette fill. Drawn from
 * `more-glyphs.tsx`'s `Frame` and `paint`, so a change to the recipe reaches
 * them too.
 */

/** Every viewer control draws at this size, the close × included. */
export const VIEWER_GLYPH_SIZE = 24;
const SIZE = VIEWER_GLYPH_SIZE;

interface ViewerGlyphProps {
  color: string;
}

export function ChevronGlyph({
  color,
  direction,
}: ViewerGlyphProps & { direction: "left" | "right" }) {
  const { detail } = paint({ color });
  return (
    <Frame size={SIZE}>
      <Path
        d={direction === "left" ? "M14.5 6l-6 6 6 6" : "M9.5 6l6 6-6 6"}
        {...detail}
      />
    </Frame>
  );
}
