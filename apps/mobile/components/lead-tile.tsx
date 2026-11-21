import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { memberAvatarTint } from "@repo/hooks";
import { SkeletonBlock } from "@/components/state-block";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useRaisedSurfaces } from "@/lib/surfaces";

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
  /**
   * What the row sits on, so the tile is one step above it: `surface1` on the
   * screen background, and the step above the card on a card
   * (`lib/surfaces.ts`).
   */
  on?: "background" | "card";
  /**
   * A fixed hue for a row that is a place (`lib/more/destination-hue.ts`):
   * the fill is the tint an initials avatar and a Notifications tile take
   * (`memberAvatarTint`), so every hued tile sits at one strength, and the
   * caller draws the glyph in the hue itself. Without one the tile is
   * neutral.
   */
  hue?: string;
  testID?: string;
  /** The glyph, at {@link LEAD_TILE_GLYPH}. */
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const surfaces = useRaisedSurfaces();
  const styles = createStyles(tokens);
  const fill = hue ? memberAvatarTint(hue).fill : null;
  return (
    <View
      style={[
        styles.tile,
        size === "lead" ? styles.lead : styles.row,
        on === "card" ? { backgroundColor: surfaces.raised } : null,
        // No edge of its own: the fill is the whole mark, as on an avatar.
        fill ? { backgroundColor: fill, borderColor: fill } : null,
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

/** The `lead` tile's stand-in while its row loads: same side, same corner. */
export function LeadTileSkeleton() {
  const { tokens } = useFrappTheme();
  return (
    <SkeletonBlock
      width={LEAD_TILE_SIZE.lead}
      height={LEAD_TILE_SIZE.lead}
      radius={tokens.radius.chipLarge}
    />
  );
}

/**
 * The frame of a two-line row that leads with the 40pt tile
 * (`spec/ui/mobile/patterns.md` § Rows): the tile sets the height, so the
 * padding is the small step, and the name is in the label role. Activity's
 * rows and the Calendar's event and task rows spread these, so the one event
 * keeps one shape on both tabs (#4679). The caller adds its own bleed and
 * divider.
 */
export function leadRowStyles(tokens: SignetTokens) {
  return {
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.sm,
    },
    text: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  } as const;
}

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
  });
}
