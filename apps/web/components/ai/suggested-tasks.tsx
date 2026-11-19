"use client";

import Link from "next/link";
import {
  noTaskRepeatDraft,
  suggestTaskOwner,
  sameTaskWho,
  taskWhoOf,
  taskWhoSuggestionFields,
  type TaskWho,
} from "@repo/validation";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import {
  useAcceptAiSuggestion,
  useAiSuggestions,
  useDecideAiSuggestions,
  useDismissAiSuggestion,
  useMeetings,
  useMembers,
  useTasks,
  taskDueLine,
  type AiSuggestion,
  type AiSuggestionDismissReason,
  type AiSuggestionSourceRef,
  type TaskStatus,
  type TaskSuggestionEdits,
} from "@repo/hooks";
import {
  dueEntryFields,
  dueEntryFromTask,
  lastYearBareDay,
  suggestTaskDue,
} from "@repo/formatting";
import { codeOf } from "@repo/api-sdk";
import {
  AI_SUGGESTION_COPY,
  LAST_YEAR_COPY,
  SIMILAR_TASK_COPY,
  aiSuggestionRefusalLine,
  existingTasks,
  lastYearTaskLine,
  similarTask,
  statusLabel,
  type ExistingTask,
} from "@repo/validation";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/shared/section-label";
import {
  DueDateField,
  dueEntryPassed,
} from "@/components/tasks/due-date-field";
import { TaskForm, type TaskDraft } from "@/components/tasks/task-form";
import { WhoPicker } from "@/components/tasks/who-picker";
import {
  meetingDayLabel,
  meetingHref,
} from "@/components/meetings/meeting-copy";
import { useToast } from "@/lib/hooks/use-toast";
import { ReportAiButton } from "@/components/ai/report-ai";
import { tasksTaskLink } from "@/lib/tasks/task-links";
import { cn, getErrorMessage } from "@/lib/utils";

/**
 * Suggested tasks (#4313, `spec/behavior/meetings.md` § Suggested tasks):
 * the action items of posted minutes, each waiting for an officer to create
 * it as a task, change it first, or dismiss it. Nothing is a task until they
 * do.
 *
 * Drawn in two places from the same rows: at the top of posted minutes (one
 * meeting's), and at the top of the Tasks board (every meeting's, each
 * linking back to its minutes). The server lists a suggestion only for
 * someone who could create it, so nobody else sees the section, and with
 * nothing waiting it draws nothing at all: no heading over an empty box.
 *
 * One suggestion at a time, in the minutes' order, the way the phone's list
 * and Linear's triage take them (Paul, 2026-11-18: "one at a time ... instead
 * of this big wall of them"). The card says what it is, who and when, and
 * Create task makes it for whoever it names; the next one takes its place.
 * Only the card being decided waits on the server, so nothing else greys out.
 * Who and when are changed in place, because those are the two things a
 * meeting leaves unsaid ("someone should call the caterer"), and a task
 * needs both. Where the minutes left one out, Frapp fills in a suggestion
 * (`task-suggestion-guess.ts`) and says so under the field; the pencil opens
 * the board's own task form for anything else.
 *
 * A task drawn from last year's board (#3930, "this time last year") is the
 * same card under a line that says so, with one more answer: already
 * planned. It carries last year's checklist and nobody's name, because the
 * officer who did it has likely handed the job on.
 *
 * A suggestion that reads like a task the chapter already has open (#5562,
 * `similar-task.ts`) says so before it can be created twice: the card sets
 * the two side by side and asks which it is, the way Linear and Jira show
 * likely duplicates as an issue is filed. Already a task dismisses it; Create
 * anyway brings back the usual card. Until one is pressed, Create all leaves
 * it out.
 */

/** `AI_SUGGESTION_DECIDE_MAX` on the API: decisions one request may carry. */
const DECIDE_MAX = 50;

type SuggestedTask = NonNullable<AiSuggestion["task"]>;
type WaitingSuggestion = AiSuggestion & { task: SuggestedTask };

/** What the officer changed on a row before deciding: who, and when. */
interface RowEdits {
  /** The Who picker's pick; null when cleared, absent when untouched. */
  who?: TaskWho | null;
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

/** What Frapp filled in where the minutes left who or when out. */
interface RowGuess {
  who: TaskWho | null;
  due: string | null;
}

/**
 * Who and when as the row stands: the officer's pick, else what the minutes
 * said, else Frapp's suggestion.
 */
function rowValues(
  item: WaitingSuggestion,
  edits: RowEdits | undefined,
  guess?: RowGuess,
) {
  return {
    // A member, several, a role or group, or one of them (Paul, 2026-11-18).
    who:
      edits?.who !== undefined
        ? edits.who
        : (taskWhoOf(item.task) ?? guess?.who ?? null),
    due: edits?.due ?? (dueEntryOf(item.task) || guess?.due || ""),
  };
}

interface RowValues {
  who: TaskWho | null;
  /** A due entry, as `DueDateField` holds it; `""` when none. */
  due: string;
}

/** Only what differs from the suggestion, as the accept route takes it. */
function editsFor(
  item: WaitingSuggestion,
  values: RowValues,
): TaskSuggestionEdits | undefined {
  const edits: TaskSuggestionEdits = {};
  if (!sameTaskWho(values.who, taskWhoOf(item.task))) {
    Object.assign(edits, taskWhoSuggestionFields(values.who));
  }
  if (values.due !== dueEntryOf(item.task)) {
    const fields = dueEntryFields(values.due);
    edits.due_date = fields.due_date;
    edits.due_at = fields.due_at ?? null;
  }
  return Object.keys(edits).length > 0 ? edits : undefined;
}

/** Why an accept or dismiss was refused, in words an officer can act on. */
export function suggestionRefusalLine(error: unknown): string {
  return (
    aiSuggestionRefusalLine(codeOf(error)) ??
    getErrorMessage(error, AI_SUGGESTION_COPY.tryAgain)
  );
}

export function SuggestedTasks({
  source,
  sourceStart,
  headingId,
  className,
}: {
  /** One meeting's suggestions; left out, every source's. */
  source?: AiSuggestionSourceRef;
  /** When that meeting started, for a suggested due day. */
  sourceStart?: string | null;
  headingId: string;
  className?: string;
}) {
  const suggestionsQuery = useAiSuggestions({ source });
  const items = useMemo(
    () => (suggestionsQuery.data?.items ?? []).filter(isWaitingTask),
    [suggestionsQuery.data],
  );
  // The names and days of the minutes each suggestion came from, on the
  // board. Only read when there is one to name, so a chapter with nothing
  // suggested never asks.
  const meetingsQuery = useMeetings({
    enabled: !source && items.some((item) => item.source.type === "meeting"),
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
  // The card whose Create task is on its way, to say so on its button.
  const [creatingId, setCreatingId] = useState<string | null>(null);
  // Suggestions the officer said are not the existing task they look like.
  const [keptAnyway, setKeptAnyway] = useState<ReadonlySet<string>>(new Set());
  // The tasks this officer can see, to spot a suggestion that is one of them.
  const tasksQuery = useTasks();
  const twins = useMemo(() => {
    const existing = existingTasks(tasksQuery.data);
    return new Map(
      items.map((item) => [item.id, similarTask(item.task.title, existing)]),
    );
  }, [items, tasksQuery.data]);

  const [index, setIndex] = useState(0);

  // Frapp's suggestions for what the minutes left out, worked out once per
  // list rather than on every keystroke.
  const guesses = useMemo(() => {
    const startOf = (item: WaitingSuggestion) =>
      source
        ? sourceStart
        : item.source.type === "meeting"
          ? (meetingsQuery.data ?? []).find((row) => row.id === item.source.id)
              ?.event_start_time
          : null;
    return new Map<string, RowGuess>(
      items.map((item) => [
        item.id,
        {
          // Last year's tasks name nobody on purpose (#3930).
          who: (() => {
            if (taskWhoOf(item.task) || item.task.last_year_on) return null;
            const userId = suggestTaskOwner(
              item.quote ?? item.task.title,
              members,
            );
            return userId ? { kind: "person" as const, userId } : null;
          })(),
          due: item.task.due_date ? null : suggestTaskDue(startOf(item)),
        },
      ]),
    );
  }, [items, members, meetingsQuery.data, source, sourceStart]);

  if (items.length === 0) return null;

  // The card on show: the same place in the list once the one before it is
  // decided and drops out, so the next one slides in under the officer.
  const at = Math.min(index, items.length - 1);
  const current = items[at]!;
  const busy = busyId !== null || decide.isPending;
  const valuesOf = (item: WaitingSuggestion) =>
    rowValues(item, edits[item.id], guesses.get(item.id));
  // What the minutes or the officer said, without Frapp's guesses: the bulk
  // button creates cards the officer may never have brought up, and a guess
  // is only saved from the card that showed it.
  const saidOf = (item: WaitingSuggestion) => rowValues(item, edits[item.id]);
  const twinOf = (item: WaitingSuggestion) =>
    keptAnyway.has(item.id) ? null : (twins.get(item.id) ?? null);
  // A row open in the form is decided there, with what was typed into it,
  // and one that looks like an existing task waits for the officer's word.
  const ready = items.filter((item) => {
    if (item.id === formFor || twinOf(item)) return false;
    const values = saidOf(item);
    return values.who && values.due;
  });

  function editRow(id: string, patch: RowEdits) {
    setEdits((previous) => ({
      ...previous,
      [id]: { ...previous[id], ...patch },
    }));
  }

  async function acceptRow(item: WaitingSuggestion) {
    const values = valuesOf(item);
    if (
      !values.who ||
      !values.due ||
      // A newly picked time already gone by; the suggestion's own is kept.
      dueEntryPassed(values.due, new Date(), dueEntryOf(item.task))
    ) {
      setFlagged((previous) => new Set(previous).add(item.id));
      return false;
    }
    setBusyId(item.id);
    setCreatingId(item.id);
    try {
      await accept.mutateAsync({ id: item.id, task: editsFor(item, values) });
      toast({
        title: AI_SUGGESTION_COPY.created,
        description: item.task.title,
      });
      return true;
    } catch (error) {
      toast({
        title: AI_SUGGESTION_COPY.acceptFailed,
        description: suggestionRefusalLine(error),
        variant: "destructive",
      });
      return false;
    } finally {
      setBusyId(null);
      setCreatingId(null);
    }
  }

  async function dismissRow(
    item: WaitingSuggestion,
    reason?: AiSuggestionDismissReason,
  ) {
    setBusyId(item.id);
    try {
      await dismiss.mutateAsync({ id: item.id, reason });
    } catch (error) {
      toast({
        title: AI_SUGGESTION_COPY.dismissFailed,
        description: suggestionRefusalLine(error),
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
        task: editsFor(item, saidOf(item)),
      }));
      // The route takes 50 at a time.
      const outcomes = [];
      for (let from = 0; from < decisions.length; from += DECIDE_MAX) {
        outcomes.push(
          ...(await decide.mutateAsync(
            decisions.slice(from, from + DECIDE_MAX),
          )),
        );
      }
      const made = outcomes.filter((outcome) => outcome.ok).length;
      const refused = outcomes.length - made;
      toast({
        title: AI_SUGGESTION_COPY.createdCount(made),
        description:
          refused > 0 ? AI_SUGGESTION_COPY.stillListed(refused) : undefined,
        variant: made === 0 ? "destructive" : undefined,
      });
    } catch (error) {
      toast({
        title: AI_SUGGESTION_COPY.acceptAllFailed,
        description: getErrorMessage(error, AI_SUGGESTION_COPY.tryAgain),
        variant: "destructive",
      });
    }
  }

  const meetingName = (id: string) => {
    const meeting = (meetingsQuery.data ?? []).find((row) => row.id === id);
    return meeting
      ? `${meeting.event_name}, ${meetingDayLabel(meeting.event_start_time)}`
      : AI_SUGGESTION_COPY.meetingFallback;
  };

  const guess = guesses.get(current.id);
  const values = valuesOf(current);

  return (
    <section aria-labelledby={headingId} className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel id={headingId} count={items.length}>
          {AI_SUGGESTION_COPY.heading}
        </SectionLabel>
        {items.length > 1 ? (
          <div className="flex items-center gap-1">
            <p
              className="text-caption tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {AI_SUGGESTION_COPY.position(at + 1, items.length)}
            </p>
            <Button
              size="icon"
              variant="ghost"
              aria-label={AI_SUGGESTION_COPY.previous}
              title={AI_SUGGESTION_COPY.previous}
              disabled={at === 0}
              onClick={() => setIndex(at - 1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={AI_SUGGESTION_COPY.next}
              title={AI_SUGGESTION_COPY.next}
              disabled={at === items.length - 1}
              onClick={() => setIndex(at + 1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
      {current.task.last_year_on ? (
        <p className="text-caption text-muted-foreground">
          {lastYearTaskLine(lastYearBareDay(current.task.last_year_on))}
        </p>
      ) : source ? (
        <p className="text-caption text-muted-foreground">
          {AI_SUGGESTION_COPY.fromActionItems}
        </p>
      ) : (
        <p className="text-caption text-muted-foreground">
          {AI_SUGGESTION_COPY.fromMinutesOf}{" "}
          {current.source.type === "meeting" ? (
            <Link
              href={meetingHref(current.source.id)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {meetingName(current.source.id)}
            </Link>
          ) : (
            AI_SUGGESTION_COPY.aMeeting
          )}
        </p>
      )}
      <SuggestedTaskRow
        key={current.id}
        item={current}
        values={values}
        suggestedWho={
          edits[current.id]?.who === undefined &&
          !!guess?.who &&
          sameTaskWho(values.who, guess.who)
        }
        suggestedDue={
          edits[current.id]?.due === undefined &&
          !!guess?.due &&
          values.due === guess.due
        }
        flagged={flagged.has(current.id)}
        disabled={busy}
        pending={creatingId === current.id}
        formOpen={formFor === current.id}
        onEdit={(patch) => editRow(current.id, patch)}
        onAccept={() => void acceptRow(current)}
        onDismiss={() => void dismissRow(current)}
        onAlreadyDoing={
          current.task.last_year_on
            ? () => void dismissRow(current, "already_doing")
            : undefined
        }
        existing={twinOf(current)}
        onSameTask={() => void dismissRow(current, "already_doing")}
        onDifferentTask={() =>
          setKeptAnyway((previous) => new Set(previous).add(current.id))
        }
        onOpenForm={() => setFormFor(current.id)}
        onCloseForm={() => setFormFor(null)}
        acceptWith={async (task) => {
          await accept.mutateAsync({ id: current.id, task });
        }}
      />
      {/*
        Under the card, for an officer who has read the list and wants the
        rest made as they stand (#4313). Only the ones that say who and when
        go; the rest stay listed.
      */}
      {ready.length > 1 ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void acceptAllReady()}
          >
            {decide.isPending
              ? AI_SUGGESTION_COPY.accepting
              : ready.length === items.length
                ? AI_SUGGESTION_COPY.acceptAll(ready.length)
                : AI_SUGGESTION_COPY.acceptReady(ready.length)}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function SuggestedTaskRow({
  item,
  values,
  suggestedWho,
  suggestedDue,
  flagged,
  disabled,
  pending,
  formOpen,
  onEdit,
  onAccept,
  onDismiss,
  onAlreadyDoing,
  existing,
  onSameTask,
  onDifferentTask,
  onOpenForm,
  onCloseForm,
  acceptWith,
}: {
  item: WaitingSuggestion;
  values: RowValues;
  /** Who, or when, is Frapp's suggestion rather than the minutes' word. */
  suggestedWho: boolean;
  suggestedDue: boolean;
  flagged: boolean;
  disabled: boolean;
  /** This card is the one being created or dismissed. */
  pending: boolean;
  formOpen: boolean;
  onEdit: (patch: RowEdits) => void;
  onAccept: () => void;
  onDismiss: () => void;
  /** Only on a "this time last year" row: the chapter is already on it. */
  onAlreadyDoing?: () => void;
  /** The open task this suggestion reads like, until the officer says. */
  existing: ExistingTask | null;
  onSameTask: () => void;
  onDifferentTask: () => void;
  onOpenForm: () => void;
  onCloseForm: () => void;
  acceptWith: (task: TaskSuggestionEdits) => Promise<void>;
}) {
  const { task } = item;
  // The form's Who, opened on the card's and sent as the suggestion's own
  // who-fields, so a role, a group or up for grabs survives the form.
  // Absent until changed in the form, so it opens on the card's latest pick.
  const [formWhoEdit, setFormWhoEdit] = useState<TaskWho | null>();
  const formWho = formWhoEdit !== undefined ? formWhoEdit : values.who;
  const missingWho = flagged && !values.who;
  const missingDue = flagged && !values.due;
  const passedDue =
    flagged && dueEntryPassed(values.due, new Date(), dueEntryOf(item.task));

  if (formOpen) {
    const initialDraft: TaskDraft = {
      title: task.title,
      // Shown by the Who picker from `formWho`; the form reads it only for a
      // single member.
      assigneeId: values.who?.kind === "person" ? values.who.userId : "",
      dueDate: values.due,
      points: "",
      description: task.description ?? "",
      subtasks: task.subtasks,
      // A suggestion's form has no Repeat (#5119).
      repeat: noTaskRepeatDraft(),
      photoFiles: [],
      keptPhotos: [],
      proofKind: "none",
      showMore: false,
    };
    return (
      <div className="rounded-[14px] border border-border p-3">
        <TaskForm
          suggestion
          who={{ value: formWho, onChange: setFormWhoEdit }}
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
                ...taskWhoSuggestionFields(formWho),
                due_date: input.due_date,
                due_at: input.due_at ?? null,
                subtasks: input.subtasks ?? [],
              });
              return { ok: true };
            } catch (error) {
              return { ok: false, error: suggestionRefusalLine(error) };
            }
          }}
        />
      </div>
    );
  }

  if (existing) {
    return (
      <SimilarTaskCard
        item={item}
        existing={existing}
        disabled={disabled}
        onSame={onSameTask}
        onDifferent={onDifferentTask}
      />
    );
  }

  return (
    <div
      aria-busy={pending || undefined}
      className="space-y-3 rounded-[14px] border border-border p-4"
    >
      <div className="space-y-1">
        <p className="break-words text-base font-medium">{task.title}</p>
        {/* The line of the minutes, when the title had to be cut from it. */}
        {item.quote && item.quote !== task.title ? (
          <p className="break-words text-caption text-muted-foreground">
            “{item.quote}”
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-32 max-w-56 flex-1">
          <WhoPicker
            allow="any"
            label={`Assignee for ${task.title}`}
            placeholder={AI_SUGGESTION_COPY.who}
            className="w-full"
            value={values.who}
            onChange={(next) => onEdit({ who: next })}
            disabled={disabled}
            invalid={missingWho}
          />
          {missingWho ? (
            <p role="alert" className="mt-1 text-caption text-destructive-text">
              {AI_SUGGESTION_COPY.missingWho}
            </p>
          ) : suggestedWho ? (
            <p className="mt-1 text-caption text-muted-foreground">
              {AI_SUGGESTION_COPY.suggestedWho}
            </p>
          ) : null}
        </div>
        <div className="min-w-32 max-w-56 flex-1">
          <DueDateField
            aria-label={`Due date for ${task.title}`}
            timeLabel={`Due time for ${task.title}`}
            placeholder="Due: Fri 5pm"
            missing={missingDue}
            passed={passedDue}
            value={values.due}
            onChange={(value) => onEdit({ due: value })}
            disabled={disabled}
          />
          {suggestedDue && !missingDue && !passedDue ? (
            <p className="mt-1 text-caption text-muted-foreground">
              {AI_SUGGESTION_COPY.suggestedDue}
            </p>
          ) : null}
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
          {onAlreadyDoing ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={onAlreadyDoing}
            >
              {LAST_YEAR_COPY.alreadyDoing}
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            aria-label={`${AI_SUGGESTION_COPY.change}: ${task.title}`}
            title={AI_SUGGESTION_COPY.change}
            disabled={disabled}
            onClick={onOpenForm}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button size="sm" disabled={disabled} onClick={onAccept}>
            {pending ? AI_SUGGESTION_COPY.accepting : AI_SUGGESTION_COPY.accept}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A suggestion beside the open task it reads like (#5562): the two titles
 * side by side, where the existing one stands, and the one question.
 */
function SimilarTaskCard({
  item,
  existing,
  disabled,
  onSame,
  onDifferent,
}: {
  item: WaitingSuggestion;
  existing: ExistingTask;
  disabled: boolean;
  onSame: () => void;
  onDifferent: () => void;
}) {
  const { task } = item;
  const due = taskDueLine(
    existing.due_at ?? existing.due_date,
    existing.status as TaskStatus,
  );
  const where = [statusLabel("task", existing.status), due?.text]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      aria-busy={disabled || undefined}
      className="space-y-3 rounded-[14px] border border-border p-4"
    >
      <p className="text-caption font-medium text-muted-foreground">
        {SIMILAR_TASK_COPY.heading}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-caption text-muted-foreground">
            {SIMILAR_TASK_COPY.suggested}
          </p>
          <p className="break-words text-base font-medium">{task.title}</p>
          {item.quote && item.quote !== task.title ? (
            <p className="break-words text-caption text-muted-foreground">
              “{item.quote}”
            </p>
          ) : null}
        </div>
        <div className="min-w-0 space-y-1 border-l border-border pl-3">
          <p className="text-caption text-muted-foreground">
            {SIMILAR_TASK_COPY.existing}
          </p>
          <p className="break-words text-base font-medium">{existing.title}</p>
          {where ? (
            <p className="text-caption text-muted-foreground">{where}</p>
          ) : null}
          <Link
            href={tasksTaskLink(existing.id)}
            className="inline-block text-caption underline underline-offset-2 hover:text-foreground"
          >
            {SIMILAR_TASK_COPY.openExisting}
          </Link>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        <ReportAiButton
          iconOnly
          name={task.title}
          target={{ subject: "ai_suggestion", subjectId: item.id }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={onDifferent}
        >
          {SIMILAR_TASK_COPY.different}
        </Button>
        <Button size="sm" disabled={disabled} onClick={onSame}>
          {SIMILAR_TASK_COPY.same}
        </Button>
      </div>
    </div>
  );
}
