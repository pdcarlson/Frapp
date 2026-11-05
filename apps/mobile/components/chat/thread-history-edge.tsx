import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { type ChapterBranding, useChapterBranding } from "@/lib/chapter-branding";

export const OLDER_LOADING_COPY = "Loading earlier messages…";
export const OLDER_FAILED_COPY = "Couldn't load earlier messages.";
export const OLDER_IDLE_COPY = "Load earlier messages";
export const HISTORY_START_COPY = "This is the start of the conversation.";

/**
 * The row above the oldest loaded message in the s05 thread (#2772): the
 * older-history read in flight, its failure with a Retry, or the start of the
 * channel's history once a read has come back short.
 *
 * Scrolling to the top loads the next page by itself (the list's
 * `onEndReached`; the list is inverted, so its end is the top). The idle state
 * still offers the load as a control, because `onEndReached` fires only when
 * the list's content grows: a page whose every row the block list holds adds
 * nothing to draw, and without the control the member would be stuck under
 * it. It is also the path for a screen reader, which does not scroll to
 * trigger anything.
 *
 * A failed read is not retried by scrolling, only by Retry, so a dead link
 * does not turn every scroll into another request.
 */
export function ThreadHistoryEdge({
  hasOlder,
  isLoadingOlder,
  olderError,
  onLoadOlder,
  start,
}: {
  hasOlder: boolean;
  isLoadingOlder: boolean;
  olderError: boolean;
  onLoadOlder: () => void;
  /**
   * The channel's start (`channel-start.tsx`), drawn in place of the bare
   * start-of-history caption once nothing earlier is left to load.
   */
  start?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);

  if (isLoadingOlder) {
    return (
      <View style={styles.edge} accessibilityRole="progressbar">
        <ActivityIndicator color={tokens.color.text.muted} />
        <Text style={styles.caption}>{OLDER_LOADING_COPY}</Text>
      </View>
    );
  }
  if (olderError) {
    return (
      <View style={styles.edge} accessibilityLiveRegion="polite">
        <Text style={styles.caption}>{OLDER_FAILED_COPY}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading earlier messages"
          hitSlop={12}
          onPress={onLoadOlder}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Text style={styles.action}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (hasOlder) {
    return (
      <View style={styles.edge}>
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={onLoadOlder}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Text style={styles.action}>{OLDER_IDLE_COPY}</Text>
        </Pressable>
      </View>
    );
  }
  if (start) return <>{start}</>;
  return (
    <View style={styles.edge}>
      <Text style={styles.caption}>{HISTORY_START_COPY}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    edge: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.sm,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    action: {
      ...typeRole(tokens.typography.role.label),
      color: brand.accent,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
