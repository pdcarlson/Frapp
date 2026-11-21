import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_EMOJI_STORAGE_KEY } from "@repo/chat-core/emoji-recent";
import {
  recordRecentEmoji,
  resetRecentEmojiForTests,
  useRecentEmoji,
} from "./recent-emoji";

describe("recent emoji on the web", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRecentEmojiForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follows another tab's use while a picker is open", () => {
    const { result } = renderHook(() => useRecentEmoji());
    expect(result.current).toEqual([]);
    window.localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, "\u{1F389}");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: RECENT_EMOJI_STORAGE_KEY }),
      );
    });
    expect(result.current).toEqual(["\u{1F389}"]);
  });

  it("reads another tab's use made while no picker was open", () => {
    const first = renderHook(() => useRecentEmoji());
    first.unmount();
    window.localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, "\u{1F389}");
    const { result } = renderHook(() => useRecentEmoji());
    expect(result.current).toEqual(["\u{1F389}"]);
  });

  it("writes on top of what another tab stored, not over it", () => {
    renderHook(() => useRecentEmoji());
    window.localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, "\u{1F389}");
    act(() => recordRecentEmoji("\u{1F525}"));
    expect(window.localStorage.getItem(RECENT_EMOJI_STORAGE_KEY)).toBe(
      "\u{1F525} \u{1F389}",
    );
  });

  it("keeps this page's list when storage throws", () => {
    const { result } = renderHook(() => useRecentEmoji());
    act(() => recordRecentEmoji("\u{1F389}"));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => recordRecentEmoji("\u{1F525}"));
    expect(result.current).toEqual(["\u{1F525}", "\u{1F389}"]);
  });
});
