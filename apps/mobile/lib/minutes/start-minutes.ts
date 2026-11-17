import { useCallback } from "react";
import { codeOf } from "@repo/api-sdk";
import { useMeetings, useStartMeeting, type MeetingSummary } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  DEFAULT_MEETING_NAME,
  MEETING_COPY,
  MEETING_ENTRY_COPY,
  guessMeetingType,
  looksLikeHearing,
  meetingInTheRoom,
  meetingStartingNow,
  meetingWhenLabel,
} from "@repo/validation";
import { selectAllEventRows, type EventRow } from "@/lib/events/select";

/**
 * Which meeting the phone's + starts minutes on (#5287;
 * `spec/behavior/meetings.md` § Writing minutes by hand, § Recording in the
 * app): Record meeting and New minutes both pick one by themselves and let
 * the officer change it. Every set of minutes belongs to an event (#4935),
 * one per event.
 */

/** What the officer is starting minutes on. */
export type MeetingChoice =
  | { kind: "event"; event: EventRow }
  /** A meeting not on the calendar: the quiet event made when minutes start. */
  | { kind: "new" };

/** One line the picker offers. */
export type MeetingOption = {
  choice: MeetingChoice;
  title: string;
  detail: string;
};

/** How far back Change looks for the meeting, and how many it lists. */
const RECENT_DAYS = 14;
const MAX_OPTIONS = 6;
/** And ahead: a meeting about to start is one an officer records from its top. */
const AHEAD_MS = 60 * 60_000;

export const MEETING_START_COPY = {
  record: "Record meeting",
  newMinutes: "New minutes",
  recordHeading: "Record this meeting",
  newHeading: "Start minutes",
  change: "Change",
  pickHeading: "Which meeting?",
  onNow: "On now",
  newTitle: DEFAULT_MEETING_NAME,
  newDetail: "Not on the calendar · today, starting now",
  rowOnNow: (name: string) => `${name} is on now`,
  rowNew: "Starts a new meeting, today",
  start: "Start minutes",
  starting: "Starting",
  yours: "Your draft",
  recorderBusy:
    "Your recording for another meeting is still on this phone. Open it to stop, upload or delete it first.",
} as const;

/** The minutes this member could open as theirs, by event. */
function ownDrafts(
  meetings: readonly MeetingSummary[],
  viewerId: string | null,
): Map<string, string> {
  const own = new Map<string, string>();
  for (const meeting of meetings) {
    if (
      meeting.event_id &&
      meeting.status === "draft" &&
      meeting.created_by === viewerId
    ) {
      own.set(meeting.event_id, meeting.id);
    }
  }
  return own;
}

/**
 * The events minutes can't start on: one already holding minutes that
 * aren't this member's draft. Minutes this member can't read aren't in the
 * list; the server's 409 `meeting.already_started` covers those.
 */
function takenEvents(
  meetings: readonly MeetingSummary[],
  own: ReadonlyMap<string, string>,
): Set<string> {
  const taken = new Set<string>();
  for (const meeting of meetings) {
    if (meeting.event_id && !own.has(meeting.event_id)) {
      taken.add(meeting.event_id);
    }
  }
  return taken;
}

export type MeetingChoices = {
  /** What the + picks by itself. */
  picked: MeetingChoice;
  /** What Change lists: recent meetings, newest first, then a new one. */
  options: MeetingOption[];
  /** This member's own unposted minutes, by event id. */
  ownDraftFor: ReadonlyMap<string, string>;
};

/**
 * The choices for starting minutes now. `eventsData` is `GET /v1/events` as
 * read; `meetings` is `GET /v1/meetings`.
 */
export function meetingChoices(
  eventsData: unknown,
  meetings: readonly MeetingSummary[],
  viewerId: string | null,
  now: Date,
): MeetingChoices {
  const at = now.getTime();
  const events = selectAllEventRows(eventsData);
  const ownDraftFor = ownDrafts(meetings, viewerId);
  const taken = takenEvents(meetings, ownDraftFor);
  const inRoom = meetingInTheRoom(events, taken, at);
  const recent = events
    .filter((event) => {
      // A hearing is never recorded or drafted (§ Standards meetings), and
      // the + only starts minutes that are: it isn't offered here at all.
      if (taken.has(event.id) || looksLikeHearing(event.name)) return false;
      const start = Date.parse(event.start_time);
      return (
        !Number.isNaN(start) &&
        start <= at + AHEAD_MS &&
        at - start <= RECENT_DAYS * 86_400_000
      );
    })
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const listed = inRoom
    ? [inRoom, ...recent.filter((event) => event.id !== inRoom.id)]
    : recent;
  const options: MeetingOption[] = listed
    .slice(0, MAX_OPTIONS)
    .map((event) => ({
      choice: { kind: "event", event },
      title: event.name,
      detail: [
        event.id === inRoom?.id
          ? MEETING_START_COPY.onNow
          : meetingWhenLabel(event.start_time, now),
        ownDraftFor.has(event.id) ? MEETING_START_COPY.yours : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
  options.push({
    choice: { kind: "new" },
    title: MEETING_START_COPY.newTitle,
    detail: MEETING_START_COPY.newDetail,
  });
  return {
    picked: inRoom ? { kind: "event", event: inRoom } : { kind: "new" },
    options,
    ownDraftFor,
  };
}

/** The line under a choice: its name and when, for the sheet's meeting row. */
export function choiceLabel(
  choice: MeetingChoice,
  now: Date,
  inRoomId: string | null,
): { title: string; detail: string } {
  if (choice.kind === "new") {
    return {
      title: MEETING_START_COPY.newTitle,
      detail: MEETING_START_COPY.newDetail,
    };
  }
  return {
    title: choice.event.name,
    detail:
      choice.event.id === inRoomId
        ? MEETING_START_COPY.onNow
        : meetingWhenLabel(choice.event.start_time, now),
  };
}

/** What the Record meeting row says about the meeting it will use. */
export function recordRowDetail(choice: MeetingChoice): string {
  return choice.kind === "event"
    ? MEETING_START_COPY.rowOnNow(choice.event.name)
    : MEETING_START_COPY.rowNew;
}

export type StartedMinutes = { id: string; eventName: string };

/**
 * Starts the minutes for `choice`, or opens this member's own draft on that
 * event. Throws an `Error` whose message is the line to show.
 */
export function useStartMinutesFor(): {
  start: (
    choice: MeetingChoice,
    ownDraftFor: ReadonlyMap<string, string>,
  ) => Promise<StartedMinutes>;
  isPending: boolean;
} {
  const mutation = useStartMeeting();
  const meetingsQuery = useMeetings();
  const { mutateAsync } = mutation;
  const refetch = meetingsQuery.refetch;
  const start = useCallback(
    async (
      choice: MeetingChoice,
      ownDraftFor: ReadonlyMap<string, string>,
    ): Promise<StartedMinutes> => {
      if (choice.kind === "event") {
        const own = ownDraftFor.get(choice.event.id);
        if (own) return { id: own, eventName: choice.event.name };
      }
      try {
        const meeting =
          choice.kind === "event"
            ? await mutateAsync({
                event_id: choice.event.id,
                meeting_type: guessMeetingType(choice.event.name),
              })
            : await mutateAsync({
                meeting_type: "chapter",
                new_event: {
                  name: DEFAULT_MEETING_NAME,
                  ...meetingStartingNow(new Date()),
                  role_ids: [],
                },
              });
        return {
          id: meeting.id,
          eventName:
            choice.kind === "event" ? choice.event.name : DEFAULT_MEETING_NAME,
        };
      } catch (error) {
        if (codeOf(error) === "meeting.already_started") {
          void refetch();
          throw new Error(MEETING_ENTRY_COPY.alreadyStartedBody);
        }
        throw new Error(
          `${MEETING_ENTRY_COPY.startFailed}. ${errorCopy(error, MEETING_COPY.tryAgain)}`,
        );
      }
    },
    [mutateAsync, refetch],
  );
  return { start, isPending: mutation.isPending };
}
