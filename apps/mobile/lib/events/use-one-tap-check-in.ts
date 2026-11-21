import { useCallback, useRef, useState } from "react";
import { useCheckIn } from "@repo/hooks";
import { useConnection } from "@/lib/connection/use-connection";
import { successHaptic } from "@/lib/haptics";
import {
  checkInFailure,
  needsScannedCode,
} from "@/lib/events/check-in-outcome";

/**
 * A check-in sent from the event itself, in one tap (2026-11-17).
 *
 * Two people need no code and no camera, and Paul asked that neither be sent
 * to one: the host, whose own phone shows the QR and can't scan it (the API
 * takes the check-in of the officer whose screen is live without a code), and
 * a member at an event nobody is showing a code for and with no drawn zone
 * (`check_in_needs_code` false), whose check-in was always a bare one.
 *
 * When the server says a code is needed after all (an officer opened a screen
 * after the event was read, or the host isn't the one whose screen is up),
 * `onNeedsCode` takes over, which opens Scan code, rather than a refusal line;
 * without one (s22, whose own code is the only one in reach) the refusal is
 * the line.
 * On success, and on a 409 (already on the list), `useCheckIn` re-reads the
 * member's own row, and the caller's "Checked in at …" replaces the button.
 * Anything else is one line under it, shown only after a tap.
 */
export function useOneTapCheckIn(
  eventId: string,
  onNeedsCode?: () => void,
): {
  checkIn: () => void;
  pending: boolean;
  message: string | null;
} {
  const { mutateAsync } = useCheckIn();
  const { writeBlockedReason } = useConnection();
  const [pending, setPending] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, so a double tap before the re-render sends once.
  const sendingRef = useRef(false);

  const checkIn = useCallback(() => {
    setTried(true);
    if (!eventId || sendingRef.current || writeBlockedReason !== null) return;
    sendingRef.current = true;
    setPending(true);
    setError(null);
    mutateAsync({ eventId })
      .then(() => successHaptic())
      .catch((caught: unknown) => {
        if (onNeedsCode && needsScannedCode(caught)) {
          onNeedsCode();
          return;
        }
        const failure = checkInFailure(caught);
        if (failure.kind !== "already") setError(failure.message);
      })
      .finally(() => {
        sendingRef.current = false;
        setPending(false);
      });
  }, [eventId, mutateAsync, onNeedsCode, writeBlockedReason]);

  return {
    checkIn,
    pending,
    message: error ?? (tried ? writeBlockedReason : null),
  };
}
