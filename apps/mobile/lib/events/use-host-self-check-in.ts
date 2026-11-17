import { useCallback, useRef, useState } from "react";
import { useCheckIn } from "@repo/hooks";
import { useConnection } from "@/lib/connection/use-connection";
import { successHaptic } from "@/lib/haptics";
import { checkInFailure } from "@/lib/events/check-in-outcome";

/**
 * The host's own check-in, in one tap (2026-11-17).
 *
 * The phone showing the QR is the host's, so they can't scan it, and typing
 * the code off their own screen was the flow Paul rejected ("how are you going
 * to scan your own code if your camera is on your device?"). The API lets an
 * officer who may host (`events:update`) check themselves in with no code and
 * no location (`AttendanceService.checkIn`), so this sends the bare check-in
 * from wherever the host is: the event's check-in card, or the host screen.
 *
 * On success the check-in's own invalidation re-reads the host's row, and the
 * caller's "Checked in at …" replaces the button; a 409 (already on the list)
 * does the same. Anything else is one line under the button.
 */
export function useHostSelfCheckIn(eventId: string): {
  checkIn: () => void;
  pending: boolean;
  message: string | null;
} {
  const { mutateAsync } = useCheckIn();
  const { writeBlockedReason } = useConnection();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, so a double tap before the re-render sends once.
  const sendingRef = useRef(false);

  const checkIn = useCallback(() => {
    if (!eventId || sendingRef.current || writeBlockedReason !== null) return;
    sendingRef.current = true;
    setPending(true);
    setError(null);
    mutateAsync({ eventId })
      .then(() => successHaptic())
      .catch((caught: unknown) => {
        const failure = checkInFailure(caught);
        if (failure.kind !== "already") setError(failure.message);
      })
      .finally(() => {
        sendingRef.current = false;
        setPending(false);
      });
  }, [eventId, mutateAsync, writeBlockedReason]);

  return { checkIn, pending, message: error ?? writeBlockedReason };
}
