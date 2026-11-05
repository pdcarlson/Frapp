import {
  type DimensionValue,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useFrappTheme } from "@/lib/theme";

/** Row title widths, cycled, so the placeholder list doesn't read as a grid. */
const ROW_TITLE_WIDTHS = ["55%", "40%", "48%", "62%"] as const;

/**
 * Loading for a screen that is one action card over a captioned list: s10
 * Study hours (start card, THIS WEEK line, RECENT SESSIONS) and s11 Dues
 * (balance card, HISTORY).
 *
 * `SkeletonLines` (`components/state-block.tsx`) is one card of bars, which
 * fits a screen that is one card. Here it stood in for a card *and* a list, so
 * on every cold open the card grew a button, a list pushed in under it, and
 * everything below jumped (components.md §10: "the skeleton mirrors the layout
 * it becomes — same blocks, same radii"). This draws those blocks on the real
 * geometry instead: the card's radius, padding and button height, the
 * section caption, and rows at the list row's height with its dividers.
 *
 * Static and neutral, like every skeleton here until the shimmer lands (the
 * gradient dependency `state-block.tsx` documents).
 */
export function CardListSkeleton({
  rows = 3,
  summary = false,
}: {
  /** List rows to draw under the section caption. */
  rows?: number;
  /** Draw the one-line summary s10 puts between its card and its list. */
  summary?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    // `accessible` makes the skeleton one node, so VoiceOver reads the role
    // and label; without it iOS skips a View that has no text and the screen
    // sounds blank while it loads.
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={styles.stack}
    >
      <View style={styles.card}>
        <Block width="35%" height={tokens.spacing.md} />
        <Block width="50%" height={tokens.spacing.xl} />
        <Block
          width="100%"
          height={tokens.touch.buttonLarge}
          radius={tokens.radius.control}
          style={styles.cardButton}
        />
      </View>

      {summary ? (
        <View style={styles.summary}>
          <Block width="22%" height={tokens.spacing.md} />
          <Block width="32%" height={tokens.spacing.md} />
        </View>
      ) : null}

      <Block width="28%" height={tokens.spacing.md} />

      <View style={styles.rows}>
        {Array.from({ length: rows }, (_, index) => (
          <View
            key={index}
            style={[styles.row, index === rows - 1 ? null : styles.rowDivided]}
          >
            <View style={styles.rowText}>
              <Block
                width={ROW_TITLE_WIDTHS[index % ROW_TITLE_WIDTHS.length]}
                height={tokens.spacing.md}
              />
              <Block width="34%" height={tokens.spacing.sm} />
            </View>
            <Block width={tokens.spacing["3xl"]} height={tokens.spacing.xl} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** One neutral placeholder block, at a text line's radius unless told otherwise. */
function Block({
  width,
  height,
  radius,
  style,
}: {
  width: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      style={[
        styles.block,
        { width, height },
        radius === undefined ? null : { borderRadius: radius },
        style,
      ]}
    />
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // `ScreenShell`'s own gap between the card, the summary, the caption and
    // the list, so each block sits where its real counterpart lands.
    stack: {
      gap: tokens.spacing.md,
    },
    // The action card's frame (`balance-card.tsx`, `start-card.tsx`).
    card: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    cardButton: {
      marginTop: tokens.spacing.sm,
    },
    summary: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    rows: {
      marginTop: tokens.spacing.xs,
    },
    // The history row's geometry, so a placeholder row is as tall as a real one.
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    rowDivided: {
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    rowText: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    block: {
      // `SkeletonLines`' block, so the two skeletons read as one family:
      // §10's radius 6 has no token, and `chip` (8) is the nearest.
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
  });
}
