/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock("./use-frapp-client", () => ({ useFrappClient: () => client }));

import { useAskThumbs } from "./use-ask-feedback";

const ok = { data: {}, response: { ok: true, status: 200 } };
const down = { error: { code: "x" }, response: { ok: false, status: 500 } };
const PATH = { params: { path: { ask_id: "ask-1" } } };

beforeEach(() => {
  client.PUT.mockReset().mockResolvedValue(ok);
  client.DELETE.mockReset().mockResolvedValue(ok);
});

describe("useAskThumbs", () => {
  it("shows a thumb at once and sends the rating alone", async () => {
    const { result } = renderHook(() => useAskThumbs("ask-1"));
    act(() => result.current.rate("up"));
    expect(result.current.state).toEqual({ rating: "up", reason: null });
    await act(async () => {});
    expect(client.PUT).toHaveBeenCalledWith("/v1/ai/ask/{ask_id}/feedback", {
      ...PATH,
      body: { rating: "up" },
    });
  });

  it("takes a thumb back when it is tapped again, and changes it for the other one", async () => {
    const { result } = renderHook(() => useAskThumbs("ask-1"));
    act(() => result.current.rate("up"));
    act(() => result.current.rate("up"));
    expect(result.current.state.rating).toBeNull();
    await act(async () => {});
    expect(client.DELETE).toHaveBeenCalledWith(
      "/v1/ai/ask/{ask_id}/feedback",
      PATH,
    );
    act(() => result.current.rate("down"));
    act(() => result.current.giveReason("missed"));
    expect(result.current.state).toEqual({ rating: "down", reason: "missed" });
    await act(async () => {});
    expect(client.PUT).toHaveBeenLastCalledWith(
      "/v1/ai/ask/{ask_id}/feedback",
      { ...PATH, body: { rating: "down", reason: "missed" } },
    );
    // The other thumb drops the reason.
    act(() => result.current.rate("up"));
    expect(result.current.state).toEqual({ rating: "up", reason: null });
  });

  it("goes back to what the server last took when a send fails, and says so until the next tap", async () => {
    const { result } = renderHook(() => useAskThumbs("ask-1"));
    act(() => result.current.rate("up"));
    await waitFor(() => expect(client.PUT).toHaveBeenCalledTimes(1));
    await act(async () => {});
    client.PUT.mockResolvedValueOnce(down);
    act(() => result.current.rate("down"));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.state).toEqual({ rating: "up", reason: null });
    act(() => result.current.rate("down"));
    expect(result.current.failed).toBe(false);
  });

  it("ignores an older tap that fails after a newer one", async () => {
    let fail!: () => void;
    client.PUT.mockReturnValueOnce(
      new Promise((resolve) => {
        fail = () => resolve(down);
      }),
    );
    const { result } = renderHook(() => useAskThumbs("ask-1"));
    act(() => result.current.rate("up"));
    act(() => result.current.rate("down"));
    await act(async () => fail());
    expect(result.current.state.rating).toBe("down");
    expect(result.current.failed).toBe(false);
  });

  it("sends taps in order, so a failed newer tap falls back to the older one the server took", async () => {
    let land!: () => void;
    client.PUT.mockReturnValueOnce(
      new Promise((resolve) => {
        land = () => resolve(ok);
      }),
    ).mockResolvedValueOnce(down);
    const { result } = renderHook(() => useAskThumbs("ask-1"));
    act(() => result.current.rate("up"));
    act(() => result.current.rate("down"));
    // The second waits for the first.
    await act(async () => {});
    expect(client.PUT).toHaveBeenCalledTimes(1);
    await act(async () => land());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(client.PUT).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ rating: "up", reason: null });
  });

  it("sends nothing for an answer with no id", () => {
    const { result } = renderHook(() => useAskThumbs(null));
    act(() => result.current.rate("up"));
    expect(result.current.state.rating).toBeNull();
    expect(client.PUT).not.toHaveBeenCalled();
  });
});
