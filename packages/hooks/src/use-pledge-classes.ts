"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** One of the chapter's pledge classes, as `GET /v1/pledge-classes` serves it. */
export type PledgeClass = components["schemas"]["PledgeClassDto"];

/** One member's class and order number, as `PUT /v1/pledge-classes/assignments` takes it. */
export type PledgeClassAssignment =
  components["schemas"]["PledgeClassAssignmentDto"];

const pledgeClassesKey = (chapterId: string | null | undefined) =>
  ["pledge-classes", chapterId] as const;

/**
 * The chapter's pledge classes, oldest first (`spec/behavior/members.md`
 * § Pledge class and order number). The order is the chapter's own, so a
 * caller never re-sorts it. Needs `members:view`, like the Directory.
 */
export function usePledgeClasses(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: pledgeClassesKey(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/pledge-classes");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/** Add a class at the end of the chapter's list. Needs `roles:manage`. */
export function useCreatePledgeClass() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["pledge-classes", "create"],
    mutationFn: async (name: string) => {
      const { data, error } = await client.POST("/v1/pledge-classes", {
        body: { name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pledgeClassesKey(chapterId) });
    },
  });
}

export function useRenamePledgeClass() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["pledge-classes", "rename"],
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await client.PATCH("/v1/pledge-classes/{id}", {
        params: { path: { id } },
        body: { name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pledgeClassesKey(chapterId) });
    },
  });
}

/**
 * Set the order of the chapter's classes: every class id, oldest first. The
 * API refuses a list that is not exactly the chapter's current classes (409),
 * so the list is re-read after a failure as well as a success: a stale editor
 * then shows what the chapter really has.
 */
export function useReorderPledgeClasses() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["pledge-classes", "reorder"],
    mutationFn: async (ids: string[]) => {
      const { data, error } = await client.PUT("/v1/pledge-classes/order", {
        body: { ids },
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pledgeClassesKey(chapterId) });
    },
  });
}

/**
 * Delete a class. Its members keep their order number and lose the class, so
 * the member reads are refreshed too.
 */
export function useDeletePledgeClass() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["pledge-classes", "delete"],
    mutationFn: async (id: string) => {
      const { error } = await client.DELETE("/v1/pledge-classes/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pledgeClassesKey(chapterId) });
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}

/**
 * Set the class and order number of one member or many. Each listed member
 * gets both values, members not listed are untouched, and the API writes all
 * of them or none.
 */
export function useAssignPledgeClasses() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["pledge-classes", "assign"],
    mutationFn: async (assignments: PledgeClassAssignment[]) => {
      const { data, error } = await client.PUT(
        "/v1/pledge-classes/assignments",
        { body: { assignments } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}
