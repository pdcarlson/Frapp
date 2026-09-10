import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("./secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

const {
  clearAuthToken,
  readAuthToken,
  writeAuthToken,
} = await import("./auth-token");

describe("auth-token memory vs SecureStore", () => {
  beforeEach(async () => {
    store.clear();
    await clearAuthToken();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the in-process token before SecureStore finishes", async () => {
    const SecureStore = await import("./secure-store");
    let release: () => void = () => {};
    vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve();
        }),
    );

    const write = writeAuthToken("access-token-b");
    await expect(readAuthToken()).resolves.toBe("access-token-b");
    release();
    await write;
  });

  it("does not send the previous token after clear, even if delete fails", async () => {
    await writeAuthToken("access-token-a");
    const SecureStore = await import("./secure-store");
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(
      new Error("keystore down"),
    );
    await clearAuthToken();
    await expect(readAuthToken()).resolves.toBeNull();
  });
});
