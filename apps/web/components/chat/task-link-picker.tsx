"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  taskLinkChoices,
  useTasks,
  type TaskLinkChoice,
  type TaskLinkSource,
} from "@repo/hooks";
import type { DispatchResult } from "@repo/chat-core/dispatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewButton } from "@/components/ui/new-button";
import { cn } from "@/lib/utils";

/**
 * The + card's Task view (#5772): link a task the member can already see into
 * the conversation, or, for an officer, make a new one. Paul, 2026-11-20: "if
 * I click on task, it could be cool to link a task or mention a task in chat".
 *
 * A search field over the tasks the member can read (`GET /v1/tasks` scopes
 * them), open ones first by when they are due, and one click posts that
 * task's card, the same card `/task` posts, which reads its live status.
 * **New task** sits beside the field for a member who may create one, and
 * turns the view into the Task form. Comparable: Slack's and Linear's issue
 * pickers (search by title, the assignee and state on each row, a create
 * action beside the search). The phone's twin is `task-link-sheet.tsx`.
 */
export function TaskLinkPicker({
  canCreate,
  nameOf,
  onLink,
  onNew,
  onDone,
}: {
  /** Whether the member may make a task (`TASK_CREATE_PERMISSIONS`). */
  canCreate: boolean;
  nameOf: (userId: string) => string;
  onLink: (task: { id: string; title: string }) => Promise<DispatchResult>;
  onNew: () => void;
  /** Closes the card once a card is on its way. */
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const tasks = useTasks();
  const choices = useMemo(
    () =>
      taskLinkChoices((tasks.data ?? []) as TaskLinkSource[], query, nameOf),
    [tasks.data, query, nameOf],
  );

  const link = async (choice: TaskLinkChoice) => {
    if (linking) return;
    setLinking(choice.id);
    setFailure(null);
    const result = await onLink({ id: choice.id, title: choice.title });
    setLinking(null);
    if (result.ok) {
      onDone();
      return;
    }
    setFailure(result.error ?? "Couldn't link that task.");
  };

  let body: ReactNode;
  if (tasks.isPending) {
    body = (
      <ul aria-label="Loading tasks" className="space-y-1">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="space-y-1.5 px-2 py-1.5">
            <div className="h-3.5 w-3/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ul>
    );
  } else if (tasks.isError) {
    body = (
      <div className="flex items-center justify-between gap-2 px-2 py-3">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load tasks.
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void tasks.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  } else if (choices.length === 0) {
    body = (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {query.trim() ? `No tasks match "${query.trim()}"` : "No tasks yet"}
      </p>
    );
  } else {
    body = (
      <ul aria-label="Tasks" className="-mx-1 max-h-72 overflow-y-auto">
        {choices.map((choice) => (
          <li key={choice.id}>
            <button
              type="button"
              disabled={linking !== null}
              onClick={() => void link(choice)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-card-hover disabled:cursor-default",
                linking !== null && linking !== choice.id && "opacity-60",
              )}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-sm",
                    choice.done && "text-muted-foreground",
                  )}
                >
                  {choice.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {choice.detail}
                </span>
              </span>
              {linking === choice.id ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                  aria-label="Linking"
                />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          data-plus-autofocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="h-9 min-w-0 flex-1"
        />
        {canCreate ? (
          <NewButton thing="task" size="sm" type="button" onClick={onNew} />
        ) : null}
      </div>
      {body}
      {failure ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Task view's two faces: the picker, and the Task form once **New task**
 * is picked. It opens on the form when the member already has a task draft
 * here (a typed `/task` with details seeds one), since that is what they
 * were doing.
 */
export function TaskPlusView({
  startNew,
  canCreate,
  renderForm,
  ...picker
}: Omit<Parameters<typeof TaskLinkPicker>[0], "onNew"> & {
  startNew: boolean;
  renderForm: () => ReactNode;
}) {
  const [mode, setMode] = useState<"link" | "new">(
    startNew && canCreate ? "new" : "link",
  );
  if (mode === "new") return renderForm();
  return (
    <TaskLinkPicker
      {...picker}
      canCreate={canCreate}
      onNew={() => setMode("new")}
    />
  );
}
