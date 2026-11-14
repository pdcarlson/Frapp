/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock("./use-frapp-client", () => ({
  useFrappClient: () => client,
  useActiveChapterId: () => "chapter-1",
}));
vi.mock("./use-user", () => ({ useViewerUserId: () => "user-1" }));

import { useAskCards } from "./use-ask-cards";

const listOf = (...ids: string[]) => ({
  data: { items: ids.map((id) => ({ id })), has_more: false },
  response: { ok: true, status: 200 },
});

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => client.GET.mockReset());

describe("useAskCards", () => {
  it("reads the asker's own waiting requests and keeps the ones the answer named", async () => {
    client.GET.mockResolvedValue(listOf("s1", "s2", "other"));
    const ids = ["s1", "s2"];
    const { result } = renderHook(() => useAskCards(ids), { wrapper: wrapper() });
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(client.GET).toHaveBeenCalledWith("/v1/ai/suggestions", {
      params: { query: { source_type: "request", source_id: "user-1" } },
    });
    expect([...result.current.byId.keys()]).toEqual(["s1", "s2"]);
    expect(client.GET).toHaveBeenCalledTimes(1);
  });

  it("reads the list once more for a card it does not hold, then calls it gone", async () => {
    client.GET.mockResolvedValueOnce(listOf("s1")).mockResolvedValue(listOf("s1"));
    const ids = ["s1", "s2"];
    const { result } = renderHook(() => useAskCards(ids), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(client.GET).toHaveBeenCalledTimes(2);
    expect(result.current.byId.has("s2")).toBe(false);
  });

  it("finds a card made after the list was first read", async () => {
    client.GET.mockResolvedValueOnce(listOf()).mockResolvedValue(listOf("s9"));
    const ids = ["s9"];
    const { result } = renderHook(() => useAskCards(ids), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.byId.has("s9")).toBe(true));
    expect(result.current.settled).toBe(true);
  });

  it("asks for nothing when no card is waiting", () => {
    const none: string[] = [];
    const { result } = renderHook(() => useAskCards(none), { wrapper: wrapper() });
    expect(client.GET).not.toHaveBeenCalled();
    expect(result.current.settled).toBe(false);
  });

  it("does not call a card gone when the list cannot be read", async () => {
    client.GET.mockResolvedValue({
      error: { code: "x" },
      response: { ok: false, status: 500 },
    });
    const ids = ["s1"];
    const { result } = renderHook(() => useAskCards(ids), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.settled).toBe(false);
  });

  it("does not call a card gone when the second read fails, and keeps a gone card gone through later reads", async () => {
    client.GET.mockResolvedValueOnce(listOf()).mockResolvedValueOnce({
      error: { code: "x" },
      response: { ok: false, status: 500 },
    });
    const ids = ["s1"];
    const view = renderHook(() => useAskCards(ids), { wrapper: wrapper() });
    await waitFor(() => expect(view.result.current.failed).toBe(true));
    expect(view.result.current.settled).toBe(false);

    client.GET.mockReset().mockResolvedValue(listOf());
    const again = renderHook(() => useAskCards(ids), { wrapper: wrapper() });
    await waitFor(() => expect(again.result.current.settled).toBe(true));
    // A later read of the list is slow: the line stays.
    let release!: (value: unknown) => void;
    client.GET.mockReturnValue(new Promise((resolve) => (release = resolve)));
    again.rerender();
    expect(again.result.current.settled).toBe(true);
    release(listOf());
  });
});
