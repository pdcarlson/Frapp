import { Path } from "react-native-svg";
import { NAV_GLYPHS, type NavGlyphName } from "@repo/theme/nav-glyphs";
import { Frame, paint, type GlyphPaintProps } from "@/components/glyph-recipe";
import { NavGlyph } from "@/components/nav-glyph";

/**
 * The You tab's leading row glyphs (the More hub's until #3839), and the bell.
 *
 * The hub rows draw the shared nav set in `@repo/theme/nav-glyphs` (see
 * {@link HubGlyph} below), so a destination has the same silhouette here as in
 * the web sidebar (`spec/ui/design-system/iconography.md` §6.2). They render at
 * 20px, §2's size for a list row's leading icon.
 *
 * Color is a prop, never baked. On the You tab a row paints its glyph in its
 * place's fixed hue, inside a tile tinted with the same hue
 * (`lib/more/destination-hue.ts`; foundations.md §6, "A place's hue",
 * 2026-11-12), and in `text.disabled` when the row can't be opened. Anywhere
 * else a row's icon is a neutral text step. Never the chapter accent
 * (foundations.md §6, "Where the accent goes", 2026-11-05).
 *
 * The bell (`NotificationsGlyph`) draws in the §1 stroke recipe,
 * `components/glyph-recipe.tsx`.
 */

const MORE_GLYPH_SIZE = 20;

export function NotificationsGlyph(props: GlyphPaintProps) {
  const { body, detail } = paint(props);
  return (
    <Frame>
      <Path
        d="M12 3a6 6 0 016 6v3.2l1.4 2.8H4.6L6 12.2V9a6 6 0 016-6z"
        {...body}
      />
      <Path d="M9.8 18a2.3 2.3 0 004.4 0" {...detail} />
    </Frame>
  );
}

/* ── Hub rows: the shared nav set ───────────────────────────────────────── */

/**
 * A hub row's glyph. These draw the shared nav set (`@repo/theme/nav-glyphs`),
 * the same shapes as the web sidebar, so Study hours or Settings looks the same
 * on the You tab as in the web nav. The silhouette is always the glyph's own
 * hue at 20%; its hue is `color` alone, `text.muted` on every hub row.
 */
export type HubGlyphProps = {
  color: string;
  /**
   * Another §2 size, for a glyph drawn outside the hub: `DocumentsGlyph`
   * takes 24 on s21's file card.
   */
  size?: number;
};

function HubGlyph({
  name,
  color,
  size = MORE_GLYPH_SIZE,
}: HubGlyphProps & { name: NavGlyphName }) {
  return <NavGlyph paths={NAV_GLYPHS[name]} color={color} size={size} />;
}

export function StudyGlyph(props: HubGlyphProps) {
  return <HubGlyph name="study" {...props} />;
}

export function ServiceGlyph(props: HubGlyphProps) {
  return <HubGlyph name="service" {...props} />;
}

/** Dues: web's Billing card. */
export function DuesGlyph(props: HubGlyphProps) {
  return <HubGlyph name="billing" {...props} />;
}

/** Also s21's file card (24) and the documents empty state. */
export function DocumentsGlyph(props: HubGlyphProps) {
  return <HubGlyph name="documents" {...props} />;
}

/** Minutes: the nav set's meetings mark, as web's sidebar draws it. */
export function MinutesGlyph(props: HubGlyphProps) {
  return <HubGlyph name="meetings" {...props} />;
}

export function DirectoryGlyph(props: HubGlyphProps) {
  return <HubGlyph name="directory" {...props} />;
}

export function SettingsGlyph(props: HubGlyphProps) {
  return <HubGlyph name="settings" {...props} />;
}

/** Switch chapter and Create a chapter: the columned chapter house. */
export function ChapterGlyph(props: HubGlyphProps) {
  return <HubGlyph name="chapter" {...props} />;
}

export function HostCheckInGlyph(props: HubGlyphProps) {
  return <HubGlyph name="hostCheckIn" {...props} />;
}

/** Invite members: the nav set's user-plus, web's Invite beside Directory. */
export function InviteGlyph(props: HubGlyphProps) {
  return <HubGlyph name="invite" {...props} />;
}
