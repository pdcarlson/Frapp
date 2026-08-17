"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Query keys for this module.
 *
 * Exported because the optimistic mutations below have to write into the same
 * cache entries the queries read, and inline literals in two places is how those
 * silently stop matching — the lesson `notificationKeys` records.
 *
 * Two things changed when this factory replaced the old literals, both fixes:
 *
 * - **The chapter id is in the key.** The old keys were `["tasks", assigneeId]`
 *   and `["tasks", id]`, neither chapter-scoped, while `GET /v1/tasks` resolves
 *   its chapter from the request header. On web the bleed was masked by the
 *   wholesale `queryClient.clear()` in `apps/web/lib/providers/
 *   frapp-client-provider.tsx`, whose comment names `["tasks", assigneeId]` as
 *   one of the unscoped keys it exists to cover. **Mobile has no such clear**,
 *   so the task board there would have served the outgoing chapter's rows after
 *   a switch.
 * - **`"list"` / `"detail"` discriminate.** `["tasks", undefined]` (the list)
 *   and `["tasks", "<uuid>"]` (a detail) were structurally indistinguishable, so
 *   no prefix could mean "every list" without also matching every detail. The
 *   mutations below need that distinction to invalidate precisely.
 */
export const taskKeys = {
  /** Prefix for every task-scoped entry, across chapters. */
  all: ["tasks"] as const,
  lists: (chapterId: string | null) => ["tasks", chapterId, "list"] as const,
  detail: (chapterId: string | null, id: string) =>
    ["tasks", chapterId, "detail", id] as const,
};

export type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";

/** The fields the optimistic writes below touch, as much as we rely on. */
interface CachedTask {
  id?: string;
  status?: string;
  stored_status?: string;
  due_date?: string;
  completed_at?: string | null;
  confirmed_at?: string | null;
  points_awarded?: boolean;
}

type TaskPatch = Partial<
  Pick<
    CachedTask,
    | "status"
    | "stored_status"
    | "completed_at"
    | "confirmed_at"
    | "points_awarded"
  >
>;

/**
 * Today in UTC, as `YYYY-MM-DD`.
 *
 * Deliberately UTC, and deliberately not the local date: this feeds
 * {@link deriveDisplayStatus}, which mirrors `toDisplayStatus` in
 * `apps/api/src/application/services/task.service.ts` — and that computes
 * `new Date().toISOString().slice(0, 10)`. A local-midnight comparison would
 * disagree with the server every evening west of Greenwich, which is exactly
 * when someone finishes a task due today.
 *
 * Human-readable date *copy* is a different problem with a different answer —
 * see the UTC-noon parsing in `apps/mobile/lib/more/service-hours.ts`.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * What the server will *render* a task's status as, given the status it will
 * *store*.
 *
 * `OVERDUE` is never stored. `toDisplayStatus` (`task.service.ts`) synthesizes
 * it at read time for any `TODO` or `IN_PROGRESS` task past its due date, and
 * every read path applies it. So an optimistic write of the raw next status is
 * wrong for an overdue task: the cache would hold `IN_PROGRESS`, the next
 * refetch would correctly return `OVERDUE`, and the row would visibly revert —
 * reading to the member as a failed tap. It type-checks, and it passes every
 * test that does not use a past due date.
 *
 * Exported for the unit table; callers below use it on every status write.
 */
export function deriveDisplayStatus(
  storedStatus: TaskStatus,
  dueDate: string | undefined,
  today: string,
): TaskStatus {
  const derivable = storedStatus === "TODO" || storedStatus === "IN_PROGRESS";
  if (derivable && typeof dueDate === "string" && dueDate !== "" && dueDate < today) {
    return "OVERDUE";
  }
  return storedStatus;
}

function asCachedTask(value: unknown): CachedTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as CachedTask;
  return typeof row.id === "string" ? row : null;
}

/** The cached task with this id, from the detail entry or the list, if either holds it. */
function readCachedTask(
  queryClient: QueryClient,
  chapterId: string | null,
  id: string,
): CachedTask | null {
  const fromDetail = asCachedTask(
    queryClient.getQueryData(taskKeys.detail(chapterId, id)),
  );
  if (fromDetail) return fromDetail;
  const list = queryClient.getQueryData(taskKeys.lists(chapterId));
  if (!Array.isArray(list)) return null;
  for (const row of list) {
    const task = asCachedTask(row);
    if (task?.id === id) return task;
  }
  return null;
}

interface TaskWriteContext {
  chapterId: string | null;
  id: string;
  /** Exactly the fields written, so `onError` can revert only those. */
  patch: TaskPatch;
  /**
   * What each entry held beforehand, captured **per entry**. A key absent from
   * one of these was absent on that row.
   *
   * Per entry rather than once, because the detail and the list can legitimately
   * disagree: `invalidateQueries` defaults to `refetchType: "active"`, so an
   * unmounted board's list entry goes stale while a mounted chat card refetches
   * the detail. Replaying one entry's history into the other on rollback would
   * write a row neither the server nor that entry ever held.
   */
  detailRestore: TaskPatch | null;
  listRestore: TaskPatch | null;
  /** False when nothing was written, so `onError` must not touch the cache. */
  wrote: boolean;
}

function mergePatch(row: CachedTask, patch: TaskPatch): CachedTask {
  return { ...row, ...patch };
}

/** The row's current values for exactly the fields `patch` is about to change. */
function captureRestore(row: CachedTask, patch: TaskPatch): TaskPatch {
  const restore: TaskPatch = {};
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
    // `in` rather than a truthiness test, so a stored `null` is captured as
    // `null` and only a genuinely missing key falls to the delete path below.
    if (key in row) restore[key] = row[key] as never;
  }
  return restore;
}

/**
 * Write `patch` onto the task in both the detail entry and the list entry.
 *
 * **An `undefined` entry is never written into.** It means the query has never
 * resolved — offline, or errored — so there is no server answer to predict
 * against, and seeding one would flip the entry to `status: "success"` with a
 * payload the server never sent. It is also unrollbackable: query-core ignores
 * a `setQueryData` of `undefined`, so `onError` could not put it back. The same
 * hazard `applyPreferenceToRows` documents.
 *
 * Anything non-array where a list is expected — some envelope shape this does
 * not understand — is left byte-identical for the same reason.
 */
function applyTaskPatch(
  queryClient: QueryClient,
  chapterId: string | null,
  id: string,
  patch: TaskPatch,
): TaskWriteContext {
  let detailRestore: TaskPatch | null = null;
  let listRestore: TaskPatch | null = null;

  // `asCachedTask` is what enforces the never-resolved rule for this entry: it
  // returns null for `undefined`, so an unfetched detail is skipped here rather
  // than being seeded with a client-invented row.
  const detailKey = taskKeys.detail(chapterId, id);
  const detailRow = asCachedTask(queryClient.getQueryData(detailKey));
  if (detailRow && detailRow.id === id) {
    detailRestore = captureRestore(detailRow, patch);
    queryClient.setQueryData(detailKey, mergePatch(detailRow, patch));
  }

  const listKey = taskKeys.lists(chapterId);
  const list = queryClient.getQueryData(listKey);
  if (Array.isArray(list)) {
    const target = list.map(asCachedTask).find((row) => row?.id === id);
    if (target) {
      listRestore = captureRestore(target, patch);
      queryClient.setQueryData(
        listKey,
        list.map((row) => {
          const task = asCachedTask(row);
          return task?.id === id ? mergePatch(task, patch) : row;
        }),
      );
    }
  }

  return {
    chapterId,
    id,
    patch,
    detailRestore,
    listRestore,
    wrote: detailRestore !== null || listRestore !== null,
  };
}

/**
 * Undo one task's optimistic write, field by field.
 *
 * **Not a whole-snapshot restore.** Mutation-level callbacks always fire in
 * react-query v5 (unlike the per-`mutate()` options, which v5 drops for a
 * superseded mutation), so a slow failure can land *after* a fast success on the
 * same task — rapid start-then-complete taps are the ordinary way to produce
 * that. Restoring a whole snapshot there would silently undo the newer write.
 * So each field is reverted only while the cache still holds the value this
 * mutation put there; anything a later write has already replaced is left alone.
 */
function revertTaskPatch(
  queryClient: QueryClient,
  context: TaskWriteContext,
): void {
  const { chapterId, id, patch, detailRestore, listRestore } = context;

  const undo = (row: CachedTask, restore: TaskPatch): CachedTask => {
    const next: CachedTask = { ...row };
    for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
      if (next[key] !== patch[key]) continue;
      if (key in restore) {
        next[key] = restore[key] as never;
      } else {
        delete next[key];
      }
    }
    return next;
  };

  if (detailRestore) {
    const detailKey = taskKeys.detail(chapterId, id);
    queryClient.setQueryData(detailKey, (current: unknown) => {
      const row = asCachedTask(current);
      return row && row.id === id ? undo(row, detailRestore) : current;
    });
  }

  if (listRestore) {
    const listKey = taskKeys.lists(chapterId);
    queryClient.setQueryData(listKey, (current: unknown) => {
      if (!Array.isArray(current)) return current;
      return current.map((row) => {
        const task = asCachedTask(row);
        return task?.id === id ? undo(task, listRestore) : row;
      });
    });
  }
}

/** Hold both entries still so an in-flight GET cannot overwrite the prediction. */
async function cancelTaskQueries(
  queryClient: QueryClient,
  chapterId: string | null,
  id: string,
): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: taskKeys.detail(chapterId, id) }),
    queryClient.cancelQueries({ queryKey: taskKeys.lists(chapterId) }),
  ]);
}

/**
 * Reconcile after a mutation, **whether it succeeded or failed** — hence
 * `onSettled` rather than `onSuccess`. A failed PATCH that only rolled back
 * would leave the reverted value unverified against the server.
 *
 * Callers pass `context.chapterId` — the chapter the write actually landed in —
 * rather than the hook's render-scope value. v5 pushes fresh options into an
 * in-flight mutation, so a chapter switch mid-flight replaces the `onSettled`
 * closure, and invalidating the *new* chapter would leave the optimistic row in
 * the old one marked valid forever. Web's `queryClient.clear()` on switch hides
 * that; mobile has no such clear.
 */
function invalidateTask(
  queryClient: QueryClient,
  chapterId: string | null,
  id: string,
): void {
  queryClient.invalidateQueries({ queryKey: taskKeys.detail(chapterId, id) });
  queryClient.invalidateQueries({ queryKey: taskKeys.lists(chapterId) });
}

/**
 * The chapter's tasks, as the server scopes them.
 *
 * There is deliberately **no assignee argument**. An earlier signature took one,
 * put it in the cache key, and never sent it — `GET /v1/tasks` accepts no query
 * parameters — so it was a parameter that changed the cache key and nothing
 * else, which is strictly worse than no parameter: two callers asking for
 * different assignees got two entries holding identical data.
 *
 * Assignee scoping is the server's, and no client argument can reproduce or
 * override it: `TaskService.list` returns the chapter's whole task set to a
 * `tasks:manage` holder and only the caller's own rows to everyone else. A
 * surface drawn as a personal board therefore has to filter by assignee itself.
 */
export function useTasks() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: taskKeys.lists(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/tasks");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useTask(id: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: taskKeys.detail(chapterId, id),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/tasks/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!id,
  });
}

/**
 * Create a task. **Not optimistic**, deliberately: the new row's `id` and
 * `created_at` are server-assigned, and creation can post a chat card as a side
 * effect. Predicting it would mean inventing an id and then reconciling it —
 * the message-outbox problem, not the checkbox problem.
 */
export function useCreateTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      title: string;
      description?: string;
      assignee_id: string;
      due_date: string;
      point_reward?: number;
    }) => {
      const { data, error } = await client.POST("/v1/tasks", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

/**
 * Move a task through its lifecycle, optimistically.
 *
 * The predicted status runs through {@link deriveDisplayStatus} rather than
 * being written raw — see that function for why an overdue row would otherwise
 * flip back on the next refetch.
 *
 * **Illegal transitions are not pre-validated here, on purpose.** The server
 * keeps the authoritative table (`VALID_ASSIGNEE_TRANSITIONS`) and checks it
 * against the *stored* status, which a client holding only the derived
 * `OVERDUE` cannot recover; `isAdmin` is likewise resolved per request. A
 * client-side copy would be a second, wrong authority. The 400 arrives,
 * `onError` reverts, `onSettled` reconciles — the same path a network failure
 * takes, which is one path rather than two.
 */
export function useUpdateTaskStatus() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    // No retry. The web client defaults every mutation to `retry: 2`
    // (`apps/web/lib/providers/query-provider.tsx`), and these three are
    // non-idempotent compare-and-set transitions: if the first attempt reaches
    // the server and only its response is lost, the retry is answered with a
    // guaranteed 400 ("Invalid status transition" / "already awarded"). The
    // rollback below would then undo a write that actually landed and report a
    // failure for an action that succeeded. `onSettled` reconciles instead.
    retry: false,
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { status: TaskStatus };
    }) => {
      const { data, error } = await client.PATCH("/v1/tasks/{id}/status", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onMutate: async ({ id, body }) => {
      await cancelTaskQueries(queryClient, chapterId, id);
      const row = readCachedTask(queryClient, chapterId, id);
      // Both halves, always. `status` is what the row renders; `stored_status`
      // is what every action affordance keys off (#1051), and patching only the
      // first leaves the button unchanged after a successful write — the member
      // taps again and collects a 400 for an action that already succeeded.
      const patch: TaskPatch = {
        status: deriveDisplayStatus(body.status, row?.due_date, todayUtc()),
        stored_status: body.status,
      };
      // Mirrors the server stamping `completed_at` on COMPLETED and leaving it
      // alone otherwise, so a "Done <weekday>" subtitle does not blank for a beat.
      if (body.status === "COMPLETED") {
        patch.completed_at = new Date().toISOString();
      }
      return applyTaskPatch(queryClient, chapterId, id, patch);
    },
    onError: (_error, _variables, context) => {
      if (!context?.wrote) return;
      revertTaskPatch(queryClient, context);
    },
    onSettled: (_data, _error, { id }, context) => {
      invalidateTask(queryClient, context?.chapterId ?? chapterId, id);
    },
  });
}

/**
 * Confirm a completed task, optimistically.
 *
 * Writes only `confirmed_at` and `points_awarded` — the two columns
 * `confirm_task_completion` sets. The status stays `COMPLETED`.
 *
 * It deliberately does **not** predict a points balance. The award is a
 * compare-and-set RPC whose amount is the task's `point_reward`, and inventing
 * a ledger number on the client is precisely the kind of claim the points
 * selectors refuse to make. The `["points"]` invalidation below is how the
 * balance catches up.
 */
export function useConfirmTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    // No retry. The web client defaults every mutation to `retry: 2`
    // (`apps/web/lib/providers/query-provider.tsx`), and these three are
    // non-idempotent compare-and-set transitions: if the first attempt reaches
    // the server and only its response is lost, the retry is answered with a
    // guaranteed 400 ("Invalid status transition" / "already awarded"). The
    // rollback below would then undo a write that actually landed and report a
    // failure for an action that succeeded. `onSettled` reconciles instead.
    retry: false,
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST("/v1/tasks/{id}/confirm", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onMutate: async (id) => {
      await cancelTaskQueries(queryClient, chapterId, id);
      return applyTaskPatch(queryClient, chapterId, id, {
        points_awarded: true,
        confirmed_at: new Date().toISOString(),
      });
    },
    onError: (_error, _id, context) => {
      if (!context?.wrote) return;
      revertTaskPatch(queryClient, context);
    },
    onSettled: (_data, _error, id, context) => {
      invalidateTask(queryClient, context?.chapterId ?? chapterId, id);
      // Broad prefix on purpose: points keys are `["points", chapterId, …]`, so
      // this matches the balance, the leaderboard and the transaction list. A
      // confirm is the one task action that moves the ledger.
      queryClient.invalidateQueries({ queryKey: ["points"] });
    },
  });
}

/**
 * Reject a completed task back to `IN_PROGRESS`, optimistically.
 *
 * `completed_at` is nulled because `rejectCompletion` nulls it, and the status
 * runs through {@link deriveDisplayStatus} because a rejected task that is past
 * its due date renders `OVERDUE`, not `IN_PROGRESS`.
 */
export function useRejectTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    // No retry. The web client defaults every mutation to `retry: 2`
    // (`apps/web/lib/providers/query-provider.tsx`), and these three are
    // non-idempotent compare-and-set transitions: if the first attempt reaches
    // the server and only its response is lost, the retry is answered with a
    // guaranteed 400 ("Invalid status transition" / "already awarded"). The
    // rollback below would then undo a write that actually landed and report a
    // failure for an action that succeeded. `onSettled` reconciles instead.
    retry: false,
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body?: { comment?: string };
    }) => {
      const { data, error } = await client.POST("/v1/tasks/{id}/reject", {
        params: { path: { id } },
        body: body ?? {},
      });
      if (error) throw error;
      return data;
    },
    onMutate: async ({ id }) => {
      await cancelTaskQueries(queryClient, chapterId, id);
      const row = readCachedTask(queryClient, chapterId, id);
      return applyTaskPatch(queryClient, chapterId, id, {
        status: deriveDisplayStatus("IN_PROGRESS", row?.due_date, todayUtc()),
        stored_status: "IN_PROGRESS",
        completed_at: null,
      });
    },
    onError: (_error, _variables, context) => {
      if (!context?.wrote) return;
      revertTaskPatch(queryClient, context);
    },
    onSettled: (_data, _error, { id }, context) => {
      invalidateTask(queryClient, context?.chapterId ?? chapterId, id);
    },
  });
}

/**
 * Delete a task. **Not optimistic**, per `spec/ui/resilience.md`: creating and
 * updating are optimistic, deleting and paying are pessimistic.
 */
export function useDeleteTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/tasks/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
