"use client";

import { useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  localDateTimeToIso,
  type DispatchResult,
  type EventInput,
} from "@repo/chat-core/dispatch";
import type { EventFormPrefill } from "@repo/chat-core/integrations";
import { localIsoDate } from "@repo/formatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/**
 * Everything the card's Event form holds. Location and points come only from
 * a typed `/event`; the card has no field for them, but carries them to the
 * post and to More options so nothing typed is dropped.
 */
export interface EventQuickDraft {
  name: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM` */
  startTime: string;
  endTime: string;
  location?: string;
  pointValue?: number;
}

/** `CreateEventDto`'s cap, the one-liner's too. */
const EVENT_MAX_NAME_LENGTH = 255;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * A blank draft: today, from the next whole hour for an hour, as Google
 * Calendar's quick create starts. Late in the evening that runs past
 * midnight, so it starts tomorrow at 9 instead.
 */
export function eventQuickDraftFrom(
  prefill: EventFormPrefill = {},
  now: Date = new Date(),
): EventQuickDraft {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  if (start.getHours() >= 23 || start.getDate() !== now.getDate()) {
    start.setTime(now.getTime());
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
  }
  const startTime = `${pad(start.getHours())}:00`;
  const endTime = `${pad(start.getHours() + 1)}:00`;
  return {
    name: prefill.name ?? "",
    date: prefill.date ?? localIsoDate(start),
    startTime: normalizeTime(prefill.startTime) ?? startTime,
    endTime: normalizeTime(prefill.endTime) ?? endTime,
    ...(prefill.location ? { location: prefill.location } : {}),
    ...(prefill.pointValue !== undefined
      ? { pointValue: prefill.pointValue }
      : {}),
  };
}

/** `9:00` → `09:00`, the time input's value. */
function normalizeTime(time: string | undefined): string | undefined {
  if (!time) return undefined;
  const [hours = "", minutes = ""] = time.split(":");
  return `${hours.padStart(2, "0")}:${minutes}`;
}

type Problems = { name?: string; date?: string; time?: string };

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
    <form onSubmit={(event) => void submit(event)} className="grid gap-3" noValidate>
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
        <Input
          ref={dateRef}
          id={`${ids}-date`}
          type="date"
          className={field}
          value={draft.date}
          aria-invalid={problems.date ? true : undefined}
          onChange={(event) => {
            edit({ date: event.target.value });
            clear("date");
          }}
          {...gate.controlProps()}
        />
        {problems.date ? <FieldError>{problems.date}</FieldError> : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Label htmlFor={`${ids}-start`}>Starts</Label>
          <Input
            ref={startRef}
            id={`${ids}-start`}
            type="time"
            step={300}
            className={field}
            value={draft.startTime}
            aria-invalid={problems.time ? true : undefined}
            onChange={(event) => {
              edit({ startTime: event.target.value });
              clear("time");
            }}
            {...gate.controlProps()}
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Label htmlFor={`${ids}-end`}>Ends</Label>
          <Input
            id={`${ids}-end`}
            type="time"
            step={300}
            className={field}
            value={draft.endTime}
            aria-invalid={problems.time ? true : undefined}
            onChange={(event) => {
              edit({ endTime: event.target.value });
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
