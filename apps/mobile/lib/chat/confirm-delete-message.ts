import {
  DELETE_MESSAGE_CONFIRM_BODY,
  DELETE_MESSAGE_CONFIRM_LABEL,
  DELETE_MESSAGE_CONFIRM_TITLE,
} from "@repo/chat-core/message-actions";
import { confirmDestructive } from "./confirm-destructive";

/** The alert a failed delete shows; the body is chat-core's classified reason. */
export const DELETE_MESSAGE_FAILED_TITLE = "Couldn't delete message";

/**
 * Delete asks first, in a native alert, with the words web's dialog uses
 * (#2775). Nothing is deleted until the destructive choice. The delete is
 * pessimistic, per `spec/ui/resilience/`: the tombstone lands when the server
 * row does, and a failure gets an alert rather than leaving the message
 * looking as if the tap did nothing.
 *
 * Kept out of `app/(app)/chat-thread.tsx` so it can be tested: a spec
 * cannot sit beside a route module.
 */
export function confirmDeleteMessage(remove: () => Promise<void>): void {
  confirmDestructive(
    {
      title: DELETE_MESSAGE_CONFIRM_TITLE,
      body: DELETE_MESSAGE_CONFIRM_BODY,
      confirmLabel: DELETE_MESSAGE_CONFIRM_LABEL,
      failedTitle: DELETE_MESSAGE_FAILED_TITLE,
    },
    remove,
  );
}
