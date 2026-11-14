import { View } from "react-native";
import { useRouter } from "expo-router";
import {
  unreadThreadCount,
  useMemberThreads,
  useNotifications,
} from "@repo/hooks";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { HeaderButton } from "@/components/header-button";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import { ThreadsGlyph } from "@/components/control-glyphs";
import { NavGlyph } from "@/components/nav-glyph";
import { useTourAnchor } from "@/components/onboarding/tour";
import { selectUnreadNonChatCount } from "@/lib/more/notifications";
import { useFrappTheme } from "@/lib/theme";

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
 * All threads (#4960): the member's threads across channels, in a sheet over
 * Chat home (`AllThreadsSheet`). Slack puts Threads at the top of its home,
 * and Discord a threads icon in the channel header. Its badge counts threads
 * with new replies, in house gold like the bell's: not direct address.
 */
export function ThreadsButton({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const unread = unreadThreadCount(useMemberThreads().data);
  return (
    <HeaderButton
      label="Threads"
      hint="Opens the threads you're part of."
      value={unread > 0 ? `${unread} with new replies` : undefined}
      onPress={onPress}
      badge={{ count: unread, tone: "inbox", testID: "threads-badge" }}
    >
      <ThreadsGlyph color={tokens.color.text.foreground} size={GLYPH} />
    </HeaderButton>
  );
}
