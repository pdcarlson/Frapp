import { Platform } from "react-native";
import { Circle, Path } from "react-native-svg";
import { Frame, paint } from "@/components/more/more-glyphs";

/**
 * The image viewer's own controls (`image-viewer.tsx`): share and the two
 * step chevrons (`spec/ui/design-system/iconography.md` §6.1.4). Its close
 * is the app-wide `CloseGlyph` in `components/control-glyphs.tsx`, drawn at
 * {@link VIEWER_GLYPH_SIZE}. They are control furniture, a verb on a button, so they draw only the stroke
 * recipe's detail strokes, with no silhouette fill. Drawn from
 * `more-glyphs.tsx`'s `Frame` and `paint`, so a change to the recipe reaches
 * them too.
 *
 * Share draws each platform's own mark, because that is the mark each
 * platform's members already read as "send this somewhere": iOS's box with an
 * arrow out of it, Android's three joined nodes.
 */

/** Every viewer control draws at this size, the close × included. */
export const VIEWER_GLYPH_SIZE = 24;
const SIZE = VIEWER_GLYPH_SIZE;

interface ViewerGlyphProps {
  color: string;
}

export function ShareGlyph({ color }: ViewerGlyphProps) {
  const { detail } = paint({ color });
  if (Platform.OS === "android") {
    return (
      <Frame size={SIZE}>
        <Circle cx={17.5} cy={5.5} r={2.5} {...detail} />
        <Circle cx={6.5} cy={12} r={2.5} {...detail} />
        <Circle cx={17.5} cy={18.5} r={2.5} {...detail} />
        <Path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9" {...detail} />
      </Frame>
    );
  }
  return (
    <Frame size={SIZE}>
      <Path d="M12 3.5v11M8 7.5l4-4 4 4" {...detail} />
      <Path
        d="M8.5 10.5H7a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1.5"
        {...detail}
      />
    </Frame>
  );
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
