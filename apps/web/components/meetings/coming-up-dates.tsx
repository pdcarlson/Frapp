"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck, ListChecks, MoreHorizontal } from "lucide-react";
import {
  useChapterRoster,
  useComingUpTracking,
  useCreateTask,
  useMemberDisplayNames,
} from "@repo/hooks";
import {
  COMING_UP_COPY,
  comingUpChips,
  comingUpCopyText,
  comingUpEventTimes,
  comingUpIsAhead,
  comingUpMenu,
  suggestTaskOwner,
  type ComingUpMenuAction,
  type MeetingDateItem,
} from "@repo/validation";
import { DatesView } from "@/components/meetings/minutes-read";
import { EventEditorDialog } from "@/components/chat/deferred-panels";
import { isoToLocalInput } from "@/components/events/local-input";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelHeader,
} from "@/components/shared/panel";
import { TaskForm, taskDraftFrom } from "@/components/tasks/task-form";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { tasksTaskLink } from "@/lib/tasks/task-links";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";

/**
 * Coming up, tracked (#5672; Paul, 2026-11-19: he "loves the Coming up dates
 * and wants them tracked"). Each date says what already tracks it, "On the
 * calendar" and "Task · Jake" as chips that open the event or the task, and
 * its ⋯ turns it into one: Open the event (or Add to calendar, opening New
 * event on that day with the date's words), Make a task (the task form, due
 * that day, Who guessed from the words as suggested tasks guess it) and Copy
 * date. The way Apple Mail and Gmail turn a date in a message into an event
 * and Linear links an issue's chips. The phone's minutes draw the same chips
 * and menu, from the same `@repo/validation` words (`coming-up-tracking.ts`).
 */
export function ComingUpDates({
  dates,
  viewerId,
}: {
  dates: readonly MeetingDateItem[];
  viewerId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { tracking, canCreateEvents, canManageTasks } =
    useComingUpTracking(dates);
  const names = useMemberDisplayNames();
  const roster = useChapterRoster();
  const createTask = useCreateTask();
  const [eventFor, setEventFor] = useState<{
    item: MeetingDateItem;
    start: Date;
    end: Date;
  } | null>(null);
  const [taskFor, setTaskFor] = useState<MeetingDateItem | null>(null);

  async function act(
    action: ComingUpMenuAction,
    item: MeetingDateItem,
    index: number,
  ) {
    if (action === "openEvent") {
      const event = tracking[index]?.event;
      if (event) router.push(`/events?event=${event.id}`);
    } else if (action === "addToCalendar") {
      const times = comingUpEventTimes(item.date);
      if (times) setEventFor({ item, ...times });
    } else if (action === "makeTask") {
      setTaskFor(item);
    } else {
      try {
        await navigator.clipboard.writeText(comingUpCopyText(item));
        toast({ title: COMING_UP_COPY.copied });
      } catch {
        toast({ title: COMING_UP_COPY.copyFailed, variant: "destructive" });
      }
    }
  }

  const guessedOwner = taskFor
    ? suggestTaskOwner(taskFor.text, roster.data ?? [])
    : null;

  return (
    <>
      <DatesView
        dates={dates}
        below={(_, index) => {
          const track = tracking[index];
          if (!track) return null;
          const chips = comingUpChips(track, names.nameFor, viewerId);
          if (chips.length === 0) return null;
          return (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {chips.map((chip) => {
                const href =
                  chip.key === "event" && track.event
                    ? `/events?event=${track.event.id}`
                    : track.tasks[0]
                      ? tasksTaskLink(track.tasks[0].id)
                      : null;
                const Glyph = chip.key === "event" ? CalendarCheck : ListChecks;
                const body = (
                  <>
                    <Glyph className="h-3 w-3" aria-hidden="true" />
                    {chip.label}
                  </>
                );
                const look =
                  "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground";
                return href ? (
                  <Link
                    key={chip.key}
                    href={href}
                    className={cn(
                      look,
                      "transition-colors hover:bg-card-hover hover:text-foreground",
                      FOCUS_RING_OFFSET,
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <span key={chip.key} className={look}>
                    {body}
                  </span>
                );
              })}
            </span>
          );
        }}
        trailing={(item, index) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={COMING_UP_COPY.more(item.text)}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {comingUpMenu({
                hasEvent: !!tracking[index]?.event,
                upcoming: comingUpIsAhead(item.date),
                canCreateEvents,
                canManageTasks,
              }).map((entry) => (
                <DropdownMenuItem
                  key={entry.action}
                  onSelect={() => void act(entry.action, item, index)}
                >
                  {entry.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {eventFor ? (
        <EventEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setEventFor(null);
          }}
          docked
          backLabel="Back to the minutes"
          mode="create"
          event={null}
          usingPreviewData={false}
          initialName={eventFor.item.text}
          initialStartAt={isoToLocalInput(eventFor.start.toISOString())}
          initialEndAt={isoToLocalInput(eventFor.end.toISOString())}
          onSaved={() => setEventFor(null)}
        />
      ) : null}

      <Panel
        open={taskFor !== null}
        onOpenChange={(open) => {
          if (!open) setTaskFor(null);
        }}
        docked
        backLabel="Back to the minutes"
      >
        <PanelContent aria-describedby={undefined}>
          <PanelHeader>{COMING_UP_COPY.makeTask}</PanelHeader>
          {taskFor ? (
            <PanelBody>
              <TaskForm
                key={`${taskFor.date}-${taskFor.text}`}
                initialDraft={taskDraftFrom(
                  { title: taskFor.text, dueDate: taskFor.date },
                  guessedOwner ?? "",
                )}
                onDiscard={() => setTaskFor(null)}
                onDone={() => setTaskFor(null)}
                onPost={async (input) => {
                  try {
                    await createTask.mutateAsync({
                      title: input.title,
                      description: input.description,
                      assignee_id: input.assignee_id,
                      due_date: input.due_date,
                      due_at: input.due_at,
                      subtasks: input.subtasks,
                      point_reward: input.point_reward,
                      reference_photo_paths: input.reference_photo_paths,
                      proof_kind: input.proof_kind,
                      recurrence_rule: input.recurrence_rule ?? undefined,
                    });
                    toast({
                      title: "Task created",
                      description: input.title,
                    });
                    return { ok: true };
                  } catch (error) {
                    return {
                      ok: false,
                      error: getErrorMessage(
                        error,
                        "Couldn't create the task. Try again in a moment.",
                      ),
                    };
                  }
                }}
              />
            </PanelBody>
          ) : null}
        </PanelContent>
      </Panel>
    </>
  );
}
