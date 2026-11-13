"use client";

import { canTryAgain, type ErrorCopyOptions } from "@repo/hooks/error-copy";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

export interface FailureToast {
  /** What failed, in the member's words: `Couldn't start study session`. */
  title: string;
  error: unknown;
  /** The screen's own reason, for a failure the shared map can't word. */
  fallback: string;
  /**
   * Sends the same write again. Offered as **Try again** only when sending it
   * again may go through ({@link canTryAgain}): no response, a 5xx, a proxy
   * timeout. A refusal the API decided shows its reason and no button,
   * because pressing it would only be refused again.
   */
  retry?: () => unknown;
  /** Passed to the shared map, for a screen whose routes write for members. */
  copyOptions?: ErrorCopyOptions;
}

/**
 * The one destructive toast for a failed write on web (writing.md § Error
 * copy pattern, "Failed writes"). It reads the shared error map for the
 * description and adds Try again when the failure is one asking again can
 * fix, so a member whose save died with the connection doesn't have to find
 * the control again.
 */
export function toastFailure({
  title,
  error,
  fallback,
  retry,
  copyOptions,
}: FailureToast) {
  const offerRetry = retry !== undefined && canTryAgain(error);
  return toast({
    title,
    description: getErrorMessage(error, fallback, copyOptions),
    variant: "destructive",
    ...(offerRetry
      ? {
          action: (
            <ToastAction
              altText={`Try again: ${title}`}
              onClick={() => {
                void retry();
              }}
            >
              Try again
            </ToastAction>
          ),
        }
      : {}),
  });
}
