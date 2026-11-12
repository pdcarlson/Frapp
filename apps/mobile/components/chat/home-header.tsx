import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useRouter } from "expo-router";
import { useNotifications } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import { selectUnreadNonChatCount } from "@/lib/more/notifications";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { useGuardedBySwipe } from "@/lib/swipe-claim";

/**
 * Chat home's top-right pair: a door to Messages, the member's direct
 * messages on their own screen (owner, 2026-11-07), then the notification
 * bell (#3839).
 *
 * Until #3839 the second control was the member's own avatar, which opened a
 * menu of Status, Profile, Notifications and Settings. The avatar is the You
 * tab now, as Instagram, Slack and Discord draw their last tab, and those
 * rows live on that tab. The bell came back here because the inbox count is
 * Chat home's to show: Instagram keeps its heart and Slack its Activity
 * beside the conversations, not behind the profile.
 */

const BUTTON = 36;

/** A speech bubble, the Messages door's glyph, on the 24pt grid. */
function MessagesGlyph({ color }: { color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M4.5 5.5h15v10.5h-8.5l-4.5 3.5v-3.5h-2z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/**
 * The door to Messages. Its badge counts conversations with anything unread,
 * in mention red: a direct message addresses the member (foundations.md §5).
 */
export function MessagesButton({
  unreadConversations,
}: {
  unreadConversations: number;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  // A leftward flick that starts on the door is also the swipe to Messages:
  // the door drops that press, so Messages opens once (`lib/swipe-claim.ts`).
  const openMessages = useGuardedBySwipe(() => router.push("/messages"));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Messages"
      accessibilityValue={
        unreadConversations > 0
          ? {
              text: `${unreadConversations} unread ${
                unreadConversations === 1 ? "conversation" : "conversations"
              }`,
            }
          : undefined
      }
      hitSlop={4}
      android_ripple={{
        color: tint(tokens.color.text.foreground, 0.12),
        borderless: true,
        radius: 22,
      }}
      onPress={openMessages}
      style={({ pressed }) => [
        styles.glass,
        pressed && Platform.OS !== "android" ? styles.pressed : null,
      ]}
    >
      <MessagesGlyph color={tokens.color.text.foreground} />
      {unreadConversations > 0 ? (
        <View
          testID="messages-badge"
          pointerEvents="none"
          style={[styles.count, styles.countBadge, styles.countMention]}
        >
          <Text style={[styles.countText, styles.countTextMention]}>
            {unreadConversations > 99 ? "99+" : unreadConversations}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The notification inbox's door: a bell beside Messages, with the unread
 * count as a badge (#3362, back on the header in #3839). The avatar that held
 * it moved to the tab bar as the You tab, and a count that lived only as a dot
 * on that avatar was a count nobody could read, so the bell is its own
 * control again, as the web top bar's is.
 *
 * ## The badge is house gold
 *
 * Fixed `gold.house`, never the chapter accent, as the web bell's badge is
 * (`spec/ui/design-system/components.md` § App bar chips). A count is not
 * direct address, and on this screen it sits beside the Messages door's
 * mention-red badge: a chapter whose accent is red would otherwise draw an
 * inbox count that reads as "someone addressed you".
 *
 * ## It counts what the channel list doesn't
 *
 * The chat push worker writes an inbox row for every chat push it sends, and
 * the channel rows already badge those messages from read receipts. Reading
 * the thread clears the channel badge but not the inbox row, so the bell
 * counts the rest, `selectUnreadNonChatCount`, the same split the app-icon
 * badge makes (`lib/notifications/use-badge-sync.ts`).
 */
export function NotificationsButton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const unread = selectUnreadNonChatCount(useNotifications().data);
  // A leftward flick that starts on the bell is the swipe to Messages, not a
  // tap on the bell (`lib/swipe-claim.ts`).
  const openInbox = useGuardedBySwipe(() => router.push("/notifications"));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Notifications"
      accessibilityHint="Opens your notification history."
      accessibilityValue={
        unread > 0 ? { text: `${unread} unread` } : undefined
      }
      hitSlop={4}
      android_ripple={{
        color: tint(tokens.color.text.foreground, 0.12),
        borderless: true,
        radius: 22,
      }}
      onPress={openInbox}
      style={({ pressed }) => [
        styles.glass,
        pressed && Platform.OS !== "android" ? styles.pressed : null,
      ]}
    >
      <NotificationsGlyph color={tokens.color.text.foreground} neutral />
      {unread > 0 ? (
        <View
          testID="notifications-badge"
          pointerEvents="none"
          style={[styles.count, styles.countBadge, styles.countInbox]}
        >
          <Text style={[styles.countText, styles.countTextInbox]}>
            {unread > 99 ? "99+" : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // The glass round of the tab bar's "+" (2026-11-06 glass direction), at
    // the header's control size.
    glass: {
      width: BUTTON,
      height: BUTTON,
      borderRadius: BUTTON / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.color.surface.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    pressed: { backgroundColor: tokens.color.surface.popover },
    count: {
      minWidth: 18,
      height: 18,
      paddingHorizontal: tokens.spacing.xs,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    countBadge: { position: "absolute", top: -4, right: -6 },
    countMention: { backgroundColor: tokens.color.semantic.mention },
    countInbox: { backgroundColor: tokens.color.gold.house },
    countText: {
      ...typeRole({ size: 11, weight: tokens.typography.weight.bold }),
      lineHeight: 14,
    },
    countTextMention: { color: tokens.color.semantic.mentionForeground },
    countTextInbox: { color: tokens.color.gold.onHouse },
  });
}
