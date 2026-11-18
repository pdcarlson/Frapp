"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { statusOf } from "@repo/api-sdk";
import {
  taskDueLine,
  useAssignOpenTask,
  useClaimOpenTask,
  useDeleteOpenTask,
  useOpenTasks,
  useReleaseTask,
  useUpdateOpenTask,
  type OpenTask,
  type UpdateOpenTaskBody,
} from "@repo/hooks";
import {
  TASK_AUDIENCE_COPY,
  TASK_PROOF_KINDS,
  TASK_PROOF_KIND_HINTS,
  TASK_PROOF_KIND_LABELS,
  openTaskScopeLabel,
  type TaskProofKind,
} from "@repo/validation";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelHeader,
} from "@/components/shared/panel";
import { SectionLabel } from "@/components/shared/section-label";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedChoice } from "@/components/ui/segmented";
import { ToastAction } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FOCUS_RING } from "@/components/ui/focus";
import { toastFailure } from "@/lib/failure-toast";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PointsTag, TASK_ROWS_CLASS } from "./task-row";
import {
  DueRow,
  FieldRow,
  NotesRow,
  PointsRow,
  StaticValue,
  TitleField,
} from "./task-panel";
import { useWhoDirectory, WhoPicker } from "./who-picker";
import { personName } from "./who-picker-model";

/** "Due Saturday", as the posting's row and its claim toast say it. */
function dueWords(posting: Pick<OpenTask, "due_date" | "due_at">): string | null {
  return taskDueLine(posting.due_at ?? posting.due_date, "TODO")?.text ?? null;
}

/**
 * Up for grabs (Paul, 2026-11-18): tasks one member out of a set takes, with
 * points as the reason to, the way an open shift waits in When I Work or a
 * slot in SignUpGenius. It sits at the top of the page whenever anything is
 * open, so a member sees what they could pick up before their own list. A
 * member sees only what is open to them and claims it; an officer also hands
 * one to someone (Assign), and opens a posting to change or take it down.
 */
export function UpForGrabs({
  canManage,
  gate,
  selectedId,
  onOpen,
}: {
  canManage: boolean;
  gate: SubscriptionGate;
  selectedId: string | null;
  onOpen: (posting: OpenTask) => void;
}) {
  const { toast } = useToast();
  const query = useOpenTasks();
  const claim = useClaimOpenTask();
  const assign = useAssignOpenTask();
  const release = useReleaseTask();
  const { directory } = useWhoDirectory({ enabled: canManage });
  const postings = query.data ?? [];

  async function giveBack(taskId: string, title: string) {
    try {
      await release.mutateAsync(taskId);
      toast({ title: "Given back", description: `${title} is up for grabs again.` });
    } catch (error) {
      toastFailure({
        title: "Couldn't give it back",
        error,
        fallback: "Retry in a moment.",
      });
    }
  }

  async function claimIt(posting: OpenTask) {
    try {
      const task = (await claim.mutateAsync(posting.id)) as { id?: string } | undefined;
      const due = dueWords(posting);
      toast({
        title: due ? `It's yours. ${due}.` : "It's yours.",
        description: posting.title,
        action: task?.id ? (
          <ToastAction
            altText={`${TASK_AUDIENCE_COPY.release}: ${posting.title}`}
            onClick={() => void giveBack(task.id!, posting.title)}
          >
            {TASK_AUDIENCE_COPY.release}
          </ToastAction>
        ) : undefined,
      });
    } catch (error) {
      if (statusOf(error) === 409) {
        toast({
          title: TASK_AUDIENCE_COPY.alreadyClaimed,
          description: posting.title,
          variant: "destructive",
        });
        return;
      }
      toastFailure({ title: "Couldn't claim it", error, fallback: "Retry in a moment." });
    }
  }

  async function assignIt(posting: OpenTask, assigneeId: string) {
    try {
      await assign.mutateAsync({ id: posting.id, assigneeId });
      toast({
        title: "Assigned",
        description: `${posting.title} is ${personName(assigneeId, directory)}'s now.`,
      });
    } catch (error) {
      if (statusOf(error) === 409) {
        toast({
          title: TASK_AUDIENCE_COPY.alreadyClaimed,
          description: posting.title,
          variant: "destructive",
        });
        return;
      }
      toastFailure({ title: "Couldn't assign it", error, fallback: "Retry in a moment." });
    }
  }

  if (query.isError && query.data === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        Couldn&apos;t load what&apos;s up for grabs.
        <Button type="button" size="toolbar" variant="ghost" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </p>
    );
  }
  if (postings.length === 0) return null;

  return (
    <section aria-labelledby="tasks-up-for-grabs" className="min-w-0 space-y-1">
      <SectionLabel id="tasks-up-for-grabs" count={postings.length}>
        {TASK_AUDIENCE_COPY.upForGrabs}
      </SectionLabel>
      <ul className={TASK_ROWS_CLASS}>
        {postings.map((posting) => {
          const due = dueWords(posting);
          const names =
            posting.scope === "people"
              ? (posting.scope_user_ids ?? []).map((id) => personName(id, directory))
              : undefined;
          const scope = openTaskScopeLabel(posting, names);
          // The title over who may claim it and when it's due, so the row
          // reads whole in the narrow column beside chat as on a wide page.
          const titleBlock = (
            <span className="grid min-w-0">
              <span className="truncate text-sm font-medium text-foreground">
                {posting.title}
              </span>
              <span className="truncate text-caption text-muted-foreground">
                {due ? `${scope} · ${due}` : scope}
              </span>
            </span>
          );
          return (
            <li
              key={posting.id}
              className={cn(
                "flex min-h-12 items-center gap-2 py-1 pl-2 pr-1 @xl:gap-3",
                selectedId === posting.id && "bg-accent-subtle",
              )}
            >
              {canManage ? (
                <button
                  type="button"
                  onClick={() => onOpen(posting)}
                  aria-label={posting.title}
                  className={cn(
                    "flex min-h-8 min-w-0 flex-1 items-center rounded-md text-left",
                    FOCUS_RING,
                  )}
                >
                  {titleBlock}
                </button>
              ) : (
                <span className="flex min-w-0 flex-1 items-center">{titleBlock}</span>
              )}
              <PointsTag points={posting.point_reward} />
              {posting.viewer_can_claim ? (
                <Button
                  type="button"
                  size="toolbar"
                  variant="secondary"
                  className="h-8"
                  aria-label={`${TASK_AUDIENCE_COPY.claim}: ${posting.title}`}
                  {...gate.controlProps(claim.isPending)}
                  onClick={() => void claimIt(posting)}
                >
                  {TASK_AUDIENCE_COPY.claim}
                </Button>
              ) : null}
              {canManage ? (
                <WhoPicker
                  allow="person"
                  label={`Assign ${posting.title}`}
                  value={null}
                  onChange={(next) => {
                    if (next?.kind === "person") void assignIt(posting, next.userId);
                  }}
                  align="end"
                  trigger={
                    <Button
                      type="button"
                      size="toolbar"
                      variant="ghost"
                      className="h-8"
                      aria-label={`Assign ${posting.title}`}
                      {...gate.controlProps(assign.isPending)}
                    >
                      Assign
                    </Button>
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A posting opened by an officer: its fields, changed in place while it is
 * open, and Take it down under the ⋯. Claimed, it is a task like any other.
 */
export function OpenTaskPanel({
  posting,
  gate,
  onClose,
}: {
  posting: OpenTask | null;
  gate: SubscriptionGate;
  onClose: () => void;
}) {
  return (
    <Panel
      open={posting !== null}
      onOpenChange={(open) => !open && onClose()}
      docked
      backLabel="Back to tasks"
    >
      {posting ? (
        <PanelContent aria-describedby={undefined}>
          <OpenTaskPanelInner key={posting.id} posting={posting} gate={gate} onClose={onClose} />
        </PanelContent>
      ) : null}
    </Panel>
  );
}

function OpenTaskPanelInner({
  posting,
  gate,
  onClose,
}: {
  posting: OpenTask;
  gate: SubscriptionGate;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateOpenTask();
  const remove = useDeleteOpenTask();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { directory } = useWhoDirectory();
  const [saving, setSaving] = useState(false);
  const editable = !gate.controlProps().disabled;
  const names =
    posting.scope === "people"
      ? (posting.scope_user_ids ?? []).map((id) => personName(id, directory))
      : undefined;

  async function save(body: UpdateOpenTaskBody): Promise<boolean> {
    setSaving(true);
    try {
      await update.mutateAsync({ id: posting.id, body });
      return true;
    } catch (error) {
      if (statusOf(error) === 409) {
        toast({
          title: TASK_AUDIENCE_COPY.alreadyClaimed,
          description: "It's a task now. Find it in the list.",
          variant: "destructive",
        });
        onClose();
        return false;
      }
      toastFailure({ title: "Couldn't save it", error, fallback: "Retry in a moment." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function takeDown() {
    const ok = await confirm({
      title: `Take down "${posting.title}"?`,
      description: "It leaves Up for grabs, and nobody can claim it.",
      confirmLabel: "Take it down",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(posting.id);
      toast({ title: "Taken down", description: posting.title });
      onClose();
    } catch (error) {
      toastFailure({ title: "Couldn't take it down", error, fallback: "Retry in a moment." });
    }
  }

  return (
    <>
      {confirmDialog}
      <PanelHeader
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`More for ${posting.title}`} className="text-muted-foreground">
                <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive-text"
                disabled={!editable}
                onSelect={() => void takeDown()}
              >
                Take it down
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {posting.title}
      </PanelHeader>
      <PanelBody>
        <div className="grid gap-5">
          <TitleField task={posting} editable={editable} onSave={(title) => save({ title })} />
          <p className="text-sm text-muted-foreground">
            {TASK_AUDIENCE_COPY.upForGrabs} · {openTaskScopeLabel(posting, names)} ·{" "}
            {posting.eligible_count === 1
              ? "1 member can claim it"
              : `${posting.eligible_count} members can claim it`}
          </p>
          <dl className="grid gap-1">
            <DueRow task={posting} editable={editable} onSave={(body) => save(body)} />
            <PointsRow
              task={posting}
              editable={editable}
              suffix=""
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
                    value={posting.proof_kind}
                    onChange={(proof_kind: TaskProofKind) => void save({ proof_kind })}
                    dense
                  />
                  <span className="text-caption text-muted-foreground">
                    {TASK_PROOF_KIND_HINTS[posting.proof_kind]}
                  </span>
                </div>
              ) : (
                <StaticValue>{TASK_PROOF_KIND_LABELS[posting.proof_kind]}</StaticValue>
              )}
            </FieldRow>
            <NotesRow
              task={posting}
              editable={editable}
              onSave={(description) => save({ description })}
            />
            {posting.subtask_titles.length > 0 ? (
              <FieldRow label="Steps" alignTop>
                <ul className="grid gap-1 px-2 py-1.5 text-sm text-foreground">
                  {posting.subtask_titles.map((step, index) => (
                    <li key={`${index}-${step}`}>{step}</li>
                  ))}
                </ul>
              </FieldRow>
            ) : null}
          </dl>
          <p className="h-5 text-caption text-muted-foreground" aria-live="polite">
            {saving ? "Saving…" : "Changes save as you make them."}
          </p>
        </div>
      </PanelBody>
    </>
  );
}
