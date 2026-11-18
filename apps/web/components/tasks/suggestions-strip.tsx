"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useAiSuggestions, useMeetings } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { SuggestedTasks } from "@/components/ai/suggested-tasks";
import { meetingDayLabel } from "@/components/meetings/meeting-copy";

/**
 * The suggested tasks at the top of Tasks, as one line until asked for
 * (Paul, 2026-11-18: "Suggested tasks shouldn't push all of the other stuff
 * away. They should just be a small piece at the top"): how many, from
 * which minutes, and Review, which opens the suggestions in place and Hide
 * folds them back. The list itself is `SuggestedTasks`, unchanged.
 */
export function SuggestionsStrip() {
  const [open, setOpen] = useState(false);
  const query = useAiSuggestions();
  const items = (query.data?.items ?? []).filter(
    (item) => item.kind === "task" && item.task !== null,
  );
  const meetingIds = [
    ...new Set(
      items
        .filter((item) => item.source.type === "meeting")
        .map((item) => item.source.id),
    ),
  ];
  const sources = new Set(items.map((item) => `${item.source.type}:${item.source.id}`));
  const meetings = useMeetings({ enabled: meetingIds.length === 1 && sources.size === 1 });
  if (items.length === 0) return null;

  const count = items.length;
  const noun = count === 1 ? "1 suggested task" : `${count} suggested tasks`;
  let from = "";
  if (sources.size === 1 && meetingIds.length === 1) {
    const meeting = (meetings.data ?? []).find((row) => row.id === meetingIds[0]);
    from = meeting
      ? ` from the minutes of ${meeting.event_name}, ${meetingDayLabel(meeting.event_start_time)}`
      : " from the minutes";
  } else if (sources.size > 1) {
    from = ` from ${sources.size} meetings and chats`;
  }

  return (
    <section aria-label="Suggested tasks" className="rounded-[14px] border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {noun}
            {from}
          </p>
        </div>
        <Button
          type="button"
          size="toolbar"
          variant={open ? "ghost" : "secondary"}
          aria-expanded={open}
          aria-controls="tasks-suggested-list"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide" : "Review"}
        </Button>
      </div>
      {open ? (
        <div id="tasks-suggested-list" className="border-t border-border p-3">
          <SuggestedTasks headingId="tasks-suggested" />
        </div>
      ) : null}
    </section>
  );
}
