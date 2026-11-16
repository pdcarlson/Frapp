import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  unreadThreadCount,
  useMemberThreads,
  useNotifications,
} from "@repo/hooks";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { HeaderButton } from "@/components/header-button";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import { SearchGlyph, ThreadsGlyph } from "@/components/control-glyphs";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { InboxCountBadge } from "@/components/chat/channel-row";
import { NavGlyph } from "@/components/nav-glyph";
import { useTourAnchor } from "@/components/onboarding/tour";
import { selectUnreadNonChatCount } from "@/lib/more/notifications";
import type { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chat home's top-right rounds: Search (#5139), a door to Messages, the member's direct
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

/** The glyph inside a header round (`components/header-button.tsx`). */
const GLYPH = 20;

/**
 * The door to Messages. Its badge counts conversations with anything unread,
 * in mention red: a direct message addresses the member (foundations.md §5).
 *
 * The glyph is the shared nav set's `direct`, the paper plane web's sidebar
 * draws beside Direct messages and Instagram draws on this same door (#4610).
 * Until then it was a speech bubble, which the Chat tab under it also is, so
 * two different places wore one picture. A plane pointing off to the right
 * also says which way the screen comes from on the swipe (#3774).
 */
export function MessagesButton({
  unreadConversations,
}: {
  unreadConversations: number;
}) {
  const { tokens } = useFrappTheme();
  const router = useRouter();
  // The first-run tour's second stop points here. A real view of its own, so
  // the tour can measure it.
  const tourAnchor = useTourAnchor("messages");
  return (
    <View ref={tourAnchor} collapsable={false}>
      <HeaderButton
        label="Messages"
        value={
          unreadConversations > 0
            ? `${unreadConversations} unread ${
                unreadConversations === 1 ? "conversation" : "conversations"
              }`
            : undefined
        }
        // A leftward flick that starts on the door is also the swipe to
        // Messages: the round drops that press, so Messages opens once
        // (`lib/swipe-claim.ts`).
        onPress={() => router.push("/messages")}
        badge={{
          count: unreadConversations,
          tone: "mention",
          testID: "messages-badge",
        }}
      >
        <NavGlyph
          paths={NAV_GLYPHS.direct}
          color={tokens.color.text.foreground}
          size={GLYPH}
        />
      </HeaderButton>
    </View>
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
  const router = useRouter();
  const unread = selectUnreadNonChatCount(useNotifications().data);
  return (
    <HeaderButton
      label="Notifications"
      hint="Opens your notification history."
      value={unread > 0 ? `${unread} unread` : undefined}
      onPress={() => router.push("/notifications")}
      badge={{ count: unread, tone: "inbox", testID: "notifications-badge" }}
    >
      <NotificationsGlyph color={tokens.color.text.foreground} neutral />
    </HeaderButton>
  );
}

/**
 * Search (#5139): the phone's search, every member's, on Chat home's title
 * row where Slack keeps it at the top of Home and Discord in the server
 * header. It pushes the Search screen (`components/search/search-screen.tsx`).
 *
 * > Changed in #5139 by pdcarlson, 2026-11-16: this round was Threads
 * > (#4960, Shawn, 2026-11-14). Threads is now the first row of the channel
 * > list ({@link ThreadsRow}), as Slack's Home lists it, so the title row
 * > keeps three rounds beside a long chapter name.
 */
export function SearchButton() {
  const { tokens } = useFrappTheme();
  const router = useRouter();
  return (
    <HeaderButton
      label="Search"
      hint="Searches channels, members, messages and events."
      onPress={() => router.push("/search")}
    >
      <SearchGlyph color={tokens.color.text.foreground} size={GLYPH} />
    </HeaderButton>
  );
}

/**
 * All threads (#4960): the member's threads across channels, in a sheet over
 * Chat home (`AllThreadsSheet`). The first row of Chat home since #5139, as
 * Slack's Home lists Threads above its channels; it was a round in the title
 * row before. It is always drawn, in every state of the channel list, like
 * the round was: hiding it until the threads read answers would push the
 * list down under a thumb, and a failed read would hide the sheet's own
 * retry. While any thread has new replies it reads as an unread channel row
 * does (a bolder title and the leading pip) and badges that count in house
 * gold, on the channel badge's geometry (`InboxCountBadge`): not direct
 * address.
 */
export function ThreadsRow({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const unread = unreadThreadCount(useMemberThreads().data);
  return (
    <PressableRow
      testID="threads-row"
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? `Threads, ${unread} with new replies` : "Threads"
      }
      accessibilityHint="Opens the threads you're part of."
      onPress={onPress}
      style={styles.row}
    >
      {unread > 0 ? <View style={styles.pip} /> : null}
      <ThreadsGlyph
        color={
          unread > 0 ? tokens.color.text.foreground : tokens.color.text.muted
        }
        size={tokens.typography.role.title.size}
      />
      <Text
        numberOfLines={1}
        style={[styles.title, unread > 0 ? styles.titleUnread : null]}
      >
        Threads
      </Text>
      {unread > 0 ? (
        <InboxCountBadge count={unread} testID="threads-badge" />
      ) : null}
    </PressableRow>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // A channel row's one-line geometry and its unread pip and title
    // weights (`channel-row.tsx`).
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      ...gutterBleed(tokens),
    },
    pip: {
      position: "absolute",
      left: 0,
      top: "50%",
      marginTop: -4,
      width: 4,
      height: 8,
      borderTopRightRadius: 4,
      borderBottomRightRadius: 4,
      backgroundColor: tokens.color.text.foreground,
    },
    title: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    titleUnread: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.foreground,
    },
  });
}
