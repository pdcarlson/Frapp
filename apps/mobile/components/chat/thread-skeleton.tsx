import { StyleSheet, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { SkeletonBlock, SkeletonRegion } from "@/components/state-block";
import { avatarRadius, useFrappTheme } from "@/lib/theme";
import { MESSAGE_AVATAR_SIZE } from "./message-item";

/** How many message shapes to draw: enough to fill the lower half of a phone. */
const ROWS = 4;
/** Body widths, cycling through the ~45–70% range §10 gives text lines. */
const BODY_WIDTHS = ["70%", "52%", "60%", "45%"] as const;

/**
 * The s05 thread while its messages, or the viewer's identity, load.
 *
 * Message-shaped, per components.md §10 ("the skeleton mirrors the layout it
 * becomes"): each row is the compact layout's first row of a run (§11), a 32pt
 * avatar beside a short author bar and a body bar, at the row's own 16pt
 * insets. The rows sit at the bottom, above the composer, because that is
 * where an inverted thread draws its newest messages, so the real rows land
 * where the shapes were rather than dropping in from the top.
 *
 * Its shapes are `SkeletonBlock`s in one `SkeletonRegion`
 * (`components/state-block.tsx`), so they pulse with every other skeleton's
 * and the §10 shimmer lands here when it lands in `SkeletonBlock`. Neutral
 * only, never the accent.
 */
export function ThreadSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <SkeletonRegion label="Loading messages" style={styles.container}>
      {Array.from({ length: ROWS }, (_, index) => (
        <View key={index} style={styles.row}>
          <SkeletonBlock
            width={MESSAGE_AVATAR_SIZE}
            height={MESSAGE_AVATAR_SIZE}
            radius={avatarRadius(MESSAGE_AVATAR_SIZE)}
          />
          <View style={styles.column}>
            <SkeletonBlock width="28%" height={tokens.spacing.md} />
            <SkeletonBlock
              width={BODY_WIDTHS[index % BODY_WIDTHS.length]!}
              height={tokens.spacing.md}
            />
          </View>
        </View>
      ))}
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "flex-end",
      paddingBottom: tokens.spacing.sm,
    },
    // The message row's insets and gap (`message-item.tsx`).
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.lg,
    },
    column: {
      flex: 1,
      gap: tokens.spacing.sm,
      paddingTop: tokens.spacing.xs,
    },
  });
}
