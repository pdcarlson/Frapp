import { StyleSheet } from "react-native";
import type { SignetTokens } from "@repo/theme/signet";

/** The unread dot's diameter: `spacing.sm`, web's `size-2`. */
export function unreadDotSize(tokens: SignetTokens): number {
  return tokens.spacing.sm;
}

/**
 * The phone's unread mark, shared so the notification list's rows and
 * Activity's rows (#4405) draw the same dot. Neutral, as the web drawer's
 * and chat's unread are: the accent is never a state (`components.md` § A
 * list inside a drawer or popover is flat; foundations.md §5). `spacer` holds
 * the dot's slot on a read row, so rows don't shift as dots clear. A screen
 * places the dot on its own row (a top margin, say) with a style beside it.
 */
export function createUnreadDotStyles(tokens: SignetTokens) {
  const size = unreadDotSize(tokens);
  return StyleSheet.create({
    dot: {
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: size / 2,
      backgroundColor: tokens.color.text.foreground,
    },
    spacer: {
      width: size,
      flexShrink: 0,
    },
  });
}
