"use client";

import { statusOf } from "@repo/api-sdk";
import { useCheckIn } from "@repo/hooks";
import { formatPointsChip } from "@repo/formatting";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * Web's plain self check-in, with the toasts it answers with. The chat event
 * card and the event sheet's own check-in both call it, so the two say the
 * same words for the same outcome (`spec/behavior/events.md` § Check-In).
 *
 * No token and no coordinates: for an event with a check-in geofence the
 * server rejects that, so a caller that knows the event has a zone says to use
 * the mobile app instead of offering it. A repeat is answered 409 by decision
 * (#3703) and toasts "Already on the list", not a failure. Not "checked in":
 * the server answers 409 for any row, an officer's excused or absent mark
 * included. `useCheckIn` re-reads the member's own row on it, so the block
 * then says which.
 *
 * `run` resolves `true` once the member is on the list (checked in now, or a
 * 409 saying they already were), `false` for any other failure, which it has
 * already toasted. Activity's row button reads it to settle (#4427).
 */
export function useSelfCheckIn() {
  const checkIn = useCheckIn();
  const { toast } = useToast();

  const run = async (
    eventId: string,
    pointValue: unknown,
  ): Promise<boolean> => {
    try {
      await checkIn.mutateAsync({ eventId });
      toast({
        title: "Checked in",
        description:
          typeof pointValue === "number" && pointValue > 0
            ? formatPointsChip(pointValue)
            : undefined,
      });
      return true;
    } catch (error) {
      const alreadyIn = statusOf(error) === 409;
      toast({
        title: alreadyIn ? "Already on the list" : "Couldn't check in",
        description: alreadyIn
          ? "You're already on the attendance list for this event."
          : getErrorMessage(error, "Couldn't check in."),
        variant: alreadyIn ? "default" : "destructive",
      });
      return alreadyIn;
    }
  };

  return {
    run,
    isPending: checkIn.isPending,
    /** The event this session last checked in to, once the POST succeeded. */
    checkedInEventId: checkIn.isSuccess
      ? checkIn.variables?.eventId
      : undefined,
  };
}
