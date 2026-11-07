/** @vitest-environment jsdom */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_DENSITY_STORAGE_KEY } from "@repo/chat-core/density";
import {
  hydrateChatDensity,
  resetChatDensityForTests,
  setChatDensity,
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
