import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAsyncStorageDraftStore } from "./draft-store";
import { DRAFT_PREFIX } from "./outbox-store";

/**
 * The draft store closes a real gap rather than adding a feature:
 * `createAsyncStorageOutboxStore.clearDraft` already removed
 * `chat:draft:<channelId>`, but nothing had ever written that key. The key
 * agreement between the two halves is therefore the single most important thing
 * these tests pin — a prefix drift would leave drafts that no send can clear.
 */

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
});

describe("createAsyncStorageDraftStore", () => {
  it("round-trips a draft under the outbox store's own draft key", () => {
    const store = createAsyncStorageDraftStore(storage);

    return store.save("chan-1", "half a message").then(async () => {
      // The exact key `clearDraft` removes. If these two ever disagree, a sent
      // message stops clearing its draft and the composer refills itself.
      expect(storage.values.get(`${DRAFT_PREFIX}chan-1`)).toBe(
        "half a message",
      );
      expect(await store.load("chan-1")).toBe("half a message");
    });
  });

  it("returns an empty string for a channel with no draft", async () => {
    const store = createAsyncStorageDraftStore(storage);

    expect(await store.load("never-typed-in")).toBe("");
  });

  it("scopes drafts per channel", async () => {
    const store = createAsyncStorageDraftStore(storage);

    await store.save("chan-1", "one");
    await store.save("chan-2", "two");

    expect(await store.load("chan-1")).toBe("one");
    expect(await store.load("chan-2")).toBe("two");
  });

  it("removes the key when the draft is emptied rather than storing ''", async () => {
    const store = createAsyncStorageDraftStore(storage);

    await store.save("chan-1", "typed");
    await store.save("chan-1", "");

    expect(storage.values.has(`${DRAFT_PREFIX}chan-1`)).toBe(false);
    expect(await store.load("chan-1")).toBe("");
  });

  it("clears a draft", async () => {
    const store = createAsyncStorageDraftStore(storage);

    await store.save("chan-1", "typed");
    await store.clear("chan-1");

    expect(await store.load("chan-1")).toBe("");
  });

  it("degrades to an empty draft when the read throws", async () => {
    // A lost draft is cosmetic; it must never fail the screen that reads it.
    storage.getItem.mockRejectedValueOnce(new Error("storage unavailable"));
    const store = createAsyncStorageDraftStore(storage);

    await expect(store.load("chan-1")).resolves.toBe("");
  });

  it("swallows a write failure rather than failing the send that triggered it", async () => {
    storage.setItem.mockRejectedValueOnce(new Error("quota exceeded"));
    const store = createAsyncStorageDraftStore(storage);

    await expect(store.save("chan-1", "typed")).resolves.toBeUndefined();
  });

  it("swallows a clear failure", async () => {
    storage.removeItem.mockRejectedValueOnce(new Error("storage unavailable"));
    const store = createAsyncStorageDraftStore(storage);

    await expect(store.clear("chan-1")).resolves.toBeUndefined();
  });
});
