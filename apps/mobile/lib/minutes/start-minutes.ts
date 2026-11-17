import { useCallback } from "react";
import { codeOf } from "@repo/api-sdk";
import { useStartMeeting, type MeetingSummary } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  DEFAULT_MEETING_NAME,
  MEETING_COPY,
  MEETING_ENTRY_COPY,
  guessMeetingType,
  looksLikeHearing,
  meetingInTheRoom,
  meetingIsOn,
  meetingStartingNow,
  meetingWhenLabel,
} from "@repo/validation";
import { selectAllEventRows, type EventRow } from "@/lib/events/select";

/**
 * Starting minutes on the phone: which meeting the +'s Record meeting and
 * New minutes start on (#5287; `spec/behavior/meetings.md` § Recording in the
 * app, § Writing minutes by hand), and the one start call they and the event
 * screen's Write minutes share. Every set of minutes belongs to an event
 * (#4935), one per event.
 */

/** The event a set of minutes is for: its id and name are all a start needs. */
type MeetingEventRef = { id: string; name: string; start_time?: string };

/** What the officer is starting minutes on. */
export type MeetingChoice =
  | { kind: "event"; event: MeetingEventRef }
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

export const MEETING_START_COPY = {
  record: "Record meeting",
  newHeading: "Start minutes",
  change: "Change",
  pickHeading: "Which meeting?",
  onNow: "On now",
  newTitle: DEFAULT_MEETING_NAME,
  newDetail: "Not on the calendar · today, starting now",
  rowOnNow: (name: string) => `${name} is on now`,
  rowNew: "Starts a new meeting, today",
  rowFinding: "Finding the meeting on now",
  rowTaken: (name: string) =>
    `${name} already has minutes. Open the event to take notes.`,
  takenNote: (name: string) =>
    `${name} already has minutes, so pick another meeting or take notes from the event.`,
  readFailed:
    "Couldn't read the calendar, so Frapp can't tell which meeting this is. Check the connection and try again.",
  start: "Start minutes",
  yours: "Your draft",
  hasRecording: (name: string) =>
    `${name} already has a recording. Its minutes are open: record again from there.`,
} as const;

/** The minutes this member could open as theirs, by event. */
function ownDrafts(
  meetings: readonly MeetingSummary[],
  viewerId: string,
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

export type MeetingChoices = {
  /**
   * What the + picks by itself: the meeting on now, a new one when nothing
   * is on, or `null` when the meeting on now already has someone else's
   * minutes (`taken`), so the officer picks rather than splitting it.
   */
  picked: MeetingChoice | null;
  /** The meeting on now, when its minutes are someone else's (or posted). */
  taken: EventRow | null;
  /** What Change lists: the meeting on now, the recent ones, a new one. */
  options: MeetingOption[];
  /** This member's own unposted minutes, by event id. */
  ownDraftFor: ReadonlyMap<string, string>;
};

/**
 * The choices for starting minutes now. `eventsData` is `GET /v1/events` as
 * read; `meetings` is `GET /v1/meetings`; `refused` holds events the server
 * answered `meeting.already_started` for, whose minutes this member can't
 * read and so can't see in `meetings`.
 */
export function meetingChoices(
  eventsData: unknown,
  meetings: readonly MeetingSummary[],
  viewerId: string,
  now: Date,
  refused: ReadonlySet<string> = new Set(),
): MeetingChoices {
  const at = now.getTime();
  const events = selectAllEventRows(eventsData);
  const ownDraftFor = ownDrafts(meetings, viewerId);
  const taken = new Set(refused);
  for (const meeting of meetings) {
    if (meeting.event_id && !ownDraftFor.has(meeting.event_id)) {
      taken.add(meeting.event_id);
    }
  }
  const inRoom = meetingInTheRoom(events, at);
  const inRoomTaken = inRoom && taken.has(inRoom.id) ? inRoom : null;
  const free = inRoom && !inRoomTaken ? inRoom : null;
  const recent = events
    .filter((event) => {
      // A hearing has no minutes in Frapp (§ Standards meetings): never here.
      if (taken.has(event.id) || looksLikeHearing(event.name)) return false;
      const start = Date.parse(event.start_time);
      if (Number.isNaN(start)) return false;
      return (
        meetingIsOn(event, at) ||
        (start <= at && at - start <= RECENT_DAYS * 86_400_000)
      );
    })
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const listed = free
    ? [free, ...recent.filter((event) => event.id !== free.id)]
    : recent;
  const options: MeetingOption[] = listed
    .slice(0, MAX_OPTIONS)
    .map((event) => ({
      choice: { kind: "event", event },
      title: event.name,
      detail: [
        event.id === free?.id
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
    picked: inRoomTaken
      ? null
      : free
        ? { kind: "event", event: free }
        : { kind: "new" },
    taken: inRoomTaken,
    options,
    ownDraftFor,
  };
}

/** The chosen meeting's two lines, for the sheet's meeting row. */
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
export function recordRowDetail(choices: MeetingChoices): string {
  if (choices.taken) return MEETING_START_COPY.rowTaken(choices.taken.name);
  return choices.picked?.kind === "event"
    ? MEETING_START_COPY.rowOnNow(choices.picked.event.name)
    : MEETING_START_COPY.rowNew;
}

/** A start that didn't happen, with the line to show. */
export class MinutesStartError extends Error {
  constructor(
    message: string,
    /** The event already has minutes, which this member may not be able to read. */
    readonly alreadyStarted: boolean,
  ) {
    super(message);
    this.name = "MinutesStartError";
  }
}

export type StartedMinutes = {
  id: string;
  eventName: string;
  /** The member's own draft, opened rather than started. */
  existing: boolean;
};

/**
 * Starts the minutes for `choice`, or opens this member's own draft on that
 * event (`ownDraftFor`). Throws {@link MinutesStartError}; on
 * `alreadyStarted` the caller re-reads its own minutes list.
 */
export function useStartMinutesFor(): {
  start: (
    choice: MeetingChoice,
    ownDraftFor?: ReadonlyMap<string, string>,
  ) => Promise<StartedMinutes>;
  isPending: boolean;
} {
  const mutation = useStartMeeting();
  const { mutateAsync } = mutation;
  const start = useCallback(
    async (
      choice: MeetingChoice,
      ownDraftFor: ReadonlyMap<string, string> = new Map(),
    ): Promise<StartedMinutes> => {
      if (choice.kind === "event") {
        const own = ownDraftFor.get(choice.event.id);
        if (own) {
          return { id: own, eventName: choice.event.name, existing: true };
        }
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
          existing: false,
        };
      } catch (error) {
        if (codeOf(error) === "meeting.already_started") {
          throw new MinutesStartError(
            MEETING_ENTRY_COPY.alreadyStartedBody,
            true,
          );
        }
        throw new MinutesStartError(
          `${MEETING_ENTRY_COPY.startFailed}. ${errorCopy(error, MEETING_COPY.tryAgain)}`,
          false,
        );
      }
    },
    [mutateAsync],
  );
  return { start, isPending: mutation.isPending };
}
