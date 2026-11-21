import { Alert } from "react-native";
import { canTryAgain, errorCopy } from "@repo/hooks/error-copy";

export interface FailureAlert {
  /** What failed, in the member's words: `Couldn't mark it done`. */
  title: string;
  error: unknown;
  /** The screen's own reason, for a failure the shared map can't word. */
  fallback?: string;
  /** The line itself, when the screen words this failure on its own. */
  message?: string;
  /**
   * Sends the same write again. Offered as **Try again** only when sending it
   * again may go through (`canTryAgain`: no response, a 5xx, a proxy
   * timeout). A refusal the API decided shows its reason with a single OK.
   */
  retry?: () => unknown;
}

/**
 * The one system alert for a failed write on mobile (writing.md § Error
 * copy pattern, "Failed writes"): the shared error map's line, and **Try
 * again** beside **Not now** when asking again can fix it, the way iOS's own
 * Messages and Mail offer it.
 */
export function alertFailure({
  title,
  error,
  fallback,
  message,
  retry,
}: FailureAlert) {
  const body = message ?? errorCopy(error, fallback);
  if (retry === undefined || !canTryAgain(error)) {
    Alert.alert(title, body);
    return;
  }
  Alert.alert(title, body, [
    { text: "Not now", style: "cancel" },
    {
      text: "Try again",
      style: "default",
      isPreferred: true,
      onPress: () => {
        void retry();
      },
    },
  ]);
}
