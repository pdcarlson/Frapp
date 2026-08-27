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
 * The signed URL off a single-document read.
 *
 * There is no separate download endpoint: `GET /v1/documents/{id}` returns the
 * document *with* a freshly signed URL, so opening a document means fetching it
 * by id and following that.
 *
 * **`downloadUrl`, not `download_url`.** `ChapterDocumentService.getWithDownloadUrl`
 * returns a camelCase key and there is no case-transforming interceptor anywhere
 * in the stack. Nothing typed catches the wrong spelling either: the endpoint has
 * no OpenAPI response schema, so the SDK infers the body as `never` and *any*
 * property access type-checks — which is how web read `download_url` at two call
 * sites and silently opened `undefined` (#1040).
 *
 * Both spellings are accepted so a future server-side rename cannot break a
 * working client, and neither is guessed at the call site. This lives beside the
 * hook that returns the data rather than in either app, so web and mobile cannot
 * drift apart on it.
 */
export function selectDownloadUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["downloadUrl", "download_url"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
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
