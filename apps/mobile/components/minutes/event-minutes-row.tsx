import { useState } from "react";
import { useRouter } from "expo-router";
import { codeOf } from "@repo/api-sdk";
import { useMeetings, usePermissionList, useStartMeeting } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  MEETING_COPY,
  MEETING_ENTRY_COPY,
  can,
  guessMeetingType,
} from "@repo/validation";
import { InlineNote } from "@/components/inline-note";
import { ListRow, ListSection } from "@/components/list-section";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useMeetingsOn } from "@/lib/minutes/meetings-on";

/**
 * An event's way into its minutes, on the event's screen
 * (`spec/behavior/meetings.md` § Writing minutes; web's twin is
 * `event-minutes.tsx`, with the same words).
 *
 * - Minutes the viewer may read: one row that opens them.
 * - None yet, for an officer who records minutes (`meetings:record`) on a
 *   chapter with drafting from notes: Write minutes, which starts them in one
 *   tap with the type the event's name suggests and opens them, ready for
 *   notes. Without drafting there is nothing to write them with on a phone
 *   (the section editor is on the web), so the row is not offered and no
 *   empty draft is left behind.
 * - Anyone else, and any chapter with the meetings module off: nothing.
 *
 * Nothing is drawn until the read answers, and the row sits last on the
 * screen, so its arrival moves nothing above it.
 */
export function EventMinutesRow({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const on = useMeetingsOn();
  const router = useRouter();
  const meetingsQuery = useMeetings({ enabled: on && !!eventId, eventId });
  const canRecord = can("meetings:record", usePermissionList());
  const canDraft = useAiSurfaces().meetingNotes;
  const start = useStartMeeting();
  const [problem, setProblem] = useState<string | null>(null);

  // Unknown is not "nobody wrote them": offering Write minutes on a failed
  // read would only meet a 409.
  if (!on || !eventId || !meetingsQuery.isSuccess) return null;
  const minutes = meetingsQuery.data?.[0];
  if (!minutes && !(canRecord && canDraft)) return null;

  const open = (id: string) =>
    router.push({ pathname: "/minutes-details", params: { id } });

  async function write() {
    setProblem(null);
    try {
      const meeting = await start.mutateAsync({
        event_id: eventId,
        meeting_type: guessMeetingType(eventName),
      });
      open(meeting.id);
    } catch (error) {
      if (codeOf(error) === "meeting.already_started") {
        void meetingsQuery.refetch();
        setProblem(MEETING_ENTRY_COPY.alreadyStartedBody);
        return;
      }
      setProblem(
        `${MEETING_ENTRY_COPY.startFailed}. ${errorCopy(error, MEETING_COPY.tryAgain)}`,
      );
    }
  }

  return (
    <>
      <ListSection>
        {minutes ? (
          <ListRow
            label={MEETING_ENTRY_COPY.label}
            value={
              minutes.status === "draft"
                ? MEETING_COPY.draftBadge
                : MEETING_ENTRY_COPY.posted
            }
            accessibilityHint={MEETING_ENTRY_COPY.open}
            onPress={() => open(minutes.id)}
          />
        ) : (
          <ListRow
            label={MEETING_ENTRY_COPY.write}
            description={MEETING_ENTRY_COPY.none}
            busy={start.isPending}
            onPress={() => void write()}
          />
        )}
      </ListSection>
      {problem ? <InlineNote tone="warning">{problem}</InlineNote> : null}
    </>
  );
}
