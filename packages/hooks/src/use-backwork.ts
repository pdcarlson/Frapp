"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The chapter's backwork list, unfiltered and unpaginated, so PostgREST's
 * `max_rows` (1000) caps it, newest first (#3525; `BACKWORK_LIST_CAP` in
 * `apps/web/components/backwork/backwork-library.ts`). `/backwork` searches and
 * filters it in memory (`apps/web/components/backwork/backwork-library.ts`), so
 * this takes no filters: a server-filtered subset here would silently shrink
 * the search, the filter options and the file count built on it.
 */
export function useBackworkResources() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["backwork", chapterId, "list"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/backwork");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

/**
 * Fetches one resource's detail (with its fresh signed `downloadUrl`) on
 * demand, for a Download press.
 *
 * It replaced `useBackworkResource`, a mounted query: `/backwork` rendered one
 * per row, so every page load asked the API for a signed URL for every file in
 * the library, minting links nobody clicked. This fetches only when
 * called, and never reuses a cached link (`staleTime: 0`), because the signed
 * URL expires quickly.
 */
export function useFetchBackworkResource() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useCallback(
    (id: string) =>
      queryClient.fetchQuery({
        queryKey: ["backwork", id],
        queryFn: async () => {
          const { data, error } = await client.GET("/v1/backwork/{id}", {
            params: { path: { id } },
          });
          if (error) throw error;
          return data;
        },
        staleTime: 0,
        // A press wants an answer now: no retry ladder on a 404 (another
        // officer deleted the file), and no pause offline, either of which
        // would hold the spinner and open the tab long after the click, past
        // the browser's popup allowance.
        retry: false,
        networkMode: "always",
      }),
    [client, queryClient],
  );
}

/**
 * `enabled` lets a caller outside the library skip the read: the route is
 * behind `backwork:upload` / `backwork:admin`, so for anyone else it can only
 * 403 (and the web client retries a failure three times).
 */
export function useDepartments(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", "departments"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/backwork/departments");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

export function useProfessors() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", "professors"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/backwork/professors");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

/**
 * Deletes one resource (`backwork:admin`). The API removes the row; the
 * `["backwork"]` prefix invalidation refreshes the library list.
 */
export function useDeleteBackworkResource() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/backwork/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}

export function useRequestBackworkUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { filename: string; content_type: string }) => {
      const { data, error } = await client.POST("/v1/backwork/upload-url", {
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useConfirmBackworkUpload() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      storage_path: string;
      file_hash: string;
      title?: string;
      department_code?: string;
      course_number?: string;
      professor_name?: string;
      year?: number;
      semester?: "Spring" | "Summer" | "Fall" | "Winter";
      assignment_type?:
        | "Exam"
        | "Midterm"
        | "Final Exam"
        | "Quiz"
        | "Homework"
        | "Lab"
        | "Project"
        | "Study Guide"
        | "Notes"
        | "Other";
      assignment_number?: number;
      document_variant?: "Student Copy" | "Blank Copy" | "Answer Key";
      tags?: string[];
      is_redacted: boolean;
    }) => {
      const { data, error } = await client.POST("/v1/backwork", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}

/**
 * Merges an updated row into a cached `["backwork", "departments" | "professors"]`
 * list in place, keyed by `id`.
 *
 * Renaming only invalidates that list, and `invalidateQueries` doesn't await
 * the refetch it schedules — so `mutateAsync` resolves as soon as the PATCH's
 * HTTP response lands, before the list has actually re-fetched. A caller that
 * flips its own "editing" state off as soon as the mutation resolves (as the
 * taxonomy drawer does) would otherwise render the *stale* cached name for the
 * length of that refetch round trip, visibly reverting the rename before it
 * reappears. Patching the cache directly with the server's own response
 * closes that window; the `invalidateQueries` call stays as the eventual-
 * consistency fallback.
 */
function patchNamedRow(
  queryClient: ReturnType<typeof useQueryClient>,
  key: unknown[],
  updated: unknown,
): void {
  if (!updated || typeof updated !== "object" || !("id" in updated)) return;
  queryClient.setQueryData(key, (current: unknown) => {
    if (!Array.isArray(current)) return current;
    return current.map((row) =>
      row && typeof row === "object" && "id" in row && row.id === (updated as { id: unknown }).id
        ? { ...row, ...updated }
        : row,
    );
  });
}

export function useUpdateDepartment() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { name?: string };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/backwork/departments/{id}",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (updated) => {
      patchNamedRow(queryClient, ["backwork", "departments"], updated);
      queryClient.invalidateQueries({
        queryKey: ["backwork", "departments"],
      });
    },
  });
}

export function useDeleteDepartment() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE(
        "/v1/backwork/departments/{id}",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["backwork", "departments"],
      });
    },
  });
}

/** Reassigns every resource tagged `id` to `targetId`, then deletes `id`. */
export function useMergeDepartments() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      targetId,
    }: {
      id: string;
      targetId: string;
    }) => {
      const { data, error } = await client.POST(
        "/v1/backwork/departments/{id}/merge",
        { params: { path: { id } }, body: { target_id: targetId } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Reassignment also changes every affected resource's department_id.
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}

export function useUpdateProfessor() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { name?: string };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/backwork/professors/{id}",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (updated) => {
      patchNamedRow(queryClient, ["backwork", "professors"], updated);
      queryClient.invalidateQueries({
        queryKey: ["backwork", "professors"],
      });
    },
  });
}

export function useDeleteProfessor() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE(
        "/v1/backwork/professors/{id}",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["backwork", "professors"],
      });
    },
  });
}

/** Reassigns every resource tagged `id` to `targetId`, then deletes `id`. */
export function useMergeProfessors() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      targetId,
    }: {
      id: string;
      targetId: string;
    }) => {
      const { data, error } = await client.POST(
        "/v1/backwork/professors/{id}/merge",
        { params: { path: { id } }, body: { target_id: targetId } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}
