/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  useBackworkResources,
  useFetchBackworkResource,
  useDeleteBackworkResource,
  useDepartments,
  useProfessors,
  useRequestBackworkUploadUrl,
  useConfirmBackworkUpload,
  useUpdateDepartment,
  useUpdateProfessor,
  useMergeDepartments,
  useBackworkCourses,
  useSaveBackworkCourse,
} from "./use-backwork";
import { FrappClientProvider } from "./use-frapp-client";

describe("useBackwork hooks", () => {
const BACKWORK_KEY = ["backwork"];
const BACKWORK_DEPARTMENTS_KEY = ["backwork", "departments"];
// `useBackworkResources` is chapter-scoped (`enabled: !!chapterId`), so the
// provider has to supply one or its query never runs.
//
// The invalidation assertions below stay chapter-less because that is what the
// hooks currently pass — the bare `["backwork"]` prefix, which still matches
// `["backwork", chapterId, "list"]`. That is a description of today's code,
// not an endorsement: `useFetchBackworkResource`, `useDepartments` and
// `useProfessors` omit chapterId from their keys entirely, which #784 tracks
// (that issue is scoped to keys and their paired invalidations, not to
// `enabled` gates — none of the three gates on the chapter). If those keys gain a chapter, the
// matching invalidations have to gain one too or they stop prefix-matching.
const CHAPTER_ID = "chapter-abc";

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
        chapterId={CHAPTER_ID}
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

      expect(mockGet).toHaveBeenCalledWith("/v1/backwork");
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

  describe("useFetchBackworkResource", () => {
    it("fetches nothing until called", async () => {
      const mockGet = vi.fn();
      renderHook(() => useFetchBackworkResource(), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("fails a press at once instead of retrying, whatever the client defaults", async () => {
      // The app's QueryClient retries 3 times; a Download press must not
      // wait out that ladder on a 404.
      const retrying = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
      const mockGet = vi.fn().mockResolvedValue({ data: null, error: new Error("Not found") });
      const { result } = renderHook(() => useFetchBackworkResource(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <FrappClientProvider
            client={{ GET: mockGet } as unknown as ReturnType<typeof createFrappClient>}
            chapterId={CHAPTER_ID}
          >
            <QueryClientProvider client={retrying}>{children}</QueryClientProvider>
          </FrappClientProvider>
        ),
      });
      await expect(result.current("gone")).rejects.toThrow("Not found");
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it("fetches the resource fresh on every call, so a signed link is never reused", async () => {
      const mockGet = vi
        .fn()
        .mockResolvedValueOnce({ data: { id: "res1", downloadUrl: "a" }, error: null })
        .mockResolvedValueOnce({ data: { id: "res1", downloadUrl: "b" }, error: null });
      const { result } = renderHook(() => useFetchBackworkResource(), {
        wrapper: createWrapper({ GET: mockGet }),
      });

      await expect(result.current("res1")).resolves.toEqual({
        id: "res1",
        downloadUrl: "a",
      });
      await expect(result.current("res1")).resolves.toEqual({
        id: "res1",
        downloadUrl: "b",
      });
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet).toHaveBeenCalledWith("/v1/backwork/{id}", {
        params: { path: { id: "res1" } },
      });
    });

    it("rejects when the API answers with an error", async () => {
      const mockError = new Error("Fetch failed");
      const mockGet = vi.fn().mockResolvedValue({ data: null, error: mockError });
      const { result } = renderHook(() => useFetchBackworkResource(), {
        wrapper: createWrapper({ GET: mockGet }),
      });
      await expect(result.current("res1")).rejects.toBe(mockError);
    });
  });

  describe("useDeleteBackworkResource", () => {
    it("deletes by id and refreshes the library", async () => {
      const mockDelete = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useDeleteBackworkResource(), {
        wrapper: createWrapper({ DELETE: mockDelete }),
      });

      await act(async () => {
        await result.current.mutateAsync("res1");
      });

      expect(mockDelete).toHaveBeenCalledWith("/v1/backwork/{id}", {
        params: { path: { id: "res1" } },
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: BACKWORK_KEY });
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

  describe("useBackworkCourses", () => {
    it("fetches courses", async () => {
      const mockData = [{ id: "c1", name: "Calculus I", nicknames: ["Calc 1"] }];
      const mockGet = vi.fn().mockResolvedValue({ data: mockData, error: null });

      const { result } = renderHook(() => useBackworkCourses(), {
        wrapper: createWrapper({ GET: mockGet }),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(mockGet).toHaveBeenCalledWith("/v1/backwork/courses");
      expect(result.current.data).toEqual(mockData);
    });
  });

  describe("useSaveBackworkCourse", () => {
    const COURSES_KEY = ["backwork", "courses"];

    it("PUTs the course and puts the saved row in the cache at once", async () => {
      queryClient.setQueryData(COURSES_KEY, [{ id: "c1", name: null, nicknames: [] }]);
      const saved = { id: "c1", name: "Calculus I", nicknames: ["Calc 1"] };
      const mockPut = vi.fn().mockResolvedValue({ data: saved, error: null });
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useSaveBackworkCourse(), {
        wrapper: createWrapper({ PUT: mockPut }),
      });
      const body = {
        department_id: "dep1",
        course_number: "1010",
        name: "Calculus I",
        nicknames: ["Calc 1"],
      };
      await result.current.mutateAsync(body);

      expect(mockPut).toHaveBeenCalledWith("/v1/backwork/courses", { body });
      expect(queryClient.getQueryData(COURSES_KEY)).toEqual([saved]);
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: COURSES_KEY });
    });

    it("appends a newly created course to the cache", async () => {
      queryClient.setQueryData(COURSES_KEY, []);
      const saved = { id: "c2", name: "Orgo", nicknames: [] };
      const mockPut = vi.fn().mockResolvedValue({ data: saved, error: null });

      const { result } = renderHook(() => useSaveBackworkCourse(), {
        wrapper: createWrapper({ PUT: mockPut }),
      });
      await result.current.mutateAsync({ department_id: "d", course_number: "1" });

      expect(queryClient.getQueryData(COURSES_KEY)).toEqual([saved]);
    });

    it("surfaces a refusal", async () => {
      const mockError = new Error("Only a backwork admin can remove a nickname.");
      const mockPut = vi.fn().mockResolvedValue({ data: null, error: mockError });

      const { result } = renderHook(() => useSaveBackworkCourse(), {
        wrapper: createWrapper({ PUT: mockPut }),
      });

      await expect(
        result.current.mutateAsync({ department_id: "d", course_number: "1", nicknames: [] }),
      ).rejects.toThrowError(mockError);
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
      const mockData = {
        upload_url: "https://upload.url",
        storage_path: "chapters/c/backwork/r/test.pdf",
        resource_id: "r",
      };
      const mockPost = vi.fn().mockResolvedValue({ data: mockData, error: null, response: { ok: true, status: 201 } });
      const mockClient = { POST: mockPost };

      const { result } = renderHook(() => useRequestBackworkUploadUrl(), {
        wrapper: createWrapper(mockClient),
      });

      const body = { filename: "test.pdf", content_type: "application/pdf" };
      await expect(result.current.mutateAsync(body)).resolves.toEqual(mockData);

      expect(mockPost).toHaveBeenCalledWith("/v1/backwork/upload-url", { body });
    });

    it("surfaces an error when request fails", async () => {
      const mockError = { statusCode: 413, message: "Upload failed" };
      const mockPost = vi.fn().mockResolvedValue({
        data: null,
        error: mockError,
        response: { ok: false, status: 413 },
      });
      const mockClient = { POST: mockPost };

      const { result } = renderHook(() => useRequestBackworkUploadUrl(), {
        wrapper: createWrapper(mockClient),
      });

      const body = { filename: "test.pdf", content_type: "application/pdf" };
      await expect(result.current.mutateAsync(body)).rejects.toEqual(mockError);
    });
  });

  describe("useConfirmBackworkUpload", () => {
    it("confirms backwork upload and invalidates queries", async () => {
      const mockData = { id: "res1", status: "success" };
      const mockPost = vi.fn().mockResolvedValue({ data: mockData, error: null, response: { ok: true, status: 201 } });
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
        queryKey: BACKWORK_KEY,
      });
    });

    it("surfaces an error when confirmation fails", async () => {
      const mockError = { statusCode: 409, message: "Confirmation failed" };
      const mockPost = vi.fn().mockResolvedValue({
        data: null,
        error: mockError,
        response: { ok: false, status: 409 },
      });
      const mockClient = { POST: mockPost };

      const { result } = renderHook(() => useConfirmBackworkUpload(), {
        wrapper: createWrapper(mockClient),
      });

      const body = {
        storage_path: "path/to/file",
        file_hash: "hash123",
        is_redacted: false,
      };

      await expect(result.current.mutateAsync(body)).rejects.toEqual(mockError);
    });

    it("rejects an empty-bodied failure instead of reading it as filed", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: undefined,
        error: undefined,
        response: { ok: false, status: 502 },
      });
      const { result } = renderHook(() => useConfirmBackworkUpload(), {
        wrapper: createWrapper({ POST: mockPost }),
      });
      await expect(
        result.current.mutateAsync({ storage_path: "p", file_hash: "h", is_redacted: false }),
      ).rejects.toMatchObject({ statusCode: 502 });
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
        queryKey: BACKWORK_DEPARTMENTS_KEY,
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

    // Regression: a naive `invalidateQueries`-only `onSuccess` schedules a
    // refetch without awaiting it, so a caller reading the cache right after
    // `mutateAsync` resolves would still see the pre-rename row and briefly
    // render a "reverted" name until the refetch lands. Patching the cache
    // with the server's own response closes that window.
    it("patches the cached departments list with the renamed row synchronously, before any refetch", async () => {
      queryClient.setQueryData(BACKWORK_DEPARTMENTS_KEY, [
        { id: "dep1", code: "CS", name: "Computer Science" },
        { id: "dep2", code: "MATH", name: "Mathematics" },
      ]);
      const mockPatch = vi
        .fn()
        .mockResolvedValue({ data: { id: "dep1", name: "Comp Sci" }, error: null });
      const mockClient = { PATCH: mockPatch };

      const { result } = renderHook(() => useUpdateDepartment(), {
        wrapper: createWrapper(mockClient),
      });

      await result.current.mutateAsync({ id: "dep1", body: { name: "Comp Sci" } });

      // No `waitFor` / refetch involved — this must already be true the
      // instant `mutateAsync` resolves.
      expect(queryClient.getQueryData(BACKWORK_DEPARTMENTS_KEY)).toEqual([
        { id: "dep1", code: "CS", name: "Comp Sci" },
        { id: "dep2", code: "MATH", name: "Mathematics" },
      ]);
    });
  });

  describe("useUpdateProfessor", () => {
    it("updates a professor and patches the cached list synchronously", async () => {
      const BACKWORK_PROFESSORS_KEY = ["backwork", "professors"];
      queryClient.setQueryData(BACKWORK_PROFESSORS_KEY, [
        { id: "prof1", name: "Dr. Smith" },
      ]);
      const mockPatch = vi
        .fn()
        .mockResolvedValue({ data: { id: "prof1", name: "Dr. Smith Jr." }, error: null });
      const mockClient = { PATCH: mockPatch };

      const { result } = renderHook(() => useUpdateProfessor(), {
        wrapper: createWrapper(mockClient),
      });

      await result.current.mutateAsync({
        id: "prof1",
        body: { name: "Dr. Smith Jr." },
      });

      expect(mockPatch).toHaveBeenCalledWith("/v1/backwork/professors/{id}", {
        params: { path: { id: "prof1" } },
        body: { name: "Dr. Smith Jr." },
      });
      expect(queryClient.getQueryData(BACKWORK_PROFESSORS_KEY)).toEqual([
        { id: "prof1", name: "Dr. Smith Jr." },
      ]);
    });
  });

  describe("useMergeDepartments", () => {
    it("posts to the merge endpoint with the target id and invalidates the whole backwork prefix", async () => {
      const mockPost = vi
        .fn()
        .mockResolvedValue({ data: { reassigned: 3 }, error: null });
      const mockClient = { POST: mockPost };
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useMergeDepartments(), {
        wrapper: createWrapper(mockClient),
      });

      await expect(
        result.current.mutateAsync({ id: "dep1", targetId: "dep2" }),
      ).resolves.toEqual({ reassigned: 3 });

      expect(mockPost).toHaveBeenCalledWith(
        "/v1/backwork/departments/{id}/merge",
        {
          params: { path: { id: "dep1" } },
          body: { target_id: "dep2" },
        },
      );
      // Reassignment moves resources between the source and target, so both
      // the resources list and the departments list need invalidating — the
      // broad prefix, not a narrower key, is deliberate here.
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: BACKWORK_KEY,
      });
    });
  });
});
