import { Path } from "react-native-svg";
import { MARK_GLYPH_PATHS } from "@repo/theme/nav-glyphs";
import { Frame, paint } from "@/components/more/more-glyphs";

/**
 * The pin and the star on s12 (#3934), drawn on the shared 24 grid with the
 * More family's strokes: solid while on, outline while off (#4289), as web's
 * `PinGlyph` and `StarGlyph` are. The More paint's 16% body fill read as an
 * outline in another colour, so an on mark fills in its own colour. The path
 * data is `MARK_GLYPH_PATHS` (`@repo/theme/nav-glyphs`), the one copy both
 * apps draw from.
 */
/** Solid in `color` while on; the stroke-only outline while off. */
function markPaint(color: string, on: boolean) {
  const { body, detail } = paint({ color });
  return { body: on ? { ...body, fill: color } : detail, detail };
}

interface MarkGlyphProps {
  color: string;
  /** Filled: the folder or file is pinned, or starred. */
  on?: boolean;
  size?: number;
}

export function PinGlyph({ color, on = false, size = 16 }: MarkGlyphProps) {
  const { body, detail } = markPaint(color, on);
  return (
    <Frame size={size}>
      <Path d={MARK_GLYPH_PATHS.pin.body} {...body} />
      <Path d={MARK_GLYPH_PATHS.pin.detail} {...detail} />
    </Frame>
  );
}

export function StarGlyph({ color, on = false, size = 16 }: MarkGlyphProps) {
  const { body } = markPaint(color, on);
  return (
    <Frame size={size}>
      <Path d={MARK_GLYPH_PATHS.star.body} {...body} />
    </Frame>
  );
}
