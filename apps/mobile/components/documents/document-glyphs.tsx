import { Path } from "react-native-svg";
import { MARK_GLYPH_PATHS } from "@repo/theme/nav-glyphs";
import { Frame, paint } from "@/components/more/more-glyphs";

/**
 * The pin and the star on s12 (#3934), drawn on the shared 24 grid with the
 * More family's paint: filled while on, outline while off, as web's
 * `PinGlyph` and `StarGlyph` are. The path data is `MARK_GLYPH_PATHS`
 * (`@repo/theme/nav-glyphs`), the one copy both apps draw from.
 */
interface MarkGlyphProps {
  color: string;
  /** Filled: the folder or file is pinned, or starred. */
  on?: boolean;
  size?: number;
}

export function PinGlyph({ color, on = false, size = 16 }: MarkGlyphProps) {
  const { body, detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path d={MARK_GLYPH_PATHS.pin.body} {...(on ? body : detail)} />
      <Path d={MARK_GLYPH_PATHS.pin.detail} {...detail} />
    </Frame>
  );
}

export function StarGlyph({ color, on = false, size = 16 }: MarkGlyphProps) {
  const { body, detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path
        d={MARK_GLYPH_PATHS.star.body}
        {...(on ? body : detail)}
      />
    </Frame>
  );
}
