import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useConfirmDocumentUpload,
  useCreateDocumentFolder,
  useDeleteDocumentFolder,
  useRequestDocumentUploadUrl,
  useDocuments,
  useUpdateDocumentFolder,
  useDocumentStars,
  useSetDocumentPin,
  useSetDocumentStar,
  withStar,
} from "./use-documents";
import { FrappClientProvider } from "./use-frapp-client";
import React from "react";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient, mockClient: unknown) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        mockClient as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
}

describe("useDocuments", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("passes folder in query params when provided", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: [{ id: "doc-1" }],
      error: null,
    });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useDocuments({ folder: "finance" }), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/documents", {
      params: { query: { folder: "finance", search: undefined } },
    });
  });

  it("passes search in query params when provided", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: [{ id: "doc-1" }],
      error: null,
    });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useDocuments({ search: "bylaws" }), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/documents", {
      params: { query: { folder: undefined, search: "bylaws" } },
    });
  });

  it("passes undefined folder in query params when omitted", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: [{ id: "doc-1" }],
      error: null,
    });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useDocuments(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/documents", {
      params: { query: { folder: undefined, search: undefined } },
    });
  });
});

describe("useConfirmDocumentUpload", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("should successfully confirm a document upload and invalidate queries", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { id: "doc-123", title: "Test Doc" },
      error: null,
    });

    const mockClient = {
      POST: mockPost,
    };

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useConfirmDocumentUpload(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    const mockPayload = {
      storage_path: "test/path",
      title: "Test Title",
      description: "Test description",
      folder: "test-folder",
    };

    result.current.mutate(mockPayload);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith("/v1/documents", {
      body: mockPayload,
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["documents"] });
  });

  it("should throw an error if the request fails", async () => {
    const mockError = new Error("Upload confirmation failed");

    const mockPost = vi.fn().mockResolvedValue({
      data: null,
      error: mockError,
    });

    const mockClient = {
      POST: mockPost,
    };

    const { result } = renderHook(() => useConfirmDocumentUpload(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    const mockPayload = {
      storage_path: "error/path",
      title: "Error Title",
    };

    result.current.mutate(mockPayload);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(mockError);
  });
});

describe("useRequestDocumentUploadUrl", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("should request an upload URL with the exact POST payload", async () => {
    const uploadHandshake = {
      upload_url: "https://storage.example.com/upload",
      storage_path: "documents/chapter-1/file.pdf",
    };
    const mockPost = vi.fn().mockResolvedValue({
      data: uploadHandshake,
      error: null,
    });
    const mockClient = { POST: mockPost };
    const requestBody = {
      filename: "file.pdf",
      content_type: "application/pdf",
    };

    const { result } = renderHook(() => useRequestDocumentUploadUrl(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate(requestBody);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith("/v1/documents/upload-url", {
      body: requestBody,
    });
    expect(result.current.data).toEqual(uploadHandshake);
  });

  it("should surface API errors from upload URL requests", async () => {
    const mockError = new Error("Failed to request upload URL");
    const mockPost = vi.fn().mockResolvedValue({
      data: null,
      error: mockError,
    });
    const mockClient = { POST: mockPost };

    const { result } = renderHook(() => useRequestDocumentUploadUrl(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate({
      filename: "file.pdf",
      content_type: "application/pdf",
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(mockError);
  });
});

describe("document folder mutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  // The page test mocks these three hooks away, so this file is the only place
  // the request shape and the invalidation key are actually observed.
  function chapterWrapper(mockClient: unknown, chapterId = "chap-1") {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        chapterId={chapterId}
        client={
          mockClient as unknown as ReturnType<
            typeof import("@repo/api-sdk").createFrappClient
          >
        }
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "ChapterWrapper";
    return Wrapper;
  }

  it("creates a folder through POST /v1/documents/folders", async () => {
    const mockPost = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useCreateDocumentFolder(), {
      wrapper: chapterWrapper({ POST: mockPost }),
    });

    await result.current.mutateAsync({ name: "Finance" });

    expect(mockPost).toHaveBeenCalledWith("/v1/documents/folders", {
      body: { name: "Finance" },
    });
  });

  it("splits id into the path and leaves the rest as the PATCH body", async () => {
    // `id` is part of the hook's argument for ergonomics but must not be sent
    // in the body — `UpdateDocumentFolderDto` accepts only name and sort_order.
    const mockPatch = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useUpdateDocumentFolder(), {
      wrapper: chapterWrapper({ PATCH: mockPatch }),
    });

    await result.current.mutateAsync({ id: "f-1", sort_order: 2 });

    expect(mockPatch).toHaveBeenCalledWith("/v1/documents/folders/{id}", {
      params: { path: { id: "f-1" } },
      body: { sort_order: 2 },
    });
  });

  it("deletes a folder through DELETE /v1/documents/folders/{id}", async () => {
    const mockDelete = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useDeleteDocumentFolder(), {
      wrapper: chapterWrapper({ DELETE: mockDelete }),
    });

    await result.current.mutateAsync("f-1");

    expect(mockDelete).toHaveBeenCalledWith("/v1/documents/folders/{id}", {
      params: { path: { id: "f-1" } },
    });
  });

  it("throws the API error rather than resolving with it", async () => {
    // What makes the page's 409 handling possible: `mutateAsync` has to reject
    // with the error body so `getErrorMessage` can read its `message`.
    const mockPost = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: 'A folder named "Finance" already exists' },
    });
    const { result } = renderHook(() => useCreateDocumentFolder(), {
      wrapper: chapterWrapper({ POST: mockPost }),
    });

    await expect(
      result.current.mutateAsync({ name: "Finance" }),
    ).rejects.toMatchObject({
      message: 'A folder named "Finance" already exists',
    });
  });

  it("scopes invalidation to the active chapter, not every chapter (#784)", async () => {
    // The criterion #791 names explicitly. A revert to the bare ["documents"]
    // key that the sibling document mutations still use would pass every other
    // test in the repo, so this is the only thing standing in front of it.
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const mockPatch = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useUpdateDocumentFolder(), {
      wrapper: chapterWrapper({ PATCH: mockPatch }, "chap-7"),
    });

    await result.current.mutateAsync({ id: "f-1", name: "Charter" });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["documents", "chap-7"],
      }),
    );
  });

  it("invalidates the document lists too, not only the folder list", async () => {
    // A rename re-files documents server-side and a delete moves them to root,
    // so every cached row's `folder` value is stale the moment either settles.
    // Both live under the ["documents", chapterId] prefix, which is why one
    // non-exact invalidation covers them.
    const listKey = ["documents", "chap-1", "list", undefined, undefined];
    queryClient.setQueryData(listKey, [{ id: "doc-1", folder: "Governance" }]);
    const mockDelete = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useDeleteDocumentFolder(), {
      wrapper: chapterWrapper({ DELETE: mockDelete }),
    });

    await result.current.mutateAsync("f-1");

    await waitFor(() =>
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true),
    );
  });
});

describe("document stars and pins (#3934)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("withStar adds and removes an id without touching the other list", () => {
    const stars = { folder_ids: ["f1"], document_ids: ["d1"] };
    expect(withStar(stars, { kind: "folder", id: "f2" }, true)).toEqual({
      folder_ids: ["f1", "f2"],
      document_ids: ["d1"],
    });
    expect(withStar(stars, { kind: "document", id: "d1" }, false)).toEqual({
      folder_ids: ["f1"],
      document_ids: [],
    });
    expect(withStar(stars, { kind: "folder", id: "f1" }, true)).toEqual(stars);
  });

  it("reads the caller's stars", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: { folder_ids: ["f1"], document_ids: [] },
      error: null,
    });
    const { result } = renderHook(() => useDocumentStars(), {
      wrapper: createWrapper(queryClient, { GET: mockGet }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/v1/documents/stars");
    expect(result.current.data).toEqual({
      folder_ids: ["f1"],
      document_ids: [],
    });
  });

  it("stars a folder with PUT and unstars a document with DELETE", async () => {
    const mockPut = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn().mockResolvedValue({ error: null });
    const mockGet = vi
      .fn()
      .mockResolvedValue({
        data: { folder_ids: [], document_ids: [] },
        error: null,
      });
    const { result } = renderHook(() => useSetDocumentStar(), {
      wrapper: createWrapper(queryClient, {
        GET: mockGet,
        PUT: mockPut,
        DELETE: mockDelete,
      }),
    });

    await result.current.mutateAsync({
      target: { kind: "folder", id: "f1" },
      starred: true,
    });
    expect(mockPut).toHaveBeenCalledWith("/v1/documents/folders/{id}/star", {
      params: { path: { id: "f1" } },
    });

    await result.current.mutateAsync({
      target: { kind: "document", id: "d1" },
      starred: false,
    });
    expect(mockDelete).toHaveBeenCalledWith("/v1/documents/{id}/star", {
      params: { path: { id: "d1" } },
    });
  });

  it("marks a star at once and takes it back when the server refuses", async () => {
    const key = ["documents", null, "stars"];
    queryClient.setQueryData(key, { folder_ids: [], document_ids: [] });
    let refuse: (value: unknown) => void = () => {};
    const mockPut = vi.fn(
      () =>
        new Promise((resolve) => {
          refuse = resolve;
        }),
    );
    const mockGet = vi.fn(() => new Promise(() => {}));
    const { result } = renderHook(() => useSetDocumentStar(), {
      wrapper: createWrapper(queryClient, { PUT: mockPut, GET: mockGet }),
    });

    const pending = result.current
      .mutateAsync({ target: { kind: "document", id: "d1" }, starred: true })
      .catch(() => undefined);
    await waitFor(() =>
      expect(queryClient.getQueryData(key)).toEqual({
        folder_ids: [],
        document_ids: ["d1"],
      }),
    );

    refuse({ error: { message: "nope" } });
    await pending;
    expect(queryClient.getQueryData(key)).toEqual({
      folder_ids: [],
      document_ids: [],
    });
  });

  it("pins a document with PUT and unpins a folder with DELETE", async () => {
    const mockPut = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn().mockResolvedValue({ error: null });
    const { result } = renderHook(() => useSetDocumentPin(), {
      wrapper: createWrapper(queryClient, { PUT: mockPut, DELETE: mockDelete }),
    });

    await result.current.mutateAsync({
      target: { kind: "document", id: "d1" },
      pinned: true,
    });
    expect(mockPut).toHaveBeenCalledWith("/v1/documents/{id}/pin", {
      params: { path: { id: "d1" } },
    });

    await result.current.mutateAsync({
      target: { kind: "folder", id: "f1" },
      pinned: false,
    });
    expect(mockDelete).toHaveBeenCalledWith("/v1/documents/folders/{id}/pin", {
      params: { path: { id: "f1" } },
    });
  });
});
