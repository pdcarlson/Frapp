import { useCallback } from "react";
import { codeOf } from "@repo/api-sdk";
import { useStartMeeting, type MeetingSummary } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  MEETING_COPY,
  MEETING_ENTRY_COPY,
  MINUTES_START_COPY,
  MINUTES_WITHOUT_MEETING_NAME,
  guessMeetingType,
  looksLikeHearing,
  meetingInTheRoom,
  meetingIsOn,
  meetingWhenLabel,
} from "@repo/validation";
import { selectAllEventRows, type EventRow } from "@/lib/events/select";

/**
 * Starting minutes on the phone: which meeting the +'s New minutes starts
 * on, for notes or a recording, (#5287; `spec/behavior/meetings.md` § Recording in the
 * app, § Writing minutes by hand), and the one start call they and the event
 * screen's Write minutes share. Minutes belong to one event at most, or to
 * none until one is linked (Paul, 2026-11-20: "No meeting · Link one later").
 */

/** The event a set of minutes is for: its id and name are all a start needs. */
type MeetingEventRef = { id: string; name: string; start_time?: string };

/** What the officer is starting minutes on. */
export type MeetingChoice =
  | { kind: "event"; event: MeetingEventRef }
  /** No meeting yet: the minutes start unlinked, and are linked later. */
  | { kind: "none" };

/** One line the picker offers. */
export type MeetingOption = {
  choice: MeetingChoice;
  title: string;
  detail: string;
  /** Shown but not picked: minutes this member can't read already hold it. */
  disabled?: boolean;
  /** Minutes this member can open already hold it: a tap opens them. */
  opens?: string;
};

/** How far back Change looks for the meeting, and how many it lists. */
const RECENT_DAYS = 14;
const MAX_OPTIONS = 6;

export const MEETING_START_COPY = {
  record: "Record",
  typeInstead: "Type notes instead",
  newHeading: MINUTES_START_COPY.heading,
  change: "Change",
  pickHeading: MINUTES_START_COPY.pick,
  onNow: MINUTES_START_COPY.onNow,
  hasMinutes: MINUTES_START_COPY.hasMinutes,
  openMinutes: MEETING_ENTRY_COPY.open,
  noneTitle: MINUTES_START_COPY.noMeeting,
  noneDetail: MINUTES_START_COPY.noMeetingDetail,
  readFailed:
    "Couldn't read the calendar, so Frapp can't tell which meeting this is. Check the connection and try again.",
  start: "Write minutes",
  yours: "Your draft",
  hasRecording: (name: string) =>
    `${name} already has a recording, so its minutes are open as they are.`,
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
   * What the + picks by itself: the meeting on now, or No meeting when
   * nothing is on or the meeting on now already has someone else's minutes.
   */
  picked: MeetingChoice;
  /** The meeting on now, when its minutes are someone else's (or posted). */
  taken: EventRow | null;
  /**
   * What Change lists: the meeting on now (as Has minutes when `taken`),
   * the recent ones, and No meeting.
   */
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
  // Minutes this member can open but didn't write as a draft (posted, or
  // another officer's draft a `meetings:edit` holder reads): Open minutes,
  // as on the web. `refused` ones can't be read at all: Has minutes.
  const readableFor = new Map<string, string>();
  for (const meeting of meetings) {
    if (meeting.event_id && !ownDraftFor.has(meeting.event_id)) {
      readableFor.set(meeting.event_id, meeting.id);
    }
  }
  const taken = new Set([...refused, ...readableFor.keys()]);
  const inRoom = meetingInTheRoom(events, at);
  const inRoomTaken = inRoom && taken.has(inRoom.id) ? inRoom : null;
  const free = inRoom && !inRoomTaken ? inRoom : null;
  const recent = events
    .filter((event) => {
      // A hearing has no minutes in Frapp (§ Standards meetings): never here.
      if (refused.has(event.id) || looksLikeHearing(event.name)) return false;
      const start = Date.parse(event.start_time);
      if (Number.isNaN(start)) return false;
      return (
        meetingIsOn(event, at) ||
        (start <= at && at - start <= RECENT_DAYS * 86_400_000)
      );
    })
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const first = inRoom && (free || inRoomTaken) ? inRoom : null;
  const listed = first
    ? [first, ...recent.filter((event) => event.id !== first.id)]
    : recent;
  const options: MeetingOption[] = listed
    .slice(0, MAX_OPTIONS)
    .map((event): MeetingOption => {
      const opens = readableFor.get(event.id);
      const blocked = refused.has(event.id);
      return {
        choice: { kind: "event", event },
        title: event.name,
        detail: [
          event.id === inRoom?.id
            ? MEETING_START_COPY.onNow
            : meetingWhenLabel(event.start_time, now),
          ownDraftFor.has(event.id) ? MEETING_START_COPY.yours : null,
          opens
            ? MEETING_START_COPY.openMinutes
            : blocked
              ? MEETING_START_COPY.hasMinutes
              : null,
        ]
          .filter(Boolean)
          .join(" · "),
        ...(opens ? { opens } : {}),
        ...(blocked ? { disabled: true } : {}),
      };
    });
  options.push({
    choice: { kind: "none" },
    title: MEETING_START_COPY.noneTitle,
    detail: MEETING_START_COPY.noneDetail,
  });
  return {
    picked: free ? { kind: "event", event: free } : { kind: "none" },
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
  if (choice.kind === "none") {
    return {
      title: MEETING_START_COPY.noneTitle,
      detail: MEETING_START_COPY.noneDetail,
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
            : // Neither an event nor a new one: the minutes start unlinked.
              await mutateAsync({ meeting_type: "other" });
        return {
          id: meeting.id,
          eventName:
            choice.kind === "event"
              ? choice.event.name
              : MINUTES_WITHOUT_MEETING_NAME,
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
