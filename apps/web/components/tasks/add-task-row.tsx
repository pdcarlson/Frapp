"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { memberLabel } from "@repo/hooks/display-names";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FOCUS_RING } from "@/components/ui/focus";
import { DueDateField } from "@/components/tasks/due-date-field";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { cn, guardIntDraft, parseGuardedInt } from "@/lib/utils";

/** What `POST /v1/tasks` takes from the board. */
export type TaskDraft = {
  title: string;
  description?: string;
  assignee_id: string;
  due_date: string;
  point_reward?: number;
};

type Member = { user_id?: string | null; display_name?: string | null };

const EMPTY = {
  title: "",
  description: "",
  assignee_id: "",
  due_date: "",
  point_reward: "",
};

type Missing = { assignee?: boolean; due?: boolean };

/**
 * The board's one way to create a task: a "+ Add a task" row at the top of
 * To do, where the new tile will land (empty-states rule 2). It replaced the
 * toolbar's New task button and its dialog.
 *
 * Pressing it opens the row in place. Typing a title and pressing Enter
 * creates the task once it has an assignee and a due date, which the API
 * requires (`CreateTaskDto`); a missing one is flagged and focused on submit,
 * never while typing. The due date is typed as a month and a day, with no
 * year to set (`due-date-field.tsx`, #3928). After a create the row stays open with a fresh title,
 * so an officer can add several in a row. Escape or Cancel closes it.
 */
export function AddTaskRow({
  members,
  gate,
  pending,
  onCreate,
}: {
  members: Member[];
  gate: SubscriptionGate;
  pending: boolean;
  /** Resolves whether the task was created; the caller owns the toasts. */
  onCreate: (draft: TaskDraft) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [missing, setMissing] = useState<Missing>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const assigneeRef = useRef<HTMLButtonElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setDraft(EMPTY);
    setMissing({});
    // Back to the row that opened it, so focus doesn't drop to the page.
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      titleRef.current?.focus();
      return;
    }
    const nextMissing: Missing = {
      assignee: !draft.assignee_id,
      due: !draft.due_date,
    };
    setMissing(nextMissing);
    if (nextMissing.assignee) {
      assigneeRef.current?.focus();
      return;
    }
    if (nextMissing.due) {
      dueRef.current?.focus();
      return;
    }
    const created = await onCreate({
      title,
      description: draft.description.trim() || undefined,
      assignee_id: draft.assignee_id,
      due_date: draft.due_date,
      point_reward: parseGuardedInt(draft.point_reward),
    });
    if (!created) return;
    setDraft(EMPTY);
    setMissing({});
    titleRef.current?.focus();
  }

  if (!open) {
    const controls = gate.controlProps();
    return (
      <button
        ref={openerRef}
        type="button"
        {...controls}
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-[14px] border border-dashed border-input px-3 text-sm text-muted-foreground transition-colors",
          "hover:bg-card-hover hover:text-foreground disabled:pointer-events-none disabled:text-disabled",
          FOCUS_RING,
        )}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add a task
      </button>
    );
  }

  return (
    <form
      aria-label="Add a task"
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        // An open Select list (and any other Radix layer) dismisses itself on
        // Escape with `preventDefault`, not `stopPropagation`, and React still
        // bubbles that key here from the portal. Closing the row too would
        // throw away the draft the officer only meant to close a list over.
        // Held while a create runs, like Cancel.
        if (event.key === "Escape" && !event.defaultPrevented && !pending) {
          event.preventDefault();
          close();
        }
      }}
      className="space-y-2 rounded-[14px] border border-border p-3"
    >
      <Input
        ref={titleRef}
        autoFocus
        aria-label="Task title"
        placeholder="Task title"
        value={draft.title}
        onChange={(event) =>
          setDraft((prev) => ({ ...prev, title: event.target.value }))
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <Select
            value={draft.assignee_id}
            onValueChange={(value) => {
              setDraft((prev) => ({ ...prev, assignee_id: value }));
              setMissing((prev) => ({ ...prev, assignee: false }));
            }}
          >
            <SelectTrigger
              ref={assigneeRef}
              aria-label="Assignee"
              aria-invalid={missing.assignee || undefined}
              aria-describedby={
                missing.assignee ? "add-task-assignee-missing" : undefined
              }
            >
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem
                  key={member.user_id ?? "unknown"}
                  value={String(member.user_id ?? "")}
                >
                  {memberLabel(member.display_name, member.user_id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {missing.assignee ? (
            <p
              id="add-task-assignee-missing"
              className="mt-1 text-caption text-destructive-text"
            >
              Pick an assignee.
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          <DueDateField
            ref={dueRef}
            aria-label="Due date"
            placeholder="Due: Nov 14"
            missing={missing.due}
            value={draft.due_date}
            onChange={(value) => {
              setDraft((prev) => ({ ...prev, due_date: value }));
              if (value) setMissing((prev) => ({ ...prev, due: false }));
            }}
          />
        </div>
      </div>
      <Input
        type="number"
        min={0}
        aria-label="Points (optional)"
        placeholder="Points (optional)"
        value={draft.point_reward}
        onChange={(event) => {
          const next = guardIntDraft(event.target.value);
          if (next === undefined) return;
          setDraft((prev) => ({ ...prev, point_reward: next }));
        }}
      />
      <Textarea
        rows={2}
        aria-label="Description (optional)"
        placeholder="Description (optional)"
        value={draft.description}
        onChange={(event) =>
          setDraft((prev) => ({ ...prev, description: event.target.value }))
        }
      />
      <div className="flex items-center gap-2">
        <Button size="toolbar" type="submit" {...gate.controlProps(pending)}>
          Add task
        </Button>
        {/*
          Not gated: it only closes the row, and a lapsed chapter still needs
          a way out of a form it can't submit. Held while a create runs: the
          write can't be called back, and its result would land on whatever
          the row holds by then.
        */}
        <Button
          size="toolbar"
          variant="ghost"
          type="button"
          disabled={pending}
          onClick={close}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
