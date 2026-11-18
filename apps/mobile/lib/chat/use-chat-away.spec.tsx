/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { AppState } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AWAY_AFTER_MS } from "./away-updates";
import { useChatAway } from "./use-chat-away";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

const KEY_A = "frapp.chat.lastVisit.u1.chA";
const appState = vi.hoisted(() => ({
  listeners: [] as ((state: string) => void)[],
}));

beforeEach(() => {
  store.clear();
  appState.listeners = [];
  vi.spyOn(AppState, "addEventListener").mockImplementation(
    (_type, listener) => {
      appState.listeners.push(listener as (state: string) => void);
      return { remove: vi.fn() } as never;
    },
  );
});

describe("useChatAway", () => {
  it("opens a stretch after eight hours away, and records the visit", async () => {
    const since = Date.now() - AWAY_AFTER_MS - 60_000;
    store.set(KEY_A, String(since));
    const { result } = renderHook(() =>
      useChatAway({ viewerId: "u1", chapterId: "chA", focused: true }),
    );
    await waitFor(() => expect(result.current.stretch?.since).toBe(since));
    expect(Number(store.get(KEY_A))).toBeGreaterThan(since);
  });

  it("opens none on a first visit or a short absence", async () => {
    const { result } = renderHook(() =>
      useChatAway({ viewerId: "u1", chapterId: "chA", focused: true }),
    );
    await waitFor(() => expect(store.has(KEY_A)).toBe(true));
    expect(result.current.stretch).toBeNull();
  });

  it("checks again when the app comes back to the foreground on Chat", async () => {
    const { result } = renderHook(() =>
      useChatAway({ viewerId: "u1", chapterId: "chA", focused: true }),
    );
    await waitFor(() => expect(store.has(KEY_A)).toBe(true));
    // A night in the background: focus never fires, the app state does.
    const since = Date.now() - AWAY_AFTER_MS - 1;
    store.set(KEY_A, String(since));
    act(() => appState.listeners.forEach((listener) => listener("active")));
    await waitFor(() => expect(result.current.stretch?.since).toBe(since));
  });

  it("drops the stretch on a chapter switch", async () => {
    store.set(KEY_A, String(Date.now() - AWAY_AFTER_MS - 60_000));
    const { result, rerender } = renderHook(
      ({ chapterId }) =>
        useChatAway({ viewerId: "u1", chapterId, focused: true }),
      { initialProps: { chapterId: "chA" } },
    );
    await waitFor(() => expect(result.current.stretch).not.toBeNull());
    store.set("frapp.chat.lastVisit.u1.chB", String(Date.now() - 60_000));
    rerender({ chapterId: "chB" });
    expect(result.current.stretch).toBeNull();
  });

  it("keeps the channels it froze, and ends or closes on request", async () => {
    store.set(KEY_A, String(Date.now() - AWAY_AFTER_MS - 60_000));
    const { result } = renderHook(() =>
      useChatAway({ viewerId: "u1", chapterId: "chA", focused: true }),
    );
    await waitFor(() => expect(result.current.stretch).not.toBeNull());
    act(() => result.current.freeze(["exec"]));
    act(() => result.current.freeze(["general"]));
    expect([...(result.current.stretch?.ids ?? [])]).toEqual(["exec"]);
    act(() => result.current.close());
    expect(result.current.stretch?.closed).toBe(true);
    act(() => result.current.end());
    expect(result.current.stretch).toBeNull();
  });
});
