import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { tint } from "@/lib/theme";

/**
 * The More hub's leading row glyphs (s09, `canvas-screens.dc.html:326`).
 *
 * Geometry is transcribed from the board where it draws the row (Study hours,
 * Dues, Documents, Directory, Notifications, Settings, Host check-in), and
 * from the web shell's `apps/web/components/layout/nav-glyphs.tsx` where it
 * does not: Service hours is web's `ServiceGlyph` heart, and Settings follows
 * web's gear rather than the board's half-drawn cog, so one intent draws one
 * shape on both surfaces (`spec/ui/design-system/iconography.md` §6.2). The
 * chapter switcher is the one shape neither draws.
 *
 * The recipe is iconography.md §1: a 1.6px stroke on a 24px grid, the primary
 * silhouette filled with its own hue at low opacity, secondary strokes
 * stroke-only. Rendered at 20px, §2's size for a list row's leading icon (the
 * board draws 22, which is off the scale).
 *
 * Color is a prop, never baked. The board paints the member rows in
 * `gold.askText`; the app paints them in the chapter accent, which is house
 * gold only for a chapter without a served palette, for the reason
 * `components/tab-glyphs.tsx` records. The admin rows are drawn neutral
 * (`text.muted` over white at 6%), as the board draws them.
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
  /** The stroke hue: the chapter accent, or `text.muted` for a neutral row. */
  color: string;
  /** `true` draws §1's neutral fill rather than the stroke hue's tint. */
  neutral?: boolean;
  /**
   * Another §2 size, for a glyph drawn outside the hub. `DocumentsGlyph`
   * takes one for s21's file card (24), and `ServiceGlyph` for the chat hours
   * card's eyebrow (16).
   */
  size?: number;
};

function paint({ color, neutral = false }: MoreGlyphProps) {
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

function Frame({
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

export function StudyGlyph(props: MoreGlyphProps) {
  const { body, detail } = paint(props);
  return (
    <Frame>
      <Circle cx={12} cy={12} r={8.5} {...body} />
      <Path d="M12 7.5V12l3 2" {...detail} />
    </Frame>
  );
}

export function ServiceGlyph(props: MoreGlyphProps) {
  const { body } = paint(props);
  return (
    <Frame size={props.size}>
      <Path
        d="M12 20.2s-6.8-4.2-8.7-8.2a4.9 4.9 0 018.7-4.5 4.9 4.9 0 018.7 4.5c-1.9 4-8.7 8.2-8.7 8.2z"
        {...body}
      />
    </Frame>
  );
}

export function DuesGlyph(props: MoreGlyphProps) {
  const { body, detail } = paint(props);
  return (
    <Frame>
      <Rect x={3.5} y={6} width={17} height={12.5} rx={3} {...body} />
      <Path d="M3.5 10h17" {...detail} />
    </Frame>
  );
}

export function DocumentsGlyph(props: MoreGlyphProps) {
  const { body, detail } = paint(props);
  return (
    <Frame size={props.size}>
      <Path
        d="M6 3.5h8l4 4V20a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 015 20V5A1.5 1.5 0 016.5 3.5z"
        {...body}
      />
      <Path d="M14 3.5V8h4.5" {...detail} />
    </Frame>
  );
}

export function DirectoryGlyph(props: MoreGlyphProps) {
  const { body, detail } = paint(props);
  return (
    <Frame>
      <Circle cx={9} cy={9} r={3.4} {...body} />
      <Path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" {...detail} />
      <Circle cx={16.5} cy={10} r={2.6} {...detail} />
      <Path d="M16 15.5c2.4 0 4 1.4 4.5 3.5" {...detail} />
    </Frame>
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

export function SettingsGlyph(props: MoreGlyphProps) {
  const { body, detail } = paint(props);
  return (
    <Frame>
      <Path
        d="M10.7 3.2h2.6l.5 2.2a7 7 0 012 1.2l2.1-.8 1.3 2.3-1.7 1.5a7.2 7.2 0 010 2.3l1.7 1.5-1.3 2.3-2.1-.8a7 7 0 01-2 1.2l-.5 2.2h-2.6l-.5-2.2a7 7 0 01-2-1.2l-2.1.8-1.3-2.3 1.7-1.5a7.2 7.2 0 010-2.3L4.8 8.1l1.3-2.3 2.1.8a7 7 0 012-1.2z"
        {...body}
      />
      <Circle cx={12} cy={12} r={2.7} {...detail} />
    </Frame>
  );
}

/**
 * Switch chapter. Neither board draws this row (`spec/ui/mobile/navigation.md`
 * § More hub lists it as a reachability row), so the shape is new: a crest
 * carrying the two opposed arrows of a swap, drawn in the §1 recipe.
 */
export function ChapterGlyph(props: MoreGlyphProps) {
  const { body, detail } = paint(props);
  return (
    <Frame>
      <Path
        d="M12 3.2l7 2.6v5.4c0 4.6-3 7.7-7 9.3-4-1.6-7-4.7-7-9.3V5.8z"
        {...body}
      />
      <Path d="M9 10h6l-1.8-1.8M15 13.6H9l1.8 1.8" {...detail} />
    </Frame>
  );
}

export function HostCheckInGlyph(props: MoreGlyphProps) {
  const { body, detail } = paint(props);
  return (
    <Frame>
      <Rect x={4} y={4} width={6.5} height={6.5} rx={1.6} {...body} />
      <Rect x={13.5} y={4} width={6.5} height={6.5} rx={1.6} {...body} />
      <Rect x={4} y={13.5} width={6.5} height={6.5} rx={1.6} {...body} />
      <Path d="M13.5 16.5h3.5v3.5M20 13.5v2" {...detail} />
    </Frame>
  );
}
