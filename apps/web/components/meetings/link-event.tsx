"use client";

import { useId, useMemo, useState } from "react";
import { codeOf } from "@repo/api-sdk";
import { useEvents, useLinkMeetingEvent, useMeetings } from "@repo/hooks";
import {
  DEFAULT_MEETING_NAME,
  MEETING_ENTRY_COPY,
  MINUTES_WITHOUT_MEETING_NAME,
  MEETING_NOTE_TAKERS_COPY,
  meetingWhenLabel,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import {
  OffCalendarMeetingFields,
  offCalendarSpan,
  type OffCalendarMeeting,
} from "@/components/meetings/off-calendar-meeting";

/** How far back the picker looks for the meeting's event. */
const RECENT_DAYS = 60;

type EventRow = { id: string; name: string; start_time: string };

/**
 * Minutes with no meeting (`spec/behavior/meetings.md` § Linking a meeting
 * later): started with none, or whose event was deleted. Only their author
 * and editors read them, and they can't be posted, until they are linked.
 * Pick the meeting from the recent ones without minutes, or add it to the
 * calendar as the quiet after-the-fact event. A state row with its action,
 * never a paragraph (Paul, 2026-11-20: indicate, don't narrate).
 */
export function LinkEventPanel({
  meetingId,
  meetingName,
  onLinked,
}: {
  meetingId: string;
  meetingName: string;
  onLinked: () => void;
}) {
  const ids = useId();
  const eventsQuery = useEvents();
  const meetingsQuery = useMeetings();
  const link = useLinkMeetingEvent();
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const [meeting, setMeeting] = useState<OffCalendarMeeting>({
    // Minutes started with no meeting go by a placeholder, which is no
    // meeting's name: blank, so it is made as "Chapter meeting".
    name: meetingName === MINUTES_WITHOUT_MEETING_NAME ? "" : meetingName,
    date: "",
    startTime: "",
    endTime: "",
    audience: "everyone",
    roleIds: [],
  });
  const [problem, setProblem] = useState<string | null>(null);

  const [now] = useState(() => Date.now());
  const recent = useMemo(() => {
    const withMinutes = new Set(
      (meetingsQuery.data ?? []).flatMap((m) =>
        m.event_id ? [m.event_id] : [],
      ),
    );
    const from = now - RECENT_DAYS * 86_400_000;
    return asArray<EventRow>(eventsQuery.data)
      .filter((event) => {
        const at = Date.parse(event?.start_time ?? "");
        return (
          !!event?.id && at >= from && at <= now && !withMinutes.has(event.id)
        );
      })
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  }, [eventsQuery.data, meetingsQuery.data, now]);

  async function submit(body: Parameters<typeof link.mutateAsync>[0]["body"]) {
    setProblem(null);
    try {
      await link.mutateAsync({ id: meetingId, body });
      onLinked();
    } catch (error) {
      setProblem(
        codeOf(error) === "meeting.already_started"
          ? MEETING_ENTRY_COPY.alreadyStartedBody
          : getErrorMessage(error, MEETING_NOTE_TAKERS_COPY.linkFailed),
      );
    }
  }

  function makeIt() {
    const span = offCalendarSpan(meeting, asArray<EventRow>(eventsQuery.data));
    if ("problem" in span) {
      setProblem(span.problem);
      return;
    }
    if (meeting.audience === "roles" && meeting.roleIds.length === 0) {
      setProblem("Pick at least one role, or choose Everyone.");
      return;
    }
    void submit({
      new_event: {
        name: meeting.name.trim() || DEFAULT_MEETING_NAME,
        ...span,
        role_ids: meeting.audience === "roles" ? meeting.roleIds : [],
      },
    });
  }

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center gap-3">
        <p
          id={`${ids}-heading`}
          className="min-w-0 flex-1 text-sm font-semibold"
        >
          {MEETING_NOTE_TAKERS_COPY.noEvent}
        </p>
        {!open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            {MEETING_NOTE_TAKERS_COPY.linkEvent}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            {MEETING_NOTE_TAKERS_COPY.linkPick}
          </h3>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {MEETING_NOTE_TAKERS_COPY.linkNone}
            </p>
          ) : (
            <ul role="list" className="space-y-1">
              {recent.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    disabled={link.isPending}
                    onClick={() => void submit({ event_id: event.id })}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start rounded-md px-3 py-2 text-left transition-colors hover:bg-card-hover",
                      FOCUS_RING_OFFSET,
                    )}
                  >
                    <span className="text-sm font-semibold">{event.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {meetingWhenLabel(event.start_time)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!making ? (
            <Button size="sm" variant="ghost" onClick={() => setMaking(true)}>
              {MEETING_NOTE_TAKERS_COPY.linkMake}
            </Button>
          ) : (
            <div className="grid gap-3">
              <OffCalendarMeetingFields
                value={meeting}
                onChange={setMeeting}
                problems={{}}
              />
              <div>
                <Button size="sm" disabled={link.isPending} onClick={makeIt}>
                  {MEETING_NOTE_TAKERS_COPY.linkEvent}
                </Button>
              </div>
            </div>
          )}
          {problem ? (
            <p role="alert" className="text-sm text-destructive-text">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
