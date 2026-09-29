import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  DISCORD_IMPORT_PROGRESS_POLL_MS,
  useDiscordImportProgress,
  useStartDiscordImport,
} from "./use-discord-import";
import { FrappClientProvider } from "./use-frapp-client";

/**
 * The wire behaviour of two import hooks the web specs mock away: the date
 * cutoff a start sends (#2858), and when the Watch panel's progress is read
 * (#2857).
 */

const createWrapper = (queryClient: QueryClient, mockClient: unknown) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        mockClient as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId="test-chapter"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
};

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

describe("useStartDiscordImport (#2858)", () => {
  const client = () => ({
    POST: vi.fn(async () => ({ data: { id: "import-1" }, error: undefined })),
  });

  it("sends no body when no cutoff is given, so the import keeps the one it has", async () => {
    const mock = client();
    const { result } = renderHook(() => useStartDiscordImport(), {
      wrapper: createWrapper(queryClient, mock),
    });
    await act(() => result.current.mutateAsync({ id: "import-1" }));
    expect(mock.POST).toHaveBeenCalledWith("/v1/discord-imports/{id}/start", {
      params: { path: { id: "import-1" } },
    });
  });

  it("sends the cutoff as messages_after", async () => {
    const mock = client();
    const { result } = renderHook(() => useStartDiscordImport(), {
      wrapper: createWrapper(queryClient, mock),
    });
    await act(() =>
      result.current.mutateAsync({
        id: "import-1",
        messagesAfter: "2024-06-01T06:00:00.000Z",
      }),
    );
    expect(mock.POST).toHaveBeenCalledWith("/v1/discord-imports/{id}/start", {
      params: { path: { id: "import-1" } },
      body: { messages_after: "2024-06-01T06:00:00.000Z" },
    });
  });
});

describe("useDiscordImportProgress (#2857)", () => {
  const progress = {
    counts: { pending: 1, running: 1, completed: 0, failed: 0, skipped: 0 },
    running: [],
    recent: [],
    failed: [],
  };
  const client = () => ({
    GET: vi.fn(async () => ({ data: progress, error: undefined })),
  });

  it("polls while the import moves, and stops when it doesn't", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const mock = client();
      const { rerender } = renderHook(
        ({ active }) => useDiscordImportProgress("import-1", { active }),
        {
          wrapper: createWrapper(queryClient, mock),
          initialProps: { active: true },
        },
      );
      await waitFor(() => expect(mock.GET).toHaveBeenCalledTimes(1));
      await act(() =>
        vi.advanceTimersByTimeAsync(DISCORD_IMPORT_PROGRESS_POLL_MS),
      );
      await waitFor(() => expect(mock.GET).toHaveBeenCalledTimes(2));

      // The import stops: one last read of where it ended, then no more.
      rerender({ active: false });
      await waitFor(() => expect(mock.GET).toHaveBeenCalledTimes(3));
      await act(() =>
        vi.advanceTimersByTimeAsync(DISCORD_IMPORT_PROGRESS_POLL_MS * 3),
      );
      expect(mock.GET).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a finished import once, and never polls it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const mock = client();
      renderHook(
        () => useDiscordImportProgress("import-1", { active: false }),
        {
          wrapper: createWrapper(queryClient, mock),
        },
      );
      await waitFor(() => expect(mock.GET).toHaveBeenCalledTimes(1));
      await act(() =>
        vi.advanceTimersByTimeAsync(DISCORD_IMPORT_PROGRESS_POLL_MS * 3),
      );
      expect(mock.GET).toHaveBeenCalledTimes(1);
      expect(mock.GET).toHaveBeenCalledWith(
        "/v1/discord-imports/{id}/progress",
        { params: { path: { id: "import-1" } } },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
