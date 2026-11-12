import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useFrappTheme } from "@/lib/theme";

/**
 * Tiles to a line in every screen's Grid layout (#4175): the Directory's and
 * Documents' alike, so the two screens the List/Grid toggle switches lay out
 * the same way. One place to change it.
 */
const GRID_COLUMNS = 2;

/** Items in lines of {@link GRID_COLUMNS}, the last one possibly short. */
export function toGridChunks<T>(items: readonly T[]): T[][] {
  const lines: T[][] = [];
  for (let i = 0; i < items.length; i += GRID_COLUMNS) {
    lines.push(items.slice(i, i + GRID_COLUMNS));
  }
  return lines;
}

/**
 * One line of tiles. A short last line is padded with empty cells, so its
 * tiles keep the width of every other tile instead of stretching across the
 * row. Each child should take `flex: 1`.
 */
export function GridLine({
  filled,
  children,
}: {
  /** How many tiles the line holds; the rest of {@link GRID_COLUMNS} is padding. */
  filled: number;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.line}>
      {children}
      {Array.from({ length: Math.max(0, GRID_COLUMNS - filled) }, (_, i) => (
        <View key={`pad-${i}`} style={styles.pad} />
      ))}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    line: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    pad: {
      flex: 1,
    },
  });
}
