import { Text, type ColorValue } from "react-native";
import Svg from "react-native-svg";
import { NAV_GLYPHS, type NavGlyphName } from "@repo/theme/nav-glyphs";
import { NavGlyph } from "@/components/nav-glyph";
import { fontFamilyFor, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Tab bar glyphs, and the stroke recipe the chat card eyebrows still use.
 *
 * Three of the four tabs draw the shared nav set in `@repo/theme/nav-glyphs` through
 * `components/nav-glyph.tsx` (the fourth, You, is the member's own avatar,
 * `components/you-tab-avatar.tsx`): a silhouette at 20% of the glyph's hue (30% when
 * focused) under a full-strength outline, per
 * `spec/ui/design-system/iconography.md` §1. The web sidebar draws the same
 * set, so a tab and its web row share one silhouette. It replaced the
 * hand-drawn 1.6px-stroke set transcribed from `canvas-screens.dc.html`, whose
 * 6% white fill disappeared on charcoal.
 *
 * Colors are token reads: the neutral stroke is `text.muted` and the focused
 * one is the chapter accent, which is house gold (`gold.house`, `#EFB63B`)
 * only for a chapter with no served palette.
 *
 * §1 rule 1 is why `focused` is a *color* input and never a shape input: a
 * state change recolors the glyph and does not swap to a solid variant.
 *
 * `glyphPaint`, `GlyphFrame` and `STROKE_WIDTH` are the older stroke recipe,
 * kept for the chat card eyebrow glyphs that have no tab of their own
 * (`components/chat/card-glyphs.tsx`).
 *
 * Sizing is 24px per iconography.md §2.
 */

const TAB_GLYPH_SIZE = 24;

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
   * Drawn size in points; the glyph's grid scales with it. The tab bar uses
   * the default {@link TAB_GLYPH_SIZE}. A chat card's eyebrow draws the same
   * glyph at 16, as web's card eyebrow does, so the card and the tab it
   * belongs to share one silhouette. Chat home's UP NEXT rows draw it at 20,
   * the list-row icon size (spec/ui/design-system/iconography.md § 6.1).
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

/**
 * Any glyph of the shared nav set (`@repo/theme/nav-glyphs`) in the tab bar's
 * props: the four tabs below, and the chat card eyebrows that are nav-set
 * shapes (`components/chat/card-glyphs.tsx`). `focused` picks the hue and
 * lifts the silhouette; it never swaps the shape.
 */
export function TabGlyph({
  name,
  focused,
  accent,
  muted,
  size = TAB_GLYPH_SIZE,
}: TabGlyphProps & { name: NavGlyphName }) {
  return (
    <NavGlyph
      paths={NAV_GLYPHS[name]}
      color={focused ? accent : muted}
      active={focused}
      size={size}
    />
  );
}

/** Chat: the speech bubble with dots. */
export function ChatGlyph(props: TabGlyphProps) {
  return <TabGlyph name="chat" {...props} />;
}

/** Activity: the nav set's tray, the old More row's and web's Activity glyph. */
export function ActivityTabGlyph(props: TabGlyphProps) {
  return <TabGlyph name="activity" {...props} />;
}

/** Calendar (the `events` route): the calendar with day dots. */
export function EventsGlyph(props: TabGlyphProps) {
  return <TabGlyph name="events" {...props} />;
}

/** Tasks: the seal with a check. Off the tab bar since #4610; chat's task card and Up next still draw it. */
export function TasksGlyph(props: TabGlyphProps) {
  return <TabGlyph name="tasks" {...props} />;
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
