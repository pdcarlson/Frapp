"use client";

import { useRequestMinutes, type MinutesRequestState } from "@repo/hooks";
import { MINUTES_REQUEST_COPY } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { toastFailure } from "@/lib/failure-toast";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Request minutes, on the event's Minutes row while they are an unposted
 * draft the reader can't open (#5471, `spec/behavior/meetings.md` § Asking
 * for minutes). It pings whoever is writing them, as Slack's Remind or
 * GitHub's Re-request review nudge someone for something owed, and then
 * reads Requested: one ask per member, so there is nothing to press again.
 */
export function RequestMinutesButton({
  state,
}: {
  state: MinutesRequestState;
}) {
  const request = useRequestMinutes();
  const { toast } = useToast();

  if (state.requested) {
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled
        aria-label={MINUTES_REQUEST_COPY.requestedLabel}
      >
        {MINUTES_REQUEST_COPY.requested}
      </Button>
    );
  }

  async function ask() {
    try {
      const sent = await request.mutateAsync(state.meeting_id);
      toast({
        title: MINUTES_REQUEST_COPY.sentTitle,
        description: sent.pinged
          ? MINUTES_REQUEST_COPY.sentBody
          : MINUTES_REQUEST_COPY.heldBody,
      });
    } catch (error) {
      toastFailure({
        title: MINUTES_REQUEST_COPY.failed,
        error,
        fallback: "Try again in a moment.",
        retry: () => void ask(),
      });
    }
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={request.isPending}
      onClick={() => void ask()}
    >
      {MINUTES_REQUEST_COPY.request}
    </Button>
  );
}
