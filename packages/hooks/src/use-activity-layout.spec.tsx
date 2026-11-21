import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivityLayoutRead } from "./activity-cards";
import {
  useActivityLayout,
  useResetActivityLayout,
  useSaveActivityLayout,
} from "./use-activity-layout";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

const KEY = (chapterId: string) => ["activity-layout", chapterId];

const STORED: ActivityLayoutRead = {
  card_order: ["future-card", "todo", "links"],
  hidden_cards: ["recap", "future-hidden"],
  saved: true,
};

function setup({
  PUT = vi.fn(),
  DELETE = vi.fn(),
  GET = vi.fn(),
  chapter = { id: "chapter-a" },
}: {
  PUT?: ReturnType<typeof vi.fn>;
  DELETE?: ReturnType<typeof vi.fn>;
  GET?: ReturnType<typeof vi.fn>;
  chapter?: { id: string };
} = {}) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(KEY("chapter-a"), STORED);
  const wrapper = createHookWrapper({
    client: { GET, PUT, DELETE },
    queryClient,
    chapterId: () => chapter.id,
    displayName: "ActivityLayoutWrapper",
  });
  return { queryClient, wrapper, PUT, DELETE, GET, chapter };
}

describe("useSaveActivityLayout", () => {
  it("shows the arrangement at once and sends it with the stored unknown keys", async () => {
    let answer!: (value: unknown) => void;
    const PUT = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { queryClient, wrapper } = setup({ PUT });
    const { result } = renderHook(() => useSaveActivityLayout(), { wrapper });

    act(() => {
      result.current.mutate({ shown: ["links", "todo"], hidden: ["recap"] });
    });
    await waitFor(() => expect(PUT).toHaveBeenCalled());

    const call = PUT.mock.calls[0] as unknown as [
      string,
      { body: { card_order: string[]; hidden_cards: string[] } },
    ];
    const body = call[1].body;
    expect(body.card_order).toEqual(["future-card", "links", "todo"]);
    expect(body.hidden_cards).toEqual(["recap", "future-hidden"]);
    expect(queryClient.getQueryData(KEY("chapter-a"))).toEqual({
      ...body,
      saved: true,
    });
    answer({ data: { ...body, saved: true } });
  });

  it("writes the answer to the chapter the save started in", async () => {
    let answer!: (value: unknown) => void;
    const PUT = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { queryClient, wrapper, chapter } = setup({ PUT });
    const { result, rerender } = renderHook(() => useSaveActivityLayout(), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ shown: ["todo"], hidden: [] });
    });
    await waitFor(() => expect(PUT).toHaveBeenCalled());
    chapter.id = "chapter-b";
    rerender();
    const saved = { card_order: ["todo"], hidden_cards: [], saved: true };
    await act(async () => answer({ data: saved }));

    expect(queryClient.getQueryData(KEY("chapter-a"))).toEqual(saved);
    expect(queryClient.getQueryData(KEY("chapter-b"))).toBeUndefined();
  });

  it("puts back what was there when the save fails", async () => {
    const PUT = vi.fn(() => Promise.resolve({ error: { message: "no" } }));
    const { queryClient, wrapper } = setup({ PUT });
    const { result } = renderHook(() => useSaveActivityLayout(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ shown: ["todo"], hidden: [] })
        .catch(() => undefined);
    });
    expect(queryClient.getQueryData(KEY("chapter-a"))).toEqual(STORED);
  });

  it("cancels a read already out, so it can't draw the old arrangement back", async () => {
    const { queryClient, wrapper } = setup({
      PUT: vi.fn(() => new Promise(() => undefined)),
    });
    const cancel = vi.spyOn(queryClient, "cancelQueries");
    const { result } = renderHook(() => useSaveActivityLayout(), { wrapper });
    act(() => {
      result.current.mutate({ shown: ["todo"], hidden: [] });
    });
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({
        queryKey: KEY("chapter-a"),
        exact: true,
      }),
    );
  });
});

describe("useResetActivityLayout", () => {
  it("shows the default at once and reads the server's copy after", async () => {
    const DELETE = vi.fn(() => Promise.resolve({}));
    const { queryClient, wrapper } = setup({ DELETE });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useResetActivityLayout(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(DELETE).toHaveBeenCalledWith("/v1/activity/layout");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: KEY("chapter-a"),
      exact: true,
    });
  });

  it("puts the arrangement back when the reset fails", async () => {
    const DELETE = vi.fn(() => Promise.resolve({ error: { message: "no" } }));
    const { queryClient, wrapper } = setup({ DELETE });
    const { result } = renderHook(() => useResetActivityLayout(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    expect(queryClient.getQueryData(KEY("chapter-a"))).toEqual(STORED);
  });
});

describe("useActivityLayout", () => {
  it("reads the member's arrangement for the open chapter", async () => {
    const GET = vi.fn(() => Promise.resolve({ data: STORED }));
    const { wrapper } = setup({ GET, chapter: { id: "chapter-c" } });
    const { result } = renderHook(() => useActivityLayout(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(GET).toHaveBeenCalledWith(
      "/v1/activity/layout",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});
