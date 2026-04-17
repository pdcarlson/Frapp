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
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";

type Task = {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  created_by: string;
  due_date: string;
  status: TaskStatus;
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString();
}

export function TasksBoard() {
  const { toast } = useToast();
  const tasksQuery = useTasks();
  const membersQuery = useMembers();
  const currentUser = useCurrentUser();
  const createTask = useCreateTask();
  const updateStatus = useUpdateTaskStatus();
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();
  const deleteTask = useDeleteTask();

  const tasks = useMemo(() => asArray<Task>(tasksQuery.data), [tasksQuery.data]);
  const members = useMemo(
    () => asArray<MemberSummary>(membersQuery.data),
    [membersQuery.data],
  );
  const membersByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.user_id) map.set(String(m.user_id), m.display_name ?? "Unnamed member");
    }
    return map;
  }, [members]);

  const [createOpen, setCreateOpen] = useState(false);
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
      setCreateOpen(false);
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
    const comment = window.prompt(
      `Reject completion of "${task.title}"? Optional comment for the assignee:`,
    );
    if (comment === null) return;
    try {
      await rejectTask.mutateAsync({
        id: task.id,
        body: { comment: comment || undefined },
      });
      toast({
        title: "Task reverted to IN_PROGRESS",
        description: "The assignee was notified to continue working.",
      });
    } catch (error) {
      toast({
        title: "Couldn't reject task",
        description: getErrorMessage(
          error,
          "Retry or check your permissions.",
        ),
        variant: "destructive",
      });
    }
  }

  async function removeTask(task: Task) {
    const confirmed = window.confirm(
      `Delete "${task.title}"? This can't be undone.`,
    );
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
        description: getErrorMessage(
          error,
          "Retry or check your permissions.",
        ),
        variant: "destructive",
      });
    }
  }

  if (tasksQuery.isPending) {
    return <LoadingState message="Loading chapter tasks..." />;
  }

  if (tasksQuery.isError) {
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
          <h2 className="text-2xl font-semibold tracking-tight">Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Admins create and confirm chapter tasks; assignees move them
            through the workflow.
          </p>
        </div>
        <Can permission="tasks:manage">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New task
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
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
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={createTask.isPending}
                >
                  Cancel
                </Button>
                <Button
                  form="tasks-create-form"
                  type="submit"
                  disabled={createTask.isPending}
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
                    <p className="text-xs text-muted-foreground">
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
                          className="rounded-md border border-border/70 p-3"
                        >
                          <p className="text-sm font-medium">{task.title}</p>
                          {task.description ? (
                            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                              {task.description}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                            {isMine && task.status === "TODO" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void changeStatus(task, "IN_PROGRESS")
                                }
                              >
                                Start
                              </Button>
                            ) : null}
                            {isMine && task.status === "IN_PROGRESS" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void changeStatus(task, "COMPLETED")
                                }
                              >
                                Mark complete
                              </Button>
                            ) : null}
                            <Can permission="tasks:manage">
                              {task.status === "COMPLETED" ? (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => void confirmCompletion(task)}
                                    disabled={task.points_awarded}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                    {task.points_awarded
                                      ? "Confirmed"
                                      : "Confirm"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
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
                  <CardFooter className="text-xs text-muted-foreground">
                    Confirming a task awards its point reward (when set) to
                    the assignee.
                  </CardFooter>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
