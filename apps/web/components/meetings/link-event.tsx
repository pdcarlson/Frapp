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
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import { localIso } from "@/components/meetings/start-minutes-panel";
import {
  MinutesAudienceField,
  type MinutesAudience,
} from "@/components/meetings/minutes-audience";

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
  const [name, setName] = useState(meetingName);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("20:00");
  const [audience, setAudience] = useState<MinutesAudience>("everyone");
  const [roleIds, setRoleIds] = useState<string[]>([]);
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
    const start = localIso(date, startTime);
    const end = localIso(date, endTime);
    if (
      !name.trim() ||
      !start ||
      !end ||
      Date.parse(end) <= Date.parse(start)
    ) {
      setProblem("Give the meeting a name, a day, and an end after its start.");
      return;
    }
    if (audience === "roles" && roleIds.length === 0) {
      setProblem("Pick at least one role, or choose Everyone.");
      return;
    }
    void submit({
      new_event: {
        name: name.trim(),
        start_time: start,
        end_time: end,
        role_ids: audience === "roles" ? roleIds : [],
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
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-name`}>Meeting name</Label>
                <Input
                  id={`${ids}-name`}
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-date`}>Day</Label>
                <DateField
                  id={`${ids}-date`}
                  lean="back"
                  placeholder="e.g. last Sunday"
                  value={date}
                  onChange={setDate}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid min-w-0 gap-1">
                  <Label htmlFor={`${ids}-start`}>Started</Label>
                  <Input
                    id={`${ids}-start`}
                    type="time"
                    step={300}
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                  />
                </div>
                <div className="grid min-w-0 gap-1">
                  <Label htmlFor={`${ids}-end`}>Ended</Label>
                  <Input
                    id={`${ids}-end`}
                    type="time"
                    step={300}
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                  />
                </div>
              </div>
              <MinutesAudienceField
                audience={audience}
                onAudienceChange={setAudience}
                roleIds={roleIds}
                onRoleIdsChange={setRoleIds}
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
