import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useFocusEffect, useRouter } from "expo-router";
import { onlineManager } from "@tanstack/react-query";
import { useNotifications } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { selectUnreadNonChatCount } from "@/lib/more/notifications";
import { useBackToClose, useFocusOnOpen } from "@/lib/overlay";
import { avatarRadius, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chat home's top-right pair (owner, 2026-11-07, option B of the round-two
 * redesign): a door to Messages, the member's direct messages on their own
 * screen, then the member's own avatar, which opens a small menu holding
 * Profile, Notifications and Settings.
 *
 * Every chat app the members already use puts these two in that corner
 * (Instagram's DM door, the avatar that is "you" in Slack, Discord and
 * GroupMe). The notification bell folded into the avatar: its unread dot
 * moved there, and the menu row carries the count, so the header holds two
 * controls instead of three beside a long chapter name.
 */

const BUTTON = 36;
const MENU_WIDTH = 220;

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
      onPress={() => router.push("/messages")}
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
          style={[styles.count, styles.countMention]}
        >
          <Text style={[styles.countText, styles.countTextMention]}>
            {unreadConversations > 99 ? "99+" : unreadConversations}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export type AccountMenuState = {
  visible: boolean;
  top: number;
  open: (top: number) => void;
  close: () => void;
};

/** The avatar menu's open state, held by the screen whose overlay draws it. */
export function useAccountMenu(): AccountMenuState {
  const [visible, setVisible] = useState(false);
  const [top, setTop] = useState(0);
  const close = useCallback(() => setVisible(false), []);
  const open = useCallback((at: number) => {
    setTop(at);
    setVisible(true);
  }, []);
  useBackToClose(visible, close);
  // A row navigates away, and Chat home stays mounted under the next screen.
  useFocusEffect(useCallback(() => close, [close]));
  return { visible, top, open, close };
}

/**
 * The member's own avatar: their photo, or their initials on a neutral fill
 * (a person's avatar never takes the chapter accent, foundations.md §6). A
 * dot in the inbox's house gold says the notification inbox has something
 * unread, the dot the bell's badge used to be.
 */
export function AccountButton({
  menu,
  initials,
  photoUrl,
  fetchedAt,
}: {
  menu: AccountMenuState;
  initials: string;
  photoUrl: string | null;
  fetchedAt: number;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const ref = useRef<View>(null);
  const inboxUnread = selectUnreadNonChatCount(useNotifications().data);
  // A photo that fails to load falls back to initials, retried on a refetch
  // or reconnect, as the More tab's profile card does.
  const [failed, setFailed] = useState<{ url: string; at: number } | null>(
    null,
  );
  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        if (online) setFailed(null);
      }),
    [],
  );
  const showPhoto =
    !!photoUrl && !(failed?.url === photoUrl && failed.at === fetchedAt);

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel="Your account"
      accessibilityHint="Opens Profile, Notifications and Settings."
      accessibilityValue={
        inboxUnread > 0
          ? { text: `${inboxUnread} unread notifications` }
          : undefined
      }
      accessibilityState={{ expanded: menu.visible }}
      hitSlop={4}
      onPress={() => {
        if (menu.visible) return menu.close();
        const node = ref.current;
        if (!node?.measureInWindow) return menu.open(0);
        node.measureInWindow((_x, y, _width, height) =>
          menu.open(y + height + tokens.spacing.xs),
        );
      }}
      style={({ pressed }) => [styles.avatar, pressed ? styles.dim : null]}
    >
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl }}
          style={styles.photo}
          onError={() => setFailed({ url: photoUrl, at: fetchedAt })}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : (
        <Text style={styles.initials}>{initials}</Text>
      )}
      {inboxUnread > 0 ? (
        <View
          testID="account-inbox-dot"
          pointerEvents="none"
          style={styles.dot}
        />
      ) : null}
    </Pressable>
  );
}

/** The avatar's menu, drawn by `ScreenShell`'s overlay like the filter menu. */
export function AccountMenu({ menu }: { menu: AccountMenuState }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const firstRef = useRef<React.ComponentRef<typeof Text>>(null);
  useFocusOnOpen(firstRef, menu.visible);
  const inboxUnread = selectUnreadNonChatCount(useNotifications().data);

  if (!menu.visible) return null;

  const rows: {
    key: string;
    label: string;
    href: "/profile" | "/notifications" | "/preferences";
    count?: number;
  }[] = [
    { key: "profile", label: "Profile", href: "/profile" },
    {
      key: "notifications",
      label: "Notifications",
      href: "/notifications",
      count: inboxUnread,
    },
    { key: "settings", label: "Settings", href: "/preferences" },
  ];

  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={menu.close}
      style={styles.fill}
    >
      <Pressable
        testID="account-menu-backdrop"
        accessible={false}
        importantForAccessibility="no"
        onPress={menu.close}
        style={styles.fill}
      />
      <View style={[styles.menu, { top: menu.top, right: tokens.spacing.lg }]}>
        {rows.map((row, index) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityValue={
              row.count ? { text: `${row.count} unread` } : undefined
            }
            onPress={() => {
              menu.close();
              router.push(row.href);
            }}
            style={({ pressed }) => [
              styles.row,
              index > 0 ? styles.rowDivided : null,
              pressed ? styles.dim : null,
            ]}
          >
            <Text ref={index === 0 ? firstRef : undefined} style={styles.label}>
              {row.label}
            </Text>
            {row.count ? (
              <View style={[styles.count, styles.countInbox, styles.inline]}>
                <Text style={[styles.countText, styles.countTextInbox]}>
                  {row.count > 99 ? "99+" : row.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
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
    dim: { opacity: 0.7 },
    avatar: {
      width: BUTTON,
      height: BUTTON,
      borderRadius: avatarRadius(BUTTON),
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.color.surface.popover,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    photo: {
      width: BUTTON - 2,
      height: BUTTON - 2,
      borderRadius: avatarRadius(BUTTON - 2),
    },
    initials: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    dot: {
      position: "absolute",
      top: -1,
      right: -1,
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: tokens.color.gold.house,
      borderWidth: 2,
      borderColor: tokens.color.surface.background,
    },
    count: {
      minWidth: 18,
      height: 18,
      paddingHorizontal: tokens.spacing.xs,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    countMention: {
      position: "absolute",
      top: -4,
      right: -6,
      backgroundColor: tokens.color.semantic.mention,
    },
    countInbox: { backgroundColor: tokens.color.gold.house },
    inline: { marginLeft: "auto" },
    countText: {
      ...typeRole({ size: 11, weight: tokens.typography.weight.bold }),
      lineHeight: 14,
    },
    countTextMention: { color: tokens.color.semantic.mentionForeground },
    countTextInbox: { color: tokens.color.gold.onHouse },
    fill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    menu: {
      position: "absolute",
      width: MENU_WIDTH,
      paddingHorizontal: tokens.spacing.md,
      backgroundColor: tokens.color.surface.popover,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.control,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    rowDivided: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    label: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}
