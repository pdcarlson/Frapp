"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwUnlessOk, type components } from "@repo/api-sdk";
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
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/backwork", { signal });
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
        queryFn: async ({ signal }) => {
          const { data, error } = await client.GET("/v1/backwork/{id}", {
            signal,
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
 * 403, which the query client refires on focus. The web client no longer
 * retries a 403 (#3141).
 */
export function useDepartments(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", "departments"],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/backwork/departments", {
        signal,
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

/**
 * The chapter's course names and nicknames (#3848). A file joins its course
 * by `department_id` and `course_key` (its course number trimmed and
 * lowercased). `enabled` as for `useDepartments`.
 */
export function useBackworkCourses(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", "courses"],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/backwork/courses", {
        signal,
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

/**
 * Changes a course's name or nicknames (`PUT /v1/backwork/courses`), creating
 * its entry on first write. Nicknames go as a delta (`add_nicknames`,
 * `remove_nicknames`) the API applies to the list as stored, so send only
 * what the person changed. Without `backwork:admin` the API refuses a rename
 * of a set name or any removal with a 403.
 */
export function useSaveBackworkCourse() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["backwork", "save-backwork-course"],
    mutationFn: async (body: {
      department_id: string;
      course_number: string;
      name?: string | null;
      add_nicknames?: string[];
      remove_nicknames?: string[];
    }) => {
      const { data, error } = await client.PUT("/v1/backwork/courses", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      // In the cache at once (replacing by id, or appended when new), for the
      // reason `patchNamedRow` gives; the refetch stays as the fallback.
      if (saved && typeof saved === "object" && "id" in saved) {
        queryClient.setQueryData(
          ["backwork", "courses"],
          (current: unknown) => {
            if (!Array.isArray(current)) return current;
            const found = current.some(
              (row) =>
                row &&
                typeof row === "object" &&
                "id" in row &&
                row.id === saved.id,
            );
            return found
              ? current.map((row) =>
                  row &&
                  typeof row === "object" &&
                  "id" in row &&
                  row.id === saved.id
                    ? saved
                    : row,
                )
              : [...current, saved];
          },
        );
      }
      queryClient.invalidateQueries({ queryKey: ["backwork", "courses"] });
    },
  });
}

export function useProfessors() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", "professors"],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/backwork/professors", {
        signal,
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

/**
 * Signed links for the files a zip will hold, asked for when the zip button is
 * pressed and never cached, for the same reason as `useFetchBackworkResource`:
 * the links expire. The API takes at most `MAX_BACKWORK_ZIP_FILES` ids and
 * leaves out any it can't sign, in the order asked.
 */
export function useFetchBackworkDownloadUrls() {
  const client = useFrappClient();
  return useCallback(
    async (ids: string[]) => {
      const { data, error } = await client.GET("/v1/backwork/download-urls", {
        params: { query: { ids: ids.join(",") } },
      });
      if (error) throw error;
      return data.files;
    },
    [client],
  );
}

/**
 * Deletes one resource (`backwork:admin`). The API removes the row; the
 * `["backwork"]` prefix invalidation refreshes the library list.
 */
export function useDeleteBackworkResource() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["backwork", "delete-backwork-resource"],
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
    mutationKey: ["backwork", "request-backwork-upload-url"],
    // `size_bytes` lets the API refuse an oversized file before the PUT
    // (its 100 MB backwork ceiling) rather than storage refusing it after.
    mutationFn: async (body: {
      filename: string;
      content_type: string;
      size_bytes?: number;
    }) => {
      const result = await client.POST("/v1/backwork/upload-url", { body });
      // On the status (see `throwUnlessOk`): an empty-bodied failure must not
      // read as a signed URL.
      throwUnlessOk(result);
      return result.data;
    },
  });
}

export function useConfirmBackworkUpload() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["backwork", "confirm-backwork-upload"],
    mutationFn: async (body: {
      storage_path: string;
      file_hash: string;
      title?: string;
      department_code?: string;
      course_number?: string;
      /** Saved only when the course has no name yet. */
      course_name?: string;
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
      /** Save as a draft only the uploader sees, to publish later (#5208). */
      draft?: boolean;
    }) => {
      const result = await client.POST("/v1/backwork", { body });
      // On the status (see `throwUnlessOk`): an empty-bodied failure must not
      // read as a filed document, which bulk upload would then mark done.
      throwUnlessOk(result);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}

/**
 * A draft's fields as the API keeps them (#5208): names, not ids, and only
 * the ones that were set. The same shape a draft edit sends.
 */
export type BackworkDraftFields = components["schemas"]["BackworkFieldsDto"];

/** One of the caller's backwork drafts (`GET /v1/backwork/drafts`). */
export type BackworkDraft = {
  id: string;
  storage_path: string;
  is_redacted: boolean;
  created_at: string;
  draft_fields: BackworkDraftFields & {
    /** Fields an AI fill set that nobody has edited since (#5233). */
    ai_filled?: string[];
    /** How the last AI fill ended, when one ran. */
    ai_fill?: "filled" | "nothing_found" | "unreadable";
  };
};

/** How one AI fill of a draft ended (`POST /v1/backwork/drafts/{id}/fill`). */
export type BackworkDraftFillStatus =
  components["schemas"]["BackworkDraftFillResponseDto"]["status"];

/**
 * The caller's own backwork drafts in the active chapter, in upload order
 * (#5208). Nobody else sees them; publishing files them in the library.
 */
export function useBackworkDrafts(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["backwork", chapterId, "drafts"],
    queryFn: async ({ signal }) => {
      const result = await client.GET("/v1/backwork/drafts", { signal });
      // On the status: an empty-bodied failure must not read as "no drafts",
      // which would hide a saved batch.
      throwUnlessOk(result);
      return (result.data ?? []) as unknown as BackworkDraft[];
    },
    staleTime: 30_000,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

/**
 * Sets the same fields on several drafts at once; a field sent as `null`
 * clears it. Patches the cached list from the response at once, so an edited
 * cell doesn't flash back to its old value while the refetch runs.
 */
export function useUpdateBackworkDrafts() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["backwork", "update-backwork-drafts"],
    mutationFn: async (body: { ids: string[]; fields: BackworkDraftFields }) => {
      const result = await client.PATCH("/v1/backwork/drafts", {
        body,
      });
      throwUnlessOk(result);
      return (result.data ?? []) as unknown as BackworkDraft[];
    },
    onSuccess: (updated) => {
      const byId = new Map(updated.map((row) => [row.id, row]));
      queryClient.setQueryData(
        ["backwork", chapterId, "drafts"],
        (current: unknown) =>
          Array.isArray(current)
            ? current.map((row: BackworkDraft) => byId.get(row.id) ?? row)
            : current,
      );
    },
  });
}

/**
 * Files drafts in the library. One that can't be filed stays a draft and
 * comes back in `failed` with a message to show.
 */
export function usePublishBackworkDrafts() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["backwork", "publish-backwork-drafts"],
    mutationFn: async (ids: string[]) => {
      const result = await client.POST("/v1/backwork/drafts/publish", {
        body: { ids },
      });
      throwUnlessOk(result);
      return result.data as {
        published: Array<{ id: string }>;
        failed: Array<{ id: string; message: string }>;
      };
    },
    onSettled: () => {
      // The library, its departments and professors (a publish can create
      // them), and the drafts list all change.
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}

/** Deletes one of the caller's drafts and its stored file. */
export function useDeleteBackworkDraft() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["backwork", "delete-backwork-draft"],
    mutationFn: async (id: string) => {
      const result = await client.DELETE("/v1/backwork/drafts/{id}", {
        params: { path: { id } },
      });
      throwUnlessOk(result);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(
        ["backwork", chapterId, "drafts"],
        (current: unknown) =>
          Array.isArray(current)
            ? current.filter((row: BackworkDraft) => row.id !== id)
            : current,
      );
      queryClient.invalidateQueries({
        queryKey: ["backwork", chapterId, "drafts"],
      });
    },
  });
}

/**
 * Asks the upload AI to fill one draft's empty fields from its redacted text
 * (#5233). Puts the filled draft in the cached list as soon as it answers.
 * Throws on 403 (`ai.consent.required`, `ai.chapter_off`) and 404 (AI off on
 * this server, or the draft is gone), so a caller can stop asking.
 */
export function useFillBackworkDraft() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["backwork", "fill-backwork-draft"],
    mutationFn: async (id: string) => {
      const result = await client.POST("/v1/backwork/drafts/{id}/fill", {
        params: { path: { id } },
      });
      throwUnlessOk(result);
      const data = result.data as unknown as {
        status: BackworkDraftFillStatus;
        draft?: BackworkDraft;
      };
      return { id, status: data.status, draft: data.draft ?? null };
    },
    onSuccess: ({ draft }) => {
      if (!draft) return;
      queryClient.setQueryData(
        ["backwork", chapterId, "drafts"],
        (current: unknown) =>
          Array.isArray(current)
            ? current.map((row: BackworkDraft) =>
                row.id === draft.id ? draft : row,
              )
            : current,
      );
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
      row &&
      typeof row === "object" &&
      "id" in row &&
      row.id === (updated as { id: unknown }).id
        ? { ...row, ...updated }
        : row,
    );
  });
}

export function useUpdateDepartment() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["backwork", "update-department"],
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
    mutationKey: ["backwork", "delete-department"],
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
    mutationKey: ["backwork", "merge-departments"],
    mutationFn: async ({ id, targetId }: { id: string; targetId: string }) => {
      const { data, error } = await client.POST(
        "/v1/backwork/departments/{id}/merge",
        { params: { path: { id } }, body: { target_id: targetId } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Reassignment also changes every affected resource's department_id,
      // and the source's course names move with it (`["backwork", "courses"]`).
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}

export function useUpdateProfessor() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["backwork", "update-professor"],
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
    mutationKey: ["backwork", "delete-professor"],
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
    mutationKey: ["backwork", "merge-professors"],
    mutationFn: async ({ id, targetId }: { id: string; targetId: string }) => {
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
