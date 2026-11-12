"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Pencil, X } from "lucide-react";
import {
  useAcceptAiSuggestion,
  useAiSuggestions,
  useDecideAiSuggestions,
  useDismissAiSuggestion,
  useMeetings,
  useMembers,
  type AiSuggestion,
  type AiSuggestionSourceRef,
  type TaskSuggestionEdits,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { dueEntryFields, dueEntryFromTask } from "@repo/formatting";
import { codeOf } from "@repo/api-sdk";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/shared/section-label";
import { DueDateField } from "@/components/tasks/due-date-field";
import { TaskForm, type TaskDraft } from "@/components/tasks/task-form";
import {
  meetingDayLabel,
  meetingHref,
} from "@/components/meetings/meeting-copy";
import { useToast } from "@/lib/hooks/use-toast";
import { ReportAiButton } from "@/components/ai/report-ai";
import { cn, getErrorMessage } from "@/lib/utils";

/**
 * Suggested tasks (#4313, `spec/behavior/meetings.md` § Suggested tasks):
 * the action items of posted minutes, each waiting for an officer to accept
 * it into a task, change it first, or dismiss it. Nothing is a task until
 * they do.
 *
 * Drawn in two places from the same rows: under posted minutes (one
 * meeting's), and at the top of the Tasks board (every meeting's, grouped,
 * each group linking back to its minutes). The server lists a suggestion
 * only for someone who could accept it, so nobody else sees the section, and
 * with nothing waiting it draws nothing at all: no heading over an empty box.
 *
 * A row is the Linear triage row: what it is, who and when, Accept and
 * Dismiss. Who and when are changed in place, because those are the two
 * things a meeting leaves unsaid ("someone should call the caterer"), and a
 * task needs both; the pencil opens the board's own task form for anything
 * else. Accept with one of them missing points at it instead of failing.
 */

/** `AI_SUGGESTION_DECIDE_MAX` on the API: decisions one request may carry. */
const DECIDE_MAX = 50;

type SuggestedTask = NonNullable<AiSuggestion["task"]>;
type WaitingSuggestion = AiSuggestion & { task: SuggestedTask };

/** What the officer changed on a row before deciding: who, and when. */
interface RowEdits {
  assigneeId?: string;
  /** A due entry, as `DueDateField` holds it; `""` when cleared. */
  due?: string;
}

function isWaitingTask(item: AiSuggestion): item is WaitingSuggestion {
  return item.kind === "task" && item.task !== null;
}

function dueEntryOf(task: SuggestedTask): string {
  return task.due_date
    ? dueEntryFromTask({ due_date: task.due_date, due_at: task.due_at })
    : "";
}

/** Who and when as the row stands: the officer's pick over the suggestion. */
function rowValues(item: WaitingSuggestion, edits: RowEdits | undefined) {
  return {
    assigneeId: edits?.assigneeId ?? item.task.assignee_id ?? "",
    due: edits?.due ?? dueEntryOf(item.task),
  };
}

/** Only what differs from the suggestion, as the accept route takes it. */
function editsFor(
  item: WaitingSuggestion,
  values: { assigneeId: string; due: string },
): TaskSuggestionEdits | undefined {
  const edits: TaskSuggestionEdits = {};
  if (values.assigneeId !== (item.task.assignee_id ?? "")) {
    edits.assignee_id = values.assigneeId;
  }
  if (values.due !== dueEntryOf(item.task)) {
    const fields = dueEntryFields(values.due);
    edits.due_date = fields.due_date;
    edits.due_at = fields.due_at ?? null;
  }
  return Object.keys(edits).length > 0 ? edits : undefined;
}

/** Why an accept or dismiss was refused, in words an officer can act on. */
function refusalLine(error: unknown): string {
  switch (codeOf(error)) {
    case "ai.suggestion.decided":
      return "Another officer already decided this one.";
    case "ai.suggestion.expired":
      return "This suggestion expired.";
    case "ai.suggestion.accepting":
      return "Another officer is accepting this one right now.";
    case "ai.suggestion.not_found":
      return "This suggestion is gone. The minutes it came from changed.";
    default:
      return getErrorMessage(error, "Try again in a moment.");
  }
}

export function SuggestedTasks({
  source,
  headingId,
  className,
}: {
  /** One meeting's suggestions; left out, every source's, grouped. */
  source?: AiSuggestionSourceRef;
  headingId: string;
  className?: string;
}) {
  const suggestionsQuery = useAiSuggestions({ source });
  const items = useMemo(
    () => (suggestionsQuery.data?.items ?? []).filter(isWaitingTask),
    [suggestionsQuery.data],
  );
  const grouped = !source;
  // The names of the minutes each group came from. Only read when there is
  // a group to name, so a chapter with nothing suggested never asks.
  const meetingsQuery = useMeetings({
    enabled: grouped && items.some((item) => item.source.type === "meeting"),
  });
  const membersQuery = useMembers();
  const members = useMemo(
    () => (membersQuery.data ?? []).filter((member) => member.user_id),
    [membersQuery.data],
  );
  const accept = useAcceptAiSuggestion();
  const dismiss = useDismissAiSuggestion();
  const decide = useDecideAiSuggestions();
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, RowEdits>>({});
  // Rows whose Accept was pressed with who or when still missing.
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [formFor, setFormFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const bySource = new Map<string, WaitingSuggestion[]>();
    for (const item of items) {
      const key = `${item.source.type}:${item.source.id}`;
      bySource.set(key, [...(bySource.get(key) ?? []), item]);
    }
    return [...bySource.values()];
  }, [items]);

  if (items.length === 0) return null;

  const busy = busyId !== null || decide.isPending;
  // A row open in the form is decided there, with what was typed into it.
  const ready = items.filter((item) => {
    if (item.id === formFor) return false;
    const values = rowValues(item, edits[item.id]);
    return values.assigneeId && values.due;
  });

  function editRow(id: string, patch: RowEdits) {
    setEdits((previous) => ({
      ...previous,
      [id]: { ...previous[id], ...patch },
    }));
  }

  async function acceptRow(item: WaitingSuggestion) {
    const values = rowValues(item, edits[item.id]);
    if (!values.assigneeId || !values.due) {
      setFlagged((previous) => new Set(previous).add(item.id));
      return false;
    }
    setBusyId(item.id);
    try {
      await accept.mutateAsync({ id: item.id, task: editsFor(item, values) });
      toast({ title: "Task created", description: item.task.title });
      return true;
    } catch (error) {
      toast({
        title: "Couldn't accept the suggestion",
        description: refusalLine(error),
        variant: "destructive",
      });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function dismissRow(item: WaitingSuggestion) {
    setBusyId(item.id);
    try {
      await dismiss.mutateAsync(item.id);
    } catch (error) {
      toast({
        title: "Couldn't dismiss the suggestion",
        description: refusalLine(error),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function acceptAllReady() {
    try {
      const decisions = ready.map((item) => ({
        id: item.id,
        action: "accept" as const,
        task: editsFor(item, rowValues(item, edits[item.id])),
      }));
      // The route takes 50 at a time.
      const outcomes = [];
      for (let at = 0; at < decisions.length; at += DECIDE_MAX) {
        outcomes.push(
          ...(await decide.mutateAsync(decisions.slice(at, at + DECIDE_MAX))),
        );
      }
      const made = outcomes.filter((outcome) => outcome.ok).length;
      const refused = outcomes.length - made;
      toast({
        title: made === 1 ? "1 task created" : `${made} tasks created`,
        description:
          refused > 0
            ? `${refused} couldn't be accepted and ${refused === 1 ? "is" : "are"} still listed.`
            : undefined,
        variant: made === 0 ? "destructive" : undefined,
      });
    } catch (error) {
      toast({
        title: "Couldn't accept the suggestions",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  const meetingName = (id: string) => {
    const meeting = (meetingsQuery.data ?? []).find((row) => row.id === id);
    return meeting
      ? `${meeting.event_name}, ${meetingDayLabel(meeting.event_start_time)}`
      : "Meeting minutes";
  };

  const renderRow = (item: WaitingSuggestion) => (
    <SuggestedTaskRow
      key={item.id}
      item={item}
      values={rowValues(item, edits[item.id])}
      members={members}
      flagged={flagged.has(item.id)}
      disabled={busy}
      formOpen={formFor === item.id}
      onEdit={(patch) => editRow(item.id, patch)}
      onAccept={() => void acceptRow(item)}
      onDismiss={() => void dismissRow(item)}
      onOpenForm={() => setFormFor(item.id)}
      onCloseForm={() => setFormFor(null)}
      acceptWith={async (task) => {
        await accept.mutateAsync({ id: item.id, task });
      }}
    />
  );

  return (
    <section aria-labelledby={headingId} className={cn("space-y-3", className)}>
      <SectionLabel id={headingId} count={items.length}>
        Suggested tasks
      </SectionLabel>
      {grouped ? (
        groups.map((group) => {
          const first = group[0]!;
          return (
            <div key={first.source.id} className="space-y-2">
              <p className="text-caption text-muted-foreground">
                From the minutes of{" "}
                {first.source.type === "meeting" ? (
                  <Link
                    href={meetingHref(first.source.id)}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {meetingName(first.source.id)}
                  </Link>
                ) : (
                  "a meeting"
                )}
              </p>
              <ul className="space-y-2">{group.map(renderRow)}</ul>
            </div>
          );
        })
      ) : (
        <>
          <p className="text-caption text-muted-foreground">
            From the action items above. Nothing is a task until you accept it.
          </p>
          <ul className="space-y-2">{items.map(renderRow)}</ul>
        </>
      )}
      {/*
        Under the rows, so an officer has been past every one before the
        button that accepts them together (#4313). Only the rows that say who
        and when go; the rest stay listed.
      */}
      {ready.length > 1 ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void acceptAllReady()}
          >
            {decide.isPending
              ? "Accepting…"
              : ready.length === items.length
                ? `Accept all ${ready.length}`
                : `Accept the ${ready.length} with an assignee and a due date`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

type Member = { user_id?: string | null; display_name?: string | null };

function SuggestedTaskRow({
  item,
  values,
  members,
  flagged,
  disabled,
  formOpen,
  onEdit,
  onAccept,
  onDismiss,
  onOpenForm,
  onCloseForm,
  acceptWith,
}: {
  item: WaitingSuggestion;
  values: { assigneeId: string; due: string };
  members: Member[];
  flagged: boolean;
  disabled: boolean;
  formOpen: boolean;
  onEdit: (patch: RowEdits) => void;
  onAccept: () => void;
  onDismiss: () => void;
  onOpenForm: () => void;
  onCloseForm: () => void;
  acceptWith: (task: TaskSuggestionEdits) => Promise<void>;
}) {
  const { task } = item;
  const missingWho = flagged && !values.assigneeId;
  const missingDue = flagged && !values.due;

  if (formOpen) {
    const initialDraft: TaskDraft = {
      title: task.title,
      assigneeId: values.assigneeId,
      dueDate: values.due,
      points: "",
      description: task.description ?? "",
      subtasks: task.subtasks,
      showMore: false,
    };
    return (
      <li className="rounded-[14px] border border-border p-3">
        <TaskForm
          suggestion
          initialDraft={initialDraft}
          onDiscard={onCloseForm}
          onDone={onCloseForm}
          onPost={async (input) => {
            try {
              // The whole form, as the officer left it: the task is made
              // from exactly these fields, as the board's form would.
              await acceptWith({
                title: input.title,
                description: input.description ?? null,
                assignee_id: input.assignee_id,
                due_date: input.due_date,
                due_at: input.due_at ?? null,
                subtasks: input.subtasks ?? [],
              });
              return { ok: true };
            } catch (error) {
              return { ok: false, error: refusalLine(error) };
            }
          }}
        />
      </li>
    );
  }

  return (
    <li className="space-y-2 rounded-[14px] border border-border p-3">
      <div className="space-y-1">
        <p className="break-words text-sm font-medium">{task.title}</p>
        {/* The line of the minutes, when the title had to be cut from it. */}
        {item.quote && item.quote !== task.title ? (
          <p className="break-words text-caption text-muted-foreground">
            “{item.quote}”
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-32 max-w-56 flex-1">
          <Select
            value={values.assigneeId}
            onValueChange={(value) => onEdit({ assigneeId: value })}
            disabled={disabled}
          >
            <SelectTrigger
              aria-label={`Assignee for ${task.title}`}
              aria-invalid={missingWho || undefined}
            >
              <SelectValue placeholder="Who?" />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem
                  key={String(member.user_id)}
                  value={String(member.user_id)}
                >
                  {memberLabel(member.display_name, member.user_id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {missingWho ? (
            <p role="alert" className="mt-1 text-caption text-destructive-text">
              Pick who this is for.
            </p>
          ) : null}
        </div>
        <div className="min-w-32 max-w-56 flex-1">
          <DueDateField
            aria-label={`Due date for ${task.title}`}
            placeholder="Due: Fri 5pm"
            missing={missingDue}
            value={values.due}
            onChange={(value) => onEdit({ due: value })}
            disabled={disabled}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ReportAiButton
            iconOnly
            name={task.title}
            target={{ subject: "ai_suggestion", subjectId: item.id }}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Dismiss ${task.title}`}
            title="Dismiss"
            disabled={disabled}
            onClick={onDismiss}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Change ${task.title} before accepting`}
            title="Change before accepting"
            disabled={disabled}
            onClick={onOpenForm}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button size="sm" disabled={disabled} onClick={onAccept}>
            Accept
          </Button>
        </div>
      </div>
    </li>
  );
}
