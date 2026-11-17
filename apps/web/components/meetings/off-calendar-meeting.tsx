"use client";

import { useId, useState } from "react";
import {
  addMinutesToTime,
  localClock,
  localIsoDate,
  timeSpanMinutes,
} from "@repo/formatting";
import { FieldError } from "@/components/shared/short-form";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeField } from "@/components/ui/time-field";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  MinutesAudienceField,
  type MinutesAudience,
} from "@/components/meetings/minutes-audience";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MEETING_NAME,
  NEW_MEETING_MINUTES,
  meetingStartingNow,
} from "@repo/validation";

/** What a meeting with no event needs before its quiet event can be made. */
export type OffCalendarMeeting = {
  name: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`, or `""`: the times are optional (#5219). */
  startTime: string;
  endTime: string;
  audience: MinutesAudience;
  roleIds: string[];
};

/** The start a past day takes when no earlier event of that name has one. */
const EVENING_START = "19:00";
/** The longest a meeting runs; the end field lists no further (`TimeField`). */
const MAX_LENGTH_MINUTES = 12 * 60;

type EventTimes = { name: string; start_time: string };

/** A local `YYYY-MM-DD` and `HH:MM` as an instant, or null. */
function localIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const at = new Date(`${date}T${time}`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * The quiet event's start and end (`spec/behavior/meetings.md` § Writing
 * minutes by hand, #5219). Only the day is asked for: the event earns no
 * points and requires nobody, so its times feed nothing but the check-in
 * window, which only matters while the meeting is on. With no start typed, a
 * meeting today starts now (so members can check in while it runs), and an
 * earlier day takes the time the chapter's last event of the same name
 * started, or 7 PM. With no end, it runs an hour. An end earlier on the
 * clock than the start ran past midnight, up to {@link MAX_LENGTH_MINUTES}.
 *
 * `live: false` is for minutes already written (Link an event): their
 * meeting is over, so today is read like any other day, not as starting now.
 */
export function offCalendarSpan(
  meeting: Pick<OffCalendarMeeting, "name" | "date" | "startTime" | "endTime">,
  events: EventTimes[],
  now: Date,
  { live = true }: { live?: boolean } = {},
):
  | { start_time: string; end_time: string }
  | { problem: string; field: "date" | "time" } {
  if (!meeting.date) {
    return {
      problem: "Add the day it met, like Tuesday or Nov 4.",
      field: "date",
    };
  }
  if (meeting.endTime && !meeting.startTime) {
    return {
      problem: "Add when it started too, or clear the end.",
      field: "time",
    };
  }
  const start =
    meeting.startTime ||
    (live && meeting.date === localIsoDate(now)
      ? localClock(new Date(meetingStartingNow(now).start_time))
      : (lastStartOf(meeting.name, events) ?? EVENING_START));
  const startIso = localIso(meeting.date, start);
  if (!startIso) {
    return {
      problem: "Add the day it met, like Tuesday or Nov 4.",
      field: "date",
    };
  }
  let length = NEW_MEETING_MINUTES;
  if (meeting.endTime) {
    // 9 PM to 12:30 AM ran past midnight.
    length = timeSpanMinutes(start, meeting.endTime);
    if (length <= 0 || length > MAX_LENGTH_MINUTES) {
      return { problem: "It has to end after it starts.", field: "time" };
    }
  }
  const end = new Date(Date.parse(startIso) + length * 60_000).toISOString();
  return { start_time: startIso, end_time: end };
}

/** When the newest event called `name` started, as `HH:MM` where the reader is. */
function lastStartOf(name: string, events: EventTimes[]): string | null {
  const wanted = (name.trim() || DEFAULT_MEETING_NAME).toLowerCase();
  let newest: Date | null = null;
  for (const event of events) {
    if (event?.name?.trim().toLowerCase() !== wanted) continue;
    const at = new Date(event.start_time);
    if (Number.isNaN(at.getTime())) continue;
    if (!newest || at > newest) newest = at;
  }
  return newest ? localClock(newest) : null;
}

/**
 * The questions a meeting off the calendar asks, in the order an officer
 * backlogging it thinks of them: what it was called, then which day. The
 * times wait behind "Add times", and who reads the minutes is one line
 * (Everyone) until changed. Starting minutes and Link an event (#4935) both
 * use it.
 */
export function OffCalendarMeetingFields({
  value,
  onChange,
  problems,
  onNameBlur,
  autoFocus,
}: {
  value: OffCalendarMeeting;
  onChange: (next: OffCalendarMeeting) => void;
  problems: { name?: string; date?: string; time?: string; roles?: string };
  onNameBlur?: () => void;
  autoFocus?: boolean;
}) {
  const ids = useId();
  const [showTimes, setShowTimes] = useState(
    () => !!(value.startTime || value.endTime),
  );
  const [showAudience, setShowAudience] = useState(
    () => value.audience === "roles",
  );
  const set = (patch: Partial<OffCalendarMeeting>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <Label htmlFor={`${ids}-name`}>What was the meeting called?</Label>
        <Input
          id={`${ids}-name`}
          value={value.name}
          maxLength={200}
          placeholder={DEFAULT_MEETING_NAME}
          autoFocus={autoFocus}
          aria-invalid={problems.name ? true : undefined}
          onChange={(event) => set({ name: event.target.value })}
          onBlur={onNameBlur}
        />
        {problems.name ? <FieldError>{problems.name}</FieldError> : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${ids}-date`}>When did it meet?</Label>
        <DateField
          id={`${ids}-date`}
          lean="back"
          placeholder="e.g. last Sunday"
          value={value.date}
          aria-invalid={problems.date ? true : undefined}
          onChange={(date) => set({ date })}
        />
        {problems.date ? <FieldError>{problems.date}</FieldError> : null}
      </div>
      {showTimes ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid min-w-0 gap-1">
            <Label htmlFor={`${ids}-start`}>Started</Label>
            <TimeField
              id={`${ids}-start`}
              value={value.startTime}
              aria-invalid={problems.time ? true : undefined}
              onChange={(startTime) => {
                // The end keeps its length when the start moves, as a
                // calendar's does; a first start fills an hour's end.
                const length =
                  value.startTime && value.endTime
                    ? timeSpanMinutes(value.startTime, value.endTime)
                    : NEW_MEETING_MINUTES;
                set({
                  startTime,
                  endTime:
                    startTime && length > 0
                      ? addMinutesToTime(startTime, length)
                      : value.endTime,
                });
              }}
            />
          </div>
          <div className="grid min-w-0 gap-1">
            <Label htmlFor={`${ids}-end`}>Ended</Label>
            <TimeField
              id={`${ids}-end`}
              value={value.endTime}
              anchor={value.startTime || undefined}
              from={value.startTime || undefined}
              span={MAX_LENGTH_MINUTES}
              placeholder="8 PM"
              aria-invalid={problems.time ? true : undefined}
              onChange={(endTime) => set({ endTime })}
            />
          </div>
          {problems.time ? (
            <div className="col-span-2">
              <FieldError>{problems.time}</FieldError>
            </div>
          ) : null}
        </div>
      ) : (
        <QuietLine onClick={() => setShowTimes(true)}>
          Add times <span className="text-muted-foreground">(optional)</span>
        </QuietLine>
      )}
      {problems.time && !showTimes ? (
        <FieldError>{problems.time}</FieldError>
      ) : null}
      {showAudience ? (
        <MinutesAudienceField
          audience={value.audience}
          onAudienceChange={(audience) => set({ audience })}
          roleIds={value.roleIds}
          onRoleIdsChange={(roleIds) => set({ roleIds })}
          error={problems.roles}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Everyone in the chapter reads these.{" "}
          <InlineChange onClick={() => setShowAudience(true)} />
        </p>
      )}
    </div>
  );
}

/** A quiet row that opens something optional, like "Add subtasks". */
export function QuietLine({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-9 items-center justify-self-start rounded-md px-1 text-sm font-medium text-accent-text transition-colors hover:text-foreground",
        FOCUS_RING,
      )}
    >
      {children}
    </button>
  );
}

/** The "Change" after a line that states a default. */
export function InlineChange({
  onClick,
  label = "Change",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm font-medium text-accent-text underline-offset-2 hover:underline",
        FOCUS_RING,
      )}
    >
      {label}
    </button>
  );
}
