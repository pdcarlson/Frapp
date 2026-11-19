"use client";

import { Check, Users } from "lucide-react";
import {
  TASK_ACTION_LABELS,
  TASK_NEEDS_CHANGES_LABEL,
  TASK_STATUS_LABELS,
  TASK_DONE_LABEL,
  actionStatus,
  isSentBack,
  type TaskStatus,
} from "@repo/hooks";
import { formatDayTime, formatPointsChip, formatWeekdayDay } from "@repo/formatting";
import {
  TASK_AUDIENCE_COPY,
  taskGroupLabel,
  taskNeedsSignOff,
} from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FOCUS_RING } from "@/components/ui/focus";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { FollowerChip } from "@/components/tasks/task-follower";
import { cn, initials } from "@/lib/utils";
import { useToast } from "@/lib/hooks/use-toast";
import type { MemberAvatarTint } from "@repo/hooks";
import { taskDueClause } from "./task-due";
import { MarkDoneControl, type CompletionProof } from "./task-photo";
import type { BoardTask, GroupTileData } from "./board-task";

/*
 * The Tasks page's compact list (Paul, 2026-11-18: "I had to scroll all the
 * way down"): one 40px row a task, as Linear's, Asana's and Todoist's lists
 * are, so an exec's 20 to 40 tasks fit on a screen. A row says what, who,
 * when and for how many points; everything else, and every edit, is in the
 * task's panel, which the row opens.
 */

/** A row's hairline list, flush on the page. */
export const TASK_ROWS_CLASS = "divide-y divide-border";

const ROW_CLASS =
  "group/row flex min-h-10 items-center gap-2 py-1 pr-1 @xl:gap-3";

/** Whose face and name a row shows. */
export interface RowPerson {
  name: string;
  avatarUrl: string | null;
  tint: MemberAvatarTint | null;
}

export function TaskRow({
  task,
  person,
  isMine,
  showStatus,
  canConfirm,
  gate,
  lifecycleWritePending,
  selected,
  audience = null,
  onOpen,
  onChangeStatus,
  onConfirm,
}: {
  task: BoardTask;
  person: RowPerson;
  /**
   * Under My tasks, a copy of a group task names who it went to in place of
   * the viewer's own face (#5699): it is theirs to finish, but the chapter
   * got it too, with how far everyone is.
   */
  audience?: CopyAudience | null;
  /** The viewer's own task: its circle is the next step. */
  isMine: boolean;
  /** Say where it stands: no heading above it says so. */
  showStatus: boolean;
  /** Offer Confirm on the row: an officer, someone else's completion. */
  canConfirm: boolean;
  gate: SubscriptionGate;
  lifecycleWritePending: boolean;
  selected: boolean;
  onOpen: () => void;
  onChangeStatus: (next: TaskStatus, proof?: CompletionProof) => Promise<boolean>;
  onConfirm: () => void;
}) {
  const { toast } = useToast();
  const status = actionStatus(task);
  const sentBack = isSentBack(task);
  const due = taskDueClause(task);
  const waiting = status === "COMPLETED" && !task.points_awarded;
  const controls = gate.controlProps(lifecycleWritePending);

  let circle: React.ReactNode;
  if (isMine && status === "TODO") {
    circle = (
      <CircleButton
        state="todo"
        label={`${TASK_ACTION_LABELS.start}: ${task.title}`}
        disabled={!!controls.disabled}
        onClick={() => void onChangeStatus("IN_PROGRESS")}
      />
    );
  } else if (isMine && status === "IN_PROGRESS") {
    circle = (
      <MarkDoneControl
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
        renderTrigger={({ onClick, disabled }) => (
          <CircleButton
            state="started"
            label={`${TASK_ACTION_LABELS.complete}: ${task.title}`}
            disabled={disabled}
            onClick={onClick}
          />
        )}
      />
    );
  } else {
    circle = (
      <CircleMark
        state={
          status === "COMPLETED" ? "done" : status === "IN_PROGRESS" ? "started" : "todo"
        }
      />
    );
  }

  return (
    <li
      className={cn(ROW_CLASS, selected && "bg-accent-subtle")}
      data-task-row={task.id}
      aria-current={selected || undefined}
    >
      {circle}
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md text-left",
          FOCUS_RING,
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate text-sm font-medium text-foreground",
            status === "COMPLETED" && task.points_awarded && "text-muted-foreground",
          )}
        >
          {task.title}
        </span>
        {sentBack ? (
          <Badge variant="warning" className="shrink-0">
            {TASK_NEEDS_CHANGES_LABEL}
          </Badge>
        ) : showStatus && status === "IN_PROGRESS" ? (
          <Badge variant="outline" className="shrink-0">
            {TASK_STATUS_LABELS.IN_PROGRESS}
          </Badge>
        ) : showStatus && waiting ? (
          <Badge variant="outline" className="shrink-0">
            {TASK_STATUS_LABELS.COMPLETED}
          </Badge>
        ) : status === "COMPLETED" && !taskNeedsSignOff(task) && task.points_awarded ? (
          <Badge variant="success" className="shrink-0">
            {TASK_DONE_LABEL}
          </Badge>
        ) : null}
      </button>
      {task.followed_by ? (
        <FollowerChip
          name={task.followed_by_name}
          className="hidden max-w-[10rem] shrink @lg:inline-flex"
        />
      ) : null}
      {audience ? (
        <>
          <AudienceText label={audience.label} />
          <MiniProgress done={audience.done} total={audience.total} title={task.title} />
        </>
      ) : (
        <PersonChip person={person} />
      )}
      <DueText task={task} due={due} />
      <PointsTag points={task.point_reward} />
      {waiting && canConfirm ? (
        <Button
          type="button"
          size="toolbar"
          variant="secondary"
          className="h-8 shrink-0"
          {...controls}
          onClick={onConfirm}
        >
          {TASK_ACTION_LABELS.confirm}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * A group task's open copies as one row, with how many are done: "Everyone
 * in Recruitment Committee", "0 of 6".
 */
export function GroupTaskRow({
  tile,
  selected,
  onOpen,
}: {
  tile: GroupTileData;
  selected: boolean;
  onOpen: () => void;
}) {
  const task = tile.sample;
  const due = taskDueClause(task);
  const label = task.group
    ? taskGroupLabel({
        audience: task.group.audience ?? "everyone",
        target_name: task.group.target_name,
        total: tile.total,
      })
    : TASK_AUDIENCE_COPY.everyone;
  return (
    <li
      className={cn(ROW_CLASS, selected && "bg-accent-subtle")}
      data-task-group={tile.id}
      aria-label={`${task.title}, for ${lowerFirst(label)}`}
      aria-current={selected || undefined}
    >
      <CircleMark state="todo" />
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md text-left",
          FOCUS_RING,
        )}
      >
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {task.title}
        </span>
      </button>
      <AudienceText label={label} />
      {task.followed_by ? (
        <FollowerChip
          name={task.followed_by_name}
          className="hidden max-w-[10rem] shrink @xl:inline-flex"
        />
      ) : null}
      <MiniProgress done={tile.done} total={tile.total} title={task.title} />
      <DueText task={task} due={due} />
      <PointsTag points={task.point_reward} />
    </li>
  );
}

/** Who a group task went to, and how far its copies are, as a row shows it. */
export interface CopyAudience {
  label: string;
  done: number;
  total: number;
}

/**
 * Who the group task a copy belongs to went to ("Everyone", "Everyone in
 * Exec board", "6 people") and its progress over every copy, from the
 * `group` each task read carries; `null` for one person's own task.
 */
export function copyAudience(task: BoardTask): CopyAudience | null {
  if (!task.group_id || !task.group) return null;
  return {
    label: taskGroupLabel({
      audience: task.group.audience ?? "everyone",
      target_name: task.group.target_name,
      total: task.group.total,
    }),
    done: task.group.done,
    total: task.group.total,
  };
}

/** "Everyone" with the people glyph; shown from `@lg`, read aloud always. */
function AudienceText({ label }: { label: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-[14rem] shrink items-center gap-1.5 text-caption text-muted-foreground">
      <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only truncate @lg:not-sr-only">{label}</span>
    </span>
  );
}

/** "Everyone in Rush" as it reads mid-sentence: "for everyone in Rush". */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "0 of 6" with a short bar. */
function MiniProgress({
  done,
  total,
  title,
}: {
  done: number;
  total: number;
  title: string;
}) {
  const share = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
      <span
        className="hidden h-1 w-10 overflow-hidden rounded-full bg-border @md:block"
        role="progressbar"
        aria-label={`${title}: ${TASK_AUDIENCE_COPY.progress(done, total)}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <span className="block h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
      </span>
      {`${done} of ${total}`}
    </span>
  );
}

function PersonChip({ person }: { person: RowPerson }) {
  return (
    <span className="inline-flex min-w-0 max-w-[11rem] shrink items-center gap-1.5 text-caption text-muted-foreground">
      <Avatar className="h-6 w-6">
        {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
        <AvatarFallback tint={person.tint} className="text-caption">
          {initials(person.name)}
        </AvatarFallback>
      </Avatar>
      <span className="hidden truncate @lg:inline">{person.name}</span>
      <span className="sr-only @lg:hidden">{person.name}</span>
    </span>
  );
}

function DueText({
  task,
  due,
}: {
  task: BoardTask;
  due: { text: string; overdue: boolean } | null;
}) {
  if (!due) return null;
  return (
    <span
      className={cn(
        "shrink-0 text-caption",
        due.overdue ? "text-destructive-text" : "text-muted-foreground",
      )}
      title={
        (task.due_at ? formatDayTime(task.due_at) : formatWeekdayDay(task.due_date)) ??
        undefined
      }
    >
      {due.text}
    </span>
  );
}

export function PointsTag({ points }: { points: number | null | undefined }) {
  if (!points) return null;
  return (
    <Badge variant="outline" className="shrink-0">
      {formatPointsChip(points)}
    </Badge>
  );
}

type CircleState = "todo" | "started" | "done";

function circleClass(state: CircleState) {
  return cn(
    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
    state === "done"
      ? "border-success bg-success text-success-foreground"
      : state === "started"
        ? "border-primary"
        : "border-control-edge",
  );
}

function CircleMark({ state }: { state: CircleState }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
      <span className={circleClass(state)}>
        {state === "done" ? <Check className="h-3 w-3" /> : null}
        {state === "started" ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
      </span>
    </span>
  );
}

function CircleButton({
  state,
  label,
  disabled,
  onClick,
}: {
  state: CircleState;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11",
        FOCUS_RING,
      )}
    >
      <span className={circleClass(state)}>
        {state === "started" ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
      </span>
    </button>
  );
}
