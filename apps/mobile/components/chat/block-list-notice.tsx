import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BlockListStatus } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { blockListNotice } from "@/lib/chat/blocks";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The s05 thread's report on a block list it could not confirm
 * (`spec/behavior/chat/README.md` § The masking contract: "When the list is
 * unavailable the member is told so"). Rows that arrived by a path the server
 * could not mask are being held off screen meanwhile, and this is the only
 * place that says so — a silent gap would read as lost messages.
 *
 * Renders nothing when there is nothing to say (`blockListNotice`).
 */
export function BlockListNotice({
  status,
  heldCount,
  onRetry,
  isRetrying,
}: {
  status: BlockListStatus;
  heldCount: number;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const notice = blockListNotice(status, heldCount);
  if (!notice) return null;

  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <View style={styles.text}>
        <Text style={styles.title}>{notice.title}</Text>
        <Text style={styles.body}>{notice.body}</Text>
      </View>
      {notice.canRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading your block list"
          accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
          disabled={isRetrying}
          hitSlop={12}
          onPress={onRetry}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          {isRetrying ? (
            <ActivityIndicator color={tokens.color.text.muted} />
          ) : (
            <Text style={styles.retry}>Retry</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    notice: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      backgroundColor: tint(tokens.color.semantic.warning),
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    text: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    retry: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.askText,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
