import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_EMOJI_STORAGE_KEY } from "@repo/chat-core/emoji-recent";
import { recordRecentEmoji, resetRecentEmojiForTests } from "./recent-emoji";

const getItem = vi.mocked(AsyncStorage.getItem);
const setItem = vi.mocked(AsyncStorage.setItem);

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("recent emoji on mobile", () => {
  beforeEach(() => {
    resetRecentEmojiForTests();
    getItem.mockReset();
    setItem.mockReset();
    setItem.mockResolvedValue(undefined);
  });

  it("lands a use on top of what was stored, even on a cold start", async () => {
    let resolveRead: (raw: string | null) => void = () => {};
    getItem.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveRead = resolve;
      }),
    );
    // The reaction comes before the stored read lands.
    recordRecentEmoji("🎉");
    expect(setItem).not.toHaveBeenCalled();
    resolveRead("🔥 👍");
    await settle();
    expect(setItem).toHaveBeenCalledWith(RECENT_EMOJI_STORAGE_KEY, "🎉 🔥 👍");
  });

  it("starts a list when storage is empty or unreadable", async () => {
    getItem.mockRejectedValue(new Error("storage"));
    recordRecentEmoji("🔥");
    await settle();
    expect(setItem).toHaveBeenCalledWith(RECENT_EMOJI_STORAGE_KEY, "🔥");
  });
});
