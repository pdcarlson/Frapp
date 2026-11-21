"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useChapterScope } from "./chapter-scope";
import { taskKeys } from "./use-tasks";

/**
 * Tasks up for grabs (Paul, 2026-11-18): one open task that anyone in the
 * chapter, a role, a chapter group or a list of people may claim. Claiming
 * (or an officer's hand-off) turns it into an ordinary task for one member,
 * and "Give it back" deletes that task and opens the posting again, so every
 * write here also moves the task board.
 */
export const openTaskKeys = {
  /** Prefix for every posting entry, across chapters. */
  all: ["open-tasks"] as const,
  list: (chapterId: string | null) =>
    ["open-tasks", chapterId, "list"] as const,
};

export type OpenTask = components["schemas"]["OpenTaskDto"];
export type CreateOpenTaskBody = components["schemas"]["CreateOpenTaskDto"];
export type UpdateOpenTaskBody = components["schemas"]["UpdateOpenTaskDto"];

/**
 * The postings the caller may claim now. A `tasks:manage` holder gets every
 * open posting, with `viewer_can_claim` saying which they may claim
 * themselves; the server decides, as it does for `useTasks`.
 */
export function useOpenTasks() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const scope = useChapterScope();
  return useQuery({
    queryKey: openTaskKeys.list(chapterId),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/open-tasks", { signal });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
    enabled: scope === "chapter",
  });
}

/** Put a task up for grabs. Not optimistic, like `useCreateTask`. */
export function useCreateOpenTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["open-tasks", "create"],
    mutationFn: async (body: CreateOpenTaskBody) => {
      const { data, error } = await client.POST("/v1/open-tasks", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: openTaskKeys.all });
    },
  });
}

/** Edit a posting while it is open; a 409 once someone claimed it. */
export function useUpdateOpenTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["open-tasks", "update"],
    mutationFn: async ({ id, body }: { id: string; body: UpdateOpenTaskBody }) => {
      const { data, error } = await client.PATCH("/v1/open-tasks/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: openTaskKeys.all });
    },
  });
}

/** Take a posting down while it is open. Not optimistic, like deletes. */
export function useDeleteOpenTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["open-tasks", "delete"],
    mutationFn: async (id: string) => {
      const { error } = await client.DELETE("/v1/open-tasks/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: openTaskKeys.all });
    },
  });
}

/**
 * Claim a posting. Optimistic on the list only: the posting leaves "Up for
 * grabs" on the tap and comes back if the claim is refused (someone else got
 * there first, a 409). The new task is the server's, so the board refetches.
 */
export function useClaimOpenTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["open-tasks", "claim"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST("/v1/open-tasks/{id}/claim", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onMutate: async (id) => {
      const key = openTaskKeys.list(chapterId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OpenTask[]>(key);
      queryClient.setQueryData<OpenTask[]>(key, (list) =>
        list?.filter((posting) => posting.id !== id),
      );
      return { key, previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: openTaskKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

/** An officer hands a posting to one active member, eligible or not. */
export function useAssignOpenTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["open-tasks", "assign"],
    mutationFn: async ({
      id,
      assigneeId,
    }: {
      id: string;
      assigneeId: string;
    }) => {
      const { data, error } = await client.POST("/v1/open-tasks/{id}/assign", {
        params: { path: { id } },
        body: { assignee_id: assigneeId },
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: openTaskKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

/**
 * "Give it back": the assignee of a task taken from Up for grabs, before it
 * is finished. The task is deleted and its posting is open again.
 */
export function useReleaseTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["tasks", "release"],
    mutationFn: async (taskId: string) => {
      const { data, error } = await client.POST("/v1/tasks/{id}/release", {
        params: { path: { id: taskId } },
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: openTaskKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
