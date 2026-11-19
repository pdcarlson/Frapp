import { useRequestMinutes, type MinutesRequestState } from "@repo/hooks";
import { MEETING_ENTRY_COPY, MINUTES_REQUEST_COPY } from "@repo/validation";
import { ListRow, ListSection } from "@/components/list-section";
import { alertFailure } from "@/lib/failure-alert";

/**
 * The event's Minutes row while they are an unposted draft the member can't
 * open (#5471, `spec/behavior/meetings.md` § Asking for minutes; web's twin
 * is `request-minutes-button.tsx`, with the same words). Request minutes
 * pings whoever is writing them, as Slack's Remind or GitHub's Re-request
 * review nudge someone for something owed; the row then reads Requested,
 * since each member asks once.
 */
export function RequestMinutesRow({ state }: { state: MinutesRequestState }) {
  const request = useRequestMinutes();

  async function ask() {
    try {
      await request.mutateAsync(state.meeting_id);
    } catch (error) {
      alertFailure({
        title: MINUTES_REQUEST_COPY.failed,
        error,
        fallback: "Try again in a moment.",
        retry: () => void ask(),
      });
    }
  }

  return (
    <ListSection>
      {state.requested ? (
        <ListRow
          label={MEETING_ENTRY_COPY.label}
          value={MINUTES_REQUEST_COPY.requested}
          description={MINUTES_REQUEST_COPY.requestedStatus}
          variant="detail"
        />
      ) : (
        <ListRow
          label={MINUTES_REQUEST_COPY.request}
          description={MINUTES_REQUEST_COPY.notPosted}
          action
          busy={request.isPending}
          onPress={() => void ask()}
        />
      )}
    </ListSection>
  );
}
