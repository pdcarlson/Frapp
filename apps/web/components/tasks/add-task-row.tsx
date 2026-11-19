"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { dueEntryFields } from "@repo/formatting";
import type { CreateOpenTaskBody } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { FOCUS_RING_WITHIN } from "@/components/ui/focus";
import { dueEntryPassed } from "@/components/tasks/due-date-field";
import { SubtaskListEditor } from "@/components/tasks/subtask-list-editor";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { cn, guardIntDraft, parseGuardedInt } from "@/lib/utils";
import {
  EMPTY_TASK_PHOTO_DRAFT,
  TaskPhotoFields,
  taskPhotosProblem,
  uploadFailureMessage,
  useUploadTaskPhotos,
  type TaskPhotoDraft,
} from "@/components/tasks/task-photo";
import {
  TASK_AUDIENCE_COPY,
  noTaskRepeatDraft,
  taskRepeatRuleOf,
  taskWhoRequest,
  type RepeatDraft,
  type TaskProofKind,
  type TaskWho,
  type TaskWhoTaskFields,
} from "@repo/validation";
import { RepeatOptions } from "@/components/shared/repeat-options";
import { firstDueOf } from "@/components/tasks/task-repeat";
import { WhoPicker } from "@/components/tasks/who-picker";

/** What `POST /v1/tasks` takes from the page. */
type NewTaskBody = {
  title: string;
  description?: string;
  due_date: string;
  /** Present only when the task has a time of day (#4003). */
  due_at?: string;
  /** Subtask titles, in order (#4003). */
  subtasks?: string[];
  point_reward?: number;
  /** Reference photos already uploaded, in order (#4635). */
  reference_photo_paths?: string[];
  /** What Mark done needs (#4635). */
  proof_kind?: TaskProofKind;
  /** Repeat on this rule (#5119); the task is the series' first copy. */
  recurrence_rule?: string;
} & TaskWhoTaskFields;

/**
 * A create from the add line: a task (one person, or a copy each) or a task
 * up for grabs, as `taskWhoRequest` routes the pick.
 */
export type TaskCreate =
  | { endpoint: "/v1/tasks"; body: NewTaskBody }
  | { endpoint: "/v1/open-tasks"; body: CreateOpenTaskBody };

const EMPTY = {
  title: "",
  description: "",
  who: null as TaskWho | null,
  due: "",
  points: "",
  subtasks: [] as string[],
  repeat: noTaskRepeatDraft() as RepeatDraft,
  ...EMPTY_TASK_PHOTO_DRAFT,
};

type Missing = {
  /** Why the Repeat pick can't be saved (#5119). */
  repeat?: string;
  who?: boolean;
  due?: boolean;
  passed?: boolean;
  /** Why the picked photo can't be sent, or why it didn't upload. */
  photo?: string | null;
};

/**
 * The page's quick add (Paul, 2026-11-18): one line, as Todoist's is. Type a
 * title and press Enter; Who, Due and Points sit beside it as compact chips,
 * so the common task never opens a form. At rest it is one line even in the
 * Tasks column beside a widened chat (down to 375px): the title, then short chips and More as
 * an icon. Once the line is in use (focused, or something typed) the title
 * and Add (once there is a title to add) take the first line and the chips
 * sit under it, the way Linear's and Todoist's quick adds grow under the
 * title rather than wrap ragged. A missing who or due is flagged and
 * focused on Enter, never while typing. More opens the rest of the task in
 * place: steps, notes, repeat, photos and proof. After a create the line
 * clears for the next one. Escape clears what was typed.
 */
export function AddTaskRow({
  gate,
  pending,
  onCreate,
  expandSignal = 0,
}: {
  gate: SubscriptionGate;
  pending: boolean;
  /** Resolves whether it was created; the caller owns the toasts. */
  onCreate: (create: TaskCreate) => Promise<boolean>;
  /** Bumped by New task: open More and put the cursor in the title. */
  expandSignal?: number;
}) {
  const ids = useId();
  const [draft, setDraft] = useState(EMPTY);
  const [more, setMore] = useState(false);
  const [missing, setMissing] = useState<Missing>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const whoRef = useRef<HTMLButtonElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  const uploadPhotos = useUploadTaskPhotos();
  const [uploading, setUploading] = useState(false);
  const busy = pending || uploading;
  const controls = gate.controlProps();

  useEffect(() => {
    if (expandSignal === 0) return;
    setMore(true);
    titleRef.current?.focus();
  }, [expandSignal]);

  // A copy each for a group, or one task up for grabs, can't repeat or carry
  // photos yet (#4295 step 3): both are hidden, and nothing hidden is sent.
  const single = draft.who === null || draft.who.kind === "person";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const title = draft.title.trim();
    if (!title) {
      titleRef.current?.focus();
      return;
    }
    const request = draft.who ? taskWhoRequest(draft.who) : null;
    const nextMissing: Missing = {
      who: !request,
      due: !draft.due,
      passed: dueEntryPassed(draft.due),
    };
    setMissing(nextMissing);
    if (nextMissing.who) {
      whoRef.current?.focus();
      return;
    }
    if (nextMissing.due || nextMissing.passed) {
      dueRef.current?.focus();
      return;
    }
    const firstDue = firstDueOf(draft.due, draft.repeat.timeZone);
    const repeat =
      firstDue && single ? taskRepeatRuleOf(draft.repeat, firstDue) : null;
    if (repeat && !repeat.ok) {
      setMore(true);
      setMissing((prev) => ({ ...prev, repeat: repeat.error }));
      return;
    }
    const base = {
      title,
      description: draft.description.trim() || undefined,
      ...dueEntryFields(draft.due),
      point_reward: parseGuardedInt(draft.points),
      subtasks: draft.subtasks.length > 0 ? draft.subtasks : undefined,
      proof_kind: draft.proofKind === "none" ? undefined : draft.proofKind,
    };
    let created: boolean;
    if (request!.endpoint === "/v1/open-tasks") {
      created = await onCreate({
        endpoint: "/v1/open-tasks",
        body: { ...base, ...request!.fields },
      });
    } else {
      let referencePhotoPaths: string[] | undefined;
      if (draft.photoFiles.length > 0 && single) {
        const problem = taskPhotosProblem(draft.photoFiles);
        if (problem) {
          setMissing((prev) => ({ ...prev, photo: problem }));
          return;
        }
        setUploading(true);
        try {
          referencePhotoPaths = await uploadPhotos(draft.photoFiles);
        } catch (error) {
          setMissing((prev) => ({ ...prev, photo: uploadFailureMessage(error) }));
          return;
        } finally {
          setUploading(false);
        }
      }
      created = await onCreate({
        endpoint: "/v1/tasks",
        body: {
          ...base,
          ...request!.fields,
          reference_photo_paths: referencePhotoPaths,
          recurrence_rule: repeat?.ok ? (repeat.rule ?? undefined) : undefined,
        },
      });
    }
    if (!created) return;
    setDraft(EMPTY);
    setMissing({});
    titleRef.current?.focus();
  }

  const dirty =
    draft.title !== "" || draft.who !== null || draft.due !== "" || draft.points !== "";
  // Focus anywhere in the line, its pickers' popovers included (React's
  // focus events bubble through their portals).
  const [focused, setFocused] = useState(false);
  const active = focused || dirty || more;
  const hasTitle = draft.title.trim() !== "";

  return (
    <form
      aria-label="Add a task"
      onSubmit={(event) => void submit(event)}
      noValidate
      onKeyDown={(event) => {
        // An open picker (any Radix layer) handles its own Escape first and
        // marks it, so the line only clears when nothing above it took it.
        if (event.key === "Escape" && !event.defaultPrevented && !busy && dirty) {
          event.preventDefault();
          setDraft(EMPTY);
          setMissing({});
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) setFocused(false);
      }}
      className="rounded-[14px] border border-border"
    >
      <div
        className={cn(
          "flex items-center gap-1.5 p-1.5",
          active ? "flex-wrap" : "flex-nowrap",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5",
            active && "basis-full",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2",
              FOCUS_RING_WITHIN,
            )}
          >
            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={titleRef}
              aria-label="Task title"
              placeholder="Add a task"
              value={draft.title}
              disabled={controls.disabled}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, title: event.target.value }))
              }
              className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
          </div>
          {hasTitle ? (
            <Button
              size="toolbar"
              type="submit"
              className="shrink-0"
              {...gate.controlProps(busy)}
            >
              {uploading ? "Adding photos…" : "Add"}
            </Button>
          ) : null}
        </div>
        <WhoPicker
          ref={whoRef}
          value={draft.who}
          onChange={(who) => {
            setDraft((prev) => ({ ...prev, who }));
            setMissing((prev) => ({ ...prev, who: false }));
          }}
          invalid={missing.who}
          aria-describedby={missing.who ? `${ids}-missing` : undefined}
          disabled={controls.disabled}
          className="max-w-[10rem] shrink-0"
        />
        <div className={cn("shrink-0", active ? "w-28" : "w-20")}>
          <DateField
            ref={dueRef}
            aria-label="Due date"
            placeholder="Due"
            lean="ahead"
            withTime
            value={draft.due}
            aria-invalid={missing.due || missing.passed || undefined}
            disabled={controls.disabled}
            className="h-9"
            onChange={(due) => {
              setDraft((prev) => ({ ...prev, due }));
              setMissing((prev) => ({
                ...prev,
                due: prev.due && !due,
                passed: false,
              }));
            }}
          />
        </div>
        <Input
          type="number"
          min={0}
          aria-label="Points (optional)"
          placeholder="Pts"
          className="h-9 w-20 shrink-0"
          value={draft.points}
          disabled={controls.disabled}
          onChange={(event) => {
            const next = guardIntDraft(event.target.value);
            if (next === undefined) return;
            setDraft((prev) => ({ ...prev, points: next }));
          }}
        />
        <Button
          type="button"
          size="toolbar"
          variant={more ? "secondary" : "ghost"}
          className="w-9 shrink-0 px-0"
          aria-label="More"
          title="More: steps, notes, repeat, photos"
          aria-expanded={more}
          aria-controls={`${ids}-more`}
          onClick={() => setMore((open) => !open)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {missing.who || missing.due || missing.passed ? (
        <p id={`${ids}-missing`} role="alert" className="px-3 pb-2 text-caption text-destructive-text">
          {[
            missing.who ? "Pick who it's for." : null,
            missing.due
              ? "Pick a due date, like Friday or Friday 5pm."
              : missing.passed
                ? "That time has already passed. Pick a later time or another day."
                : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
      {more ? (
        <div id={`${ids}-more`} className="grid gap-3 border-t border-border p-3">
          <SubtaskListEditor
            items={draft.subtasks}
            disabled={busy}
            onChange={(subtasks) => setDraft((prev) => ({ ...prev, subtasks }))}
          />
          <Textarea
            rows={2}
            aria-label="Notes (optional)"
            placeholder="Notes (optional)"
            value={draft.description}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, description: event.target.value }))
            }
          />
          {single ? (
            <RepeatOptions
              forTasks
              idPrefix={`${ids}-repeat`}
              draft={draft.repeat}
              start={firstDueOf(draft.due, draft.repeat.timeZone)}
              showLength
              disabled={busy}
              onChange={(repeat) => {
                setDraft((prev) => ({ ...prev, repeat }));
                setMissing((prev) => ({ ...prev, repeat: undefined }));
              }}
            />
          ) : (
            <p className="text-caption text-muted-foreground">
              {TASK_AUDIENCE_COPY.noRepeat}
            </p>
          )}
          {missing.repeat && single ? (
            <p className="text-caption text-destructive-text">{missing.repeat}</p>
          ) : null}
          <TaskPhotoFields
            id={`${ids}-photos`}
            withoutPhotos={!single}
            draft={draft}
            disabled={busy}
            problem={missing.photo}
            onChange={(patch: Partial<TaskPhotoDraft>) => {
              setDraft((prev) => ({ ...prev, ...patch }));
              if (patch.photoFiles) {
                const files = patch.photoFiles;
                setMissing((prev) => ({ ...prev, photo: taskPhotosProblem(files) }));
              }
            }}
          />
        </div>
      ) : null}
    </form>
  );
}
