import { Path } from "react-native-svg";
import { Frame, paint } from "@/components/more/more-glyphs";

/**
 * The pin and the star on s12 (#3934), drawn on the shared 24 grid with the
 * More family's paint: filled while on, outline while off, as web's
 * `PinGlyph` and `StarGlyph` (`apps/web/components/documents/
 * resources-glyphs.tsx`) are. Same paths as web's, so the two apps draw one
 * shape for one idea.
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
      <Path d="M9 3.5h6l-.8 5.2 3 3.1H6.8l3-3.1z" {...(on ? body : detail)} />
      <Path d="M12 11.8V20.5" {...detail} />
    </Frame>
  );
}

export function StarGlyph({ color, on = false, size = 16 }: MarkGlyphProps) {
  const { body, detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path
        d="M12 3.6l2.55 5.2 5.7.83-4.13 4.02.98 5.68L12 16.65l-5.1 2.68.98-5.68-4.13-4.02 5.7-.83z"
        {...(on ? body : detail)}
      />
    </Frame>
  );
}
