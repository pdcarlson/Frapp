import { Circle, Path } from "react-native-svg";
import {
  Frame,
  type MoreGlyphProps,
  paint,
} from "@/components/more/more-glyphs";

/**
 * The magnifier, for a search or a filter that matched nothing. Geometry is
 * web's `SearchGlyph` (`apps/web/components/layout/nav-glyphs.tsx`), so one
 * intent draws one shape on both surfaces
 * (`spec/ui/design-system/iconography.md` §6.2).
 *
 * Drawn in the More hub's recipe (iconography.md §1), from that file's own
 * `paint` and `Frame`, so a change to the recipe reaches it too: the lens is
 * the body, the handle the detail.
 *
 * It replaces the "⌕" character the empty-state tiles drew, which Figtree
 * doesn't carry, so Android drew it from a fallback font.
 */
export function SearchGlyph(props: MoreGlyphProps) {
  const { body, detail } = paint(props);
  return (
    <Frame size={props.size}>
      <Circle cx={10.5} cy={10.5} r={6.2} {...body} />
      <Path d="M15.2 15.2l4.3 4.3" {...detail} />
    </Frame>
  );
}
