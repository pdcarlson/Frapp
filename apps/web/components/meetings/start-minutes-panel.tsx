"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { codeOf } from "@repo/api-sdk";
import { useEvents, useMeetings, useStartMeeting } from "@repo/hooks";
import {
  MEETING_OTHER_LABEL_MAX_LENGTH,
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  MEETING_ENTRY_COPY,
  MINUTES_START_COPY,
  STANDARDS_MEETING_NOTE,
  likelyMeeting,
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
  QuietLine,
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
type Source = { kind: "event"; id: string } | { kind: "none" };

/** The kept draft's name (`@repo/hooks/kept-drafts`, #4593). */
export const MINUTES_DRAFT = "minutes-start";

/** What the form keeps when the officer leaves it before starting. */
type MinutesDraft = {
  /** What the officer picked; null follows the panel's own pick. */
  source: Source | null;
  /** The type the officer chose; null follows the guess from the name. */
  type: MeetingType | null;
  otherLabel: string;
};

function freshMinutesDraft(): MinutesDraft {
  return { source: null, type: null, otherLabel: "" };
}

/**
 * A kept draft from before No meeting (2026-11-20) may hold the retired
 * "new" pick, which named a meeting off the calendar: it reads as no pick.
 */
function keptSource(source: unknown): Source | null {
  if (!source || typeof source !== "object") return null;
  const kind = (source as { kind?: unknown }).kind;
  if (kind === "none") return { kind: "none" };
  const id = (source as { id?: unknown }).id;
  return kind === "event" && typeof id === "string" ? { kind, id } : null;
}

/**
 * Start minutes (`spec/behavior/meetings.md` § Writing minutes by hand): one
 * list of the calendar's meetings, the way Granola and Otter attach a note to
 * the event it was taken in, and No meeting to write now and link one later
 * (Paul, 2026-11-20). The likely meeting comes picked; with none likely, No
 * meeting does. Each row says where it stands and nothing more: no narration
 * (Paul, 2026-11-20). The type is guessed from the name and stated in one
 * line. It opens docked in place of the Meetings page, chat staying beside it
 * (2026-11-12, #4593).
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
        <PanelHeader>{MINUTES_START_COPY.heading}</PanelHeader>
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
  const start = useStartMeeting();

  const [now] = useState(() => Date.now());
  const recent = useMemo<EventRow[]>(() => {
    const from = now - RECENT_DAYS * 86_400_000;
    const to = now + AHEAD_HOURS * 3_600_000;
    return asArray<EventRow>(eventsQuery.data)
      .filter((event) => {
        if (!event?.id) return false;
        const at = Date.parse(event.start_time ?? "");
        return at >= from && at <= to;
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
  const initial = kept ?? freshMinutesDraft();
  const [chosen, setChosen] = useState<Source | null>(() =>
    keptSource(initial.source),
  );
  const [typeChoice, setTypeChoice] = useState<MeetingType | null>(
    initial.type ?? null,
  );
  const [otherLabel, setOtherLabel] = useState(initial.otherLabel ?? "");
  const [changingType, setChangingType] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const draft = useKeptFormDraft<MinutesDraft>(
    MINUTES_DRAFT,
    true,
    { source: chosen, type: typeChoice, otherLabel },
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
    meeting is one press of Write minutes. With none likely it opens on No
    meeting. The officer's own pick wins, and the panel's pick isn't kept as
    a draft: an untouched form keeps nothing.
  */
  // Events the server said already have minutes this viewer can't see (an
  // officer's unposted draft): shown as Has minutes, and never picked.
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
    return likely ? { kind: "event", id: likely.id } : { kind: "none" };
  }, [
    eventsQuery.isPending,
    meetingsQuery.isPending,
    meetingsQuery.isError,
    recent,
    started,
    taken,
    now,
  ]);
  const source = chosen ?? autoSource;
  const sourceName =
    source?.kind === "event"
      ? (recent.find((event) => event.id === source.id)?.name ?? "")
      : "";
  const type = typeChoice ?? guessMeetingType(sourceName);

  function discard() {
    draft.discard();
    setProblem(null);
    setChosen(null);
    setTypeChoice(null);
    setOtherLabel("");
  }
  const [problem, setProblem] = useState<string | null>(null);

  function pick(next: Source) {
    setChosen(next);
    setTypeChoice(null);
    setProblem(null);
  }

  function pickEvent(event: EventRow) {
    const existing = started.get(event.id);
    if (existing) {
      // Their minutes are what the officer came for; nothing to keep.
      draft.drop();
      onDone();
      router.push(meetingHref(existing));
      return;
    }
    pick({ kind: "event", id: event.id });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!source) {
      setProblem("Pick a meeting, or No meeting.");
      return;
    }
    // Out of the store while it runs: coming back mid-start must not offer
    // the same minutes to start twice.
    draft.hold();
    try {
      const result = await start.mutateAsync({
        meeting_type: type,
        other_label:
          type === "other" && otherLabel.trim() ? otherLabel.trim() : null,
        // No meeting sends neither: the minutes start unlinked.
        ...(source.kind === "event" ? { event_id: source.id } : {}),
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
          title: MEETING_ENTRY_COPY.alreadyStartedTitle,
          description: MEETING_ENTRY_COPY.alreadyStartedBody,
        });
        return;
      }
      toast({
        title: MEETING_ENTRY_COPY.startFailed,
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
  const onNowId = useMemo(() => {
    const on = recent.find((event) => {
      const startAt = Date.parse(event.start_time);
      const endAt = Date.parse(event.end_time ?? "") || startAt + 3_600_000;
      return startAt <= now && now < endAt;
    });
    return on?.id ?? null;
  }, [recent, now]);

  return (
    <>
      <PanelBody as="form" id={`${ids}-form`} onSubmit={submit} noValidate>
        <div className="grid gap-6">
          <section aria-labelledby={`${ids}-which`} className="grid gap-2">
            <h3 id={`${ids}-which`} className="text-sm font-semibold">
              {MINUTES_START_COPY.pick}
            </h3>
            {eventsQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Loading</p>
            ) : null}
            <ul role="list" className="grid gap-0.5">
              {shownEvents.map((event) => {
                const isTaken = taken.includes(event.id);
                const existing = started.has(event.id);
                return (
                  <li key={event.id}>
                    <PickRow
                      held={pickedId === event.id}
                      disabled={isTaken}
                      onClick={() => pickEvent(event)}
                      title={event.name}
                      detail={meetingWhenLabel(event.start_time)}
                      trailing={
                        existing
                          ? MEETING_ENTRY_COPY.open
                          : isTaken
                            ? MINUTES_START_COPY.hasMinutes
                            : onNowId === event.id
                              ? MINUTES_START_COPY.onNow
                              : null
                      }
                    />
                  </li>
                );
              })}
              {hidden > 0 ? (
                <li>
                  <QuietLine onClick={() => setShowOlder(true)}>
                    Show older
                  </QuietLine>
                </li>
              ) : null}
              <li>
                <PickRow
                  held={source?.kind === "none"}
                  onClick={() => pick({ kind: "none" })}
                  title={MINUTES_START_COPY.noMeeting}
                  detail={MINUTES_START_COPY.noMeetingDetail}
                  trailing={null}
                />
              </li>
            </ul>
            {problem ? <FieldError>{problem}</FieldError> : null}
          </section>

          {source ? (
            <section aria-labelledby={`${ids}-type`} className="grid gap-2">
              {changingType ? (
                <>
                  <h3 id={`${ids}-type`} className="text-sm font-semibold">
                    Type
                  </h3>
                  <SegmentedChoice
                    label="Type"
                    value={type}
                    onChange={setTypeChoice}
                    options={typeOptions}
                    fill
                  />
                  {type === "other" ? (
                    <div className="grid gap-1">
                      <Label htmlFor={`${ids}-other`}>Name (optional)</Label>
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
                  Type: {typeName}{" "}
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
          {MEETING_ENTRY_COPY.write}
        </Button>
      </PanelFooter>
    </>
  );
}

/** One row of the meeting list: its name, when, and where it stands. */
function PickRow({
  held,
  disabled,
  onClick,
  title,
  detail,
  trailing,
}: {
  held: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  detail: string;
  trailing: string | null;
}) {
  return (
    <button
      type="button"
      aria-pressed={held}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors disabled:cursor-default disabled:opacity-60",
        held
          ? "bg-accent-subtle text-accent-text"
          : "enabled:hover:bg-card-hover",
        FOCUS_RING_OFFSET,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block text-caption text-muted-foreground">
          {detail}
        </span>
      </span>
      {trailing ? (
        <span className="shrink-0 text-caption text-muted-foreground">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}
