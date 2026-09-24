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
 * The quote a reply draws when its parent is held off screen because the block
 * list is loading or unavailable. A blocked member's parent quotes as the
 * tombstone's own words instead (`blocked-message-tombstone.tsx`).
 */
export const HELD_QUOTE_TEXT = "Message hidden";

/**
 * Quote chrome for a reply on s05. Re-implements the web rule against
 * mobile tokens — not a port of `QuotedMessage` (Tailwind / web type
 * treatment). A left rule plus author and preview, or the unavailable
 * line when the parent is outside the loaded window.
 *
 * Hidden on a deleted *reply* (the tombstone is not something anyone
 * said). A deleted *parent* still quotes: that tombstone is the honest
 * preview of what the still-real reply answered.
 *
 * A parent the viewer's block list hides — a blocked member's message, or one
 * held while the list is unreadable — quotes as `hiddenText` alone, with no
 * author and no preview (#2312 §1). That is the tombstone rule applied to the
 * quote: a block that hid the message but let a reply print its words would
 * hide nothing. The caller also withholds the parent itself (`replyParent`
 * arrives `null`), so this cannot draw what it was never given.
 */
export function ReplyQuote({
  message,
  replyParent,
  hiddenText,
  nameFor,
  viewerId,
  borderColor,
  textColor,
}: {
  message: ChatMessage;
  replyParent: ChatMessage | null | undefined;
  /** Drawn instead of the parent when the block list hides it. */
  hiddenText?: string;
  nameFor: (userId: string) => string | null;
  /** Resolved, like every row surface's (#2250): a null viewer mislabels the member's own quote. */
  viewerId: string;
  borderColor: string;
  textColor: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  if (!message.reply_to_id || message.is_deleted) return null;

  const placeholder = hiddenText ?? (replyParent ? null : UNAVAILABLE_QUOTE);

  return (
    <View
      accessibilityRole="text"
      style={[styles.rule, { borderLeftColor: borderColor }]}
    >
      {placeholder !== null || !replyParent ? (
        <Text
          style={[styles.preview, styles.unavailable, { color: textColor }]}
          numberOfLines={1}
        >
          {placeholder ?? UNAVAILABLE_QUOTE}
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
