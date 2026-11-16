import { isRecord, str } from "../more/narrow";
import { chatChannelIdFrom } from "./targets";
import type { PresentedNotification } from "./push-types";

/**
 * Which chat pushes in the tray quote a message the app knows was deleted
 * (#4470, `spec/behavior/chat/README.md` § Edit and delete). Since #4418 a
 * delete removes every recipient's in-app row for the message; this lets the
 * phone take the matching push out of the tray too, matched by the push's
 * `messageId` only, never by its channel.
 *
 * Pure, so the tray call in `push.ts` stays thin.
 */

/**
 * The message a single-message chat push quotes and is tied to
 * (`data.messageId`, beside `notificationId`; § Deep Linking), or `null`.
 * A bundle quotes no one message. A reminder names its message too, but its
 * row is not always tied to it (a reminder about a blocked author's message
 * quotes nothing and outlives a delete), so it leaves only as its row does.
 */
export function chatPushMessageId(data: unknown): string | null {
  if (chatChannelIdFrom(data) === null || !isRecord(data)) return null;
  if (data.bundled === true || data.reminder === true) return null;
  return str(data, "messageId");
}

/** The tray entries whose push quotes one of `messageIds`. */
export function pushesQuotingMessages(
  presented: readonly PresentedNotification[],
  messageIds: ReadonlySet<string>,
): string[] {
  if (messageIds.size === 0) return [];
  return presented
    .filter((n) => {
      const id = chatPushMessageId(n.request.content.data);
      return id !== null && messageIds.has(id);
    })
    .map((n) => n.request.identifier);
}
