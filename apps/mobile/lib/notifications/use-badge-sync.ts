/**
 * Syncs the app icon badge to unread in-app notifications + unread chat
 * messages, per `spec/behavior/notifications.md` § Badge Count.
 *
 * Mounted once, app-wide, from `components/app-runtime.tsx` — alongside the
 * other runtimes that have no screen to live on (see that file's comment for
 * why `app/_layout.tsx`, a frozen hotspot, can't host this directly).
 *
 * ## Both halves are already-live queries; nothing here re-derives them
 *
 * `useChannelUnreadCounts` is the server's own per-channel unread count
 * (`spec/behavior/chat/README.md` § Read Receipts: clients MUST NOT
 * re-derive it). The notification half reuses `selectUnreadIds`, the same
 * `read_at === null` filter the in-app history (s14) and its own "Mark all
 * read" already use — a second, slightly different definition here would be
 * exactly the kind of drift that rule exists to prevent.
 *
 * ## Why no explicit `AppState` resync
 *
 * `spec/behavior/notifications.md` also asks for a resync "on app resume".
 * `lib/connection/query-connectivity.ts` already binds TanStack's
 * `focusManager` to `AppState`, and `query-client.ts` sets
 * `refetchOnWindowFocus: true` — so both queries below already refetch on
 * foreground, and the `useEffect` here reacts to their data like any other
 * derived state. A second, hand-rolled `AppState` listener would just race
 * the one that already exists.
 *
 * ## Verification
 *
 * `setBadgeCountAsync` needs no EAS `projectId` (see `push.ts`'s
 * `setBadgeCount`), so this runs in a plain dev build — but no device or
 * simulator is available in this sandbox to confirm the OS badge actually
 * updates. Untested on-device, same accepted gap as the rest of `#937`'s
 * push work (`#998`'s own "Definition of done": push cannot be verified in
 * Expo Go, and there is no dev build here either — say so rather than
 * checking the box).
 */
import { useEffect } from "react";
import {
  useActiveChapterId,
  useChannelUnreadCounts,
  useNotifications,
} from "@repo/hooks";
import { selectUnreadIds } from "../more/notifications";
import { setBadgeCount } from "./push";

export function useBadgeSyncRuntime(): void {
  const chapterId = useActiveChapterId();
  // No explicit limit: matches the in-app history's own call
  // (`app/(tabs)/notifications.tsx`), so both read the same default page.
  const notifications = useNotifications();
  const channelUnread = useChannelUnreadCounts();

  useEffect(() => {
    // No active chapter (signed out, or between chapters): nothing to badge.
    if (!chapterId) {
      void setBadgeCount(0);
      return;
    }
    const unreadNotifications = selectUnreadIds(notifications.data).length;
    const unreadChat = (channelUnread.data ?? []).reduce(
      (sum, row) => sum + row.unread_count,
      0,
    );
    void setBadgeCount(unreadNotifications + unreadChat);
  }, [chapterId, notifications.data, channelUnread.data]);
}
