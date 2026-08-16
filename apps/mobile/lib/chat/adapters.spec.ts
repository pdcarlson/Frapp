import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserNetworkState } from "@repo/chat-core/adapters";
import { createAsyncStorageKeyValueStore } from "./key-value-store";
import {
  createExpoNetworkState,
  isOfflineFromExpoState,
} from "./network-state";
import { createAsyncStorageOutboxStore, OUTBOX_KEY } from "./outbox-store";

/** In-memory stand-in with the slice of the AsyncStorage surface we use. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: vi.fn(async (k: string) => map.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void map.set(k, v)),
    removeItem: vi.fn(async (k: string) => void map.delete(k)),
    getAllKeys: vi.fn(async () => [...map.keys()]),
    multiGet: vi.fn(async (keys: string[]) =>
      keys.map((k) => [k, map.get(k) ?? null] as [string, string | null]),
    ),
  };
}

describe("the browser NetworkState is wrong on React Native", () => {
  // This is the reason `net` must be injected everywhere chat-core accepts it.
  // Both `ManagerContext.net` and `ChatActionContext.net` are optional and fall
  // back to `browserNetworkState`, so a missed injection does not throw — it
  // silently reports the device as permanently online and every offline gate
  // stops queueing. Pinning it here means deleting the injection fails a test
  // instead of shipping.
  it("reports online in an RN-shaped global where navigator has no onLine", () => {
    const original = globalThis.navigator;
    // RN defines `navigator` but never sets `onLine`.
    Object.defineProperty(globalThis, "navigator", {
      value: { product: "ReactNative" },
      configurable: true,
      writable: true,
    });

    try {
      // `undefined === false` is false, so the browser adapter claims online.
      expect(browserNetworkState.isOffline()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe("createExpoNetworkState", () => {
  it("treats a definite negative on either field as offline", () => {
    expect(isOfflineFromExpoState({ isConnected: false })).toBe(true);
    expect(
      isOfflineFromExpoState({ isConnected: true, isInternetReachable: false }),
    ).toBe(true);
  });

  it("treats unknown as online, per the port contract", () => {
    expect(isOfflineFromExpoState({})).toBe(false);
    expect(isOfflineFromExpoState({ isConnected: true })).toBe(false);
  });

  it("primes from the platform and reports it synchronously", async () => {
    const net = createExpoNetworkState({
      getState: vi.fn().mockResolvedValue({ isConnected: false }),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    });

    expect(net.isOffline()).toBe(false); // optimistic before priming
    await net.prime();
    expect(net.isOffline()).toBe(true);
  });

  it("stays online when priming throws", async () => {
    const net = createExpoNetworkState({
      getState: vi.fn().mockRejectedValue(new Error("no native module")),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    });

    await net.prime();
    // A false "offline" would strand sends in the outbox, so unknown is online.
    expect(net.isOffline()).toBe(false);
  });

  it("emits online=true on recovery and suppresses duplicate transitions", async () => {
    let emit: (s: { isConnected: boolean }) => void = () => {};
    const net = createExpoNetworkState({
      getState: vi.fn().mockResolvedValue({ isConnected: false }),
      addListener: vi.fn((cb: (s: { isConnected: boolean }) => void) => {
        emit = cb;
        return { remove: vi.fn() };
      }),
    });
    await net.prime();

    const seen: boolean[] = [];
    net.subscribe((online) => seen.push(online));

    emit({ isConnected: false }); // no change — must not fire
    emit({ isConnected: true });
    emit({ isConnected: true }); // still no change

    expect(seen).toEqual([true]);
    expect(net.isOffline()).toBe(false);
  });

  it("unsubscribes through the returned disposer", () => {
    const remove = vi.fn();
    const net = createExpoNetworkState({
      getState: vi.fn().mockResolvedValue({}),
      addListener: vi.fn(() => ({ remove })),
    });

    net.subscribe(() => {})();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("createAsyncStorageKeyValueStore", () => {
  it("reads nothing before hydration and the cursor after it", async () => {
    const storage = fakeStorage({ "chat:lastSeen:c1": "m-42" });
    const kv = createAsyncStorageKeyValueStore(storage);

    expect(kv.get("chat:lastSeen:c1")).toBeNull();
    await kv.hydrate();
    expect(kv.get("chat:lastSeen:c1")).toBe("m-42");
  });

  it("only hydrates chat-prefixed keys", async () => {
    const storage = fakeStorage({
      "chat:lastSeen:c1": "m-1",
      "auth:token": "secret",
    });
    const kv = createAsyncStorageKeyValueStore(storage);
    await kv.hydrate();

    expect(kv.get("chat:lastSeen:c1")).toBe("m-1");
    expect(kv.get("auth:token")).toBeNull();
  });

  it("serves a write synchronously and persists it behind the read", async () => {
    const storage = fakeStorage();
    const kv = createAsyncStorageKeyValueStore(storage);

    kv.set("chat:lastSeen:c1", "m-7");
    expect(kv.get("chat:lastSeen:c1")).toBe("m-7"); // no await
    await vi.waitFor(() =>
      expect(storage.setItem).toHaveBeenCalledWith("chat:lastSeen:c1", "m-7"),
    );
  });

  it("does not let a slow hydration clobber a newer local write", async () => {
    const storage = fakeStorage({ "chat:lastSeen:c1": "stale" });
    const kv = createAsyncStorageKeyValueStore(storage);

    // Write lands while the disk read is still in flight.
    const hydrating = kv.hydrate();
    kv.set("chat:lastSeen:c1", "fresh");
    await hydrating;

    expect(kv.get("chat:lastSeen:c1")).toBe("fresh");
  });

  it("removes synchronously and degrades when the disk write fails", async () => {
    const storage = fakeStorage({ "chat:lastSeen:c1": "m-1" });
    storage.removeItem = vi.fn().mockRejectedValue(new Error("disk full"));
    const kv = createAsyncStorageKeyValueStore(storage);
    await kv.hydrate();

    expect(() => kv.remove("chat:lastSeen:c1")).not.toThrow();
    expect(kv.get("chat:lastSeen:c1")).toBeNull();
  });

  it("degrades to empty when hydration throws", async () => {
    const storage = fakeStorage();
    storage.getAllKeys = vi.fn().mockRejectedValue(new Error("unavailable"));
    const kv = createAsyncStorageKeyValueStore(storage);

    await expect(kv.hydrate()).resolves.toBeUndefined();
    expect(kv.get("chat:lastSeen:c1")).toBeNull();
  });
});

describe("createAsyncStorageOutboxStore", () => {
  let clock = 0;
  const now = () => ++clock;

  beforeEach(() => {
    clock = 0;
  });

  it("enqueues with bookkeeping defaults and lists it as queued", async () => {
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    const row = await store.enqueue({
      clientId: "a",
      channelId: "c1",
      body: "hi",
    });

    expect(row).toMatchObject({ attempts: 0, status: "queued", body: "hi" });
    expect(await store.listQueued()).toHaveLength(1);
  });

  it("defaults bookkeeping fields even when passed explicitly undefined", async () => {
    // `NewOutboxRow` makes attempts/status/queuedAt optional, so a caller
    // spreading an intent object can hand us the keys with undefined values. If
    // those overwrote the defaults, `bumpAttempt` would produce NaN.
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    await store.enqueue({
      clientId: "a",
      channelId: "c1",
      body: "hi",
      attempts: undefined,
      status: undefined,
      queuedAt: undefined,
    });
    await store.bumpAttempt("a", "boom");

    const [row] = await store.listQueued();
    expect(row).toMatchObject({ attempts: 1, status: "queued" });
    expect(row?.queuedAt).toBeTypeOf("number");
  });

  it("replaces rather than duplicates on a repeated client id", async () => {
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    await store.enqueue({ clientId: "a", channelId: "c1", body: "first" });
    await store.enqueue({ clientId: "a", channelId: "c1", body: "second" });

    const queued = await store.listQueued();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.body).toBe("second");
  });

  it("lists queued rows FIFO and omits failed ones", async () => {
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    await store.enqueue({ clientId: "a", channelId: "c1", body: "1" });
    await store.enqueue({ clientId: "b", channelId: "c1", body: "2" });
    await store.enqueue({ clientId: "c", channelId: "c1", body: "3" });
    await store.markFailed("b", "boom");

    expect((await store.listQueued()).map((r) => r.clientId)).toEqual([
      "a",
      "c",
    ]);
  });

  it("requeues a failed row and clears its error", async () => {
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    await store.enqueue({ clientId: "a", channelId: "c1", body: "1" });
    await store.markFailed("a", "boom");
    await store.requeue("a");

    const [row] = await store.listQueued();
    expect(row?.status).toBe("queued");
    // `JSON.stringify` drops undefined-valued keys, so the cleared error comes
    // back absent rather than explicitly undefined. Assert the observable
    // contract — nothing reads a `lastError` after a requeue — rather than the
    // serialized shape.
    expect(row?.lastError).toBeUndefined();
  });

  it("bumps attempts cumulatively", async () => {
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    await store.enqueue({ clientId: "a", channelId: "c1", body: "1" });
    await store.bumpAttempt("a", "e1");
    await store.bumpAttempt("a", "e2");

    const [row] = await store.listQueued();
    expect(row).toMatchObject({ attempts: 2, lastError: "e2" });
  });

  it("dequeues by client id", async () => {
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    await store.enqueue({ clientId: "a", channelId: "c1", body: "1" });
    await store.dequeue("a");

    expect(await store.listQueued()).toHaveLength(0);
  });

  it("scopes listForChannel and includes failed rows", async () => {
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    await store.enqueue({ clientId: "a", channelId: "c1", body: "1" });
    await store.enqueue({ clientId: "b", channelId: "c2", body: "2" });
    await store.markFailed("a", "boom");

    const rows = await store.listForChannel("c1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientId: "a", status: "failed" });
  });

  it("does not lose an update when two mutations overlap", async () => {
    // AsyncStorage has no compare-and-swap, so unserialized read-modify-write
    // cycles drop one of two concurrent enqueues. The flush loop and a user
    // send genuinely race here.
    const store = createAsyncStorageOutboxStore(fakeStorage(), now);
    await Promise.all([
      store.enqueue({ clientId: "a", channelId: "c1", body: "1" }),
      store.enqueue({ clientId: "b", channelId: "c1", body: "2" }),
      store.enqueue({ clientId: "c", channelId: "c1", body: "3" }),
    ]);

    expect(await store.listQueued()).toHaveLength(3);
  });

  it("treats a corrupt payload as empty instead of wedging sends", async () => {
    const store = createAsyncStorageOutboxStore(
      fakeStorage({ [OUTBOX_KEY]: "{not json" }),
      now,
    );

    expect(await store.listQueued()).toEqual([]);
    await expect(
      store.enqueue({ clientId: "a", channelId: "c1", body: "1" }),
    ).resolves.toMatchObject({ clientId: "a" });
  });

  it("clears a draft without failing the send that triggered it", async () => {
    const storage = fakeStorage();
    storage.removeItem = vi.fn().mockRejectedValue(new Error("disk full"));
    const store = createAsyncStorageOutboxStore(storage, now);

    await expect(store.clearDraft("c1")).resolves.toBeUndefined();
  });
});
