import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConfirmDocumentUpload } from "./use-documents";
import { FrappClientProvider } from "./use-frapp-client";
import React from "react";

describe("useConfirmDocumentUpload", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  const createWrapper = (mockClient: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider client={mockClient as unknown as ReturnType<typeof import("@repo/api-sdk").createFrappClient>}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "Wrapper";
    return Wrapper;
  };

  it("should successfully confirm a document upload and invalidate queries", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { id: "doc-123", title: "Test Doc" },
      error: null,
    });

    const mockClient = {
      POST: mockPost,
    };

    // Spy on invalidateQueries
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useConfirmDocumentUpload(), {
      wrapper: createWrapper(mockClient),
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

    // Check if the client POST was called with the correct path and body
    expect(mockPost).toHaveBeenCalledWith("/v1/documents", {
      body: mockPayload,
    });

    // Check if invalidateQueries was called with the exact expected query key
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
      wrapper: createWrapper(mockClient),
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
