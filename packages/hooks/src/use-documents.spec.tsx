import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useConfirmDocumentUpload,
  useRequestDocumentUploadUrl,
  useDocuments,
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

    const { result } = renderHook(() => useDocuments("finance"), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/documents", {
      params: { query: { folder: "finance" } },
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
      params: { query: { folder: undefined } },
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
