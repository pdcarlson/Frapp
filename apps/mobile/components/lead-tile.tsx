import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, useFrappTheme } from "@/lib/theme";

/**
 * The tile a row's leading glyph sits in (`spec/ui/mobile/patterns.md`
 * § Rows): a small rounded square one surface step above what the row is on,
 * with a hairline edge.
 *
 * It started as the Activity rows' lead (#4402). Since #4610 step 3 the You
 * tab's rows and Chat home's Up next draw it too, so a row that opens a place
 * leads the same way on every tab. A bare 20pt outline on a charcoal card was
 * the thinnest thing on the screen: the team's 2026-11-12 read was that the
 * phone "feels flat". iOS Settings, Telegram and Slack's You tab each seat a
 * row's icon in a tile for the same reason.
 *
 * Two sizes. `row` (32) is a one-line row's, so the row keeps its height;
 * `lead` (40) is a two-line row's, as Activity and Up next draw.
 *
 * Decoration only: the row's label names it, so the tile is hidden from
 * screen readers.
 */
export function LeadTile({
  size = "row",
  on = "background",
  hue,
  testID,
  children,
}: {
  size?: LeadTileSize;
  /** What the row sits on, so the tile is one step above it. */
  on?: "background" | "card";
  /**
   * A fixed hue for a row that is a place (`lib/you/destination-hue.ts`):
   * the fill takes it at 16%, as iconography.md §1's emphasis fill does.
   * Without one the tile is neutral.
   */
  hue?: string;
  testID?: string;
  /** The glyph, at {@link LEAD_TILE_GLYPH}. */
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      style={[
        styles.tile,
        size === "lead" ? styles.lead : styles.row,
        on === "card" ? styles.onCard : null,
        hue
          ? { backgroundColor: tint(hue, 0.16), borderColor: tint(hue, 0.22) }
          : null,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {children}
    </View>
  );
}

export type LeadTileSize = "row" | "lead";

/** The tile's side per size. */
export const LEAD_TILE_SIZE = { row: 32, lead: 40 } as const;

/** iconography.md §2's size for a list row's leading icon, in either tile. */
export const LEAD_TILE_GLYPH = 20;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    tile: {
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    // Pulled 4pt into the row's own padding above and below, so a one-line
    // row with a tile is 48pt, not 56: the padding is sized for a line of
    // text, and the tile is taller than one.
    row: {
      width: LEAD_TILE_SIZE.row,
      height: LEAD_TILE_SIZE.row,
      marginVertical: -tokens.spacing.xs,
      borderRadius: tokens.radius.chip,
    },
    lead: {
      width: LEAD_TILE_SIZE.lead,
      height: LEAD_TILE_SIZE.lead,
      borderRadius: tokens.radius.chipLarge,
    },
    onCard: {
      backgroundColor: tokens.color.surface.popover,
    },
  });
}
