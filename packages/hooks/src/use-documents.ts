"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * List documents, optionally narrowed to a folder or a title search.
 *
 * The chapter id is in the key but **not** in an `enabled` gate: the endpoint
 * resolves the chapter from the request header server-side, so the request is
 * well-formed either way — but two chapters' libraries must not share a cache
 * entry, which is what `["documents", folder]` alone did.
 */
export function useDocuments(options?: { folder?: string; search?: string }) {
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
 * Invalidate everything a folder write can have changed.
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

export function useDocument(id: string) {
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
    enabled: !!id,
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
    mutationFn: async (body: { filename: string; content_type: string }) => {
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
    mutationFn: async (body: {
      storage_path: string;
      title: string;
      description?: string;
      folder?: string;
      content_type?: string;
      byte_size?: number;
      document_type?: string;
      effective_date?: string;
    }) => {
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
