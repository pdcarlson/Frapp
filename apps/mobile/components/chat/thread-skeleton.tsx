import { StyleSheet, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
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
 * Static, like `SkeletonLines` in `components/state-block.tsx`, and for the
 * same reason: the §10 shimmer needs a gradient primitive this app does not
 * have. Neutral only, never the accent.
 *
 * TODO-DESIGN: shimmer sweep per components.md §10, as `SkeletonLines` carries
 * it, once a gradient dependency lands. Nearest pattern used: static neutral
 * blocks at the row's shapes. A second hand-drawn skeleton until this folds
 * onto the shared skeleton block, so whoever lands the shimmer finds it here.
 */
export function ThreadSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading messages"
      style={styles.container}
    >
      {Array.from({ length: ROWS }, (_, index) => (
        <View key={index} style={styles.row}>
          <View style={styles.avatar} />
          <View style={styles.column}>
            <View style={styles.author} />
            <View
              style={[
                styles.line,
                { width: BODY_WIDTHS[index % BODY_WIDTHS.length] },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
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
    avatar: {
      width: MESSAGE_AVATAR_SIZE,
      height: MESSAGE_AVATAR_SIZE,
      borderRadius: avatarRadius(MESSAGE_AVATAR_SIZE),
      backgroundColor: tokens.color.surface.popover,
    },
    column: {
      flex: 1,
      gap: tokens.spacing.sm,
      paddingTop: tokens.spacing.xs,
    },
    author: {
      width: "28%",
      height: tokens.spacing.md,
      // TODO-DESIGN: §10 specifies radius 6 for skeleton text lines. `chip` (8)
      // is the nearest token; a raw 6 would be a hard-coded value, which
      // foundations.md bans. Same gap as `SkeletonLines`.
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
    line: {
      height: tokens.spacing.md,
      // TODO-DESIGN: radius 6, as on `author` above.
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
  });
}
