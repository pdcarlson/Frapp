import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useNotifications } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { CountBadge } from "@/components/more/count-badge";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import { selectUnreadIds } from "@/lib/more/notifications";
import { tint, useFrappTheme } from "@/lib/theme";

/**
 * The notification inbox's entry point: a bell on Chat home's title row, with
 * the unread count as a badge (#3362).
 *
 * Chat is the home tab, so the count is the first thing a member sees, which
 * is where the web puts it too (`apps/web/components/layout/top-bar.tsx`). It
 * replaced the Notifications row in More (owner decision 2026-11-04,
 * `spec/ui/mobile/navigation.md` § Global entries outside the tab bar).
 *
 * The bell is the inbox's glyph and nothing else's: a channel's alert level
 * draws a speaker (`components/chat/mute-glyph.tsx`), so the two controls
 * never share a silhouette.
 */
export function NotificationsBell() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const notificationsQuery = useNotifications();
  const unreadCount = selectUnreadIds(notificationsQuery.data).length;

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
        <View style={styles.badge} pointerEvents="none">
          <CountBadge count={unreadCount} />
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
      top: -4,
      right: -6,
    },
  });
}
