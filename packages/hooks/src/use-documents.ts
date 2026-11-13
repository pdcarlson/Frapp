"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * List documents, optionally narrowed to a folder or a title search.
 *
 * The chapter id is in the key but **not** in an `enabled` gate: the endpoint
 * resolves the chapter from the request header server-side, so the request is
 * well-formed either way — but two chapters' libraries must not share a cache
 * entry, which is what `["documents", folder]` alone did.
 */
export function useDocuments(options?: {
  folder?: string;
  search?: string;
  enabled?: boolean;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const folder = options?.folder;
  const search = options?.search;
  return useQuery({
    queryKey: ["documents", chapterId, "list", folder, search],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/documents", {
        params: { query: { folder, search } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * The chapter's document folders, in display order.
 *
 * `GET /v1/documents/folders` has existed since the documents module landed and
 * had no caller until the mobile library (C4 of #937) needed folder chips —
 * deriving the list from the documents themselves would silently omit every
 * empty folder.
 */
export function useDocumentFolders() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["documents", chapterId, "folders"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/documents/folders");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

/**
 * Invalidate everything a folder or type write can have changed.
 *
 * Scoped to `["documents", chapterId]`, not the bare `["documents"]` the
 * document mutations below still use: folder writes are chapter-scoped and
 * blowing away every chapter's cache on a rename is the leak #784 is about.
 *
 * It has to cover the *document* lists too, not just the folder list. A rename
 * re-files documents server-side (`chapter-document.service.ts` renames the
 * documents before the folder row) and a delete moves them to root, so the
 * rows carry a `folder` value that is stale the moment either settles. Both
 * live under this prefix, so one call is enough.
 */
function useInvalidateDocumentFolders() {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: ["documents", chapterId],
    });
  };
}

export function useCreateDocumentFolder() {
  const client = useFrappClient();
  const invalidate = useInvalidateDocumentFolders();
  return useMutation({
    mutationKey: ["documents", "create-document-folder"],
    mutationFn: async (body: { name: string; sort_order?: number }) => {
      const { data, error } = await client.POST("/v1/documents/folders", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Rename and reorder are one route — `PATCH` takes `name`, `sort_order`, or both. */
export function useUpdateDocumentFolder() {
  const client = useFrappClient();
  const invalidate = useInvalidateDocumentFolders();
  return useMutation({
    mutationKey: ["documents", "update-document-folder"],
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      sort_order?: number;
    }) => {
      const { data, error } = await client.PATCH("/v1/documents/folders/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteDocumentFolder() {
  const client = useFrappClient();
  const invalidate = useInvalidateDocumentFolders();
  return useMutation({
    mutationKey: ["documents", "delete-document-folder"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE(
        "/v1/documents/folders/{id}",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * The chapter's document types, in display order (#3642). The upload form
 * offers them as its type choices, and an officer edits them from there.
 */
export function useDocumentTypes(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["documents", chapterId, "types"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/documents/types");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: options?.enabled ?? true,
  });
}

export type DocumentTypeRow = components["schemas"]["DocumentTypeDto"];

/*
  A type write invalidates the whole chapter's documents prefix, as a folder
  write does: a rename renames the type on its documents and a delete clears
  it, so the document lists are stale too.
*/

export function useCreateDocumentType() {
  const client = useFrappClient();
  const invalidate = useInvalidateDocumentFolders();
  return useMutation({
    mutationKey: ["documents", "create-document-type"],
    mutationFn: async (body: { name: string; sort_order?: number }) => {
      const { data, error } = await client.POST("/v1/documents/types", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Rename and reorder are one route, as for folders. */
export function useUpdateDocumentType() {
  const client = useFrappClient();
  const invalidate = useInvalidateDocumentFolders();
  return useMutation({
    mutationKey: ["documents", "update-document-type"],
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      sort_order?: number;
    }) => {
      const { data, error } = await client.PATCH("/v1/documents/types/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteDocumentType() {
  const client = useFrappClient();
  const invalidate = useInvalidateDocumentFolders();
  return useMutation({
    mutationKey: ["documents", "delete-document-type"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/documents/types/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Ids one `GET /v1/documents/previews` signs; the API refuses more. */
export const DOCUMENT_PREVIEW_BATCH = 100;

/**
 * Inline preview links for the web Documents grid (#4647), as a map from
 * document id to signed URL. One request per hundred ids, rather than a
 * `useDocument` per tile: the grid spends a read or two of the member's read
 * budget, records no `document-viewed` event (a tile coming into view isn't a
 * member opening a file), and the links stay put when an upload or delete
 * invalidates `["documents"]`, so photos aren't downloaded again.
 *
 * The links last an hour, so the cache keeps them 50 minutes and doesn't
 * refetch on window focus. A tile whose id is missing from the map (storage
 * couldn't sign it) shows its type glyph.
 */
export function useDocumentPreviews(
  ids: readonly string[],
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const sorted = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ["document-previews", chapterId, sorted.join(",")],
    queryFn: async () => {
      const urls = new Map<string, string>();
      for (let i = 0; i < sorted.length; i += DOCUMENT_PREVIEW_BATCH) {
        const batch = sorted.slice(i, i + DOCUMENT_PREVIEW_BATCH);
        const { data, error } = await client.GET("/v1/documents/previews", {
          params: { query: { ids: batch } },
        });
        if (error) throw error;
        for (const { id, url } of data) urls.set(id, url);
      }
      return urls;
    },
    staleTime: 50 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    // A narrower or wider list keeps the links it had while the next set signs.
    placeholderData: (previous) => previous,
    enabled: sorted.length > 0 && (options?.enabled ?? true),
  });
}

export function useDocument(id: string, options?: { enabled?: boolean }) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["documents", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/documents/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!id && (options?.enabled ?? true),
  });
}

/**
 * Fetch a document's freshly signed `downloadUrl` on demand.
 *
 * A mutation rather than a query even though it is a `GET`, matching
 * `useGetServiceProofUrl`. Opening a document is an action taken once, not
 * state a screen observes, and expressing it as a query means the *cached*
 * result answers the next attempt: a tap that failed on a dropped connection
 * would keep failing instantly from the cached error for the rest of the
 * `gcTime` window, never reaching the network again. It also keeps the signed
 * URL — which expires — out of the cache.
 */
export function useDocumentDownloadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["documents", "document-download-url"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.GET("/v1/documents/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useRequestDocumentUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["documents", "request-document-upload-url"],
    // The generated body, so `size_bytes` reaches the API's own size check
    // from the phone (#3399); web's call site still omits it (#1515).
    mutationFn: async (
      body: components["schemas"]["RequestDocumentUploadUrlDto"],
    ) => {
      const { data, error } = await client.POST("/v1/documents/upload-url", {
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useConfirmDocumentUpload() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["documents", "confirm-document-upload"],
    mutationFn: async (
      body: components["schemas"]["ConfirmDocumentUploadDto"],
    ) => {
      const { data, error } = await client.POST("/v1/documents", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useDeleteDocument() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["documents", "delete-document"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/documents/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Pins (chapter-wide) and stars (each member's own), #3934.
// `spec/behavior/chapter-docs.md` § Pinned and starred.
// ---------------------------------------------------------------------------

/** What a pin or a star points at. */
export type DocumentMarkTarget =
  { kind: "folder"; id: string } | { kind: "document"; id: string };

/** The caller's own starred folder and document ids. */
export interface DocumentStarIds {
  folder_ids: string[];
  document_ids: string[];
}

const NO_STARS: DocumentStarIds = { folder_ids: [], document_ids: [] };

function starsKey(chapterId: string | null | undefined) {
  return ["documents", chapterId, "stars"] as const;
}

/**
 * The caller's starred folders and documents in the active chapter. Private to
 * the caller: the server answers with their stars alone.
 */
export function useDocumentStars() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: starsKey(chapterId),
    queryFn: async (): Promise<DocumentStarIds> => {
      const { data, error } = await client.GET("/v1/documents/stars");
      if (error) throw error;
      return data ?? NO_STARS;
    },
    staleTime: 300_000,
  });
}

/** `stars` with `target` starred or not, leaving the input unchanged. */
export function withStar(
  stars: DocumentStarIds,
  target: DocumentMarkTarget,
  starred: boolean,
): DocumentStarIds {
  const field = target.kind === "folder" ? "folder_ids" : "document_ids";
  const rest = stars[field].filter((id) => id !== target.id);
  return { ...stars, [field]: starred ? [...rest, target.id] : rest };
}

/**
 * Stars or unstars a folder or a document for the caller.
 *
 * Optimistic, because a star is the caller's own: the mark moves on the tap.
 * Two rules from `useSidebarWrite` (`use-chat-sidebar.ts`), which met the
 * same hazards first:
 *
 * - The chapter is captured when the write starts. TanStack pushes each
 *   render's options onto a write still in flight, so a key read at settle
 *   time would file a write sent in one chapter under the next.
 * - Every write ends by re-reading the server, and a failure re-reads rather
 *   than restoring a snapshot: a snapshot taken before a second tap would
 *   undo that tap's star along with the failed one.
 */
export function useSetDocumentStar() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["documents", "set-document-star"],
    mutationFn: async ({
      target,
      starred,
    }: {
      target: DocumentMarkTarget;
      starred: boolean;
    }) => {
      const params = { params: { path: { id: target.id } } };
      const { error } =
        target.kind === "folder"
          ? starred
            ? await client.PUT("/v1/documents/folders/{id}/star", params)
            : await client.DELETE("/v1/documents/folders/{id}/star", params)
          : starred
            ? await client.PUT("/v1/documents/{id}/star", params)
            : await client.DELETE("/v1/documents/{id}/star", params);
      if (error) throw error;
    },
    onMutate: async ({ target, starred }) => {
      const key = starsKey(chapterId);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<DocumentStarIds>(key, (current) =>
        withStar(current ?? NO_STARS, target, starred),
      );
      return { key };
    },
    onSettled: (_data, _error, _vars, context) => {
      if (!context) return;
      void queryClient.invalidateQueries({ queryKey: context.key });
    },
  });
}

/**
 * Pins or unpins a folder or a document for the whole chapter. Needs
 * `chapter_docs:manage`. Not optimistic: a pin changes what everyone sees,
 * so the mark moves when the server has it. Re-reads the folder and document
 * lists, which carry `pinned_at`, before it settles.
 */
export function useSetDocumentPin() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["documents", "set-document-pin"],
    mutationFn: async ({
      target,
      pinned,
    }: {
      target: DocumentMarkTarget;
      pinned: boolean;
    }) => {
      const params = { params: { path: { id: target.id } } };
      const { error } =
        target.kind === "folder"
          ? pinned
            ? await client.PUT("/v1/documents/folders/{id}/pin", params)
            : await client.DELETE("/v1/documents/folders/{id}/pin", params)
          : pinned
            ? await client.PUT("/v1/documents/{id}/pin", params)
            : await client.DELETE("/v1/documents/{id}/pin", params);
      if (error) throw error;
    },
    // Returned, so the pin stays pending until the lists carry the new
    // `pinned_at`: a folder move worked out from the old one would save an
    // arrangement the pin contradicts.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["documents", chapterId] }),
  });
}
