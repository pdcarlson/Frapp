import { settingEntryById, type FindTarget } from "@repo/hooks";
import { settingPhoneRoute } from "@/lib/settings/settings-search";
import type { NotificationTarget } from "@/lib/notifications/targets";

/**
 * Where a row of the phone's Search screen opens, or `null` when this build
 * has no screen for it, in which case the row is not listed
 * (`components/search/search-screen.tsx`). Until #5139 the same rows were
 * listed inside the Ask field (#4904).
 *
 * - A channel opens the channel; a message opens its channel at that message
 *   (`focusMessageId`, the route's own jump).
 * - A member opens their profile (`/member`, #5568), the page every other
 *   door to a member opens; one with no user id opens the Directory.
 * - An event opens its details.
 * - Backwork has no screen on the phone.
 * - A setting opens its settings screen with the row lit; one only web
 *   changes has no route here, and the Search screen opens it on the web
 *   dashboard instead (`openSetting`).
 *
 * The routes are spelled `pathname: "…"` so `lib/routes.spec.ts` checks them
 * against the file tree (see `lib/notifications/targets.ts`).
 */
export function findTargetRoute(target: FindTarget): NotificationTarget | null {
  switch (target.type) {
    case "channel":
      return target.channelId
        ? { pathname: "/chat-thread", params: { channelId: target.channelId } }
        : null;
    case "message":
      if (!target.channelId) return null;
      return {
        pathname: "/chat-thread",
        params: target.messageId
          ? { channelId: target.channelId, focusMessageId: target.messageId }
          : { channelId: target.channelId },
      };
    case "member":
      return target.userId
        ? { pathname: "/member", params: { userId: target.userId } }
        : { pathname: "/directory" };
    case "event":
      return target.eventId
        ? { pathname: "/event-details", params: { id: target.eventId } }
        : null;
    case "backwork":
      return null;
    case "setting": {
      const entry = settingEntryById(target.settingId);
      return entry ? settingPhoneRoute(entry) : null;
    }
  }
}
