"use client";

import { useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useMembers } from "@repo/hooks";
import { dueEntryFields } from "@repo/formatting";
import { memberLabel } from "@repo/hooks/display-names";
import type { DispatchResult, TaskInput } from "@repo/chat-core/dispatch";
import { TASK_TITLE_MAX_LENGTH } from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { DueDateField } from "@/components/tasks/due-date-field";
import { SubtaskListEditor } from "@/components/tasks/subtask-list-editor";
import { useToast } from "@/lib/hooks/use-toast";
import { guardIntDraft, parseGuardedInt } from "@/lib/utils";

export type NewTaskPrefill = {
  title?: string;
  dueDate?: string;
  pointReward?: number;
};

type NewTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: NewTaskPrefill;
  /** The `@member` a typed `/task` named, once the host resolved it. */
  initialAssigneeId?: string;
  /**
   * Creates the task and posts its card in the channel the form was opened
   * in, as `/task` does (`postTask`). `{ ok: false }` keeps the dialog open
   * with the draft; anything else closes it, and the host reports a warning.
   */
  onPost: (input: TaskInput) => Promise<DispatchResult>;
};

type Missing = {
  title?: boolean;
  titleTooLong?: boolean;
  assignee?: boolean;
  due?: boolean;
};

/**
 * The chat composer's Task form (#3865, #3773 step 3): the fields the task
 * board's Add a task row takes (`add-task-row.tsx`), in a dialog, since chat
 * has no board to open a row on. Title, assignee and due date are required,
 * as `CreateTaskDto` requires them; a missing one is flagged and focused on
 * submit, never while typing. Points and description are optional. Repeat
 * and role assignees are #3661, which will give both apps one task form.
 *
 * Keyed per open by the host, so each visit starts from what was typed.
 */
export function NewTaskDialog({
  open,
  onOpenChange,
  prefill,
  initialAssigneeId,
  onPost,
}: NewTaskDialogProps) {
  // `POST /v1/tasks` carries no `@FreeTier`: paid-ops (#841).
  const gate = useSubscriptionGate();
  const membersQuery = useMembers();
  const members = membersQuery.data ?? [];
  const { toast } = useToast();
  const ids = useId();
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [assigneeId, setAssigneeId] = useState(initialAssigneeId ?? "");
  const [dueDate, setDueDate] = useState(prefill?.dueDate ?? "");
  const [points, setPoints] = useState(
    prefill?.pointReward !== undefined ? String(prefill.pointReward) : "",
  );
  const [description, setDescription] = useState("");
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [missing, setMissing] = useState<Missing>({});
  const [posting, setPosting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const assigneeRef = useRef<HTMLButtonElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting) return;
    const trimmed = title.trim();
    const nextMissing: Missing = {
      title: !trimmed,
      titleTooLong: trimmed.length > TASK_TITLE_MAX_LENGTH,
      assignee: !assigneeId,
      due: !dueDate,
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
        description: description.trim() || undefined,
        assignee_id: assigneeId,
        ...dueEntryFields(dueDate),
        point_reward: parseGuardedInt(points),
        subtasks: subtasks.length > 0 ? subtasks : undefined,
      });
      if (!result.ok) {
        toast({
          title: "Couldn't create task",
          description:
            result.error ??
            "Retry in a moment or confirm the assignee is a chapter member.",
          variant: "destructive",
        });
        return;
      }
      onOpenChange(false);
    } finally {
      setPosting(false);
    }
  }

  const formId = `${ids}-form`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <SubscriptionNotice gate={gate} feature="creating tasks" />
        <form
          id={formId}
          onSubmit={(event) => void submit(event)}
          className="space-y-4"
        >
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-title`}>Title</Label>
            <Input
              ref={titleRef}
              id={`${ids}-title`}
              autoFocus
              value={title}
              aria-invalid={missing.title || missing.titleTooLong || undefined}
              onChange={(event) => {
                const next = event.target.value;
                setTitle(next);
                setMissing((prev) => ({
                  ...prev,
                  title: prev.title && !next.trim(),
                  titleTooLong:
                    prev.titleTooLong &&
                    next.trim().length > TASK_TITLE_MAX_LENGTH,
                }));
              }}
              {...gate.controlProps()}
            />
            {missing.title ? (
              <p role="alert" className="text-caption text-destructive-text">
                Give the task a title.
              </p>
            ) : missing.titleTooLong ? (
              <p role="alert" className="text-caption text-destructive-text">
                Keep the title to {TASK_TITLE_MAX_LENGTH} characters. It&apos;s{" "}
                {title.trim().length} now.
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1">
              <Label htmlFor={`${ids}-assignee`}>Assignee</Label>
              <Select
                value={assigneeId}
                onValueChange={(value) => {
                  setAssigneeId(value);
                  setMissing((prev) => ({ ...prev, assignee: false }));
                }}
                disabled={gate.controlProps().disabled}
              >
                <SelectTrigger
                  ref={assigneeRef}
                  id={`${ids}-assignee`}
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
                <p role="alert" className="text-caption text-destructive-text">
                  Pick an assignee.
                </p>
              ) : null}
            </div>
            <div className="grid min-w-0 gap-1">
              <Label htmlFor={`${ids}-due`}>Due date</Label>
              <div>
                <DueDateField
                  ref={dueRef}
                  id={`${ids}-due`}
                  placeholder="Nov 14, Friday 5pm, tomorrow"
                  missing={missing.due}
                  value={dueDate}
                  onChange={(value) => {
                    setDueDate(value);
                    if (value) setMissing((prev) => ({ ...prev, due: false }));
                  }}
                  {...gate.controlProps()}
                />
              </div>
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-points`}>Points (optional)</Label>
            <Input
              id={`${ids}-points`}
              type="number"
              min={0}
              value={points}
              onChange={(event) => {
                const next = guardIntDraft(event.target.value);
                if (next === undefined) return;
                setPoints(next);
              }}
              {...gate.controlProps()}
            />
          </div>
          <SubtaskListEditor
            items={subtasks}
            onChange={setSubtasks}
            disabled={posting}
          />
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-description`}>Description (optional)</Label>
            <Textarea
              id={`${ids}-description`}
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              {...gate.controlProps()}
            />
          </div>
        </form>
        <DialogFooter>
          {/* Not gated: it only closes, and a lapsed chapter needs a way out. */}
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={posting}
          >
            Cancel
          </Button>
          <Button form={formId} type="submit" {...gate.controlProps(posting)}>
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {posting ? "Creating…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
