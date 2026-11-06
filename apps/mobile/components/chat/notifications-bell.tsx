import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useNotifications } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import { selectUnreadNonChatCount } from "@/lib/more/notifications";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The notification inbox's entry point: a bell on Chat home's title row, with
 * the unread count as a badge (#3362).
 *
 * Chat is the home tab, so the count is the first thing a member sees, which
 * is where the web puts it too (`apps/web/components/layout/top-bar.tsx`). It
 * replaced the Notifications row in More (owner decision 2026-11-04,
 * `spec/ui/mobile/navigation.md` § Global entries outside the tab bar).
 *
 * ## The badge is house gold
 *
 * Fixed `gold.house`, never the chapter accent, as the web bell's badge is
 * (`spec/ui/design-system/components.md` § App bar chips). A count is not
 * direct address, and on this screen it sits beside the channel rows'
 * mention-red badges: a chapter whose accent is red would otherwise draw an
 * inbox count that reads as "someone addressed you".
 *
 * ## It counts what the channel list doesn't
 *
 * The chat push worker writes an inbox row for every chat push it sends (DMs,
 * mentions, announcements), and the channel rows below already badge those
 * messages from read receipts. Reading the thread clears the channel badge
 * but not the inbox row, so counting chat rows here would leave the bell
 * showing a message the member has already read, one row above the badge
 * that cleared. The bell counts the rest, `selectUnreadNonChatCount`, the
 * same split the app-icon badge makes (`lib/notifications/use-badge-sync.ts`).
 *
 * The bell is the inbox's glyph and nothing else's: a channel's alert level
 * sits behind the thread header's `⋯` (`notification-level-control.tsx`), so
 * the two controls never share a silhouette.
 */
export function NotificationsBell() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const notificationsQuery = useNotifications();
  const unreadCount = selectUnreadNonChatCount(notificationsQuery.data);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Notifications"
      accessibilityHint="Opens your notification history."
      accessibilityValue={
        unreadCount > 0 ? { text: `${unreadCount} unread` } : undefined
      }
      // 36pt drawn against a 44pt minimum, as the Ask pill beside it does.
      hitSlop={4}
      android_ripple={{
        color: styles.ripple.color,
        borderless: true,
        radius: 22,
      }}
      onPress={() => router.push("/notifications")}
      style={({ pressed }) => [
        styles.button,
        pressed && Platform.OS !== "android" ? styles.pressed : null,
      ]}
    >
      <NotificationsGlyph color={tokens.color.text.foreground} neutral />
      {unreadCount > 0 ? (
        <View
          testID="notifications-badge"
          style={styles.badge}
          pointerEvents="none"
        >
          <Text style={styles.badgeText}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    button: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      backgroundColor: tokens.color.surface.card,
    },
    ripple: {
      color: tint(tokens.color.text.foreground, 0.12),
    },
    badge: {
      position: "absolute",
      top: -2,
      right: -4,
      minWidth: 18,
      height: 18,
      paddingHorizontal: tokens.spacing.xs,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.color.gold.house,
    },
    badgeText: {
      // The web bell's badge type (`top-bar.tsx`): small and bold, so a
      // two-digit count fits the 18pt pill.
      ...typeRole({ size: 11, weight: tokens.typography.weight.bold }),
      lineHeight: 14,
      color: tokens.color.gold.onHouse,
    },
  });
}
