"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { CheckCircle2, MoreHorizontal, Undo2, Users } from "lucide-react";
import {
  TASK_ACTION_LABELS,
  TASK_CONFIRMED_LABEL,
  TASK_NEEDS_CHANGES_LABEL,
  TASK_STATUS_LABELS,
  actionStatus,
  canReopenOwnTask,
  isSentBack,
  useMeeting,
  useReleaseTask,
  useUpdateTask,
  type TaskEdit,
  type TaskStatus,
} from "@repo/hooks";
import {
  dueEntryFields,
  dueEntryFromTask,
  formatClockShort,
  parseBareDateLocalNoon,
} from "@repo/formatting";
import {
  AI_SUGGESTION_COPY,
  TASK_AUDIENCE_COPY,
  TASK_PHOTOS_MAX,
  TASK_PROOF_KINDS,
  TASK_PROOF_KIND_HINTS,
  TASK_PROOF_KIND_LABELS,
  TASK_SERIES_SCOPE_COPY,
  TASK_TITLE_MAX_LENGTH,
  noTaskRepeatDraft,
  taskGroupLabel,
  taskNeedsSignOff,
  taskRepeatDraftFromRule,
  taskFirstDue,
  taskRepeatRuleOf,
  taskSaveScope,
  taskSeriesBody,
  taskSignedOffAutomatically,
  type RepeatDraft,
  type TaskProofKind,
  type TaskWho,
} from "@repo/validation";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelHeader,
  OWNS_ESCAPE,
} from "@/components/shared/panel";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { RepeatOptions } from "@/components/shared/repeat-options";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedChoice } from "@/components/ui/segmented";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FOCUS_RING } from "@/components/ui/focus";
import { useToast } from "@/lib/hooks/use-toast";
import { toastFailure } from "@/lib/failure-toast";
import { cn, guardIntDraft, initials, parseGuardedInt } from "@/lib/utils";
import type { BoardTask, GroupTileData } from "./board-task";
import { DueDateField, dueEntryPassed } from "./due-date-field";
import { TaskSubtaskList } from "./task-subtasks";
import { TaskRepeatLine } from "./task-repeat";
import {
  MarkDoneControl,
  TaskPhotoPicker,
  TaskProof,
  taskPhotosProblem,
  uploadFailureMessage,
  useUploadTaskPhotos,
  type CompletionProof,
} from "./task-photo";
import { WhoPicker } from "./who-picker";
import type { RowPerson } from "./task-row";
import { movesDayTo } from "./task-edit-form";

/** What the panel shows: one task, or a group task's copies. */
export type TaskPanelTarget =
  | { kind: "task"; task: BoardTask }
  | { kind: "group"; tile: GroupTileData; copies: BoardTask[] };

export interface TaskPanelProps {
  target: TaskPanelTarget | null;
  onClose: () => void;
  personOf: (userId: string) => RowPerson;
  myUserId: string;
  canManage: boolean;
  gate: SubscriptionGate;
  lifecycleWritePending: boolean;
  onChangeStatus: (
    task: BoardTask,
    next: TaskStatus,
    proof?: CompletionProof,
  ) => Promise<boolean>;
  onConfirm: (task: BoardTask) => void;
  onReject: (task: BoardTask) => void;
  onDelete: (task: BoardTask) => void;
  onDeleteGroup: (tile: GroupTileData) => void;
}

/**
 * A task opened from the list (Paul, 2026-11-18: "the editing is terrible"):
 * the app's docked panel, where each field is a label and its value, and a
 * click on the value changes it in place and saves it, as Linear's, Asana's
 * and Notion's task panels do. Nothing waits on a Save button. A field sends
 * only itself, and a change to a repeating task's copy asks "This task only"
 * or "All upcoming tasks" first when it needs to. A group task edits every
 * copy not yet confirmed (`scope: "group"`) and lists where each member is.
 */
export function TaskPanel(props: TaskPanelProps) {
  const { target, onClose } = props;
  const title =
    target?.kind === "group" ? target.tile.sample.title : target?.task.title;
  return (
    <Panel
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      docked
      backLabel="Back to tasks"
    >
      {target ? (
        <PanelContent aria-describedby={undefined}>
          <PanelHeader actions={<MoreMenu {...props} target={target} />}>
            {title}
          </PanelHeader>
          <PanelBody>
            <TaskPanelBody
              // A different task is a different editor: no draft carries over.
              key={
                target.kind === "group" ? `g:${target.tile.id}` : target.task.id
              }
              {...props}
              target={target}
            />
          </PanelBody>
        </PanelContent>
      ) : null}
    </Panel>
  );
}

function MoreMenu({
  target,
  canManage,
  gate,
  onDelete,
  onDeleteGroup,
}: TaskPanelProps & { target: TaskPanelTarget }) {
  if (!canManage) return null;
  const isGroup = target.kind === "group";
  const title = isGroup ? target.tile.sample.title : target.task.title;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`More for ${title}`}
          className="text-muted-foreground"
        >
          <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="text-destructive-text"
          disabled={!!gate.controlProps().disabled}
          onSelect={() =>
            isGroup ? onDeleteGroup(target.tile) : onDelete(target.task)
          }
        >
          {isGroup ? "Delete for everyone" : "Delete task"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Thursday, November 20 at 5 PM", or "Thursday, November 20". */
function writtenDue(task: {
  due_date: string;
  due_at?: string | null;
}): string {
  const at = task.due_at
    ? new Date(task.due_at)
    : parseBareDateLocalNoon(task.due_date);
  if (!at || Number.isNaN(at.getTime())) return task.due_date;
  const now = new Date();
  const day = at.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return task.due_at ? `${day} at ${formatClockShort(at)}` : day;
}

function TaskPanelBody({
  target,
  personOf,
  myUserId,
  canManage,
  gate,
  lifecycleWritePending,
  onChangeStatus,
  onConfirm,
  onReject,
}: TaskPanelProps & { target: TaskPanelTarget }) {
  const { toast } = useToast();
  const updateTask = useUpdateTask();
  const releaseTask = useReleaseTask();
  const uploadPhotos = useUploadTaskPhotos();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [saving, setSaving] = useState(false);
  const isGroup = target.kind === "group";
  const task = isGroup ? target.tile.sample : target.task;
  const viewerUnknown = myUserId === "";
  const isMine = !viewerUnknown && !isGroup && task.assignee_id === myUserId;
  const status = actionStatus(task);
  const sentBack = isSentBack(task);
  const editable = canManage && !task.points_awarded;
  const repeats = !!task.series && !task.series.ended;

  /**
   * Save one field. A copy of a live series asks which tasks it changes when
   * it must (#5119); a group task changes every copy not yet confirmed.
   */
  async function save(
    body: TaskEdit,
    { movesDay = false }: { movesDay?: boolean } = {},
  ): Promise<boolean> {
    let send: TaskEdit = body;
    if (isGroup) {
      send = { ...body, scope: "group" };
    } else {
      const { recurrence_rule, ...rest } = body;
      const decided = taskSaveScope(task, {
        ...(recurrence_rule !== undefined ? { recurrence_rule } : {}),
        movesDay,
        changesOther: Object.keys(rest).length > 0,
      });
      if (decided.kind === "refuse") {
        toast({
          title: "Couldn't save the task",
          description: decided.message,
          variant: "destructive",
        });
        return false;
      }
      let scope = decided.kind;
      if (scope === "ask") {
        const picked = await confirm({
          title: TASK_SERIES_SCOPE_COPY.saveTitle,
          description: TASK_SERIES_SCOPE_COPY.saveMessage,
          confirmLabel: TASK_SERIES_SCOPE_COPY.allUpcoming,
          alternativeLabel: TASK_SERIES_SCOPE_COPY.thisTask,
          tone: "default",
        });
        if (!picked) return false;
        scope = picked.alternative ? "instance" : "series";
      }
      if (scope === "series") send = taskSeriesBody(body);
    }
    setSaving(true);
    try {
      await updateTask.mutateAsync({ id: task.id, body: send });
      return true;
    } catch (error) {
      toastFailure({
        title: "Couldn't save the task",
        error,
        fallback: "Retry in a moment.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function giveBack() {
    try {
      await releaseTask.mutateAsync(task.id);
      toast({
        title: "Given back",
        description: `${task.title} is up for grabs again.`,
      });
    } catch (error) {
      toastFailure({
        title: "Couldn't give it back",
        error,
        fallback: "Retry in a moment.",
      });
    }
  }

  async function reassign(next: TaskWho | null) {
    if (!next || next.kind !== "person" || next.userId === task.assignee_id)
      return;
    const stored = task.stored_status ?? task.status;
    if (stored !== "TODO") {
      const ok = await confirm({
        title: `Give it to ${personOf(next.userId).name}?`,
        description: `It starts over at To do. ${personOf(task.assignee_id).name}'s progress doesn't carry.`,
        confirmLabel: "Give it to them",
        tone: "default",
      });
      if (!ok) return;
    }
    await save({ assignee_id: next.userId });
  }

  async function savePhotos(keptPaths: string[], files: File[]) {
    const problem =
      files.length > 0
        ? taskPhotosProblem(files, TASK_PHOTOS_MAX - keptPaths.length)
        : null;
    if (problem) {
      toast({
        title: "Couldn't add the photo",
        description: problem,
        variant: "destructive",
      });
      return;
    }
    let uploaded: string[] = [];
    if (files.length > 0) {
      setSaving(true);
      try {
        uploaded = await uploadPhotos(files);
      } catch (error) {
        setSaving(false);
        toast({
          title: "Couldn't add the photo",
          description: uploadFailureMessage(error),
          variant: "destructive",
        });
        return;
      }
      setSaving(false);
    }
    await save({ reference_photo_paths: [...keptPaths, ...uploaded] });
  }

  const statusWord = sentBack
    ? TASK_NEEDS_CHANGES_LABEL
    : status === "COMPLETED" && task.points_awarded
      ? TASK_CONFIRMED_LABEL
      : TASK_STATUS_LABELS[task.status];

  const assignee = personOf(task.assignee_id);
  const references = (task.photos ?? []).filter(
    (photo) => photo.kind === "reference",
  );
  const groupLabel = isGroup
    ? taskGroupLabel({
        audience: task.group?.audience ?? "everyone",
        target_name: task.group?.target_name,
        total: target.tile.total,
      })
    : null;

  return (
    <div className="grid gap-5">
      {confirmDialog}
      <TitleField
        task={task}
        editable={editable}
        onSave={(title) => save({ title })}
      />
      {isGroup ? null : (
        <StatusActions
          task={task}
          isMine={isMine}
          viewerUnknown={viewerUnknown}
          canManage={canManage}
          gate={gate}
          pending={lifecycleWritePending || releaseTask.isPending}
          statusWord={statusWord}
          onChangeStatus={(next, proof) => onChangeStatus(task, next, proof)}
          onConfirm={() => onConfirm(task)}
          onReject={() => onReject(task)}
          onGiveBack={
            task.open_task_id && isMine ? () => void giveBack() : undefined
          }
        />
      )}
      <dl className="grid gap-1">
        <FieldRow label="Who">
          {isGroup ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-1.5 text-sm">
              <Users
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              {`${groupLabel} · ${target.tile.total}`}
            </span>
          ) : editable ? (
            <WhoPicker
              allow="person"
              label="Who"
              value={{ kind: "person", userId: task.assignee_id }}
              onChange={(next) => void reassign(next)}
              disabled={!!gate.controlProps().disabled}
              trigger={
                <button
                  type="button"
                  className={valueButtonClass}
                  aria-label={`Who: ${assignee.name}`}
                >
                  <PersonFace person={assignee} />
                  {assignee.name}
                </button>
              }
            />
          ) : (
            <span className="inline-flex items-center gap-2 px-2 py-1.5 text-sm">
              <PersonFace person={assignee} />
              {assignee.name}
            </span>
          )}
        </FieldRow>
        <DueRow task={task} editable={editable} onSave={save} />
        <PointsRow
          task={task}
          editable={editable}
          suffix={isGroup ? " each" : ""}
          onSave={(point_reward) => save({ point_reward })}
        />
        <FieldRow label="Proof">
          {editable ? (
            <div className="grid gap-1 px-2 py-1">
              <SegmentedChoice
                label="Proof to mark it done"
                options={TASK_PROOF_KINDS.map((kind) => ({
                  value: kind,
                  label: TASK_PROOF_KIND_LABELS[kind],
                }))}
                value={task.proof_kind ?? "none"}
                onChange={(proof_kind: TaskProofKind) =>
                  void save({ proof_kind })
                }
                disabled={!!gate.controlProps().disabled}
                dense
              />
              <span className="text-caption text-muted-foreground">
                {TASK_PROOF_KIND_HINTS[task.proof_kind ?? "none"]}
              </span>
            </div>
          ) : (
            <StaticValue>
              {TASK_PROOF_KIND_LABELS[task.proof_kind ?? "none"]}
            </StaticValue>
          )}
        </FieldRow>
        <RepeatRow
          task={task}
          isGroup={isGroup}
          editable={editable && repeats}
          onSave={(recurrence_rule) => save({ recurrence_rule })}
        />
        <NotesRow
          task={task}
          editable={editable}
          onSave={(description) => save({ description })}
        />
        {task.meeting_id ? (
          <FromMinutesRow meetingId={task.meeting_id} />
        ) : null}
        {isGroup ? null : (
          <FieldRow label="Steps" alignTop>
            <div className="px-2 py-1">
              <TaskSubtaskList
                taskId={task.id}
                subtasks={task.subtasks ?? []}
                canCheck={isMine || canManage}
                canEdit={editable}
                closed={task.points_awarded}
                gate={gate}
                embedded
              />
            </div>
          </FieldRow>
        )}
        <FieldRow label="Photos" alignTop>
          {isGroup ? (
            <StaticValue muted>{TASK_AUDIENCE_COPY.noPhotos}</StaticValue>
          ) : editable ? (
            <div className="px-2 py-1">
              <TaskPhotoPicker
                id={`task-panel-${task.id}-photos`}
                taskId={task.id}
                kept={references}
                files={[]}
                onKeptChange={(kept) =>
                  void savePhotos(
                    kept.map((photo) => photo.storage_path),
                    [],
                  )
                }
                onFilesChange={(files) =>
                  void savePhotos(
                    references.map((photo) => photo.storage_path),
                    files,
                  )
                }
                disabled={saving || !!gate.controlProps().disabled}
              />
            </div>
          ) : references.length === 0 ? (
            <StaticValue muted>None</StaticValue>
          ) : null}
        </FieldRow>
      </dl>
      {isGroup ? (
        <GroupProgress
          tile={target.tile}
          copies={target.copies}
          personOf={personOf}
        />
      ) : (
        <TaskProof
          task={
            editable
              ? {
                  ...task,
                  photos: (task.photos ?? []).filter(
                    (p) => p.kind !== "reference",
                  ),
                }
              : task
          }
          showProof={isMine || canManage}
          sentBack={sentBack}
        />
      )}
      {editable ? (
        // One line held at its height, so "Saving…" never moves anything.
        <p
          className="h-5 text-caption text-muted-foreground"
          aria-live="polite"
        >
          {saving || updateTask.isPending
            ? "Saving…"
            : "Changes save as you make them."}
        </p>
      ) : null}
    </div>
  );
}

const valueButtonClass = cn(
  "inline-flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-card-hover",
  FOCUS_RING,
);

/**
 * The minutes a task was suggested from (#5562), named as the meeting is
 * called now. Nothing shows to someone who can't read those minutes, or
 * once they're deleted.
 */
export function FromMinutesRow({ meetingId }: { meetingId: string }) {
  const meeting = useMeeting(meetingId);
  const name = meeting.data?.event_name;
  if (!name) return null;
  return (
    <FieldRow label={AI_SUGGESTION_COPY.taskMinutes}>
      <Link
        href={`/meetings/${meetingId}`}
        className="px-2 text-sm font-medium text-accent-text underline-offset-4 hover:underline"
      >
        {name}
      </Link>
    </FieldRow>
  );
}

export function FieldRow({
  label,
  children,
  alignTop = false,
}: {
  label: string;
  children: ReactNode;
  alignTop?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2",
        alignTop ? "items-start" : "items-center",
      )}
    >
      <dt className={cn("text-sm text-muted-foreground", alignTop && "pt-2")}>
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function StaticValue({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "block px-2 py-1.5 text-sm",
        muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {children}
    </span>
  );
}

function PersonFace({ person }: { person: RowPerson }) {
  return (
    <Avatar className="h-6 w-6">
      {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
      <AvatarFallback tint={person.tint} className="text-caption">
        {initials(person.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A value that becomes its editor on a click and saves when focus leaves it
 * or Enter is pressed; Escape puts it back unsaved. A popover opened from
 * the editor (a date's month) keeps it open.
 */
function InlineEditor({
  onCommit,
  onCancel,
  children,
  multiline = false,
}: {
  onCommit: () => void;
  onCancel: () => void;
  children: ReactNode;
  multiline?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={box}
      className="px-1 py-1"
      // As a sheet, Radix hears Escape first: this marks it the editor's, so
      // it puts the value back rather than closing the panel.
      {...{ [OWNS_ESCAPE]: "" }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && box.current?.contains(next)) return;
        // Focus moving into a layer the editor opened (a date picker's
        // calendar, a confirm) is still editing; the panel's own dialog
        // around the editor is not such a layer.
        const layer =
          next instanceof Element
            ? next.closest(
                '[data-radix-popper-content-wrapper], [role="dialog"], [role="listbox"]',
              )
            : null;
        if (layer && box.current && !layer.contains(box.current)) return;
        onCommit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (
          event.key === "Enter" &&
          !(
            multiline &&
            event.target instanceof HTMLTextAreaElement &&
            !event.metaKey &&
            !event.ctrlKey
          )
        ) {
          event.preventDefault();
          onCommit();
        }
      }}
    >
      {children}
    </div>
  );
}

export function TitleField({
  task,
  editable,
  onSave,
}: {
  task: { title: string };
  editable: boolean;
  onSave: (title: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const heading = (
    <p className="break-words text-title font-semibold text-foreground">
      {task.title}
    </p>
  );
  if (!editable) return heading;
  if (draft === null) {
    return (
      <button
        type="button"
        className={cn(
          "-mx-2 rounded-md px-2 py-1 text-left hover:bg-card-hover",
          FOCUS_RING,
        )}
        aria-label={`Title: ${task.title}`}
        onClick={() => setDraft(task.title)}
      >
        {heading}
      </button>
    );
  }
  const trimmed = draft.trim();
  const tooLong = trimmed.length > TASK_TITLE_MAX_LENGTH;
  return (
    <InlineEditor
      onCancel={() => setDraft(null)}
      onCommit={() => {
        if (!trimmed || tooLong) {
          if (!trimmed) setDraft(null);
          return;
        }
        setDraft(null);
        // A failed save reopens with what was typed; the toast says why.
        if (trimmed !== task.title) {
          void onSave(trimmed).then((ok) => {
            if (!ok) setDraft(draft);
          });
        }
      }}
    >
      <Input
        autoFocus
        aria-label="Title"
        value={draft}
        aria-invalid={tooLong || undefined}
        onChange={(event) => setDraft(event.target.value)}
      />
      {tooLong ? (
        <p className="mt-1 text-caption text-destructive-text">
          Keep the title to {TASK_TITLE_MAX_LENGTH} characters. It&apos;s{" "}
          {trimmed.length} now.
        </p>
      ) : null}
    </InlineEditor>
  );
}

export function DueRow({
  task,
  editable,
  onSave,
}: {
  task: { due_date: string; due_at?: string | null };
  editable: boolean;
  onSave: (
    body: { due_date: string; due_at: string | null },
    options: { movesDay: boolean },
  ) => Promise<boolean>;
}) {
  const stored = dueEntryFromTask(task);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<"missing" | "passed" | null>(null);
  const shown = writtenDue(task);
  if (!editable) {
    return (
      <FieldRow label="Due">
        <StaticValue>{shown}</StaticValue>
      </FieldRow>
    );
  }
  if (draft === null) {
    return (
      <FieldRow label="Due">
        <button
          type="button"
          className={valueButtonClass}
          aria-label={`Due: ${shown}`}
          onClick={() => setDraft(stored)}
        >
          {shown}
        </button>
      </FieldRow>
    );
  }
  return (
    <FieldRow label="Due" alignTop>
      <InlineEditor
        onCancel={() => {
          setDraft(null);
          setProblem(null);
        }}
        onCommit={() => {
          if (!draft) {
            setProblem("missing");
            return;
          }
          if (draft === stored) {
            setDraft(null);
            return;
          }
          if (dueEntryPassed(draft, new Date(), stored)) {
            setProblem("passed");
            return;
          }
          const fields = dueEntryFields(draft);
          const typed = draft;
          setDraft(null);
          setProblem(null);
          void onSave(
            { due_date: fields.due_date, due_at: fields.due_at ?? null },
            { movesDay: movesDayTo(task, fields.due_date) },
          ).then((ok) => {
            if (!ok) setDraft(typed);
          });
        }}
      >
        <DueDateField
          autoFocus
          aria-label="Due date"
          placeholder="Friday 5pm"
          value={draft}
          missing={problem === "missing"}
          passed={problem === "passed"}
          onChange={(value) => {
            setDraft(value);
            setProblem(null);
          }}
        />
      </InlineEditor>
    </FieldRow>
  );
}

export function PointsRow({
  task,
  editable,
  suffix,
  onSave,
}: {
  task: { point_reward: number | null };
  editable: boolean;
  suffix: string;
  onSave: (points: number | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = task.point_reward ? `${task.point_reward}${suffix}` : "None";
  if (!editable) {
    return (
      <FieldRow label="Points">
        <StaticValue muted={!task.point_reward}>{shown}</StaticValue>
      </FieldRow>
    );
  }
  if (draft === null) {
    return (
      <FieldRow label="Points">
        <button
          type="button"
          className={cn(
            valueButtonClass,
            !task.point_reward && "text-muted-foreground",
          )}
          aria-label={`Points: ${shown}`}
          onClick={() =>
            setDraft(task.point_reward ? String(task.point_reward) : "")
          }
        >
          {shown}
        </button>
      </FieldRow>
    );
  }
  return (
    <FieldRow label="Points">
      <InlineEditor
        onCancel={() => setDraft(null)}
        onCommit={() => {
          const next = parseGuardedInt(draft) || null;
          const typed = draft;
          setDraft(null);
          if (next !== (task.point_reward || null)) {
            void onSave(next).then((ok) => {
              if (!ok) setDraft(typed);
            });
          }
        }}
      >
        <Input
          autoFocus
          type="number"
          min={0}
          aria-label="Points"
          placeholder="0"
          className="w-28"
          value={draft}
          onChange={(event) => {
            const next = guardIntDraft(event.target.value);
            if (next !== undefined) setDraft(next);
          }}
        />
      </InlineEditor>
    </FieldRow>
  );
}

function RepeatRow({
  task,
  isGroup,
  editable,
  onSave,
}: {
  task: BoardTask;
  isGroup: boolean;
  editable: boolean;
  onSave: (rule: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<RepeatDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const live = !!task.series && !task.series.ended;
  if (isGroup) {
    return (
      <FieldRow label="Repeat">
        <StaticValue muted>{TASK_AUDIENCE_COPY.noRepeat}</StaticValue>
      </FieldRow>
    );
  }
  const shown = live ? (
    <span className="text-sm text-foreground">
      <TaskRepeatLine task={task} next />
    </span>
  ) : (
    "Doesn't repeat"
  );
  if (!editable) {
    return (
      <FieldRow label="Repeat">
        <StaticValue muted={!live}>{shown}</StaticValue>
      </FieldRow>
    );
  }
  if (draft === null) {
    return (
      <FieldRow label="Repeat">
        <button
          type="button"
          className={valueButtonClass}
          aria-label="Repeat"
          onClick={() =>
            setDraft(
              task.series
                ? taskRepeatDraftFromRule(task.series.recurrence_rule)
                : noTaskRepeatDraft(),
            )
          }
        >
          {shown}
        </button>
      </FieldRow>
    );
  }
  const first = taskFirstDue(dueEntryFromTask(task), draft.timeZone);
  return (
    <FieldRow label="Repeat" alignTop>
      <InlineEditor
        onCancel={() => {
          setDraft(null);
          setProblem(null);
        }}
        onCommit={() => {
          if (!first) return;
          const result = taskRepeatRuleOf(draft, first);
          if (!result.ok) {
            setProblem(result.error);
            return;
          }
          const picked = draft;
          setDraft(null);
          setProblem(null);
          if (result.rule !== (task.series?.recurrence_rule ?? null)) {
            void onSave(result.rule).then((ok) => {
              if (!ok) setDraft(picked);
            });
          }
        }}
      >
        <RepeatOptions
          forTasks
          idPrefix={`task-panel-${task.id}-repeat`}
          draft={draft}
          start={first}
          showLength
          onChange={(next) => {
            setDraft(next);
            setProblem(null);
          }}
        />
        {problem ? (
          <p className="mt-1 text-caption text-destructive-text">{problem}</p>
        ) : null}
      </InlineEditor>
    </FieldRow>
  );
}

export function NotesRow({
  task,
  editable,
  onSave,
}: {
  task: { description: string | null };
  editable: boolean;
  onSave: (description: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = task.description?.trim() ?? "";
  if (!editable) {
    return (
      <FieldRow label="Notes" alignTop>
        <StaticValue muted={!text}>
          <span className="whitespace-pre-wrap">{text || "None"}</span>
        </StaticValue>
      </FieldRow>
    );
  }
  if (draft === null) {
    return (
      <FieldRow label="Notes" alignTop>
        <button
          type="button"
          className={cn(valueButtonClass, !text && "text-muted-foreground")}
          aria-label={text ? `Notes: ${text}` : "Add notes"}
          onClick={() => setDraft(text)}
        >
          <span className="line-clamp-4 whitespace-pre-wrap">
            {text || "Add notes"}
          </span>
        </button>
      </FieldRow>
    );
  }
  return (
    <FieldRow label="Notes" alignTop>
      <InlineEditor
        multiline
        onCancel={() => setDraft(null)}
        onCommit={() => {
          const next = draft.trim() || null;
          const typed = draft;
          setDraft(null);
          if (next !== (text || null)) {
            void onSave(next).then((ok) => {
              if (!ok) setDraft(typed);
            });
          }
        }}
      >
        <Textarea
          autoFocus
          rows={3}
          aria-label="Notes"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </InlineEditor>
    </FieldRow>
  );
}

/** Start, Mark done, Confirm, Send back, Give it back: the task's next move. */
function StatusActions({
  task,
  isMine,
  viewerUnknown,
  canManage,
  gate,
  pending,
  statusWord,
  onChangeStatus,
  onConfirm,
  onReject,
  onGiveBack,
}: {
  task: BoardTask;
  isMine: boolean;
  viewerUnknown: boolean;
  canManage: boolean;
  gate: SubscriptionGate;
  pending: boolean;
  statusWord: string;
  onChangeStatus: (
    next: TaskStatus,
    proof?: CompletionProof,
  ) => Promise<boolean>;
  onConfirm: () => void;
  onReject: () => void;
  onGiveBack?: () => void;
}) {
  const { toast } = useToast();
  const status = actionStatus(task);
  const sentBack = isSentBack(task);
  const needsSignOff = taskNeedsSignOff(task);
  const autoSignedOff = taskSignedOffAutomatically(task);
  // Fails closed, as the list does: an unknown viewer might be the assignee.
  const cannotConfirm = isMine || viewerUnknown;
  const controls = gate.controlProps(pending);
  const reviewable =
    canManage &&
    status === "COMPLETED" &&
    (!task.points_awarded || autoSignedOff);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-muted-foreground">{statusWord}</span>
        {isMine && status === "TODO" ? (
          <Button
            size="sm"
            variant="secondary"
            {...controls}
            onClick={() => void onChangeStatus("IN_PROGRESS")}
          >
            {TASK_ACTION_LABELS.start}
          </Button>
        ) : null}
        {isMine && status === "IN_PROGRESS" ? (
          <MarkDoneControl
            size="sm"
            title={task.title}
            label={TASK_ACTION_LABELS.complete}
            task={task}
            sentBack={sentBack}
            controlProps={controls}
            onComplete={(proof) => onChangeStatus("COMPLETED", proof)}
            onUploadError={(message) =>
              toast({
                title: "Couldn't add the photo",
                description: message,
                variant: "destructive",
              })
            }
          />
        ) : null}
        {canReopenOwnTask({
          stored: status,
          pointsAwarded: task.points_awarded,
          isAssignee: isMine,
          signedOffAutomatically: autoSignedOff,
        }) ? (
          <Button
            size="sm"
            variant="ghost"
            {...controls}
            onClick={() => void onChangeStatus("IN_PROGRESS")}
          >
            {TASK_ACTION_LABELS.reopen}
          </Button>
        ) : null}
        {reviewable && !cannotConfirm && needsSignOff ? (
          <Button
            size="sm"
            className="gap-1.5"
            {...controls}
            onClick={onConfirm}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {TASK_ACTION_LABELS.confirm}
          </Button>
        ) : null}
        {reviewable ? (
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            {...controls}
            onClick={onReject}
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            {TASK_ACTION_LABELS.reject}
          </Button>
        ) : null}
        {onGiveBack && status !== "COMPLETED" ? (
          <Button size="sm" variant="ghost" {...controls} onClick={onGiveBack}>
            {TASK_AUDIENCE_COPY.release}
          </Button>
        ) : null}
      </div>
      {canManage && isMine && status === "COMPLETED" && !task.points_awarded ? (
        <p className="text-caption text-muted-foreground">
          You can&apos;t confirm your own task.
        </p>
      ) : null}
    </div>
  );
}

/** A group task's members and where each stands, open copies first. */
function GroupProgress({
  tile,
  copies,
  personOf,
}: {
  tile: GroupTileData;
  copies: BoardTask[];
  personOf: (userId: string) => RowPerson;
}) {
  const [all, setAll] = useState(false);
  const PREVIEW = 6;
  const sorted = [...copies].sort(
    (a, b) =>
      Number(a.status === "COMPLETED") - Number(b.status === "COMPLETED") ||
      personOf(a.assignee_id).name.localeCompare(personOf(b.assignee_id).name),
  );
  const shown = all ? sorted : sorted.slice(0, PREVIEW);
  return (
    <section aria-label="Who's done" className="grid gap-2">
      <p className="text-sm font-semibold text-foreground">
        {TASK_AUDIENCE_COPY.progress(tile.done, tile.total)}
      </p>
      <ul className="grid gap-1">
        {shown.map((copy) => {
          const person = personOf(copy.assignee_id);
          return (
            <li key={copy.id} className="flex items-center gap-2 text-sm">
              <PersonFace person={person} />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {person.name}
              </span>
              <span
                className={cn(
                  "shrink-0 text-caption",
                  copy.status === "OVERDUE"
                    ? "text-destructive-text"
                    : "text-muted-foreground",
                )}
              >
                {isSentBack(copy)
                  ? TASK_NEEDS_CHANGES_LABEL
                  : copy.status === "COMPLETED" && copy.points_awarded
                    ? TASK_CONFIRMED_LABEL
                    : TASK_STATUS_LABELS[copy.status]}
              </span>
            </li>
          );
        })}
      </ul>
      {sorted.length > PREVIEW ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-self-start"
          onClick={() => setAll((open) => !open)}
        >
          {all ? "Show fewer" : `and ${sorted.length - PREVIEW} more`}
        </Button>
      ) : null}
    </section>
  );
}
