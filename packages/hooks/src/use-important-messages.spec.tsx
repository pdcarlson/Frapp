import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { FrappClientProvider } from "./use-frapp-client";
import {
  IMPORTANT_SEEN_BATCH_MS,
  importantMessageKeys,
  importantSignature,
  importantStripLabel,
  useImportantMessages,
  withoutMessages,
  type ImportantMessages,
} from "./use-important-messages";

const KEY = importantMessageKeys.detail("chapter-1", "chan-1");

const ref = (id: string) => ({
  id,
  created_at: "2026-11-11T15:00:00.000Z",
  flagged_at: "2026-11-11T15:00:00.000Z",
  sender_id: "sam",
  author_name: null,
  excerpt: `message ${id}`,
});

const answer = (ids: string[]): ImportantMessages => ({
  messages: ids.map(ref),
  total: ids.length,
});

type Flagged = {
  id: string;
  flag?: string | null;
  flagged_at?: string | null;
  is_deleted?: boolean;
};

function setup(initial: ImportantMessages) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const GET = vi.fn().mockResolvedValue({ data: initial });
  const POST = vi.fn(
    (path: string, init: { body?: { message_ids: string[] } }) => {
      if (path.endsWith("/dismiss")) {
        return Promise.resolve({ data: answer([]) });
      }
      const asked = new Set(init.body?.message_ids ?? []);
      const current =
        queryClient.getQueryData<ImportantMessages>(KEY) ?? initial;
      return Promise.resolve({
        data: answer(
          initial.messages.map((m) => m.id).filter((id) => !asked.has(id)),
        ),
        current,
      });
    },
  );
  const client = { GET, POST };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        client as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId="chapter-1"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  return { queryClient, GET, POST, wrapper };
}

describe("importantStripLabel", () => {
  it("counts in words", () => {
    expect(importantStripLabel(1)).toBe("1 important message");
    expect(importantStripLabel(3)).toBe("3 important messages");
  });
});

describe("importantSignature", () => {
  it("changes when a flag goes on, comes off or is replaced, not otherwise", () => {
    const base: Flagged[] = [
      { id: "a", flag: "important", flagged_at: "t1" },
      { id: "b", flag: "funny", flagged_at: "t1" },
    ];
    const same = importantSignature([
      { id: "b", flag: "funny", flagged_at: "t1" },
      { id: "a", flag: "important", flagged_at: "t1" },
    ]);
    expect(importantSignature(base)).toBe(same);
    expect(
      importantSignature([
        ...base,
        { id: "c", flag: "important", flagged_at: "t2" },
      ]),
    ).not.toBe(same);
    expect(
      importantSignature([
        { id: "a", flag: "important", flagged_at: "t3" },
        base[1]!,
      ]),
    ).not.toBe(same);
    expect(
      importantSignature([{ id: "a", flag: "important", is_deleted: true }]),
    ).toBe("");
  });
});

describe("withoutMessages", () => {
  it("takes the ids out of the list and the count", () => {
    expect(
      withoutMessages(answer(["a", "b", "c"]), new Set(["b", "x"])),
    ).toEqual(answer(["a", "c"]));
  });
});

describe("useImportantMessages", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("reads the channel's strip and points at the oldest unseen", async () => {
    const { GET, wrapper } = setup(answer(["a", "b"]));
    const { result } = renderHook(() => useImportantMessages("chan-1", []), {
      wrapper,
    });

    await waitFor(() => expect(result.current.total).toBe(2));
    expect(result.current.next?.id).toBe("a");
    expect(GET).toHaveBeenCalledWith("/v1/channels/{id}/important", {
      params: { path: { id: "chan-1" } },
    });
  });

  it("marks a jumped-to message seen at once, and leaves the strip at once", async () => {
    const { POST, wrapper } = setup(answer(["a", "b"]));
    const { result } = renderHook(() => useImportantMessages("chan-1", []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.total).toBe(2));

    act(() => result.current.markSeen(["a"]));

    // Before the write answers: the optimistic copy.
    await waitFor(() => expect(result.current.total).toBe(1));
    expect(result.current.next?.id).toBe("b");
    expect(POST).toHaveBeenCalledWith("/v1/channels/{id}/important/seen", {
      params: { path: { id: "chan-1" } },
      body: { message_ids: ["a"] },
    });
  });

  it("batches rows scrolled onto the screen, and writes each once", async () => {
    const { POST, wrapper } = setup(answer(["a", "b", "c"]));
    const { result } = renderHook(() => useImportantMessages("chan-1", []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.total).toBe(3));

    act(() => {
      result.current.reportVisible(["x", "a"]);
      result.current.reportVisible(["a", "b", "y"]);
    });
    expect(POST).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(IMPORTANT_SEEN_BATCH_MS);
    });

    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST.mock.calls[0]![1]).toEqual({
      params: { path: { id: "chan-1" } },
      body: { message_ids: ["a", "b"] },
    });

    act(() => result.current.reportVisible(["a", "b"]));
    await act(async () => {
      vi.advanceTimersByTime(IMPORTANT_SEEN_BATCH_MS);
    });
    expect(POST).toHaveBeenCalledTimes(1);
  });

  it("dismisses every one", async () => {
    const { POST, wrapper } = setup(answer(["a", "b"]));
    const { result } = renderHook(() => useImportantMessages("chan-1", []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.total).toBe(2));

    act(() => result.current.dismiss());

    await waitFor(() => expect(result.current.total).toBe(0));
    expect(POST).toHaveBeenCalledWith("/v1/channels/{id}/important/dismiss", {
      params: { path: { id: "chan-1" } },
    });
  });

  it("puts the message back when the write fails", async () => {
    const { POST, GET, wrapper } = setup(answer(["a"]));
    POST.mockResolvedValueOnce({ error: { message: "nope" } } as never);
    const { result } = renderHook(() => useImportantMessages("chan-1", []), {
      wrapper,
    });
    await waitFor(() => expect(result.current.total).toBe(1));

    act(() => result.current.markSeen(["a"]));

    // The failed write re-reads the strip, so the message comes back, and a
    // later report of it is sent again rather than taken as already sent.
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.total).toBe(1));
    POST.mockClear();
    act(() => result.current.markSeen(["a"]));
    expect(POST).toHaveBeenCalledTimes(1);
  });

  it("re-reads when a loaded message's Important flag changes", async () => {
    const { GET, wrapper } = setup(answer([]));
    const { rerender } = renderHook(
      ({ loaded }: { loaded: Flagged[] }) =>
        useImportantMessages("chan-1", loaded),
      { wrapper, initialProps: { loaded: [{ id: "a" }] as Flagged[] } },
    );
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(1));

    rerender({ loaded: [{ id: "a" }] });
    expect(GET).toHaveBeenCalledTimes(1);

    rerender({ loaded: [{ id: "a", flag: "important", flagged_at: "t" }] });
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));
  });

  it("reads nothing without a channel", () => {
    const { GET, wrapper } = setup(answer(["a"]));
    const { result } = renderHook(() => useImportantMessages(null, []), {
      wrapper,
    });

    expect(result.current.total).toBe(0);
    expect(GET).not.toHaveBeenCalled();
  });
});
