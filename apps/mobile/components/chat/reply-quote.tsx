import { Pressable, StyleSheet, Text, View } from "react-native";
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
 * treatment). Author and preview, or the unavailable line when the parent is
 * outside the loaded window. It sits above the row's author line, after the
 * elbow `MessageRowFrame` draws (`components.md` §11 § What rides the row), so
 * it draws no rule of its own.
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
 *
 * Tapping the quote scrolls to the parent (#2775) when the caller passes
 * `onPress`, which it does only for a parent that is loaded and shown. The
 * quote is not announced as a button. It sits above the row's author line, a
 * focusable element of its own, and the row's body (or a poll card's own
 * container) carries the same jump as a named action, "Go to the original
 * message".
 */
export function ReplyQuote({
  message,
  replyParent,
  hiddenText,
  nameFor,
  viewerId,
  onPress,
  onLongPress,
}: {
  message: ChatMessage;
  replyParent: ChatMessage | null | undefined;
  /** Drawn instead of the parent when the block list hides it. */
  hiddenText?: string;
  nameFor: (userId: string) => string | null;
  /** Resolved, like every row surface's (#2250): a null viewer mislabels the member's own quote. */
  viewerId: string;
  /** Scrolls to the parent; omitted when there is nothing to scroll to. */
  onPress?: () => void;
  /** The row's long-press, since a pressable quote claims the touch. */
  onLongPress?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  if (!message.reply_to_id || message.is_deleted) return null;

  const placeholder = hiddenText ?? (replyParent ? null : UNAVAILABLE_QUOTE);

  return (
    <Pressable
      accessibilityRole="text"
      disabled={!onPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      {placeholder !== null || !replyParent ? (
        <Text
          style={[styles.preview, styles.unavailable]}
          numberOfLines={1}
        >
          {placeholder ?? UNAVAILABLE_QUOTE}
        </Text>
      ) : (
        <View style={styles.row}>
          <Text style={styles.author} numberOfLines={1}>
            {resolveAuthorLabel(replyParent, nameFor, viewerId)}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>
            {replyPreviewText(replyParent)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
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
      color: tokens.color.text.foreground,
      flexShrink: 0,
    },
    preview: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flexShrink: 1,
    },
    unavailable: {
      fontStyle: "italic",
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
