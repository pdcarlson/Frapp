import { HeaderButton } from "@/components/header-button";
import { GridGlyph, ListGlyph } from "@/components/control-glyphs";
import {
  setListLayout,
  useListLayout,
  type ListLayoutScreen,
} from "@/lib/list-layout";
import { useChapterBranding } from "@/lib/chapter-branding";

/**
 * The one List / Grid switch every screen that offers both uses (#4175): a
 * round header button at the trailing end of the title row, showing the
 * layout a tap switches to, as Google Drive and Files draw theirs. The pick is
 * remembered per screen on this phone (`lib/list-layout.ts`).
 *
 * In the chapter accent: it acts on this screen, as Edit and Mark all read
 * do (`HeaderButton`, `patterns.md` § Screen headers).
 *
 * > Changed 2026-11-17 by pdcarlson (picked in the #5278 session, after Paul
 * > asked for no segmented switchers on Documents): it was a List | Grid
 * > segmented control with word labels. Events' List / Calendar is not this
 * > control and keeps its segmented control.
 */
export function ListLayoutToggle({ screen }: { screen: ListLayoutScreen }) {
  const { accent } = useChapterBranding();
  const layout = useListLayout(screen);
  const next = layout === "grid" ? "list" : "grid";
  const Glyph = next === "grid" ? GridGlyph : ListGlyph;
  return (
    <HeaderButton
      label={next === "grid" ? "Show as grid" : "Show as list"}
      value={layout === "grid" ? "Grid" : "List"}
      onPress={() => setListLayout(screen, next)}
    >
      <Glyph color={accent} />
    </HeaderButton>
  );
}
