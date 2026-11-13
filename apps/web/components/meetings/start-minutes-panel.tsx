"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { codeOf } from "@repo/api-sdk";
import {
  useEvents,
  useMeetings,
  useMyPermissions,
  useRoles,
  useStartMeeting,
} from "@repo/hooks";
import {
  MEETING_OTHER_LABEL_MAX_LENGTH,
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  STANDARDS_MEETING_NOTE,
  can,
  type MeetingType,
} from "@repo/validation";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import { FieldError } from "@/components/shared/short-form";
import { InlineNote } from "@/components/shared/inline-note";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { dashboardTableCheckboxClassName } from "@/components/shared/table-controls";
import { toRoleOptions } from "@repo/hooks/chapter-roles";
import {
  dropKeptDraft,
  readKeptDraft,
  useKeptDraftKeys,
  writeKeptDraft,
} from "@repo/hooks/kept-drafts";
import { KeptDraftNote } from "@/components/shared/kept-draft-note";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import {
  guessMeetingType,
  meetingHref,
  meetingWhenLabel,
} from "@/components/meetings/meeting-copy";

/** How far back the event list reaches: a meeting written up within the month. */
const RECENT_DAYS = 30;
/** And forward: minutes started at the top of a meeting that hasn't begun. */
const AHEAD_HOURS = 24;
/** Past this many roles the audience list gets a filter (a chapter can hold 100). */
const ROLE_FILTER_AT = 8;

type EventRow = { id: string; name: string; start_time: string };
type Source = { kind: "event"; id: string } | { kind: "new" };

/** The kept draft's name (`@repo/hooks/kept-drafts`, #4593). */
export const MINUTES_DRAFT = "minutes-start";

/** What the form keeps when the officer leaves it before starting. */
type MinutesDraft = {
  source: Source | null;
  type: MeetingType;
  otherLabel: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  audience: "everyone" | "roles";
  roleIds: string[];
};

function freshMinutesDraft(): MinutesDraft {
  return {
    source: null,
    type: "chapter",
    otherLabel: "",
    name: "",
    date: todayInput(),
    startTime: "",
    endTime: "",
    audience: "everyone",
    roleIds: [],
  };
}

function todayInput(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A local `YYYY-MM-DD` and `HH:MM` as an instant, or null. */
function localIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const at = new Date(`${date}T${time}`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Start minutes (`spec/behavior/meetings.md` § Writing minutes): pick the
 * meeting from the calendar, the way Granola and Otter attach a note to the
 * calendar event it was taken in, or name one that never made it onto the
 * calendar. Then the type, which the event's name guesses. It opens docked in
 * place of the Meetings page, chat staying beside it (2026-11-12, #4593).
 */
export function StartMinutesPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      docked
      backLabel="Back to meetings"
    >
      <PanelContent aria-describedby={undefined}>
        <PanelHeader>New minutes</PanelHeader>
        {open ? <StartMinutesForm onDone={() => onOpenChange(false)} /> : null}
      </PanelContent>
    </Panel>
  );
}

function StartMinutesForm({ onDone }: { onDone: () => void }) {
  const ids = useId();
  const router = useRouter();
  const { toast } = useToast();
  const eventsQuery = useEvents();
  const meetingsQuery = useMeetings();
  const rolesQuery = useRoles();
  const permissions = useMyPermissions().data?.permissions ?? [];
  const canCreateEvents = can("events:create", permissions);
  const start = useStartMeeting();

  const [now] = useState(() => Date.now());
  const recent = useMemo<EventRow[]>(() => {
    const from = now - RECENT_DAYS * 86_400_000;
    const to = now + AHEAD_HOURS * 3_600_000;
    return asArray<EventRow>(eventsQuery.data)
      .filter((event) => {
        const at = Date.parse(event?.start_time ?? "");
        return !!event?.id && at >= from && at <= to;
      })
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  }, [eventsQuery.data, now]);
  /** Events whose minutes the viewer can already open. */
  const started = useMemo(() => {
    const byEvent = new Map<string, string>();
    for (const meeting of meetingsQuery.data ?? []) {
      if (meeting.event_id) byEvent.set(meeting.event_id, meeting.id);
    }
    return byEvent;
  }, [meetingsQuery.data]);

  /*
    Kept when the officer goes back or leaves the page before starting
    (#4593): the form mounts on what it held, and Meetings reopens it on
    return when it was left open. Cancel, Discard and a start drop it.
  */
  const draftKey = useKeptDraftKeys().draft(MINUTES_DRAFT);
  const [kept] = useState(() => readKeptDraft<MinutesDraft>(draftKey));
  const [restored, setRestored] = useState(kept !== undefined);
  const initial = kept ?? freshMinutesDraft();
  const [source, setSource] = useState<Source | null>(initial.source);
  const [type, setType] = useState<MeetingType>(initial.type);
  const [otherLabel, setOtherLabel] = useState(initial.otherLabel);
  const [name, setName] = useState(initial.name);
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [audience, setAudience] = useState(initial.audience);
  const [roleIds, setRoleIds] = useState<string[]>(initial.roleIds);
  const [fresh] = useState(() => JSON.stringify(freshMinutesDraft()));
  const current: MinutesDraft = {
    source,
    type,
    otherLabel,
    name,
    date,
    startTime,
    endTime,
    audience,
    roleIds,
  };
  const currentJson = JSON.stringify(current);
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });
  // Kept once it differs from a fresh form (an opened, untouched form keeps
  // nothing), or always once it opened on a kept one.
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    writeKeptDraft(
      draftKey,
      restored || currentJson !== fresh ? latest.current : null,
    );
  }, [draftKey, currentJson, fresh, restored]);
  // A start that lands after the officer left the page doesn't pull them to
  // the new minutes: they are somewhere else now.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function fill(draft: MinutesDraft) {
    setSource(draft.source);
    setType(draft.type);
    setOtherLabel(draft.otherLabel);
    setName(draft.name);
    setDate(draft.date);
    setStartTime(draft.startTime);
    setEndTime(draft.endTime);
    setAudience(draft.audience);
    setRoleIds(draft.roleIds);
  }
  function discard() {
    dropKeptDraft(draftKey);
    setRestored(false);
    setProblems({});
    fill(freshMinutesDraft());
  }
  const [roleFilter, setRoleFilter] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});

  const roles = useMemo(
    () => toRoleOptions(rolesQuery.data),
    [rolesQuery.data],
  );
  const shownRoles = useMemo(() => {
    const term = roleFilter.trim().toLowerCase();
    return term
      ? roles.filter((role) => role.name.toLowerCase().includes(term))
      : roles;
  }, [roles, roleFilter]);

  function pickEvent(event: EventRow) {
    const existing = started.get(event.id);
    if (existing) {
      // Their minutes are what the officer came for; nothing to keep.
      done.current = true;
      dropKeptDraft(draftKey);
      onDone();
      router.push(meetingHref(existing));
      return;
    }
    setSource({ kind: "event", id: event.id });
    setType(guessMeetingType(event.name));
    setProblems({});
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!source) next.source = "Pick the meeting these minutes are for.";
    if (source?.kind === "new") {
      if (!name.trim()) next.name = "Name the meeting.";
      const from = localIso(date, startTime);
      const to = localIso(date, endTime);
      if (!date) next.date = "Add the day it met, like Tuesday or Nov 4.";
      else if (!from || !to) next.time = "Add when it started and ended.";
      else if (Date.parse(to) <= Date.parse(from)) {
        next.time = "It has to end after it starts.";
      }
      if (audience === "roles" && roleIds.length === 0) {
        next.roles = "Pick at least one role, or choose Everyone.";
      }
    }
    return next;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate();
    setProblems(found);
    if (Object.keys(found).length > 0 || !source) return;
    try {
      const meeting = await start.mutateAsync({
        meeting_type: type,
        other_label:
          type === "other" && otherLabel.trim() ? otherLabel.trim() : null,
        ...(source.kind === "event"
          ? { event_id: source.id }
          : {
              new_event: {
                name: name.trim(),
                start_time: localIso(date, startTime)!,
                end_time: localIso(date, endTime)!,
                role_ids: audience === "roles" ? roleIds : [],
              },
            }),
      });
      done.current = true;
      dropKeptDraft(draftKey);
      if (!mounted.current) return;
      onDone();
      router.push(meetingHref(meeting.id));
    } catch (error) {
      if (codeOf(error) === "meeting.already_started") {
        // Someone started them while this panel was open. The list refetches
        // with them in it when the viewer may read them.
        void meetingsQuery.refetch();
        toast({
          title: "These minutes are already started",
          description:
            "Someone else started minutes for this meeting. They show on Meetings once they are posted.",
        });
        return;
      }
      toast({
        title: "Couldn't start the minutes",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  const typeOptions = MEETING_TYPES.map((value) => ({
    value,
    label: MEETING_TYPE_LABELS[value],
  }));

  return (
    <>
      <PanelBody as="form" id={`${ids}-form`} onSubmit={submit} noValidate>
        <div className="grid gap-6">
          <section aria-labelledby={`${ids}-which`} className="grid gap-2">
            <h3 id={`${ids}-which`} className="text-sm font-semibold">
              Which meeting?
            </h3>
            {eventsQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Loading events</p>
            ) : recent.length === 0 ? (
              <InlineNote>No events in the last month.</InlineNote>
            ) : (
              <ul role="list" className="grid gap-0.5">
                {recent.map((event) => {
                  const held =
                    source?.kind === "event" && source.id === event.id;
                  const existing = started.has(event.id);
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        aria-pressed={held}
                        onClick={() => pickEvent(event)}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors",
                          held
                            ? "bg-accent-subtle text-accent-text"
                            : "hover:bg-card-hover",
                          FOCUS_RING_OFFSET,
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {event.name}
                          </span>
                          <span className="block text-caption text-muted-foreground">
                            {meetingWhenLabel(event.start_time)}
                          </span>
                        </span>
                        {existing ? (
                          <span className="shrink-0 text-caption text-muted-foreground">
                            Open minutes
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {canCreateEvents ? (
              <button
                type="button"
                aria-pressed={source?.kind === "new"}
                onClick={() => {
                  setSource({ kind: "new" });
                  setProblems({});
                }}
                className={cn(
                  "flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm font-semibold transition-colors",
                  source?.kind === "new"
                    ? "bg-accent-subtle text-accent-text"
                    : "hover:bg-card-hover",
                  FOCUS_RING_OFFSET,
                )}
              >
                It isn&apos;t on the calendar
              </button>
            ) : null}
            {problems.source ? (
              <FieldError>{problems.source}</FieldError>
            ) : null}
          </section>

          {source?.kind === "new" ? (
            <section aria-labelledby={`${ids}-new`} className="grid gap-3">
              <h3 id={`${ids}-new`} className="sr-only">
                The meeting
              </h3>
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-name`}>Meeting name</Label>
                <Input
                  id={`${ids}-name`}
                  value={name}
                  maxLength={200}
                  placeholder="Exec meeting"
                  aria-invalid={problems.name ? true : undefined}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => {
                    if (name.trim()) setType(guessMeetingType(name));
                  }}
                />
                {problems.name ? (
                  <FieldError>{problems.name}</FieldError>
                ) : null}
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-date`}>Date</Label>
                <DateField
                  id={`${ids}-date`}
                  lean="back"
                  placeholder="e.g. yesterday"
                  value={date}
                  aria-invalid={problems.date ? true : undefined}
                  onChange={setDate}
                />
                {problems.date ? (
                  <FieldError>{problems.date}</FieldError>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid min-w-0 gap-1">
                  <Label htmlFor={`${ids}-start`}>Started</Label>
                  <Input
                    id={`${ids}-start`}
                    type="time"
                    step={300}
                    value={startTime}
                    aria-invalid={problems.time ? true : undefined}
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
                    aria-invalid={problems.time ? true : undefined}
                    onChange={(event) => setEndTime(event.target.value)}
                  />
                </div>
                {problems.time ? (
                  <div className="col-span-2">
                    <FieldError>{problems.time}</FieldError>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label id={`${ids}-audience`}>Who reads the minutes</Label>
                <SegmentedChoice
                  label="Who reads the minutes"
                  value={audience}
                  onChange={setAudience}
                  options={[
                    { value: "everyone", label: "Everyone" },
                    { value: "roles", label: "Some roles" },
                  ]}
                />
                {audience === "roles" ? (
                  <div className="grid gap-2">
                    {roles.length > ROLE_FILTER_AT ? (
                      <Input
                        aria-label="Find a role"
                        placeholder="Find a role"
                        value={roleFilter}
                        onChange={(event) => setRoleFilter(event.target.value)}
                      />
                    ) : null}
                    <ul
                      role="list"
                      aria-labelledby={`${ids}-audience`}
                      className="grid max-h-56 gap-0.5 overflow-y-auto"
                    >
                      {shownRoles.map((role) => {
                        const checked = roleIds.includes(role.id);
                        return (
                          <li key={role.id}>
                            <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-card-hover pointer-coarse:min-h-11">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setRoleIds((current) =>
                                    checked
                                      ? current.filter((id) => id !== role.id)
                                      : [...current, role.id],
                                  )
                                }
                                className={dashboardTableCheckboxClassName}
                              />
                              <span className="truncate">{role.name}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    {problems.roles ? (
                      <FieldError>{problems.roles}</FieldError>
                    ) : null}
                  </div>
                ) : null}
                <p className="text-caption text-muted-foreground">
                  It goes on the calendar with nobody required, no points, and
                  no notification.
                </p>
              </div>
            </section>
          ) : null}

          <section aria-labelledby={`${ids}-type`} className="grid gap-2">
            <h3 id={`${ids}-type`} className="text-sm font-semibold">
              Type
            </h3>
            <SegmentedChoice
              label="Meeting type"
              value={type}
              onChange={setType}
              options={typeOptions}
              fill
            />
            {type === "other" ? (
              <div className="grid gap-1">
                <Label htmlFor={`${ids}-other`}>
                  What kind of meeting (optional)
                </Label>
                <Input
                  id={`${ids}-other`}
                  value={otherLabel}
                  maxLength={MEETING_OTHER_LABEL_MAX_LENGTH}
                  placeholder="Alumni board"
                  onChange={(event) => setOtherLabel(event.target.value)}
                />
              </div>
            ) : null}
            <p className="text-caption text-muted-foreground">
              {STANDARDS_MEETING_NOTE}
            </p>
          </section>
        </div>
      </PanelBody>
      <PanelFooter>
        {restored ? <KeptDraftNote onDiscard={discard} /> : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            done.current = true;
            dropKeptDraft(draftKey);
            onDone();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" form={`${ids}-form`} disabled={start.isPending}>
          Start minutes
        </Button>
      </PanelFooter>
    </>
  );
}
