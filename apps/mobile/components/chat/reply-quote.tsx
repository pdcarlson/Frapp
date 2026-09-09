import { StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  replyPreviewText,
  UNAVAILABLE_QUOTE,
} from "@repo/chat-core/reply-preview";
import { SignetTokens } from "@repo/theme/signet";
import { resolveAuthorLabel } from "@repo/hooks";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Quote chrome for a reply on s05. Re-implements the web rule against
 * mobile tokens — not a port of `QuotedMessage` (Tailwind / web type
 * treatment). A left rule plus author and preview, or the unavailable
 * line when the parent is outside the loaded window.
 *
 * Hidden on a deleted *reply* (the tombstone is not something anyone
 * said). A deleted *parent* still quotes: that tombstone is the honest
 * preview of what the still-real reply answered.
 */
export function ReplyQuote({
  message,
  replyParent,
  nameFor,
  viewerId,
  borderColor,
  textColor,
}: {
  message: ChatMessage;
  replyParent: ChatMessage | null | undefined;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  borderColor: string;
  textColor: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  if (!message.reply_to_id || message.is_deleted) return null;

  const unavailable = !replyParent;

  return (
    <View
      accessibilityRole="text"
      style={[styles.rule, { borderLeftColor: borderColor }]}
    >
      {unavailable ? (
        <Text
          style={[styles.preview, styles.unavailable, { color: textColor }]}
          numberOfLines={1}
        >
          {UNAVAILABLE_QUOTE}
        </Text>
      ) : (
        <View style={styles.row}>
          <Text
            style={[styles.author, { color: textColor }]}
            numberOfLines={1}
          >
            {resolveAuthorLabel(replyParent, nameFor, viewerId)}
          </Text>
          <Text
            style={[styles.preview, { color: textColor }]}
            numberOfLines={1}
          >
            {replyPreviewText(replyParent)}
          </Text>
        </View>
      )}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    rule: {
      borderLeftWidth: 2,
      paddingLeft: tokens.spacing.sm,
      marginBottom: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.sm,
      minWidth: 0,
    },
    author: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      flexShrink: 0,
    },
    preview: {
      ...typeRole(tokens.typography.role.caption),
      flexShrink: 1,
    },
    unavailable: {
      fontStyle: "italic",
    },
  });
}
