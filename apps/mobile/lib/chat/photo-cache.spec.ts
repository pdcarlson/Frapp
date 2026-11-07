import { describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  clearDiskCache: vi.fn(async () => true),
  clearMemoryCache: vi.fn(async () => true),
}));
vi.mock("expo-image", () => ({ Image: cache }));

import { chatPhotoCacheKey, forgetCachedChatPhotos } from "./photo-cache";

describe("chatPhotoCacheKey", () => {
  it("names the file, so a re-signed URL still hits the cache", () => {
    expect(chatPhotoCacheKey("att-1", "preview")).toBe(
      chatPhotoCacheKey("att-1", "preview"),
    );
  });

  it("keeps a photo's preview and original apart", () => {
    expect(chatPhotoCacheKey("att-1", "preview")).not.toBe(
      chatPhotoCacheKey("att-1", "original"),
    );
  });
});

describe("forgetCachedChatPhotos", () => {
  it("clears the disk and memory caches, so the next account can't draw them", async () => {
    forgetCachedChatPhotos();
    await vi.waitFor(() => {
      expect(cache.clearDiskCache).toHaveBeenCalled();
      expect(cache.clearMemoryCache).toHaveBeenCalled();
    });
  });

  it("never throws when a clear fails", async () => {
    cache.clearDiskCache.mockRejectedValueOnce(new Error("busy"));
    expect(() => forgetCachedChatPhotos()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
