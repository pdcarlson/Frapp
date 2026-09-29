import { Alert } from "react-native";
import {
  DELETE_MESSAGE_CONFIRM_BODY,
  DELETE_MESSAGE_CONFIRM_LABEL,
  DELETE_MESSAGE_CONFIRM_TITLE,
} from "@repo/chat-core/message-actions";

/** The alert a failed delete shows; the body is chat-core's classified reason. */
export const DELETE_MESSAGE_FAILED_TITLE = "Couldn't delete message";

/**
 * Delete asks first, in a native alert, with the words web's dialog uses
 * (#2775). Nothing is deleted until the destructive choice. The delete is
 * pessimistic, per `spec/ui/resilience/`: the tombstone lands when the server
 * row does, and a failure gets an alert rather than leaving the message
 * looking as if the tap did nothing.
 *
 * Kept out of `app/(tabs)/chat-thread.tsx` so it can be tested: a spec
 * cannot sit beside a route module.
 */
export function confirmDeleteMessage(remove: () => Promise<void>): void {
  Alert.alert(DELETE_MESSAGE_CONFIRM_TITLE, DELETE_MESSAGE_CONFIRM_BODY, [
    { text: "Cancel", style: "cancel" },
    {
      text: DELETE_MESSAGE_CONFIRM_LABEL,
      style: "destructive",
      onPress: () => {
        remove().catch((error: unknown) => {
          Alert.alert(
            DELETE_MESSAGE_FAILED_TITLE,
            error instanceof Error ? error.message : undefined,
          );
        });
      },
    },
  ]);
}
