"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { dueEntryFields } from "@repo/formatting";
import type { DispatchResult, TaskInput } from "@repo/chat-core/dispatch";
import {
  TASK_AUDIENCE_COPY,
  TASK_AUDIENCE_EVERYONE,
  TASK_PHOTOS_MAX,
  TASK_TITLE_MAX_LENGTH,
  taskRepeatRuleOf,
  type TaskWho,
  taskRepeatSummary,
} from "@repo/validation";
import { RepeatOptions } from "@/components/shared/repeat-options";
import { firstDueOf } from "@/components/tasks/task-repeat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoreOptionsToggle } from "@/components/ui/more-options-toggle";
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
import {
  DueDateField,
  dueEntryPassed,
} from "@/components/tasks/due-date-field";
import { SubtaskListEditor } from "@/components/tasks/subtask-list-editor";
import { pointsLabel } from "@/components/events/event-labels";
import { useToast } from "@/lib/hooks/use-toast";
import {
  TaskPhotoFields,
  taskPhotosProblem,
  uploadFailureMessage,
  useUploadTaskPhotos,
} from "@/components/tasks/task-photo";
import { cn, guardIntDraft, parseGuardedInt } from "@/lib/utils";
import { WhoPicker } from "@/components/tasks/who-picker";

// The draft lives in its own module so the chat shell can build one without
// loading this form, which it loads only when the + card opens it (#3716).
// Re-exported for the form's other callers, which import it from here.
export { taskDraftFrom, type TaskDraft } from "./task-draft";
import { taskDraftFrom, type TaskDraft } from "./task-draft";

type Missing = {
  /** Why the Repeat pick can't be saved (#5119). */
  repeat?: string;
  title?: boolean;
  titleTooLong?: boolean;
  assignee?: boolean;
  due?: boolean;
  /** The due time has already gone by (#4512). */
  passed?: boolean;
  /** Why the photo can't be sent, or why it didn't upload (#4565). */
  photo?: string | null;
};

/** The form's Assignee as the Who picker holds it. */
function whoOfAssignee(assigneeId: string): TaskWho | null {
  if (assigneeId === TASK_AUDIENCE_EVERYONE) {
    return { kind: "each", target: { kind: "chapter" } };
  }
  return assigneeId ? { kind: "person", userId: assigneeId } : null;
}

/** A pick back into the Assignee string: a user id, `everyone`, or blank. */
function assigneeOfWho(who: TaskWho | null): string {
  if (who?.kind === "person") return who.userId;
  if (who?.kind === "each" && who.target.kind === "chapter") {
    return TASK_AUDIENCE_EVERYONE;
  }
  return "";
}

export interface TaskFormProps {
  initialDraft?: TaskDraft;
  onDraftChange?: (draft: TaskDraft) => void;
  /**
   * Creates the task and posts its card in the channel the form was opened
   * in, as `/task` does (`postTask`). `{ ok: false }` keeps the form open
   * with the draft; anything else is done, and the host reports a warning.
   */
  onPost: (input: TaskInput) => Promise<DispatchResult>;
  /**
   * Runs once the form is valid, before any photo is uploaded, with the
   * write as it stands minus photo paths and whether new photos are on it:
   * a step that can still back out (the scope prompt on a repeating task,
   * #5119). `true` goes on; `false` stays open and says nothing; a string
   * stays open and says it.
   */
  beforeSave?: (
    input: TaskInput,
    hasNewPhotos: boolean,
  ) => Promise<boolean | string>;
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
    /** The task whose stored reference photos the draft keeps (#4635). */
    taskId?: string;
    /**
     * The task is a copy of a live repeating series (#5119), so its Repeat
     * can change. A task that doesn't repeat has no Repeat on an edit: a
     * series starts with a new task.
     */
    repeats?: boolean;
  };
  /**
   * Opened on a suggested task (#4313) to change it before accepting: Accept
   * and Cancel, and no Points field, because a suggested task never carries
   * points (`spec/behavior/meetings.md` § Suggested tasks) and the officer
   * adds them on the task afterwards.
   */
  suggestion?: boolean;
  /**
   * Offer Everyone at the top of Assignee (#4295 step 3): the field then
   * holds `everyone` in place of a user id, and the caller sends it as
   * `audience` (`taskWhoFields`). Only where a task for everyone can be
   * made: never the chat + card (no card is posted for one) or an edit.
   */
  offerEveryone?: boolean;
}

/**
 * The chat composer's Task form (#3865, #3773 step 3), inside the + card
 * (#3983): Title, Assignee and Due date, the fields `CreateTaskDto` requires,
 * with Points, Repeat (#5119) and Description behind More options. A missing
 * field is outlined, named under it and focused on submit, never while
 * typing. Role assignees are #4295 step 3.
 */
export function TaskForm({
  initialDraft,
  onDraftChange,
  onPost,
  beforeSave,
  onDone,
  onDiscard,
  editing,
  suggestion = false,
  offerEveryone = false,
}: TaskFormProps) {
  const layout = "card";
  const field = fieldClass(layout);
  // `POST /v1/tasks` carries no `@FreeTier`: paid-ops (#841).
  const gate = useSubscriptionGate();
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
  const uploadPhotos = useUploadTaskPhotos();
  // An edit opens on the title, the way the + card's form does.
  useEffect(() => {
    if (editing || suggestion) titleRef.current?.focus();
    // Once, when the edit opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const edit = (patch: Partial<TaskDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  // A task for everyone (#4295 step 3) can't repeat or carry photos yet, so
  // the form hides both and sends neither.
  const forEveryone = draft.assigneeId === TASK_AUDIENCE_EVERYONE;
  const offersPhotos = !suggestion && !forEveryone;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting) return;
    const trimmed = draft.title.trim();
    const nextMissing: Missing = {
      title: !trimmed,
      titleTooLong: trimmed.length > TASK_TITLE_MAX_LENGTH,
      assignee: !draft.assigneeId,
      due: !draft.dueDate,
      // An edit keeps the task's own time even once it has passed (#4296),
      // and an accepted suggestion keeps the one the minutes gave it.
      passed: dueEntryPassed(
        draft.dueDate,
        new Date(),
        editing || suggestion ? initialDraft?.dueDate : undefined,
      ),
    };
    setMissing(nextMissing);
    if (nextMissing.title || nextMissing.titleTooLong) {
      return titleRef.current?.focus();
    }
    if (nextMissing.assignee) return assigneeRef.current?.focus();
    if (nextMissing.due || nextMissing.passed) return dueRef.current?.focus();
    // The Repeat pick (#5119), read against the first due it repeats from.
    const showRepeat =
      !suggestion && !forEveryone && (!editing || editing.repeats);
    const firstDue = firstDueOf(draft.dueDate, draft.repeat.timeZone);
    const repeat =
      showRepeat && firstDue ? taskRepeatRuleOf(draft.repeat, firstDue) : null;
    if (repeat && !repeat.ok) {
      setMissing((prev) => ({ ...prev, repeat: repeat.error }));
      edit({ showMore: true });
      return;
    }
    const photoProblem = offersPhotos
      ? taskPhotosProblem(
          draft.photoFiles,
          TASK_PHOTOS_MAX - draft.keptPhotos.length,
        )
      : null;
    if (photoProblem) {
      setMissing((prev) => ({ ...prev, photo: photoProblem }));
      edit({ showMore: true });
      return;
    }
    // The write as it stands, photos aside, for `beforeSave` and `onPost`.
    const base: TaskInput = {
      title: trimmed,
      description: draft.description.trim() || undefined,
      assignee_id: draft.assigneeId,
      // "YYYY-MM-DD", or with a time "YYYY-MM-DDTHH:MM" (#4003).
      ...dueEntryFields(draft.dueDate),
      subtasks: draft.subtasks.length > 0 ? draft.subtasks : undefined,
      point_reward: suggestion ? undefined : parseGuardedInt(draft.points),
      ...(suggestion ? {} : { proof_kind: draft.proofKind }),
      // A new task sends a rule only when it repeats; an edit sends the
      // rule as it should stand, null for "Doesn't repeat" (#5119).
      ...(repeat?.ok
        ? editing
          ? { recurrence_rule: repeat.rule }
          : repeat.rule
            ? { recurrence_rule: repeat.rule }
            : {}
        : {}),
    };
    setPosting(true);
    try {
      if (beforeSave) {
        const go = await beforeSave(
          !offersPhotos
            ? base
            : {
                ...base,
                reference_photo_paths: draft.keptPhotos.map(
                  (photo) => photo.storage_path,
                ),
              },
          offersPhotos && draft.photoFiles.length > 0,
        );
        if (go !== true) {
          if (typeof go === "string") {
            toast({
              title: "Couldn't save the task",
              description: go,
              variant: "destructive",
            });
          }
          return;
        }
      }
      // The photos go up first; the write carries their paths (#4635). An
      // edit sends the set as it should stand: the kept ones, then the new.
      let uploaded: string[] = [];
      if (offersPhotos && draft.photoFiles.length > 0) {
        try {
          uploaded = await uploadPhotos(draft.photoFiles);
        } catch (error) {
          setMissing((prev) => ({
            ...prev,
            photo: uploadFailureMessage(error),
          }));
          edit({ showMore: true });
          return;
        }
      }
      const referencePhotoPaths = [
        ...draft.keptPhotos.map((photo) => photo.storage_path),
        ...uploaded,
      ];
      const result = await onPost({
        ...base,
        ...(offersPhotos ? { reference_photo_paths: referencePhotoPaths } : {}),
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

  const showRepeat =
    !suggestion && !forEveryone && (!editing || editing.repeats);
  const firstDue = firstDueOf(draft.dueDate, draft.repeat.timeZone);
  const moreSummary = [
    ...(suggestion
      ? []
      : [pointsLabel(parseGuardedInt(draft.points) ?? 0) ?? "No points"]),
    // How it repeats, right after the points: "5 points · Every Monday".
    showRepeat && draft.repeat.preset !== "NONE" && firstDue
      ? taskRepeatSummary(draft.repeat, firstDue)
      : null,
    draft.description.trim() ? "Description" : "No description",
    ...(suggestion
      ? []
      : [
          offersPhotos && draft.photoFiles.length + draft.keptPhotos.length > 0
            ? "Photos"
            : null,
          draft.proofKind === "photo"
            ? "Photo required"
            : draft.proofKind === "link"
              ? "Link required"
              : null,
        ].filter(Boolean)),
  ]
    .filter(Boolean)
    .join(" · ");

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
          <WhoPicker
            ref={assigneeRef}
            id={`${ids}-assignee`}
            label="Assignee"
            placeholder="Pick a member"
            allow={offerEveryone ? "personOrEveryone" : "person"}
            className={cn(field, "w-full")}
            value={whoOfAssignee(draft.assigneeId)}
            onChange={(next) => {
              edit({ assigneeId: assigneeOfWho(next) });
              setMissing((prev) => ({ ...prev, assignee: false }));
            }}
            disabled={gate.controlProps().disabled}
            invalid={missing.assignee}
          />
          {missing.assignee ? (
            <FieldError>Pick an assignee.</FieldError>
          ) : draft.assigneeId === TASK_AUDIENCE_EVERYONE ? (
            <p className="text-caption text-muted-foreground">
              {TASK_AUDIENCE_COPY.everyoneHint(null)}
            </p>
          ) : (
            editing?.assigneeNote(draft.assigneeId)
          )}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-1">
          <Label htmlFor={`${ids}-due`}>Due date</Label>
          <DueDateField
            ref={dueRef}
            id={`${ids}-due`}
            className={field}
            placeholder="Friday 5pm"
            timeClassName={field}
            missing={missing.due}
            passed={missing.passed}
            value={draft.dueDate}
            onChange={(value) => {
              edit({ dueDate: value });
              setMissing((prev) => ({
                ...prev,
                due: prev.due && !value,
                passed: false,
              }));
            }}
            {...gate.controlProps()}
          />
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
          {forEveryone && !suggestion ? (
            <p className="text-caption text-muted-foreground">
              {TASK_AUDIENCE_COPY.noRepeat}
            </p>
          ) : null}
          {showRepeat ? (
            <div className="grid gap-1">
              <RepeatOptions
                forTasks
                idPrefix={`${ids}-repeat`}
                draft={draft.repeat}
                start={firstDue}
                showLength
                disabled={posting || gate.controlProps().disabled}
                onChange={(repeat) => {
                  edit({ repeat });
                  setMissing((prev) => ({ ...prev, repeat: undefined }));
                }}
              />
              {missing.repeat ? (
                <FieldError>{missing.repeat}</FieldError>
              ) : null}
            </div>
          ) : null}
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
          {suggestion ? null : (
            <TaskPhotoFields
              id={ids}
              withoutPhotos={forEveryone}
              draft={draft}
              taskId={editing?.taskId}
              disabled={posting || gate.controlProps().disabled}
              problem={missing.photo}
              onChange={(patch) => {
                edit(patch);
                if ("photoFiles" in patch || "keptPhotos" in patch) {
                  const next = { ...draft, ...patch };
                  setMissing((prev) => ({
                    ...prev,
                    photo: taskPhotosProblem(
                      next.photoFiles,
                      TASK_PHOTOS_MAX - next.keptPhotos.length,
                    ),
                  }));
                }
              }}
            />
          )}
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
