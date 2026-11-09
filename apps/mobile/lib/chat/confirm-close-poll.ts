import { errorCopy } from "@repo/hooks/error-copy";
import { Alert } from "react-native";
import {
  CLOSE_POLL_CONFIRM_BODY,
  CLOSE_POLL_CONFIRM_LABEL,
  CLOSE_POLL_CONFIRM_TITLE,
} from "@repo/chat-core/polls";

/** The alert a failed close shows; the body is chat-core's classified reason. */
export const CLOSE_POLL_FAILED_TITLE = "Couldn't close poll";

/**
 * Close poll asks first, in a native alert, with the words web's dialog uses
 * (#3794): closing stops everyone's voting and can't be undone. Nothing is
 * sent until the destructive choice. The close is pessimistic, per
 * `spec/ui/resilience/`: the card draws closed when the server row lands, and
 * a failure gets an alert rather than leaving the card looking as if the tap
 * did nothing.
 *
 * Kept out of `app/(app)/chat-thread.tsx` so it can be tested: a spec
 * cannot sit beside a route module.
 */
export function confirmClosePoll(close: () => Promise<void>): void {
  Alert.alert(CLOSE_POLL_CONFIRM_TITLE, CLOSE_POLL_CONFIRM_BODY, [
    { text: "Cancel", style: "cancel" },
    {
      text: CLOSE_POLL_CONFIRM_LABEL,
      style: "destructive",
      onPress: () => {
        close().catch((error: unknown) => {
          Alert.alert(CLOSE_POLL_FAILED_TITLE, errorCopy(error));
        });
      },
    },
  ]);
}
