import { errorCopy } from "@repo/hooks/error-copy";
import { Alert } from "react-native";

/** The words of one destructive confirmation and of its failure alert. */
export interface DestructiveConfirmCopy {
  title: string;
  body: string;
  confirmLabel: string;
  failedTitle: string;
}

/**
 * A destructive chat action asks first, in a native alert, and nothing runs
 * until the destructive choice. The action is pessimistic, per
 * `spec/ui/resilience/`: what it changes lands when the server row does, and a
 * failure gets an alert with chat-core's classified reason (`errorCopy`)
 * rather than leaving the screen looking as if the tap did nothing. Delete
 * message and Close poll both confirm through this, so the two can't drift.
 */
export function confirmDestructive(
  copy: DestructiveConfirmCopy,
  action: () => Promise<void>,
): void {
  Alert.alert(copy.title, copy.body, [
    { text: "Cancel", style: "cancel" },
    {
      text: copy.confirmLabel,
      style: "destructive",
      onPress: () => {
        action().catch((error: unknown) => {
          Alert.alert(copy.failedTitle, errorCopy(error));
        });
      },
    },
  ]);
}
