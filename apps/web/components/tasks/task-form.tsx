"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useMembers } from "@repo/hooks";
import { dueEntryFields } from "@repo/formatting";
import { memberLabel } from "@repo/hooks/display-names";
import type { DispatchResult, TaskInput } from "@repo/chat-core/dispatch";
import { TASK_TITLE_MAX_LENGTH } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoreOptionsToggle } from "@/components/ui/more-options-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { DueDateField } from "@/components/tasks/due-date-field";
import { SubtaskListEditor } from "@/components/tasks/subtask-list-editor";
import { pointsLabel } from "@/components/events/event-labels";
import { useToast } from "@/lib/hooks/use-toast";
import { guardIntDraft, parseGuardedInt } from "@/lib/utils";

/** What a typed `/task` could read, for the form to open on. */
export type TaskPrefill = {
  title?: string;
  dueDate?: string;
  pointReward?: number;
};

/** Everything the form holds, kept by the + card while it is closed. */
export interface TaskDraft {
  title: string;
  assigneeId: string;
  dueDate: string;
  points: string;
  description: string;
  /** The steps typed so far (#4003). */
  subtasks: string[];
  showMore: boolean;
}

export function taskDraftFrom(
  prefill: TaskPrefill = {},
  assigneeId = "",
): TaskDraft {
  return {
    title: prefill.title ?? "",
    assigneeId,
    dueDate: prefill.dueDate ?? "",
    points:
      prefill.pointReward !== undefined ? String(prefill.pointReward) : "",
    description: "",
    subtasks: [],
    // Open when the typed command set something that lives there.
    showMore: prefill.pointReward !== undefined,
  };
}

type Missing = {
  title?: boolean;
  titleTooLong?: boolean;
  assignee?: boolean;
  due?: boolean;
};

export interface TaskFormProps {
  initialDraft?: TaskDraft;
  onDraftChange?: (draft: TaskDraft) => void;
  /**
   * Creates the task and posts its card in the channel the form was opened
   * in, as `/task` does (`postTask`). `{ ok: false }` keeps the form open
   * with the draft; anything else is done, and the host reports a warning.
   */
  onPost: (input: TaskInput) => Promise<DispatchResult>;
  onDone: () => void;
  onDiscard: () => void;
  /**
   * Editing a task that exists (#4296) rather than making one: Save and
   * Cancel in place of Create and Discard draft, the task's live checklist in
   * place of the steps typed for a new task, and a line under Assignee when
   * the pick would start the task over.
   */
  editing?: {
    steps: React.ReactNode;
    assigneeNote: (assigneeId: string) => React.ReactNode;
  };
  /**
   * Opened on a suggested task (#4313) to change it before accepting: Accept
   * and Cancel, and no Points field, because a suggested task never carries
   * points (`spec/behavior/meetings.md` § Suggested tasks) and the officer
   * adds them on the task afterwards.
   */
  suggestion?: boolean;
}

/**
 * The chat composer's Task form (#3865, #3773 step 3), inside the + card
 * (#3983): Title, Assignee and Due date, the fields `CreateTaskDto` requires,
 * with Points and Description behind More options. A missing field is
 * outlined, named under it and focused on submit, never while typing. Repeat
 * and role assignees are #3661, which will give both apps one task form.
 */
export function TaskForm({
  initialDraft,
  onDraftChange,
  onPost,
  onDone,
  onDiscard,
  editing,
  suggestion = false,
}: TaskFormProps) {
  const layout = "card";
  const field = fieldClass(layout);
  // `POST /v1/tasks` carries no `@FreeTier`: paid-ops (#841).
  const gate = useSubscriptionGate();
  const membersQuery = useMembers();
  const members = membersQuery.data ?? [];
  const { toast } = useToast();
  const ids = useId();
  const [draft, setDraft] = useState<TaskDraft>(
    () => initialDraft ?? taskDraftFrom(),
  );
  useReportDraft(draft, onDraftChange);
  const [missing, setMissing] = useState<Missing>({});
  const [posting, setPosting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const assigneeRef = useRef<HTMLButtonElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  // An edit opens on the title, the way the + card's form does.
  useEffect(() => {
    if (editing || suggestion) titleRef.current?.focus();
    // Once, when the edit opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const edit = (patch: Partial<TaskDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting) return;
    const trimmed = draft.title.trim();
    const nextMissing: Missing = {
      title: !trimmed,
      titleTooLong: trimmed.length > TASK_TITLE_MAX_LENGTH,
      assignee: !draft.assigneeId,
      due: !draft.dueDate,
    };
    setMissing(nextMissing);
    if (nextMissing.title || nextMissing.titleTooLong) {
      return titleRef.current?.focus();
    }
    if (nextMissing.assignee) return assigneeRef.current?.focus();
    if (nextMissing.due) return dueRef.current?.focus();
    setPosting(true);
    try {
      const result = await onPost({
        title: trimmed,
        description: draft.description.trim() || undefined,
        assignee_id: draft.assigneeId,
        // "YYYY-MM-DD", or with a time "YYYY-MM-DDTHH:MM" (#4003).
        ...dueEntryFields(draft.dueDate),
        subtasks: draft.subtasks.length > 0 ? draft.subtasks : undefined,
        point_reward: suggestion ? undefined : parseGuardedInt(draft.points),
      });
      if (!result.ok) {
        toast({
          title: suggestion
            ? "Couldn't accept the suggestion"
            : editing
              ? "Couldn't save the task"
              : "Couldn't create task",
          description:
            result.error ??
            "Retry in a moment or confirm the assignee is a chapter member.",
          variant: "destructive",
        });
        return;
      }
      onDone();
    } finally {
      setPosting(false);
    }
  }

  const moreSummary = [
    ...(suggestion
      ? []
      : [pointsLabel(parseGuardedInt(draft.points) ?? 0) ?? "No points"]),
    draft.description.trim() ? "Description" : "No description",
  ].join(" · ");

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3"
      noValidate
    >
      <SubscriptionNotice gate={gate} feature="creating tasks" />
      <div className="grid gap-1">
        <Label htmlFor={`${ids}-title`}>Title</Label>
        <Input
          ref={titleRef}
          id={`${ids}-title`}
          data-plus-autofocus
          className={field}
          value={draft.title}
          placeholder="Sweep the porch"
          aria-invalid={missing.title || missing.titleTooLong || undefined}
          onChange={(event) => {
            const next = event.target.value;
            edit({ title: next });
            setMissing((prev) => ({
              ...prev,
              title: prev.title && !next.trim(),
              titleTooLong:
                prev.titleTooLong && next.trim().length > TASK_TITLE_MAX_LENGTH,
            }));
          }}
          {...gate.controlProps()}
        />
        {missing.title ? (
          <FieldError>Give the task a title.</FieldError>
        ) : missing.titleTooLong ? (
          <FieldError>
            Keep the title to {TASK_TITLE_MAX_LENGTH} characters. It&apos;s{" "}
            {draft.title.trim().length} now.
          </FieldError>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-1">
          <Label htmlFor={`${ids}-assignee`}>Assignee</Label>
          <Select
            value={draft.assigneeId}
            onValueChange={(value) => {
              edit({ assigneeId: value });
              setMissing((prev) => ({ ...prev, assignee: false }));
            }}
            disabled={gate.controlProps().disabled}
          >
            <SelectTrigger
              ref={assigneeRef}
              id={`${ids}-assignee`}
              className={field}
              aria-invalid={missing.assignee || undefined}
            >
              <SelectValue placeholder="Pick a member" />
            </SelectTrigger>
            <SelectContent>
              {members
                .filter((member) => member.user_id)
                .map((member) => (
                  <SelectItem
                    key={String(member.user_id)}
                    value={String(member.user_id)}
                  >
                    {memberLabel(member.display_name, member.user_id)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {missing.assignee ? (
            <FieldError>Pick an assignee.</FieldError>
          ) : (
            editing?.assigneeNote(draft.assigneeId)
          )}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-1">
          <Label htmlFor={`${ids}-due`}>Due date</Label>
          <div>
            <DueDateField
              ref={dueRef}
              id={`${ids}-due`}
              className={field}
              placeholder="Friday 5pm"
              missing={missing.due}
              value={draft.dueDate}
              onChange={(value) => {
                edit({ dueDate: value });
                if (value) setMissing((prev) => ({ ...prev, due: false }));
              }}
              {...gate.controlProps()}
            />
          </div>
        </div>
      </div>
      {editing ? (
        editing.steps
      ) : (
        <SubtaskListEditor
          items={draft.subtasks}
          onChange={(subtasks) => edit({ subtasks })}
          disabled={posting}
        />
      )}
      <MoreOptionsToggle
        open={draft.showMore}
        onToggle={() => edit({ showMore: !draft.showMore })}
        summary={moreSummary}
        controls={`${ids}-more`}
      />
      {draft.showMore ? (
        <div id={`${ids}-more`} className="grid gap-3">
          {suggestion ? null : (
            <div className="grid gap-1">
              <Label htmlFor={`${ids}-points`}>Points</Label>
              <Input
                id={`${ids}-points`}
                type="number"
                min={0}
                className={field}
                value={draft.points}
                placeholder="0"
                onChange={(event) => {
                  const next = guardIntDraft(event.target.value);
                  if (next === undefined) return;
                  edit({ points: next });
                }}
                {...gate.controlProps()}
              />
            </div>
          )}
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-description`}>Description</Label>
            <Textarea
              id={`${ids}-description`}
              rows={2}
              value={draft.description}
              onChange={(event) => edit({ description: event.target.value })}
              {...gate.controlProps()}
            />
          </div>
        </div>
      ) : null}
      {editing || suggestion ? (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDiscard}
            disabled={posting}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" {...gate.controlProps(posting)}>
            {suggestion
              ? posting
                ? "Accepting…"
                : "Accept"
              : posting
                ? "Saving…"
                : "Save"}
          </Button>
        </div>
      ) : (
        <FormFooter
          layout={layout}
          onCancel={onDiscard}
          cancelDisabled={posting}
        >
          <Button
            type="submit"
            size={primarySize(layout)}
            {...gate.controlProps(posting)}
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {posting ? "Creating…" : "Create task"}
          </Button>
        </FormFooter>
      )}
    </form>
  );
}
