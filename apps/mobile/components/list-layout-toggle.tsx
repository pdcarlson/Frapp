import { HeaderButton } from "@/components/header-button";
import { GridGlyph, ListGlyph } from "@/components/control-glyphs";
import {
  setListLayout,
  useListLayout,
  type ListLayoutScreen,
} from "@/lib/list-layout";
import { useFrappTheme } from "@/lib/theme";

/**
 * The one List / Grid switch every screen that offers both uses (#4175): a
 * round header button at the trailing end of the title row, showing the
 * layout a tap switches to, as Google Drive and Files draw theirs. The pick is
 * remembered per screen on this phone (`lib/list-layout.ts`).
 *
 * > Changed 2026-11-17 by pdcarlson (Paul's rule against segmented switchers
 * > on the phone, picked in the #5278 session): it was a List | Grid
 * > segmented control with word labels, as Events' List / Calendar is.
 */
export function ListLayoutToggle({ screen }: { screen: ListLayoutScreen }) {
  const { tokens } = useFrappTheme();
  const layout = useListLayout(screen);
  const next = layout === "grid" ? "list" : "grid";
  const Glyph = next === "grid" ? GridGlyph : ListGlyph;
  return (
    <HeaderButton
      label={next === "grid" ? "Show as grid" : "Show as list"}
      value={layout === "grid" ? "Grid" : "List"}
      onPress={() => setListLayout(screen, next)}
    >
      <Glyph color={tokens.color.text.foreground} />
    </HeaderButton>
  );
}
