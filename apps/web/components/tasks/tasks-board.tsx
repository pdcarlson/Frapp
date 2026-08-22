"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plus, Undo2 } from "lucide-react";
import {
  useConfirmTask,
  useCreateTask,
  useCurrentUser,
  useDeleteTask,
  useMembers,
  useRejectTask,
  useTasks,
  useUpdateTaskStatus,
} from "@repo/hooks";
import type { TaskStatus } from "@repo/hooks";
import { formatLocaleDate as formatDate } from "@repo/formatting";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

type Task = {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  created_by: string;
  due_date: string;
  /** Display status — `OVERDUE` when derived. Drives the column grouping. */
  status: TaskStatus;
  /**
   * The persisted status (#1051). Drives which action is offered: `OVERDUE`
   * renders identically for a stored `TODO` and a stored `IN_PROGRESS`, and the
   * server checks its transition table against this one. Optional because the
   * pre-#1051 API did not send it; falling back to `status` reproduces the old
   * behaviour, where an overdue task simply offered no action.
   */
  stored_status?: TaskStatus;
  point_reward: number | null;
  points_awarded: boolean;
  completed_at: string | null;
  confirmed_at: string | null;
  created_at: string;
};

type MemberSummary = {
  id?: string;
  user_id?: string;
  display_name?: string | null;
};

const COLUMNS: { status: TaskStatus; label: string; description: string }[] = [
  {
    status: "TODO",
    label: "To do",
    description: "Assigned but not started yet.",
  },
  {
    status: "IN_PROGRESS",
    label: "In progress",
    description: "Assignee is working on it.",
  },
  {
    status: "COMPLETED",
    label: "Awaiting confirmation",
    description: "Assignee marked done; admin confirms to award points.",
  },
  {
    status: "OVERDUE",
    label: "Overdue",
    description: "Past due date and not yet complete.",
  },
];

/**
 * Which status a row's *actions* are decided by.
 *
 * Not `status`: that is the rendered value, and `OVERDUE` renders identically
 * for a stored `TODO` and a stored `IN_PROGRESS` while the server checks its
 * transition table against the stored one (#1051). Columns and badges keep
 * using `status`; only affordances come through here, so the two authorities
 * never get mixed on one row.
 *
 * A row whose *persisted* status is `OVERDUE` maps to `TODO`, because
 * `VALID_ASSIGNEE_TRANSITIONS[OVERDUE]` is `[IN_PROGRESS]` — the same move
 * Start makes. The fallback to `status` covers a pre-#1051 API, where an
 * overdue row simply offers nothing rather than guessing.
 */
function actionStatus(task: Task): TaskStatus | undefined {
  if (task.stored_status === undefined) {
    // Pre-#1051 API. Derivation only ever *produces* `OVERDUE`, so any other
    // rendered value is also the stored one and is safe to act on; `OVERDUE`
    // alone is ambiguous, and returning `undefined` there offers no action —
    // exactly what this board did before the field existed.
    return task.status === "OVERDUE" ? undefined : task.status;
  }
  return task.stored_status === "OVERDUE" ? "TODO" : task.stored_status;
}

export function TasksBoard() {
  const { toast } = useToast();
  // Every write on this board (create, status, confirm, reject, delete) hits
  // `TaskController`, which carries no `@FreeTier`, so all five mirror one
  // paid-ops gate (#841). Reads stay ungated — the server guard returns early
  // for GET, and it remains the enforcement either way.
  const gate = useSubscriptionGate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const createDialog = useGatedDialog(gate);
  const tasksQuery = useTasks();
  const membersQuery = useMembers();
  const currentUser = useCurrentUser();
  const createTask = useCreateTask();
  const updateStatus = useUpdateTaskStatus();
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();
  const deleteTask = useDeleteTask();

  const tasks = useMemo(
    () => asArray<Task>(tasksQuery.data),
    [tasksQuery.data],
  );
  const members = useMemo(
    () => asArray<MemberSummary>(membersQuery.data),
    [membersQuery.data],
  );
  const membersByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.user_id)
        map.set(String(m.user_id), m.display_name ?? "Unnamed member");
    }
    return map;
  }, [members]);

  // Since #560 the status mutations write the list entry in `onMutate`, so a
  // row re-renders into its next status immediately — "Mark complete" can now
  // appear under the cursor while the Start PATCH is still in flight, and a
  // fast second tap sends a transition the server will reject (the table in
  // `task.service.ts` is checked against the *stored* status). The chat card
  // already folds these in; the board did not.
  const lifecycleWritePending =
    updateStatus.isPending || confirmTask.isPending || rejectTask.isPending;

  const [draft, setDraft] = useState({
    title: "",
    description: "",
    assignee_id: "",
    due_date: "",
    point_reward: "",
  });

  const columns = useMemo(() => {
    const grouped = new Map<TaskStatus, Task[]>();
    for (const column of COLUMNS) {
      grouped.set(column.status, []);
    }
    for (const task of tasks) {
      const bucket = grouped.get(task.status);
      if (bucket) bucket.push(task);
    }
    for (const [, list] of grouped) {
      list.sort((a, b) => {
        const aMs = new Date(a.due_date).getTime();
        const bMs = new Date(b.due_date).getTime();
        return aMs - bMs;
      });
    }
    return grouped;
  }, [tasks]);

  async function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createTask.mutateAsync({
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        assignee_id: draft.assignee_id,
        due_date: draft.due_date,
        point_reward: draft.point_reward
          ? Number(draft.point_reward)
          : undefined,
      });
      toast({
        title: "Task created",
        description: `${draft.title} is now assigned.`,
      });
      createDialog.setOpen(false);
      setDraft({
        title: "",
        description: "",
        assignee_id: "",
        due_date: "",
        point_reward: "",
      });
    } catch (error) {
      toast({
        title: "Couldn't create task",
        description: getErrorMessage(
          error,
          "Retry in a moment or confirm the assignee is a chapter member.",
        ),
        variant: "destructive",
      });
    }
  }

  async function changeStatus(task: Task, next: TaskStatus) {
    try {
      await updateStatus.mutateAsync({
        id: task.id,
        body: { status: next },
      });
      toast({
        title: "Status updated",
        description: `${task.title} → ${next.replace("_", " ")}.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't update task",
        description: getErrorMessage(
          error,
          "The API rejected the transition. Only the assignee or admins can move tasks.",
        ),
        variant: "destructive",
      });
    }
  }

  async function confirmCompletion(task: Task) {
    try {
      await confirmTask.mutateAsync(task.id);
      toast({
        title: "Task confirmed",
        description: task.point_reward
          ? `${task.point_reward} points awarded to the assignee.`
          : "Completion confirmed.",
      });
    } catch (error) {
      toast({
        title: "Couldn't confirm task",
        description: getErrorMessage(
          error,
          "Only admins with tasks:manage can confirm completions.",
        ),
        variant: "destructive",
      });
    }
  }

  async function rejectCompletion(task: Task) {
    const result = await confirm({
      title: `Reject completion of "${task.title}"?`,
      description:
        "The task goes back to IN_PROGRESS and the assignee is notified to keep working.",
      confirmLabel: "Reject completion",
      tone: "destructive",
      comment: {
        label: "Comment for the assignee",
        placeholder: "Optional — what still needs doing?",
      },
    });
    // `null` is cancel; a confirmed empty box is still a rejection, which is the
    // distinction `window.prompt` carried and the dialog preserves.
    if (result === null) return;
    try {
      await rejectTask.mutateAsync({
        id: task.id,
        body: { comment: result.comment || undefined },
      });
      toast({
        title: "Task reverted to IN_PROGRESS",
        description: "The assignee was notified to continue working.",
      });
    } catch (error) {
      toast({
        title: "Couldn't reject task",
        description: getErrorMessage(error, "Retry or check your permissions."),
        variant: "destructive",
      });
    }
  }

  async function removeTask(task: Task) {
    const confirmed = await confirm({
      title: `Delete "${task.title}"?`,
      description: "This can't be undone.",
      confirmLabel: "Delete task",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteTask.mutateAsync(task.id);
      toast({
        title: "Task deleted",
        description: `${task.title} was removed.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't delete task",
        description: getErrorMessage(error, "Retry or check your permissions."),
        variant: "destructive",
      });
    }
  }

  if (tasksQuery.isPending) {
    return <LoadingState message="Loading chapter tasks..." />;
  }

  // Only swap the whole board out when there is nothing to show. v5 keeps the
  // last good payload alongside `isError`, and since the optimistic rework
  // (#560) a *failed* mutation reconciles through `onSettled` too — so an
  // action that fails offline triggers a refetch that also fails, and gating
  // on `isError` alone would replace a fully populated, readable board with an
  // error page every time.
  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <ErrorState
        title="Couldn't load tasks"
        description="Confirm your chapter access and retry. Assignees see only their own tasks; admins need tasks:manage to see every task."
        onRetry={() => void tasksQuery.refetch()}
      />
    );
  }

  const myUserId = (currentUser.data as { id?: string } | undefined)?.id ?? "";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Admins create and confirm chapter tasks; assignees move them through
            the workflow.
          </p>
        </div>
        <Can permission="tasks:manage">
          <Dialog {...createDialog.dialogProps}>
            <DialogTrigger asChild>
              <Button className="gap-2" {...gate.controlProps()}>
                <Plus className="h-4 w-4" /> New task
              </Button>
            </DialogTrigger>
            <DialogContent
              className="sm:max-w-lg"
              {...createDialog.contentProps}
            >
              <DialogHeader>
                <DialogTitle>Create a task</DialogTitle>
                <DialogDescription>
                  Assign it to a chapter member with a due date. Point rewards
                  are optional.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={submitDraft}
                className="space-y-4"
                id="tasks-create-form"
              >
                <div className="grid gap-1">
                  <Label htmlFor="task-title">Title</Label>
                  <Input
                    id="task-title"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="task-description">Description</Label>
                  <Textarea
                    id="task-description"
                    rows={3}
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="task-assignee">Assignee</Label>
                    <Select
                      value={draft.assignee_id}
                      onValueChange={(value) =>
                        setDraft((prev) => ({ ...prev, assignee_id: value }))
                      }
                    >
                      <SelectTrigger id="task-assignee">
                        <SelectValue placeholder="Select a member" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((member) => (
                          <SelectItem
                            key={member.user_id ?? "unknown"}
                            value={String(member.user_id ?? "")}
                          >
                            {member.display_name ?? "Unnamed member"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="task-due-date">Due date</Label>
                    <Input
                      id="task-due-date"
                      type="date"
                      value={draft.due_date}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          due_date: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-1 sm:max-w-xs">
                  <Label htmlFor="task-points">Point reward (optional)</Label>
                  <Input
                    id="task-points"
                    type="number"
                    min={0}
                    value={draft.point_reward}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        point_reward: event.target.value,
                      }))
                    }
                  />
                </div>
              </form>
              <DialogFooter>
                {/*
                  Cancel is not gated: it only closes the dialog, and a lapsed
                  chapter still needs a way out of a form it can't submit.
                */}
                <Button
                  variant="secondary"
                  onClick={() => createDialog.setOpen(false)}
                  disabled={createTask.isPending}
                >
                  Cancel
                </Button>
                <Button
                  form="tasks-create-form"
                  type="submit"
                  {...gate.controlProps(createTask.isPending)}
                >
                  {createTask.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Create task
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Can>
      </header>

      {/*
        Outside the `tasks:manage` <Can>: the assignee-facing Start / Mark
        complete controls are gated too, so a member with no manage permission
        still needs the explanation for why their own board went read-only.
      */}
      <SubscriptionNotice gate={gate} feature="managing tasks" />

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Admins can create the first chapter task to assign ownership and award points."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const list = columns.get(column.status) ?? [];
            return (
              <Card
                key={column.status}
                className={
                  column.status === "OVERDUE"
                    ? "border-destructive/40"
                    : "border-border"
                }
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{column.label}</span>
                    <Badge variant="outline">{list.length}</Badge>
                  </CardTitle>
                  <CardDescription>{column.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {list.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">
                      Nothing here yet.
                    </p>
                  ) : (
                    list.map((task) => {
                      const assigneeName =
                        membersByUserId.get(task.assignee_id) ??
                        `Member ${task.assignee_id.slice(0, 6)}`;
                      const isMine = task.assignee_id === myUserId;
                      return (
                        <div
                          key={task.id}
                          className="rounded-lg border border-border p-3"
                        >
                          <p className="text-sm font-semibold">{task.title}</p>
                          {task.description ? (
                            <p className="mt-1 text-[12.5px] text-muted-foreground line-clamp-2">
                              {task.description}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
                            <span>Due {formatDate(task.due_date)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{assigneeName}</span>
                            {task.point_reward ? (
                              <Badge variant="outline">
                                +{task.point_reward} pts
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {/*
                              The inline status controls are writes too
                              (`PATCH /v1/tasks/:id/status`), so they mirror the
                              same gate as Create — gating only the header
                              trigger would claim writes are blocked while
                              still offering four of them.
                            */}
                            {isMine && actionStatus(task) === "TODO" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                {...gate.controlProps(lifecycleWritePending)}
                                onClick={() =>
                                  void changeStatus(task, "IN_PROGRESS")
                                }
                              >
                                Start
                              </Button>
                            ) : null}
                            {isMine && actionStatus(task) === "IN_PROGRESS" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                {...gate.controlProps(lifecycleWritePending)}
                                onClick={() =>
                                  void changeStatus(task, "COMPLETED")
                                }
                              >
                                Mark complete
                              </Button>
                            ) : null}
                            <Can permission="tasks:manage">
                              {actionStatus(task) === "COMPLETED" ? (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => void confirmCompletion(task)}
                                    {...gate.controlProps(
                                      task.points_awarded ||
                                        lifecycleWritePending,
                                    )}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                    {task.points_awarded
                                      ? "Confirmed"
                                      : "Confirm"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    {...gate.controlProps(
                                      lifecycleWritePending,
                                    )}
                                    onClick={() => void rejectCompletion(task)}
                                  >
                                    <Undo2 className="h-4 w-4" />
                                    Reject
                                  </Button>
                                </>
                              ) : null}
                              <Button
                                size="sm"
                                variant="ghost"
                                {...gate.controlProps()}
                                onClick={() => void removeTask(task)}
                              >
                                Delete
                              </Button>
                            </Can>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
                {column.status === "COMPLETED" ? (
                  <CardFooter className="text-[12.5px] text-muted-foreground">
                    Confirming a task awards its point reward (when set) to the
                    assignee.
                  </CardFooter>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
