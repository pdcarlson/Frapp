import { Text, type ColorValue } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { fontFamilyFor, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Signet duotone tab glyphs.
 *
 * Geometry — every coordinate, radius, and stroke width — is transcribed from
 * the tab bar drawn in `spec/ui/design-system/reference/canvas-screens.dc.html`,
 * the visual truth that wins over prose per #937. Nothing here is invented.
 *
 * One deliberate deviation from that markup: Canvas omits `stroke-linecap` on
 * the calendar rules, and §1 specifies rounded caps for the family, so they are
 * rounded here. Colors are token reads rather than Canvas's baked hexes —
 * `#78716A` is `text.muted`, and where Canvas bakes `#F4CB63` (`gold.askText`)
 * the active stroke is the chapter accent, which is house gold (`gold.house`,
 * `#EFB63B`) only for a chapter with no served palette.
 *
 * The recipe is `spec/ui/design-system/iconography.md` §1: a 1.6px stroke on a
 * 24px grid with rounded caps and joins, the primary silhouette carrying a
 * low-opacity fill of the stroke's own hue, and secondary strokes (the calendar
 * rules, the checkmark) staying stroke-only with no fill.
 *
 * §1 rule 1 is why every glyph below takes `focused` as a *color* input and
 * never as a shape input: a state change MUST recolor the glyph, and MUST NOT
 * swap to a solid-filled variant. That is the substantive difference from the
 * Ionicons outline/fill pairs this replaces — those swapped geometry.
 *
 * Sizing is 24px per iconography.md §2, which locks 24 for the reskin against
 * the legacy 20 the app shipped until now.
 */

export const TAB_GLYPH_SIZE = 24;

export const STROKE_WIDTH = 1.6;

/** Canvas draws the tab labels at 10.5px. */
const TAB_LABEL_SIZE = 10.5;

/**
 * Inactive fill is "white at 6%" per iconography.md §1's state table. It is a
 * literal rather than a token read because no token carries it — the nearest,
 * `border.hairline`, is 8% and semantically a border, so borrowing it would
 * drift the glyph the next time hairlines are retuned.
 */
const INACTIVE_FILL = "rgba(255,255,255,0.06)";

/**
 * Active fill is the stroke hue at 16–18% (iconography.md §1); Canvas draws the
 * tab bar at .18, so that is what we use.
 *
 * The stroke itself is spec'd as "accent text (step 11)", and that is what
 * the tab layout passes: `useChapterBranding().accent`, read from
 * `chapters.theme_palette` (`--signet-accent-text`), or house gold for a
 * palette without the Signet map.
 */
const ACTIVE_FILL_ALPHA = 0.18;

export type TabGlyphProps = {
  focused: boolean;
  /** Resolved chapter accent (a normalized hex from `useChapterBranding`). */
  accent: string;
  /**
   * The neutral state's stroke: `tokens.color.text.muted` in the tab bar, and
   * `text.mutedForeground` on a chat card's muted eyebrow, so the glyph
   * matches the label beside it.
   */
  muted: string;
  /**
   * Drawn size in points; the 24-unit grid scales with it. The tab bar uses
   * the default {@link TAB_GLYPH_SIZE}. A chat card's eyebrow draws the same
   * glyph at 16, as web's card eyebrow does, so the card and the tab it
   * belongs to share one silhouette.
   */
  size?: number;
};

/**
 * Not a hook, and deliberately not named like one — it reads no state and calls
 * nothing. A `use` prefix here would be a false promise to the `rules-of-hooks`
 * lint, which would then reject a perfectly legal future refactor that moved
 * one of these calls inside a `.map` or a conditional.
 *
 * Exported with {@link GlyphFrame} for the chat card glyphs
 * (`components/chat/card-glyphs.tsx`), which are drawn in this recipe so a
 * card's eyebrow and the tab it belongs to read as one family.
 */
export function glyphPaint({ focused, accent, muted }: TabGlyphProps) {
  return {
    stroke: focused ? accent : muted,
    fill: focused ? tint(accent, ACTIVE_FILL_ALPHA) : INACTIVE_FILL,
  };
}

export function GlyphFrame({
  size = TAB_GLYPH_SIZE,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {children}
    </Svg>
  );
}

/** Chat (s04, home) — the speech bubble with a tail. */
export function ChatGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Path
        d="M4 6.5A3.5 3.5 0 017.5 3h9A3.5 3.5 0 0120 6.5v6a3.5 3.5 0 01-3.5 3.5H10l-4.5 4v-4A3.5 3.5 0 014 12.5z"
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
    </GlyphFrame>
  );
}

/** Events (s06) — calendar body plus stroke-only rules and hangers. */
export function EventsGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Rect
        x={4}
        y={5}
        width={16}
        height={15}
        rx={3.5}
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
      />
      <Path
        d="M4 9.5h16M8.5 3v4M15.5 3v4"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        fill="none"
        strokeLinecap="round"
      />
    </GlyphFrame>
  );
}

/** Tasks (s08) — circle-check; the checkmark stays stroke-only. */
export function TasksGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      <Circle
        cx={12}
        cy={12}
        r={8.5}
        fill={fill}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
      />
      <Path
        d="M8.5 12.2l2.4 2.4 4.6-5"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphFrame>
  );
}

const MORE_SQUARES = [
  { x: 4, y: 4 },
  { x: 13, y: 4 },
  { x: 4, y: 13 },
  { x: 13, y: 13 },
];

/**
 * More (s09) — a 2x2 grid of rounded squares.
 *
 * Note this is NOT an ellipsis. `iconography.md` §6.1 mapped More to
 * `ellipsis-horizontal-circle`, but Canvas draws the grid, and Canvas wins for
 * visuals per #937. The spec row is corrected alongside this file.
 */
export function MoreGlyph(props: TabGlyphProps) {
  const { stroke, fill } = glyphPaint(props);
  return (
    <GlyphFrame size={props.size}>
      {MORE_SQUARES.map((square) => (
        <Rect
          key={`${square.x}-${square.y}`}
          x={square.x}
          y={square.y}
          width={7}
          height={7}
          rx={2.4}
          fill={fill}
          stroke={stroke}
          strokeWidth={STROKE_WIDTH}
        />
      ))}
    </GlyphFrame>
  );
}

/**
 * Tab bar label.
 *
 * iconography.md §1 rule 2 pairs the active glyph with a **700-weight** label,
 * and Canvas draws inactive at 600. Neither can be expressed through
 * `tabBarLabelStyle`, which is a single static style applied to both states —
 * and `typeRole` deliberately emits no `fontWeight`, because Figtree is
 * registered as one font file per weight and a numeric weight makes Android
 * resolve an unregistered face and fall back to system sans. So the weight has
 * to arrive as a per-state `fontFamily`, which needs the label itself.
 *
 * `color` comes from the navigator's active/inactive tint, so the label keeps
 * tracking the chapter accent.
 */
export function TabLabel({
  focused,
  color,
  children,
}: {
  focused: boolean;
  /**
   * `ColorValue`, not `string`: the navigator hands the label its resolved tint,
   * which RN 0.86 types as `string | OpaqueColorValue`.
   */
  color: ColorValue;
  children: React.ReactNode;
}) {
  const { tokens } = useFrappTheme();

  return (
    <Text
      style={{
        ...typeRole(tokens.typography.role.caption),
        fontSize: TAB_LABEL_SIZE,
        fontFamily: fontFamilyFor(focused ? 700 : 600),
        color,
      }}
    >
      {children}
    </Text>
  );
}
