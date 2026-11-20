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
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  ListPlus,
  MoreHorizontal,
  Pencil,
  X,
} from "lucide-react";
import {
  useAcceptAiSuggestion,
  useAiSuggestions,
  useDecideAiSuggestions,
  useDismissAiSuggestion,
  useMeetings,
  useMembers,
  useMyPermissions,
  useSendAiSuggestionToNextAgenda,
  useUndoAiSuggestionNextAgenda,
  existingTaskLine,
  useSimilarTasks,
  type AiSuggestion,
  type AiSuggestionDismissReason,
  type AiSuggestionSourceRef,
  type ExistingTask,
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
  AI_REPORT_COPY,
  AI_SUGGESTION_COPY,
  LAST_YEAR_COPY,
  SIMILAR_TASK_COPY,
  aiSuggestionRefusalLine,
  can,
  lastYearTaskLine,
  nextAgendaOutcomeLines,
} from "@repo/validation";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/shared/section-label";
import {
  DueChip,
  dueChipProblem,
  dueEntryPassed,
} from "@/components/tasks/due-date-field";
import { TaskForm, type TaskDraft } from "@/components/tasks/task-form";
import { WhoPicker } from "@/components/tasks/who-picker";
import {
  meetingDayLabel,
  meetingHref,
} from "@/components/meetings/meeting-copy";
import { useToast } from "@/lib/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useChapterModuleGateState } from "@/lib/hooks/use-chapter-module-gate";
import { ReportAiDialog } from "@/components/ai/report-ai";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 * Who and when are chips under the title, changed in place, because those
 * are the two things a meeting leaves unsaid ("someone should call the
 * caterer"), and a task needs both. Where the minutes left one out, Frapp
 * fills in a suggestion (`task-suggestion-guess.ts`), drawn dashed and named
 * as one to a screen reader. Everything else is worded behind ⋯ (Paul,
 * 2026-11-19, the layout Linear's triage and Todoist's task rows use):
 * Change before creating opens the board's own task form.
 *
 * A task drawn from last year's board (#3930, "this time last year") is the
 * same card under a line that says so, with one more answer: already
 * planned. It carries last year's checklist and nobody's name, because the
 * officer who did it has likely handed the job on.
 *
 * A suggestion that reads like a task the chapter already has open (#5562,
 * `similar-task.ts`) says so before it can be created twice: the card sets
 * the two side by side and asks which it is, the way Linear and Jira show
 * likely duplicates as an issue is filed. Already a task records the
 * existing task as the suggestion's, so the action item follows it; Create
 * anyway brings back the usual card. Until one is pressed, Create all leaves
 * it out, and it waits for the task list to be read at all.
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
  const toNextAgenda = useSendAiSuggestionToNextAgenda();
  const undoNextAgenda = useUndoAiSuggestionNextAgenda();
  const moduleGate = useChapterModuleGateState();
  // The next meeting's Suggested list lives on events (#5790).
  const eventsOn =
    moduleGate.status === "ready" && moduleGate.isModuleEnabled("events");
  const decide = useDecideAiSuggestions();
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, RowEdits>>({});
  // Rows whose Accept was pressed with who or when still missing.
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [formFor, setFormFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The card whose Create task is on its way, to say so on its button.
  const [creatingId, setCreatingId] = useState<string | null>(null);
  // The open task each suggestion reads like, from the tasks this officer
  // can see (#5562).
  const similar = useSimilarTasks(items);

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
  const twinOf = (item: WaitingSuggestion) => similar.twinOf(item.id);
  // A row open in the form is decided there, with what was typed into it,
  // and one that looks like an existing task waits for the officer's word.
  const ready = items.filter((item) => {
    if (item.id === formFor || !similar.known || twinOf(item)) return false;
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

  /** Already a task: the suggestion is that task, and its item follows it. */
  async function linkRow(item: WaitingSuggestion, existing: ExistingTask) {
    setBusyId(item.id);
    try {
      await accept.mutateAsync({
        id: item.id,
        task: { existing_task_id: existing.id },
      });
      toast({
        title: SIMILAR_TASK_COPY.linked,
        description: existing.title,
      });
    } catch (error) {
      toast({
        title: SIMILAR_TASK_COPY.linkFailed,
        description: suggestionRefusalLine(error),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
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

  /**
   * Add to next meeting's agenda (#5790; Shawn, 2026-11-20): the action item
   * goes onto the next meeting with the same people, or under Suggested there
   * when the officer can't edit it, or waits for that meeting to be created.
   * The toast says which, with Undo and a link to the meeting.
   */
  async function sendToNextAgenda(item: WaitingSuggestion) {
    setBusyId(item.id);
    try {
      const outcome = await toNextAgenda.mutateAsync(item.id);
      const lines = nextAgendaOutcomeLines(outcome);
      toast({
        title: lines.title,
        description: outcome.meeting ? (
          <span className="flex flex-col gap-1">
            {lines.body ? <span>{lines.body}</span> : null}
            <Link
              href={`/events?event=${outcome.meeting.id}`}
              className="w-fit underline underline-offset-2"
            >
              {AI_SUGGESTION_COPY.toAgendaOpen}
            </Link>
          </span>
        ) : (
          (lines.body ?? undefined)
        ),
        action: (
          <ToastAction
            altText={`${AI_SUGGESTION_COPY.undo}: ${item.task.title}`}
            onClick={() =>
              void undoNextAgenda.mutateAsync(item.id).then(
                () => toast({ title: AI_SUGGESTION_COPY.undone }),
                (error: unknown) =>
                  toast({
                    title: AI_SUGGESTION_COPY.undoFailed,
                    description: suggestionRefusalLine(error),
                    variant: "destructive",
                  }),
              )
            }
          >
            {AI_SUGGESTION_COPY.undo}
          </ToastAction>
        ),
      });
    } catch (error) {
      toast({
        title: AI_SUGGESTION_COPY.toAgendaFailed,
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
        onToAgenda={
          eventsOn &&
          current.source.type === "meeting" &&
          !current.task.last_year_on
            ? () => void sendToNextAgenda(current)
            : undefined
        }
        onAlreadyDoing={
          current.task.last_year_on
            ? () => void dismissRow(current, "already_doing")
            : undefined
        }
        existing={twinOf(current)}
        onSameTask={(existing) => void linkRow(current, existing)}
        onDifferentTask={() => similar.keep(current.id)}
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
                : items.some(twinOf)
                  ? SIMILAR_TASK_COPY.acceptReady(ready.length)
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
  onToAgenda,
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
  /** From minutes: offer it on the next meeting's agenda instead (#5790). */
  onToAgenda?: () => void;
  /** Only on a "this time last year" row: the chapter is already on it. */
  onAlreadyDoing?: () => void;
  /** The open task this suggestion reads like, until the officer says. */
  existing: ExistingTask | null;
  onSameTask: (existing: ExistingTask) => void;
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
  const dueProblem = dueChipProblem({
    value: values.due,
    missing: missingDue,
    passed: passedDue,
  });

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
        pending={pending}
        onSame={() => onSameTask(existing)}
        onDifferent={onDifferentTask}
        onDismiss={onDismiss}
      />
    );
  }

  return (
    <div
      aria-busy={pending || undefined}
      className="space-y-2 rounded-[14px] border border-border p-4"
    >
      {/*
        One row (#5562; Paul, 2026-11-19: "can we rethink the layout"): what
        to do, then who and when as chips, with Create task and a worded
        menu on the right, the way Linear's triage rows carry their
        properties. The phone's card has the same parts; there Create task
        sits under the chips, in thumb reach, so the title keeps the width.
      */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-words text-base font-medium">{task.title}</p>
          {/* The line of the minutes, when the title had to be cut from it. */}
          {item.quote && item.quote !== task.title ? (
            <p className="break-words text-caption text-muted-foreground">
              “{item.quote}”
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Last year's task has a third answer, worded as the phone's. */}
          {onAlreadyDoing ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={onAlreadyDoing}
            >
              {LAST_YEAR_COPY.alreadyDoing}
            </Button>
          ) : null}
          <Button size="sm" disabled={disabled} onClick={onAccept}>
            {pending ? AI_SUGGESTION_COPY.accepting : AI_SUGGESTION_COPY.accept}
          </Button>
          <SuggestionMenu
            item={item}
            disabled={disabled}
            onChange={onOpenForm}
            onToAgenda={onToAgenda}
            onDismiss={onDismiss}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <WhoPicker
          chip
          guessed={suggestedWho}
          allow="any"
          // A suggestion's payload has no tier field yet (#5614).
          tiers={false}
          label={
            suggestedWho
              ? `Assignee for ${task.title}, ${AI_SUGGESTION_COPY.suggestedWho.toLowerCase()}`
              : `Assignee for ${task.title}`
          }
          placeholder={AI_SUGGESTION_COPY.who}
          value={values.who}
          onChange={(next) => onEdit({ who: next })}
          disabled={disabled}
          invalid={missingWho}
          aria-describedby={missingWho ? `${item.id}-who` : undefined}
        />
        <DueChip
          label={`Due date for ${task.title}`}
          timeLabel={`Due time for ${task.title}`}
          placeholder={AI_SUGGESTION_COPY.when}
          guessed={suggestedDue}
          note={suggestedDue ? AI_SUGGESTION_COPY.suggestedDue : null}
          missing={missingDue}
          passed={passedDue}
          value={values.due}
          onChange={(value) => onEdit({ due: value })}
          disabled={disabled}
          aria-describedby={dueProblem ? `${item.id}-due` : undefined}
        />
      </div>
      {missingWho ? (
        <p
          id={`${item.id}-who`}
          role="alert"
          className="text-caption text-destructive-text"
        >
          {AI_SUGGESTION_COPY.missingWho}
        </p>
      ) : null}
      {/* Said here too: the chip's own field is in its closed popover. */}
      {dueProblem ? (
        <p
          id={`${item.id}-due`}
          role="alert"
          className="text-caption text-destructive-text"
        >
          {dueProblem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The card's other answers, worded behind ⋯ (#5562): a flag, an × and a
 * pencil read as nothing until hovered. Change before creating opens the
 * task form; Report this, the AI report sheet, for a member who may report.
 */
function SuggestionMenu({
  item,
  disabled,
  onChange,
  onToAgenda,
  onDismiss,
}: {
  item: WaitingSuggestion;
  disabled: boolean;
  onChange?: () => void;
  onToAgenda?: () => void;
  onDismiss: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const permissions = useMyPermissions().data?.permissions;
  const mayReport = !!permissions && can("ai:use", permissions);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`${AI_SUGGESTION_COPY.more}: ${item.task.title}`}
            title={AI_SUGGESTION_COPY.more}
            disabled={disabled}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onChange ? (
            <DropdownMenuItem onSelect={onChange}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {AI_SUGGESTION_COPY.change}
            </DropdownMenuItem>
          ) : null}
          {onToAgenda ? (
            <DropdownMenuItem onSelect={onToAgenda}>
              <ListPlus className="h-4 w-4" aria-hidden="true" />
              {AI_SUGGESTION_COPY.toAgenda}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={onDismiss}>
            <X className="h-4 w-4" aria-hidden="true" />
            {AI_SUGGESTION_COPY.dismiss}
          </DropdownMenuItem>
          {/*
            Gone once sent, as on the phone, whose menu has no greyed rows:
            a report can't be taken back or sent twice.
          */}
          {mayReport && !reported ? (
            <DropdownMenuItem onSelect={() => setReporting(true)}>
              <Flag className="h-4 w-4" aria-hidden="true" />
              {AI_REPORT_COPY.action}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {reporting ? (
        <ReportAiDialog
          target={{ subject: "ai_suggestion", subjectId: item.id }}
          onClose={() => setReporting(false)}
          onReported={() => setReported(true)}
        />
      ) : null}
    </>
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
  pending,
  onSame,
  onDifferent,
  onDismiss,
}: {
  item: WaitingSuggestion;
  existing: ExistingTask;
  disabled: boolean;
  pending: boolean;
  onSame: () => void;
  onDifferent: () => void;
  onDismiss: () => void;
}) {
  const { task } = item;
  const where = existingTaskLine(existing);
  return (
    <div
      aria-busy={pending || undefined}
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
        <SuggestionMenu item={item} disabled={disabled} onDismiss={onDismiss} />
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
