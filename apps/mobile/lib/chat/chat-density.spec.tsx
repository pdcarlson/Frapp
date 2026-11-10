/** @vitest-environment jsdom */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_CHANNEL_DENSITY_STORAGE_KEY,
  CHAT_DENSITY_STORAGE_KEY,
} from "@repo/chat-core/density";
import {
  hydrateChatDensity,
  resetChatDensityForTests,
  setChannelDensity,
  setChatDensity,
  useChannelDensityOverride,
  useChatDensity,
} from "./chat-density";

const getItem = vi.mocked(AsyncStorage.getItem);
const setItem = vi.mocked(AsyncStorage.setItem);

describe("the phone's chat density", () => {
  beforeEach(() => {
    resetChatDensityForTests();
    getItem.mockReset();
    setItem.mockReset();
    setItem.mockResolvedValue(undefined);
  });

  it("reads a density stored by an earlier launch", async () => {
    getItem.mockResolvedValue("compact");
    const { result } = renderHook(() => useChatDensity());
    expect(result.current).toBe("cozy");
    await act(async () => {
      await hydrateChatDensity();
    });
    expect(getItem).toHaveBeenCalledWith(CHAT_DENSITY_STORAGE_KEY);
    expect(result.current).toBe("compact");
  });

  it("reads storage that fails, or holds junk, as cozy", async () => {
    getItem.mockRejectedValue(new Error("disk"));
    const { result } = renderHook(() => useChatDensity());
    await act(async () => {
      await hydrateChatDensity();
    });
    expect(result.current).toBe("cozy");
  });

  it("stores a pick and redraws at once", () => {
    getItem.mockResolvedValue(null);
    const { result } = renderHook(() => useChatDensity());
    act(() => setChatDensity("compact"));
    expect(result.current).toBe("compact");
    expect(setItem).toHaveBeenCalledWith(CHAT_DENSITY_STORAGE_KEY, "compact");
  });

  it("keeps a pick made before the stored read lands", async () => {
    let land: (value: string | null) => void = () => {};
    getItem.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const { result } = renderHook(() => useChatDensity());
    act(() => setChatDensity("compact"));
    await act(async () => {
      land("cozy");
      await hydrateChatDensity();
    });
    expect(result.current).toBe("compact");
  });
});

describe("a channel's own display on this phone (#3787)", () => {
  beforeEach(() => {
    resetChatDensityForTests();
    getItem.mockReset();
    setItem.mockReset();
    setItem.mockResolvedValue(undefined);
  });

  it("reads overrides stored by an earlier launch", async () => {
    getItem.mockImplementation(async (key: string) =>
      key === CHAT_CHANNEL_DENSITY_STORAGE_KEY
        ? JSON.stringify({ a: "bubbles" })
        : null,
    );
    const { result } = renderHook(() => useChatDensity("a"));
    await act(async () => {
      await hydrateChatDensity();
    });
    expect(result.current).toBe("bubbles");
  });

  it("pins one channel, stores it, and clears it back to the default", () => {
    getItem.mockResolvedValue(null);
    const { result } = renderHook(() => ({
      a: useChatDensity("a"),
      b: useChatDensity("b"),
      override: useChannelDensityOverride("a"),
    }));
    act(() => setChannelDensity("a", "bubbles"));
    expect(result.current).toEqual({
      a: "bubbles",
      b: "cozy",
      override: "bubbles",
    });
    expect(setItem).toHaveBeenCalledWith(
      CHAT_CHANNEL_DENSITY_STORAGE_KEY,
      JSON.stringify({ a: "bubbles" }),
    );
    act(() => setChannelDensity("a", null));
    expect(result.current.override).toBeNull();
    expect(result.current.a).toBe("cozy");
  });
});
