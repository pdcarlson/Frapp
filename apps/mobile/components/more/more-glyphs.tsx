import type { ReactNode } from "react";
import Svg, { Path } from "react-native-svg";
import { NAV_GLYPHS, type NavGlyphName } from "@repo/theme/nav-glyphs";
import { NavGlyph } from "@/components/nav-glyph";
import { tint } from "@/lib/theme";

/**
 * The More hub's leading row glyphs, and the stroke recipe a few other
 * glyphs outside the hub still use.
 *
 * The hub rows draw the shared nav set in `@repo/theme/nav-glyphs` (see
 * {@link HubGlyph} below), so a destination has the same silhouette here as in
 * the web sidebar (`spec/ui/design-system/iconography.md` §6.2). They render at
 * 20px, §2's size for a list row's leading icon.
 *
 * Color is a prop, never baked. Every hub row passes `text.mutedForeground`,
 * the rest hue the web sidebar's glyphs take (iconography.md §1: the accent is
 * the active state, and a hub row is never active).
 *
 * `paint`, `Frame` and `STROKE_WIDTH` are the older stroke recipe (a 1.6px
 * stroke on a 24px grid, silhouette at 16% of the hue or 6% white when
 * neutral). The bell and `components/search-glyph.tsx` still draw in it, and
 * `documents/document-glyphs.tsx` borrows its `STROKE_WIDTH`.
 */

export const MORE_GLYPH_SIZE = 20;

export const STROKE_WIDTH = 1.6;

/** iconography.md §1: the emphasis fill is the stroke hue at 16–18%. */
const EMPHASIS_FILL_ALPHA = 0.16;

/**
 * iconography.md §1's neutral fill, "white at 6%". A literal for the reason
 * `tab-glyphs.tsx` gives: no token carries it.
 */
const NEUTRAL_FILL = "rgba(255,255,255,0.06)";

export type MoreGlyphProps = {
  /** The stroke hue: `text.mutedForeground` on every hub row (iconography §1). */
  color: string;
  /** `true` draws §1's neutral fill rather than the stroke hue's tint. */
  neutral?: boolean;
  /**
   * Another §2 size, for a stroke-recipe glyph drawn outside the hub, such
   * as `components/search-glyph.tsx`.
   */
  size?: number;
};

/**
 * The recipe's strokes and fills: `body` for the primary silhouette, `detail`
 * for a secondary stroke. Exported, with {@link Frame}, so a glyph drawn in
 * this recipe outside the hub (`components/search-glyph.tsx`) uses this one
 * definition rather than a copy.
 */
export function paint({ color, neutral = false }: MoreGlyphProps) {
  const fill = neutral ? NEUTRAL_FILL : tint(color, EMPHASIS_FILL_ALPHA);
  return {
    body: {
      fill,
      stroke: color,
      strokeWidth: STROKE_WIDTH,
      strokeLinejoin: "round" as const,
    },
    detail: {
      fill: "none",
      stroke: color,
      strokeWidth: STROKE_WIDTH,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
    },
  };
}

/** The 24 grid at a §2 size, hidden from screen readers. */
export function Frame({
  children,
  size = MORE_GLYPH_SIZE,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      // Decorative: the row's label names the destination.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </Svg>
  );
}

export function NotificationsGlyph(props: MoreGlyphProps) {
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
 * in the More hub as in the web nav. The silhouette is always the glyph's own
 * hue at 20%; a row's hue comes from `color` alone (`text.mutedForeground` on
 * every hub row).
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
