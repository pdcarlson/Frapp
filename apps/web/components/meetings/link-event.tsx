"use client";

import { useId, useMemo, useState } from "react";
import { codeOf } from "@repo/api-sdk";
import { useEvents, useLinkMeetingEvent, useMeetings } from "@repo/hooks";
import {
  MEETING_ENTRY_COPY,
  MEETING_NOTE_TAKERS_COPY,
  meetingWhenLabel,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import {
  DEFAULT_MEETING_NAME,
  OffCalendarMeetingFields,
  offCalendarSpan,
  type OffCalendarMeeting,
} from "@/components/meetings/off-calendar-meeting";

/** How far back the picker looks for the meeting's event. */
const RECENT_DAYS = 60;

type EventRow = { id: string; name: string; start_time: string };

/**
 * Minutes whose event was deleted (`spec/behavior/meetings.md` § Who can read
 * minutes, #4935): only editors read them until they are linked again. Pick
 * the meeting's event from the recent ones without minutes, or make the
 * quiet after-the-fact event, as starting minutes does.
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
    name: meetingName,
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
    const span = offCalendarSpan(
      meeting,
      asArray<EventRow>(eventsQuery.data),
      new Date(),
    );
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
      className="space-y-3 rounded-lg border border-warning/30 bg-warning-tint p-4"
    >
      <p id={`${ids}-heading`} className="text-sm">
        {MEETING_NOTE_TAKERS_COPY.noEvent}
      </p>
      {!open ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {MEETING_NOTE_TAKERS_COPY.linkEvent}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">
              {MEETING_NOTE_TAKERS_COPY.linkPick}
            </h3>
            <p className="text-caption text-muted-foreground">
              {MEETING_NOTE_TAKERS_COPY.linkHint}
            </p>
          </div>
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
      )}
    </section>
  );
}
