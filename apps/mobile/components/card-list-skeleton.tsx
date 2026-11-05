import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { SectionHeaderSkeleton } from "@/components/list-section";
import { HistoryRowsSkeleton } from "@/components/history-row";
import { SkeletonRegion, SkeletonText } from "@/components/state-block";
import { useFrappTheme } from "@/lib/theme";

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
 * geometry instead: the screen's own card skeleton (each card draws its own,
 * beside the card), the section caption, and the history rows themselves
 * (`HistoryRowsSkeleton`).
 *
 * Every shape is a `SkeletonBlock`, inside one `SkeletonRegion`, so its blocks
 * pulse together with every other skeleton's and the shimmer (the gradient
 * dependency `state-block.tsx` documents) lands once in `SkeletonBlock`.
 */
export function CardListSkeleton({
  card,
  rows = 3,
  summary = false,
}: {
  /** The action card's own skeleton (`StartCardSkeleton`, `BalanceCardSkeleton`). */
  card: ReactNode;
  /** List rows to draw under the section caption. */
  rows?: number;
  /** Draw the one-line summary s10 puts between its card and its list. */
  summary?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading" style={styles.stack}>
      {card}

      {summary ? (
        <View style={styles.summary}>
          <SkeletonText role={caption} width="22%" />
          <SkeletonText role={caption} width="32%" />
        </View>
      ) : null}

      <SectionHeaderSkeleton width="28%" />

      <View style={styles.rows}>
        <HistoryRowsSkeleton
          rows={rows}
          trailingWidth={tokens.spacing["3xl"]}
        />
      </View>
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // `ScreenShell`'s own gap between the card, the summary, the caption and
    // the list, so each block sits where its real counterpart lands.
    stack: {
      gap: tokens.spacing.md,
    },
    summary: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    rows: {
      marginTop: tokens.spacing.xs,
    },
  });
}
