"use client";

import { useRef, useState } from "react";
import { ListChecks, X } from "lucide-react";
import {
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
} from "@repo/validation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A new task's subtasks on web (#4003): the steps of a chore, typed one per
 * line. Closed, it is one quiet "Add subtasks" line, so a task that needs
 * none costs nothing; open, Enter adds the line and keeps the cursor for the
 * next, the way Todoist's and Apple Reminders' subtask entry works. Leaving
 * the field with text in it adds that text too, so clicking the form's own
 * button never drops a typed step.
 *
 * Enter is kept from submitting the surrounding form: in this field it means
 * "next step", not "create the task".
 */
export function SubtaskListEditor({
  items,
  onChange,
  disabled,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(items.length > 0);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const full = items.length >= TASK_SUBTASKS_MAX;

  function commit(): boolean {
    const title = text.trim();
    if (!title || full) return false;
    onChange([...items, title]);
    setText("");
    return true;
  }

  if (!open && items.length === 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex min-h-9 items-center gap-2 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <ListChecks className="size-4" aria-hidden="true" />
        Add subtasks
      </button>
    );
  }

  return (
    <div className="space-y-1">
      {items.length > 0 ? (
        <ul aria-label="Subtasks" className="space-y-0.5">
          {items.map((item, index) => (
            <li
              key={`${index}-${item}`}
              className="group flex min-h-8 items-center gap-2 rounded-md px-1 text-sm"
            >
              <span
                aria-hidden="true"
                className="size-3.5 shrink-0 rounded-[4px] border border-input"
              />
              <span className="min-w-0 flex-1 truncate">{item}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove subtask: ${item}`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="rounded p-1 text-muted-foreground opacity-60 transition-opacity hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {full ? (
        <p className="px-1 text-caption text-muted-foreground">
          {TASK_SUBTASKS_MAX} subtasks is the most a task can have.
        </p>
      ) : (
        <Input
          ref={inputRef}
          aria-label="Add a subtask"
          placeholder={items.length === 0 ? "First step" : "Next step"}
          maxLength={TASK_SUBTASK_TITLE_MAX_LENGTH}
          disabled={disabled}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            commit();
          }}
          onBlur={() => {
            commit();
            if (items.length === 0 && !text.trim()) setOpen(false);
          }}
          className={cn("h-9")}
        />
      )}
    </div>
  );
}
