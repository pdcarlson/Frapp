import { useRef, useState } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import {
  useMeeting,
  useMeetingNoteTaking,
  useMeetings,
  useMinutesRequest,
  usePermissionList,
} from "@repo/hooks";
import {
  MEETING_COPY,
  MEETING_ENTRY_COPY,
  MEETING_NOTE_TAKERS_COPY,
  can,
  eventMinutesLines,
} from "@repo/validation";
import { InlineNote } from "@/components/inline-note";
import { ListRow, ListSection } from "@/components/list-section";
import { useAiSurfaces } from "@/lib/ai/availability";
import { recorderMeetingId } from "@/lib/minutes/recorder/machine";
import { useMeetingRecorder } from "@/lib/minutes/recorder/session";
import { useMeetingsOn } from "@/lib/minutes/meetings-on";
import {
  MinutesStartError,
  useStartMinutesFor,
} from "@/lib/minutes/start-minutes";
import { NoteTakerSheet } from "@/components/minutes/note-taker-sheet";
import { RequestMinutesRow } from "@/components/minutes/request-minutes-row";

/**
 * An event's way into its minutes, on the event's screen
 * (`spec/behavior/meetings.md` § Writing minutes; web's twin is
 * `event-minutes.tsx`, with the same words).
 *
 * - Minutes the viewer may read: one row that opens them, saying where they
 *   stand (posted on which day, or a draft), how many decisions and action
 *   items they hold, and the TL;DR's first line, as web's card does.
 * - None yet, for an officer who records minutes (`meetings:record`):
 *   Record minutes where this phone can record (it starts them and opens
 *   them asking to record, notice first), else Write minutes, which starts
 *   them in one tap with the type the event's name suggests and opens them,
 *   ready to type in. Without drafting from notes what is typed there is the
 *   minutes' Summary (#5288).
 * - Someone else's unposted minutes this member may take notes on (an
 *   officer who records minutes, or a member their author added, #4935):
 *   Take notes, which opens their own notes in a sheet.
 * - Unposted minutes anyone else the event invites can't open, once it has
 *   ended: Request minutes, which pings whoever is writing them (#5471).
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
  // The TL;DR lives on the minutes themselves, read once they are known.
  const detailQuery = useMeeting(on ? meetingsQuery.data?.[0]?.id : null);
  const canRecord = can("meetings:record", usePermissionList());
  const canDraft = useAiSurfaces().meetingNotes;
  const start = useStartMinutesFor();
  const takingQuery = useMeetingNoteTaking({
    enabled: on && !!eventId && canDraft,
    eventId,
  });
  // Only asked once the member is known to see no minutes of their own.
  const requestQuery = useMinutesRequest({
    enabled: on && meetingsQuery.isSuccess && !meetingsQuery.data?.[0],
    eventId,
  });
  // Where this phone can record and holds no recording now, the row records
  // (Paul, 2026-11-17: "replace it for just the record button"): the minutes
  // open and ask to record, notice first. The server's own offer is checked
  // there, and without it they open ready for notes.
  const { state: recorderState, recorder } = useMeetingRecorder();
  // Recording is offered with drafting, which is what a transcript is for
  // (#5289 records without it); elsewhere the row writes.
  const records =
    canDraft && !!recorder && recorderMeetingId(recorderState) === null;
  const notesSheet = useRef<BottomSheetModal>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Unknown is not "nobody wrote them": offering Write minutes on a failed
  // read would only meet a 409.
  if (!on || !eventId || !meetingsQuery.isSuccess) return null;
  const minutes = meetingsQuery.data?.[0];
  const taking = minutes ? undefined : takingQuery.data?.[0];
  if (taking) {
    return (
      <>
        <ListSection>
          <ListRow
            label={
              taking.joined
                ? MEETING_NOTE_TAKERS_COPY.takingNotes
                : MEETING_NOTE_TAKERS_COPY.takeNotes
            }
            description={MEETING_NOTE_TAKERS_COPY.listItem(taking.author_name)}
            onPress={() => notesSheet.current?.present()}
          />
        </ListSection>
        <NoteTakerSheet ref={notesSheet} meetingId={taking.meeting_id} />
      </>
    );
  }
  // Someone else may have started them; the note-taking read decides, and
  // its Take notes wins over Request minutes.
  if (!minutes && canDraft && takingQuery.isPending) return null;
  const askable = minutes ? null : requestQuery.data;
  if (askable) return <RequestMinutesRow state={askable} />;
  if (!minutes && !canRecord) return null;

  const open = (id: string, record = false) =>
    router.push({
      pathname: "/minutes-details",
      params: record ? { id, record: "1" } : { id },
    });

  async function write() {
    setProblem(null);
    try {
      // The same start the +'s New minutes makes (`lib/minutes/start-minutes.ts`).
      const meeting = await start.start({
        kind: "event",
        event: { id: eventId, name: eventName },
      });
      open(meeting.id, records);
    } catch (error) {
      if (error instanceof MinutesStartError && error.alreadyStarted) {
        void meetingsQuery.refetch();
      }
      setProblem(
        error instanceof Error ? error.message : MEETING_COPY.tryAgain,
      );
    }
  }

  const lines = minutes
    ? eventMinutesLines(minutes, detailQuery.data?.content?.tldr)
    : null;
  return (
    <>
      <ListSection>
        {lines && minutes ? (
          <ListRow
            label={MEETING_ENTRY_COPY.label}
            description={
              lines.gist ? `${lines.status}\n${lines.gist}` : lines.status
            }
            accessibilityHint={MEETING_ENTRY_COPY.open}
            onPress={() => open(minutes.id)}
          />
        ) : (
          <ListRow
            label={records ? MEETING_ENTRY_COPY.record : MEETING_ENTRY_COPY.write}
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
