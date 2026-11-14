import type { FindTarget } from "@repo/hooks";
import type { NotificationTarget } from "@/lib/notifications/targets";

/**
 * Where a row of the Ask field's search opens on the phone (#4904), or
 * `null` when this build has no screen for it, in which case the row is not
 * listed (`components/ask/ask-find.tsx`).
 *
 * - A channel opens the channel; a message opens its channel at that message
 *   (`focusMessageId`, the route's own jump).
 * - A member opens the directory, as web's Find opens Members: neither has a
 *   page for one member.
 * - An event opens its details.
 * - Backwork has no screen on the phone.
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
      return { pathname: "/directory" };
    case "event":
      return target.eventId
        ? { pathname: "/event-details", params: { id: target.eventId } }
        : null;
    case "backwork":
      return null;
  }
}
