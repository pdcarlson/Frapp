"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAcceptAiSuggestion,
  useActiveChapterId,
  useAiSuggestions,
  useDismissAiSuggestion,
  useFrappClient,
  type AiSuggestion,
  type AiSuggestionDismissReason,
} from "@repo/hooks";
import { LAST_YEAR_COPY, lastYearEventLine } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/shared/section-label";
import { isoToLocalInput } from "@/components/events/event-editor-dialog";
import {
  lastYearDay,
  nameForThisYear,
  sameWeekdayThisYear,
} from "@/components/ai/last-year-dates";
import { ReportAiButton } from "@/components/ai/report-ai";
import { suggestionRefusalLine } from "@/components/ai/suggested-tasks";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * "This time last year" on the Events page (#3930, `spec/behavior/ai.md`
 * § This time last year): events the chapter held around now a year ago that
 * this year's calendar doesn't show. A new president doesn't know the chapter
 * runs a philanthropy week every April; last year's calendar does.
 *
 * The same rows the Tasks board's Suggested list reads
 * (`suggested-tasks.tsx`), from the same hooks: the server lists a suggestion
 * only for an officer who could add the event and can open last year's, so
 * nobody else sees the section, and with nothing waiting it draws nothing.
 *
 * A row says what happened and that it isn't on the calendar, and asks to be
 * corrected (the wording is `LAST_YEAR_COPY`). Three answers, as Google
 * Calendar's "Add to calendar" on an event found in mail, and Linear's
 * triage: add it (the ordinary event form, filled in from last year's event,
 * on the same weekday), already planned (one tap), or not this year. Either
 * of the last two and it does not come back.
 */

type SuggestedEvent = NonNullable<AiSuggestion["event"]>;
type WaitingEvent = AiSuggestion & { event: SuggestedEvent };

function isWaitingEvent(item: AiSuggestion): item is WaitingEvent {
  return item.kind === "event" && item.event != null;
}

/** What the event form opens with for one suggestion. */
export interface EventPlan {
  suggestionId: string;
  /** Last year's event: the form starts as a copy of it. */
  template: Record<string, unknown>;
  /** `datetime-local` values: the same weekday and hour, this year. */
  startAt: string;
  endAt: string;
}

/**
 * Marks a suggestion answered by the event the officer just added from it.
 * The event is on the calendar whatever this does: if it doesn't land, the
 * weekly check sees the event and takes the suggestion back, so a failure
 * here is not the officer's to fix and is not shown.
 */
export function useRecordPlannedEvent() {
  const accept = useAcceptAiSuggestion();
  return async (suggestionId: string, eventId: string): Promise<void> => {
    await accept
      .mutateAsync({ id: suggestionId, eventId })
      .catch(() => undefined);
  };
}

export function SuggestedEvents({
  headingId,
  onPlan,
  disabled = false,
  className,
}: {
  headingId: string;
  /** Opens the event form for this suggestion. */
  onPlan: (plan: EventPlan) => void;
  /** The chapter can't add events right now (a lapsed plan, or offline). */
  disabled?: boolean;
  className?: string;
}) {
  const suggestionsQuery = useAiSuggestions();
  const items = useMemo(
    () => (suggestionsQuery.data?.items ?? []).filter(isWaitingEvent),
    [suggestionsQuery.data],
  );
  const dismiss = useDismissAiSuggestion();
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function dismissRow(
    item: WaitingEvent,
    reason?: AiSuggestionDismissReason,
  ) {
    setBusyId(item.id);
    try {
      await dismiss.mutateAsync({ id: item.id, reason });
    } catch (error) {
      toast({
        title: "Couldn't dismiss the suggestion",
        description: suggestionRefusalLine(error),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function plan(item: WaitingEvent) {
    setBusyId(item.id);
    try {
      // Last year's event, read as this officer: the same read the event's
      // own page makes, so the form copies only what they may see.
      const source = await queryClient.fetchQuery({
        queryKey: ["events", chapterId, item.source.id],
        queryFn: async () => {
          const { data, error } = await client.GET("/v1/events/{id}", {
            params: { path: { id: item.source.id } },
          });
          if (error) throw error;
          return data;
        },
        staleTime: 30_000,
      });
      const template = source as unknown as Record<string, unknown>;
      const start = sameWeekdayThisYear(template.start_time);
      // The end keeps its distance from the start, not its own next week.
      const end = sameWeekdayThisYear(template.end_time, start ?? undefined);
      onPlan({
        suggestionId: item.id,
        template: {
          ...template,
          name:
            typeof template.name === "string"
              ? nameForThisYear(template.name, template.start_time, start)
              : template.name,
        },
        startAt: start ? isoToLocalInput(start.toISOString()) : "",
        endAt: end ? isoToLocalInput(end.toISOString()) : "",
      });
    } catch {
      toast({
        title: "Couldn't open last year's event",
        description: "It may have been deleted. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  const busy = busyId !== null;

  return (
    <section aria-labelledby={headingId} className={cn("space-y-3", className)}>
      <SectionLabel id={headingId} count={items.length}>
        {LAST_YEAR_COPY.heading}
      </SectionLabel>
      <p className="text-caption text-muted-foreground">
        {LAST_YEAR_COPY.intro}
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-border p-3"
          >
            <div className="min-w-48 flex-1 space-y-1">
              <p className="break-words text-sm font-medium">
                {item.event.name}
              </p>
              <p className="break-words text-caption text-muted-foreground">
                {lastYearEventLine(
                  lastYearDay(item.event.last_year_at),
                  item.event.times,
                )}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <ReportAiButton
                iconOnly
                name={item.event.name}
                target={{ subject: "ai_suggestion", subjectId: item.id }}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${LAST_YEAR_COPY.dismiss}: ${item.event.name}`}
                title={LAST_YEAR_COPY.dismiss}
                disabled={busy}
                onClick={() => void dismissRow(item)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void dismissRow(item, "already_doing")}
              >
                {LAST_YEAR_COPY.alreadyDoing}
              </Button>
              <Button
                size="sm"
                disabled={busy || disabled}
                onClick={() => void plan(item)}
              >
                {LAST_YEAR_COPY.addEvent}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
