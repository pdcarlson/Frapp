import { useRouter } from "expo-router";
import { useNotifications } from "@repo/hooks";
import { HeaderButton } from "@/components/header-button";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import { SearchGlyph } from "@/components/control-glyphs";
import { selectUnreadNonChatCount } from "@/lib/more/notifications";
import { useFrappTheme } from "@/lib/theme";

/**
 * Chat home's top-right rounds: Search (#5139), then the notification bell
 * (#3839). Between them sat a door to Messages (owner, 2026-11-07) until
 * Messages became the third tab (#5310).
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
 * The notification inbox's door: a bell beside Search, with the unread
 * count as a badge (#3362, back on the header in #3839). The avatar that held
 * it moved to the tab bar as the You tab, and a count that lived only as a dot
 * on that avatar was a count nobody could read, so the bell is its own
 * control again, as the web top bar's is.
 *
 * ## The badge is house gold
 *
 * Fixed `gold.house`, never the chapter accent, as the web bell's badge is
 * (`spec/ui/design-system/components.md` § App bar chips). A count is not
 * direct address: a chapter whose accent is red would otherwise draw an
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
 * > list (`ThreadsRow`), as Slack's Home lists it, so the title row
 * > keeps three rounds beside a long chapter name.
 * >
 * > Changed in #5277 by pdcarlson, 2026-11-17: the Threads row and its sheet
 * > are gone; each channel lists its active threads under its own row
 * > (`ChannelThreadRows`), as Discord's channel list does.
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
