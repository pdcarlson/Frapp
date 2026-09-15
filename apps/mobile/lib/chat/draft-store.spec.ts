import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAsyncStorageDraftStore } from "./draft-store";
import { draftKey } from "./outbox-store";

/** The member every draft below is keyed under. */
const SCOPE = { userId: "user-a" };

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
    const store = createAsyncStorageDraftStore(SCOPE, storage);

    return store.save("chan-1", "half a message").then(async () => {
      // The exact key `clearDraft` removes. If these two ever disagree, a sent
      // message stops clearing its draft and the composer refills itself.
      expect(storage.values.get(draftKey(SCOPE, "chan-1"))).toBe(
        "half a message",
      );
      expect(await store.load("chan-1")).toBe("half a message");
    });
  });

  it("returns an empty string for a channel with no draft", async () => {
    const store = createAsyncStorageDraftStore(SCOPE, storage);

    expect(await store.load("never-typed-in")).toBe("");
  });

  it("scopes drafts per channel", async () => {
    const store = createAsyncStorageDraftStore(SCOPE, storage);

    await store.save("chan-1", "one");
    await store.save("chan-2", "two");

    expect(await store.load("chan-1")).toBe("one");
    expect(await store.load("chan-2")).toBe("two");
  });

  it("removes the key when the draft is emptied rather than storing ''", async () => {
    const store = createAsyncStorageDraftStore(SCOPE, storage);

    await store.save("chan-1", "typed");
    await store.save("chan-1", "");

    expect(storage.values.has(draftKey(SCOPE, "chan-1"))).toBe(false);
    expect(await store.load("chan-1")).toBe("");
  });

  it("clears a draft", async () => {
    const store = createAsyncStorageDraftStore(SCOPE, storage);

    await store.save("chan-1", "typed");
    await store.clear("chan-1");

    expect(await store.load("chan-1")).toBe("");
  });

  it("degrades to an empty draft when the read throws", async () => {
    // A lost draft is cosmetic; it must never fail the screen that reads it.
    storage.getItem.mockRejectedValueOnce(new Error("storage unavailable"));
    const store = createAsyncStorageDraftStore(SCOPE, storage);

    await expect(store.load("chan-1")).resolves.toBe("");
  });

  it("swallows a write failure rather than failing the send that triggered it", async () => {
    storage.setItem.mockRejectedValueOnce(new Error("quota exceeded"));
    const store = createAsyncStorageDraftStore(SCOPE, storage);

    await expect(store.save("chan-1", "typed")).resolves.toBeUndefined();
  });

  it("swallows a clear failure", async () => {
    storage.removeItem.mockRejectedValueOnce(new Error("storage unavailable"));
    const store = createAsyncStorageDraftStore(SCOPE, storage);

    await expect(store.clear("chan-1")).resolves.toBeUndefined();
  });
});

/**
 * The #2228 tenant boundary for drafts.
 *
 * Same argument as the outbox: run the real store against a real storage fake,
 * write as one member and read as another. A composer that opens showing
 * someone else's unsent text is the visible half of the shared-device bug.
 */
describe("createAsyncStorageDraftStore tenant scoping (#2228)", () => {
  const MEMBER_A = { userId: "user-a" };
  const MEMBER_B = { userId: "user-b" };

  it("does not load another member's draft into the composer", async () => {
    const a = createAsyncStorageDraftStore(MEMBER_A, storage);
    await a.save("chan-1", "A's half-typed message");

    const b = createAsyncStorageDraftStore(MEMBER_B, storage);

    expect(await b.load("chan-1")).toBe("");
    // A's draft is kept, not wiped — it waits for A's next sign-in.
    expect(await a.load("chan-1")).toBe("A's half-typed message");
  });

  it("cannot clear another member's draft", async () => {
    const a = createAsyncStorageDraftStore(MEMBER_A, storage);
    await a.save("chan-1", "A's half-typed message");

    await createAsyncStorageDraftStore(MEMBER_B, storage).clear("chan-1");

    expect(await a.load("chan-1")).toBe("A's half-typed message");
  });

  it("cannot overwrite another member's draft", async () => {
    const a = createAsyncStorageDraftStore(MEMBER_A, storage);
    await a.save("chan-1", "A's half-typed message");

    await createAsyncStorageDraftStore(MEMBER_B, storage).save(
      "chan-1",
      "B's message",
    );

    expect(await a.load("chan-1")).toBe("A's half-typed message");
    expect(storage.values.get(draftKey(MEMBER_A, "chan-1"))).toBe(
      "A's half-typed message",
    );
    expect(storage.values.get(draftKey(MEMBER_B, "chan-1"))).toBe(
      "B's message",
    );
  });

  it("is inert with no scope rather than writing an unattributable key", async () => {
    // Unlike the outbox this does not throw: a draft that does not persist
    // loses at most the keystrokes since the last save, and the composer keeps
    // its in-memory value either way.
    const unscoped = createAsyncStorageDraftStore(null, storage);

    await unscoped.save("chan-1", "nowhere");

    expect(storage.values.size).toBe(0);
    expect(await unscoped.load("chan-1")).toBe("");
    await expect(unscoped.clear("chan-1")).resolves.toBeUndefined();
  });
});
