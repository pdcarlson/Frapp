"use client";

import { useState } from "react";
import { Check, ChevronDown, ListChecks, X } from "lucide-react";
import {
  subtaskProgress,
  useAddSubtask,
  useDeleteSubtask,
  useSetSubtaskDone,
  type TaskSubtask,
} from "@repo/hooks";
import {
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
} from "@repo/validation";
import { Input } from "@/components/ui/input";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";

/**
 * A task tile's subtasks (#4003). Closed, the tile says how far through
 * them it is ("2 of 5") beside the due date, which is all a board scan
 * needs; a click opens the checklist under the tile, where the assignee or
 * an officer ticks steps off. An officer can also add a step at the end or
 * take one away. Like Todoist's and Asana's sub-task counts, the number is
 * the button.
 *
 * A confirmed task is closed: its points are paid, so its steps no longer
 * move (the API refuses it too).
 */
export function TaskSubtasksToggle({
  subtasks,
  open,
  onToggle,
}: {
  subtasks: TaskSubtask[] | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const progress = subtaskProgress(subtasks);
  if (!progress) return null;
  const allDone = progress.done === progress.total;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 -mx-1 transition-colors hover:text-foreground",
        allDone ? "text-success" : undefined,
      )}
    >
      <ListChecks className="size-3.5" aria-hidden="true" />
      <span>
        {progress.label}
        <span className="sr-only"> subtasks done</span>
      </span>
      <ChevronDown
        className={cn("size-3 transition-transform", open && "rotate-180")}
        aria-hidden="true"
      />
    </button>
  );
}

export function TaskSubtaskList({
  taskId,
  subtasks,
  canCheck,
  canEdit,
  closed,
  gate,
}: {
  taskId: string;
  subtasks: TaskSubtask[];
  /** The assignee, or an officer. */
  canCheck: boolean;
  /** An officer who can manage tasks. */
  canEdit: boolean;
  /** Confirmed: nothing moves. */
  closed: boolean;
  gate: SubscriptionGate;
}) {
  const setDone = useSetSubtaskDone();
  const addSubtask = useAddSubtask();
  const deleteSubtask = useDeleteSubtask();
  const { toast } = useToast();
  const [text, setText] = useState("");

  const fail = (title: string) => (error: unknown) =>
    toast({
      title,
      description: getErrorMessage(error, "Retry in a moment."),
      variant: "destructive",
    });

  function add() {
    const title = text.trim();
    if (!title) return;
    setText("");
    addSubtask.mutate(
      { taskId, title },
      {
        onError: (error) => {
          setText(title);
          fail("Couldn't add that subtask")(error);
        },
      },
    );
  }

  const writable = !closed;
  return (
    <div className="mt-2 border-t border-border pt-2">
      <ul aria-label="Subtasks" className="space-y-0.5">
        {subtasks.map((subtask) => {
          const done = subtask.done_at !== null;
          return (
            <li
              key={subtask.id}
              className="group flex min-h-8 items-center gap-2 text-sm"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={subtask.title}
                {...gate.controlProps(!canCheck || !writable)}
                onClick={() =>
                  setDone.mutate(
                    { taskId, subtaskId: subtask.id, done: !done },
                    { onError: fail("Couldn't update that subtask") },
                  )
                }
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:cursor-default",
                  done
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input hover:border-foreground/60",
                )}
              >
                {done ? <Check className="size-3" aria-hidden="true" /> : null}
              </button>
              <span
                className={cn(
                  "min-w-0 flex-1 break-words",
                  done && "text-muted-foreground line-through",
                )}
              >
                {subtask.title}
              </span>
              {canEdit && writable ? (
                <button
                  type="button"
                  aria-label={`Remove subtask: ${subtask.title}`}
                  {...gate.controlProps()}
                  onClick={() =>
                    deleteSubtask.mutate(
                      { taskId, subtaskId: subtask.id },
                      { onError: fail("Couldn't remove that subtask") },
                    )
                  }
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canEdit && writable && subtasks.length < TASK_SUBTASKS_MAX ? (
        <Input
          aria-label="Add a subtask"
          placeholder="Add a subtask"
          maxLength={TASK_SUBTASK_TITLE_MAX_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            add();
          }}
          {...gate.controlProps(addSubtask.isPending)}
          className="mt-1 h-8 text-sm"
        />
      ) : null}
    </div>
  );
}
