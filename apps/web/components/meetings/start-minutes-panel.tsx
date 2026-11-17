"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { localIsoDate } from "@repo/formatting";
import { codeOf } from "@repo/api-sdk";
import {
  useEvents,
  useMeetings,
  useMyPermissions,
  useStartMeeting,
} from "@repo/hooks";
import {
  MEETING_OTHER_LABEL_MAX_LENGTH,
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  STANDARDS_MEETING_NOTE,
  can,
  likelyMeeting,
  DEFAULT_MEETING_NAME,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  readKeptDraft,
  useKeptDraftKeys,
  useKeptFormDraft,
} from "@repo/hooks/kept-drafts";
import {
  InlineChange,
  OffCalendarMeetingFields,
  QuietLine,
  offCalendarSpan,
  type OffCalendarMeeting,
} from "@/components/meetings/off-calendar-meeting";
import { KeptDraftNote } from "@/components/shared/kept-draft-note";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import {
  guessMeetingType,
  meetingHref,
  meetingWhenLabel,
} from "@/components/meetings/meeting-copy";

/**
 * How far back the event list reaches: through a semester, so backlogging
 * last month's minutes still starts from the calendar (#5219).
 */
const RECENT_DAYS = 120;
/** And forward: minutes started at the top of a meeting that hasn't begun. */
const AHEAD_HOURS = 24;
/** Rows shown before "Show older meetings". */
const FIRST_ROWS = 5;

type EventRow = {
  id: string;
  name: string;
  start_time: string;
  end_time?: string | null;
  check_in_opens_minutes?: number | null;
};
type Source = { kind: "event"; id: string } | { kind: "new" };

/** The kept draft's name (`@repo/hooks/kept-drafts`, #4593). */
export const MINUTES_DRAFT = "minutes-start";

/** What the form keeps when the officer leaves it before starting. */
type MinutesDraft = {
  /** What the officer picked; null follows the panel's own pick. */
  source: Source | null;
  /** The type the officer chose; null follows the guess from the name. */
  type: MeetingType | null;
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
    type: null,
    otherLabel: "",
    name: "",
    date: localIsoDate(new Date()),
    startTime: "",
    endTime: "",
    audience: "everyone",
    roleIds: [],
  };
}

/**
 * Start minutes (`spec/behavior/meetings.md` § Writing minutes by hand): pick the
 * meeting from the calendar, the way Granola and Otter attach a note to the
 * calendar event it was taken in, or name one that never made it onto the
 * calendar. One question at a time (#5219): the likely meeting comes picked,
 * the type is guessed from its name and stated in one line, and a meeting off
 * the calendar asks only its name and day. It opens docked in
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
  const permissions = useMyPermissions().data?.permissions ?? [];
  // Starting minutes is enough to make the quiet after-the-fact event
  // (#4935): it requires nobody, earns no points and pushes nothing.
  const canCreateEvents =
    can("events:create", permissions) || can("meetings:record", permissions);
  const start = useStartMeeting();

  const [now] = useState(() => Date.now());
  const allEvents = useMemo(
    () => asArray<EventRow>(eventsQuery.data).filter((event) => !!event?.id),
    [eventsQuery.data],
  );
  const recent = useMemo<EventRow[]>(() => {
    const from = now - RECENT_DAYS * 86_400_000;
    const to = now + AHEAD_HOURS * 3_600_000;
    return allEvents
      .filter((event) => {
        const at = Date.parse(event.start_time ?? "");
        return at >= from && at <= to;
      })
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  }, [allEvents, now]);
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
  const initial = kept ?? freshMinutesDraft();
  const [chosen, setChosen] = useState<Source | null>(initial.source);
  const [typeChoice, setTypeChoice] = useState<MeetingType | null>(
    initial.type,
  );
  const [otherLabel, setOtherLabel] = useState(initial.otherLabel);
  const [meeting, setMeeting] = useState<OffCalendarMeeting>({
    name: initial.name,
    date: initial.date,
    startTime: initial.startTime,
    endTime: initial.endTime,
    audience: initial.audience,
    roleIds: initial.roleIds,
  });
  const [changingType, setChangingType] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const draft = useKeptFormDraft<MinutesDraft>(
    MINUTES_DRAFT,
    true,
    { source: chosen, type: typeChoice, otherLabel, ...meeting },
    { restoredAtMount: kept !== undefined },
  );
  // A start that lands after the officer left the page doesn't pull them to
  // the new minutes: they are somewhere else now.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /*
    One question at a time (#5219): the panel opens on the meeting that is on
    now, or the newest one without minutes, already picked, so a calendar
    meeting is one press of Start minutes. With nothing on the calendar it
    opens straight on the meeting's name. The officer's own pick wins, and
    the panel's pick isn't kept as a draft: an untouched form keeps nothing.
  */
  // Events the server said already have minutes this viewer can't see (an
  // officer's unposted draft): the panel's pick moves past them.
  const [taken, setTaken] = useState<string[]>([]);
  const autoSource = useMemo<Source | null>(() => {
    // Without the minutes list it can't tell which meetings have them.
    if (eventsQuery.isPending || meetingsQuery.isPending) return null;
    if (meetingsQuery.isError) return null;
    const likely = likelyMeeting(
      recent,
      new Set([...started.keys(), ...taken]),
      now,
    );
    if (likely) return { kind: "event", id: likely.id };
    return recent.length === 0 && canCreateEvents ? { kind: "new" } : null;
  }, [
    eventsQuery.isPending,
    meetingsQuery.isPending,
    meetingsQuery.isError,
    recent,
    started,
    taken,
    now,
    canCreateEvents,
  ]);
  // Back to the list from the meeting's name: nothing picked, and the
  // panel's own pick stays out of it.
  const source =
    chosen?.kind === "event" && !chosen.id ? null : (chosen ?? autoSource);
  const sourceName =
    source?.kind === "event"
      ? (recent.find((event) => event.id === source.id)?.name ?? "")
      : meeting.name;
  const type = typeChoice ?? guessMeetingType(sourceName);

  function fill(next: MinutesDraft) {
    setChosen(next.source);
    setTypeChoice(next.type);
    setOtherLabel(next.otherLabel);
    setMeeting({
      name: next.name,
      date: next.date,
      startTime: next.startTime,
      endTime: next.endTime,
      audience: next.audience,
      roleIds: next.roleIds,
    });
  }
  function discard() {
    draft.discard();
    setProblems({});
    fill(freshMinutesDraft());
  }
  const [problems, setProblems] = useState<Record<string, string>>({});

  function pickEvent(event: EventRow) {
    const existing = started.get(event.id);
    if (existing) {
      // Their minutes are what the officer came for; nothing to keep.
      draft.drop();
      onDone();
      router.push(meetingHref(existing));
      return;
    }
    setChosen({ kind: "event", id: event.id });
    setTypeChoice(null);
    setProblems({});
  }

  type Span = { start_time: string; end_time: string };
  function validate(): { found: Record<string, string>; span: Span | null } {
    const found: Record<string, string> = {};
    let span: Span | null = null;
    if (!source) found.source = "Pick the meeting these minutes are for.";
    if (source?.kind === "new") {
      const result = offCalendarSpan(meeting, allEvents, new Date());
      if ("problem" in result) found[result.field] = result.problem;
      else span = result;
      if (meeting.audience === "roles" && meeting.roleIds.length === 0) {
        found.roles = "Pick at least one role, or choose Everyone.";
      }
    }
    return { found, span };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const { found, span } = validate();
    setProblems(found);
    if (Object.keys(found).length > 0 || !source) return;
    // Out of the store while it runs: coming back mid-start must not offer
    // the same minutes to start twice.
    draft.hold();
    try {
      const result = await start.mutateAsync({
        meeting_type: type,
        other_label:
          type === "other" && otherLabel.trim() ? otherLabel.trim() : null,
        ...(source.kind === "event"
          ? { event_id: source.id }
          : {
              new_event: {
                name: meeting.name.trim() || DEFAULT_MEETING_NAME,
                ...span!,
                role_ids: meeting.audience === "roles" ? meeting.roleIds : [],
              },
            }),
      });
      draft.drop();
      if (!mounted.current) return;
      onDone();
      router.push(meetingHref(result.id));
    } catch (error) {
      draft.release();
      if (codeOf(error) === "meeting.already_started") {
        // Someone started them while this panel was open. The list refetches
        // with them in it when the viewer may read them.
        void meetingsQuery.refetch();
        if (source.kind === "event") {
          const id = source.id;
          setTaken((before) => [...before, id]);
          if (chosen?.kind === "event") setChosen(null);
        }
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
  const typeName =
    type === "other" && otherLabel.trim()
      ? otherLabel.trim()
      : MEETING_TYPE_LABELS[type];

  // The picked row always shows, even when it sits past the first few.
  const pickedId = source?.kind === "event" ? source.id : null;
  const shownEvents = showOlder
    ? recent
    : recent.filter(
        (event, index) => index < FIRST_ROWS || event.id === pickedId,
      );
  const hidden = recent.length - shownEvents.length;

  return (
    <>
      <PanelBody as="form" id={`${ids}-form`} onSubmit={submit} noValidate>
        <div className="grid gap-6">
          {source?.kind === "new" ? (
            <section aria-label="The meeting" className="grid gap-4">
              {recent.length > 0 ? (
                <QuietLine
                  onClick={() => {
                    setChosen({ kind: "event", id: "" });
                    setProblems({});
                  }}
                >
                  Pick it from the calendar instead
                </QuietLine>
              ) : null}
              <OffCalendarMeetingFields
                value={meeting}
                onChange={setMeeting}
                problems={problems}
                autoFocus={kept === undefined}
              />
            </section>
          ) : (
            <section aria-labelledby={`${ids}-which`} className="grid gap-2">
              <h3 id={`${ids}-which`} className="text-sm font-semibold">
                Which meeting?
              </h3>
              {eventsQuery.isPending ? (
                <p className="text-sm text-muted-foreground">Loading events</p>
              ) : recent.length === 0 ? (
                <InlineNote>No events on the calendar lately.</InlineNote>
              ) : (
                <ul role="list" className="grid gap-0.5">
                  {shownEvents.map((event) => {
                    const held = pickedId === event.id;
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
              {hidden > 0 ? (
                <QuietLine onClick={() => setShowOlder(true)}>
                  Show older meetings
                </QuietLine>
              ) : null}
              {canCreateEvents ? (
                <QuietLine
                  onClick={() => {
                    setChosen({ kind: "new" });
                    setProblems({});
                  }}
                >
                  It isn&apos;t on the calendar
                </QuietLine>
              ) : null}
              {problems.source ? (
                <FieldError>{problems.source}</FieldError>
              ) : null}
            </section>
          )}

          {source ? (
            <section aria-labelledby={`${ids}-type`} className="grid gap-2">
              {changingType ? (
                <>
                  <h3 id={`${ids}-type`} className="text-sm font-semibold">
                    Type
                  </h3>
                  <SegmentedChoice
                    label="Meeting type"
                    value={type}
                    onChange={setTypeChoice}
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
                </>
              ) : (
                <p id={`${ids}-type`} className="text-sm text-muted-foreground">
                  Filed as {typeName}.{" "}
                  <InlineChange onClick={() => setChangingType(true)} />
                </p>
              )}
            </section>
          ) : null}
        </div>
      </PanelBody>
      <PanelFooter>
        {draft.restored ? <KeptDraftNote onDiscard={discard} /> : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            draft.drop();
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
