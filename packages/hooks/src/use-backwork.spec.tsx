/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  useBackworkResources,
  useBackworkResource,
  useDepartments,
  useProfessors,
  useRequestBackworkUploadUrl,
  useConfirmBackworkUpload,
  useDeleteBackworkResource,
  useUpdateDepartment,
} from "./use-backwork";
import { FrappClientProvider } from "./use-frapp-client";

describe("useBackwork hooks", () => {
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
      <FrappClientProvider
        client={mockClient as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );

    Wrapper.displayName = "BackworkHookWrapper";
    return Wrapper;
  };

  describe("useBackworkResources", () => {
    it("fetches backwork resources without filters", async () => {
      const mockData = [{ id: "1", title: "Test" }];
      const mockGet = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { GET: mockGet };

      const { result } = renderHook(() => useBackworkResources(), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockGet).toHaveBeenCalledWith("/v1/backwork", {
        params: { query: undefined },
      });
      expect(result.current.data).toEqual(mockData);
    });

    it("fetches backwork resources with filters", async () => {
      const mockData = [{ id: "1", title: "Test" }];
      const mockGet = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { GET: mockGet };
      const filters = { department_id: "dep1", search: "midterm" };

      const { result } = renderHook(() => useBackworkResources(filters), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockGet).toHaveBeenCalledWith("/v1/backwork", {
        params: { query: filters },
      });
      expect(result.current.data).toEqual(mockData);
    });

    it("surfaces an error when fetch fails", async () => {
      const mockError = new Error("Fetch failed");
      const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockClient = { GET: mockGet };

      const { result } = renderHook(() => useBackworkResources(), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });
  });

  describe("useBackworkResource", () => {
    it("fetches a specific backwork resource by id", async () => {
      const mockData = { id: "res1", title: "Test Resource" };
      const mockGet = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { GET: mockGet };

      const { result } = renderHook(() => useBackworkResource("res1"), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockGet).toHaveBeenCalledWith("/v1/backwork/{id}", {
        params: { path: { id: "res1" } },
      });
      expect(result.current.data).toEqual(mockData);
    });

    it("does not fetch if id is empty", async () => {
      const mockGet = vi.fn();
      const mockClient = { GET: mockGet };

      renderHook(() => useBackworkResource(""), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(mockGet).not.toHaveBeenCalled();
      });
    });

    it("surfaces an error when fetch fails", async () => {
      const mockError = new Error("Fetch failed");
      const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockClient = { GET: mockGet };

      const { result } = renderHook(() => useBackworkResource("res1"), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });
  });

  describe("useDepartments", () => {
    it("fetches departments", async () => {
      const mockData = [{ id: "dep1", name: "CS" }];
      const mockGet = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { GET: mockGet };

      const { result } = renderHook(() => useDepartments(), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockGet).toHaveBeenCalledWith("/v1/backwork/departments");
      expect(result.current.data).toEqual(mockData);
    });

    it("surfaces an error when fetch fails", async () => {
      const mockError = new Error("Fetch failed");
      const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockClient = { GET: mockGet };

      const { result } = renderHook(() => useDepartments(), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });
  });

  describe("useProfessors", () => {
    it("fetches professors", async () => {
      const mockData = [{ id: "prof1", name: "Dr. Smith" }];
      const mockGet = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { GET: mockGet };

      const { result } = renderHook(() => useProfessors(), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockGet).toHaveBeenCalledWith("/v1/backwork/professors");
      expect(result.current.data).toEqual(mockData);
    });

    it("surfaces an error when fetch fails", async () => {
      const mockError = new Error("Fetch failed");
      const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockClient = { GET: mockGet };

      const { result } = renderHook(() => useProfessors(), {
        wrapper: createWrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });
  });

  describe("useRequestBackworkUploadUrl", () => {
    it("requests an upload URL", async () => {
      const mockData = { url: "https://upload.url", filename: "test.pdf" };
      const mockPost = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { POST: mockPost };

      const { result } = renderHook(() => useRequestBackworkUploadUrl(), {
        wrapper: createWrapper(mockClient),
      });

      const body = { filename: "test.pdf", content_type: "application/pdf" };
      await expect(result.current.mutateAsync(body)).resolves.toEqual(mockData);

      expect(mockPost).toHaveBeenCalledWith("/v1/backwork/upload-url", { body });
    });

    it("surfaces an error when request fails", async () => {
      const mockError = new Error("Upload failed");
      const mockPost = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockClient = { POST: mockPost };

      const { result } = renderHook(() => useRequestBackworkUploadUrl(), {
        wrapper: createWrapper(mockClient),
      });

      const body = { filename: "test.pdf", content_type: "application/pdf" };
      await expect(result.current.mutateAsync(body)).rejects.toThrowError(mockError);
    });
  });

  describe("useConfirmBackworkUpload", () => {
    it("confirms backwork upload and invalidates queries", async () => {
      const mockData = { id: "res1", status: "success" };
      const mockPost = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { POST: mockPost };
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useConfirmBackworkUpload(), {
        wrapper: createWrapper(mockClient),
      });

      const body = {
        storage_path: "path/to/file",
        file_hash: "hash123",
        title: "Midterm",
        is_redacted: false,
      };

      await expect(result.current.mutateAsync(body)).resolves.toEqual(mockData);

      expect(mockPost).toHaveBeenCalledWith("/v1/backwork", { body });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: ["backwork"],
      });
    });

    it("surfaces an error when confirmation fails", async () => {
      const mockError = new Error("Confirmation failed");
      const mockPost = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockClient = { POST: mockPost };

      const { result } = renderHook(() => useConfirmBackworkUpload(), {
        wrapper: createWrapper(mockClient),
      });

      const body = {
        storage_path: "path/to/file",
        file_hash: "hash123",
        is_redacted: false,
      };

      await expect(result.current.mutateAsync(body)).rejects.toThrowError(mockError);
    });
  });

  describe("useDeleteBackworkResource", () => {
    it("deletes a backwork resource and invalidates queries", async () => {
      const mockData = { success: true };
      const mockDelete = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { DELETE: mockDelete };
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useDeleteBackworkResource(), {
        wrapper: createWrapper(mockClient),
      });

      await expect(result.current.mutateAsync("res1")).resolves.toEqual(mockData);

      expect(mockDelete).toHaveBeenCalledWith("/v1/backwork/{id}", {
        params: { path: { id: "res1" } },
      });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: ["backwork"],
      });
    });

    it("surfaces an error when delete fails", async () => {
      const mockError = new Error("Delete failed");
      const mockDelete = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockClient = { DELETE: mockDelete };

      const { result } = renderHook(() => useDeleteBackworkResource(), {
        wrapper: createWrapper(mockClient),
      });

      await expect(result.current.mutateAsync("res1")).rejects.toThrowError(mockError);
    });
  });

  describe("useUpdateDepartment", () => {
    it("updates a department and invalidates queries", async () => {
      const mockData = { id: "dep1", name: "Computer Science" };
      const mockPatch = vi.fn().mockResolvedValue({ data: mockData, error: null });
      const mockClient = { PATCH: mockPatch };
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useUpdateDepartment(), {
        wrapper: createWrapper(mockClient),
      });

      const req = { id: "dep1", body: { name: "Computer Science" } };
      await expect(result.current.mutateAsync(req)).resolves.toEqual(mockData);

      expect(mockPatch).toHaveBeenCalledWith("/v1/backwork/departments/{id}", {
        params: { path: { id: "dep1" } },
        body: { name: "Computer Science" },
      });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: ["backwork", "departments"],
      });
    });

    it("surfaces an error when update fails", async () => {
      const mockError = new Error("Update failed");
      const mockPatch = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const mockClient = { PATCH: mockPatch };

      const { result } = renderHook(() => useUpdateDepartment(), {
        wrapper: createWrapper(mockClient),
      });

      const req = { id: "dep1", body: { name: "Computer Science" } };
      await expect(result.current.mutateAsync(req)).rejects.toThrowError(mockError);
    });
  });
});
