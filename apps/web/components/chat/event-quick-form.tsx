"use client";

import { useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { addMinutesToTime, timeSpanMinutes } from "@repo/formatting";
import {
  localDateTimeToIso,
  type DispatchResult,
  type EventInput,
} from "@repo/chat-core/dispatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeField } from "@/components/ui/time-field";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  FieldError,
  FormFooter,
  fieldClass,
  primarySize,
  useReportDraft,
} from "@/components/shared/short-form";

// The draft lives in its own module so the chat shell can build one without
// loading this form, which it loads only when the + card opens it (#3716).
import { eventQuickDraftFrom, type EventQuickDraft } from "./event-quick-draft";

/** `CreateEventDto`'s cap, the one-liner's too. */
const EVENT_MAX_NAME_LENGTH = 255;

type Problems = { name?: string; date?: string; time?: string };

/** A first start's end: an hour on, as a calendar's quick create fills it. */
const FIRST_LENGTH_MINUTES = 60;

/** Minutes from `HH:MM` to midnight: the card's event ends the day it starts. */
function minutesLeftInDay(time: string): number {
  return 24 * 60 - timeSpanMinutes("00:00", time);
}

/**
 * The end when the start moves to `startTime`: it keeps the event's length,
 * as Google Calendar's does, and a first start fills an hour, while the end
 * still falls on the same day; otherwise it stays as typed.
 */
function endFollowing(draft: EventQuickDraft, startTime: string): string {
  if (!startTime) return draft.endTime;
  const length =
    draft.startTime && draft.endTime
      ? timeSpanMinutes(draft.startTime, draft.endTime)
      : FIRST_LENGTH_MINUTES;
  if (length <= 0 || length >= minutesLeftInDay(startTime)) {
    return draft.endTime;
  }
  return addMinutesToTime(startTime, length);
}

export interface EventQuickFormProps {
  initialDraft?: EventQuickDraft;
  onDraftChange?: (draft: EventQuickDraft) => void;
  /** The write `/event` makes, into the channel the form was opened in. */
  onPost: (input: EventInput) => Promise<DispatchResult>;
  /**
   * Opens the full event editor with this draft carried over: Repeat, Who's
   * coming, points, a check-in zone and the rest don't fit a card that never
   * scrolls.
   */
  onMoreOptions: (draft: EventQuickDraft) => void;
  onDone: () => void;
  onDiscard: () => void;
}

/**
 * The + card's Event form (#3983): the four fields every event needs, name,
 * date, start and end, as Google Calendar's quick create asks for. The event
 * is created as the one-liner creates it (10 points unless typed, not
 * required, everyone invited; a member without `events:update` gets no
 * points, which the API decides, #3709), and More options opens the full
 * editor for everything else.
 */
export function EventQuickForm({
  initialDraft,
  onDraftChange,
  onPost,
  onMoreOptions,
  onDone,
  onDiscard,
}: EventQuickFormProps) {
  const layout = "card";
  const field = fieldClass(layout);
  const ids = useId();
  // `POST /v1/events` carries no `@FreeTier`: paid-ops (#841).
  const gate = useSubscriptionGate();
  const [draft, setDraft] = useState<EventQuickDraft>(
    () => initialDraft ?? eventQuickDraftFrom(),
  );
  useReportDraft(draft, onDraftChange);
  const edit = (patch: Partial<EventQuickDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  const [problems, setProblems] = useState<Problems>({});
  const clear = (key: keyof Problems) =>
    setProblems((previous) =>
      previous[key] ? { ...previous, [key]: undefined } : previous,
    );
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting) return;
    const name = draft.name.trim();
    const startIso =
      draft.date && draft.startTime
        ? localDateTimeToIso(draft.date, draft.startTime)
        : null;
    const endIso =
      draft.date && draft.endTime
        ? localDateTimeToIso(draft.date, draft.endTime)
        : null;
    const next: Problems = {
      name: name ? undefined : "Give the event a name.",
      date: draft.date ? undefined : "Pick a date.",
      time:
        !startIso || !endIso
          ? "Set a start and an end time."
          : new Date(endIso).getTime() <= new Date(startIso).getTime()
            ? "End after it starts. For an overnight event, use More options."
            : undefined,
    };
    setProblems(next);
    setFailure(null);
    if (next.name) return nameRef.current?.focus();
    if (next.date) return dateRef.current?.focus();
    if (next.time || !startIso || !endIso) return startRef.current?.focus();
    setPosting(true);
    try {
      const result = await onPost({
        name,
        start_time: startIso,
        end_time: endIso,
        location: draft.location,
        point_value: draft.pointValue,
      });
      if (!result.ok) {
        setFailure(result.error ?? "Couldn't create the event. Try again.");
        return;
      }
      onDone();
    } finally {
      setPosting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3"
      noValidate
    >
      <SubscriptionNotice gate={gate} feature="creating events" />
      <div className="grid gap-1">
        <Label htmlFor={`${ids}-name`}>Event name</Label>
        <Input
          ref={nameRef}
          id={`${ids}-name`}
          data-plus-autofocus
          className={field}
          value={draft.name}
          maxLength={EVENT_MAX_NAME_LENGTH}
          placeholder="Chapter meeting"
          aria-invalid={problems.name ? true : undefined}
          onChange={(event) => {
            edit({ name: event.target.value });
            clear("name");
          }}
          {...gate.controlProps()}
        />
        {problems.name ? <FieldError>{problems.name}</FieldError> : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${ids}-date`}>Date</Label>
        <DateField
          ref={dateRef}
          id={`${ids}-date`}
          lean="ahead"
          placeholder="e.g. Friday"
          className={field}
          value={draft.date}
          aria-invalid={problems.date ? true : undefined}
          onChange={(date) => {
            edit({ date });
            clear("date");
          }}
          {...gate.controlProps()}
        />
        {problems.date ? <FieldError>{problems.date}</FieldError> : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Label htmlFor={`${ids}-start`}>Starts</Label>
          <TimeField
            ref={startRef}
            id={`${ids}-start`}
            placeholder="7 PM"
            className={field}
            value={draft.startTime}
            aria-invalid={problems.time ? true : undefined}
            onChange={(startTime) => {
              edit({ startTime, endTime: endFollowing(draft, startTime) });
              clear("time");
            }}
            {...gate.controlProps()}
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Label htmlFor={`${ids}-end`}>Ends</Label>
          <TimeField
            id={`${ids}-end`}
            placeholder="8 PM"
            className={field}
            value={draft.endTime}
            anchor={draft.startTime || undefined}
            from={draft.startTime || undefined}
            span={draft.startTime ? minutesLeftInDay(draft.startTime) : undefined}
            aria-invalid={problems.time ? true : undefined}
            onChange={(endTime) => {
              edit({ endTime });
              clear("time");
            }}
            {...gate.controlProps()}
          />
        </div>
        {problems.time ? (
          <div className="col-span-2">
            <FieldError>{problems.time}</FieldError>
          </div>
        ) : null}
      </div>
      {failure ? <FieldError>{failure}</FieldError> : null}
      <FormFooter
        layout={layout}
        onCancel={onDiscard}
        cancelDisabled={posting}
        start={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={posting}
            onClick={() => onMoreOptions(draft)}
          >
            More options
          </Button>
        }
      >
        <Button
          type="submit"
          size={primarySize(layout)}
          {...gate.controlProps(posting)}
        >
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {posting ? "Creating…" : "Create event"}
        </Button>
      </FormFooter>
    </form>
  );
}
