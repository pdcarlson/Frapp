import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteItemAsync,
  getItemAsync,
  setItemAsync,
  WEB_SECURE_STORE_ENV_KEY,
} from "./secure-store.web";

/**
 * These tests are about the *closed* direction, like `lib/ask/flag.spec.ts`:
 * what fails to open web persistence. `localStorage` is not secure storage, and
 * the only reason this module may use it is that the flag confines it to a
 * local demo capture. A loose parse here would put a real member's session
 * somewhere any script on the origin can read.
 *
 * Modelled on `flag.spec.ts` — mutate `process.env` around the helper, restore
 * in `afterEach`. The `window` stub is torn down the same way; vitest runs this
 * suite in the `node` environment, so there is no ambient `window` to clobber.
 */

const KEY = WEB_SECURE_STORE_ENV_KEY;

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => "from-native-module"),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

/** A minimal in-memory `Storage`, which is all this module touches. */
function stubLocalStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    clear: () => map.clear(),
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return map;
}

beforeEach(() => {
  delete process.env[KEY];
  delete (globalThis as { window?: unknown }).window;
});

afterEach(() => {
  delete process.env[KEY];
  delete (globalThis as { window?: unknown }).window;
  vi.clearAllMocks();
});

describe("with the flag unset — every shipped build", () => {
  it("delegates to expo-secure-store rather than touching localStorage", async () => {
    const map = stubLocalStorage();

    await expect(getItemAsync("k")).resolves.toBe("from-native-module");
    await setItemAsync("k", "v");
    await deleteItemAsync("k");

    // The stub is present and still untouched: the gate, not the absence of a
    // store, is what kept the value out of it.
    expect(map.size).toBe(0);

    const SecureStore = await import("expo-secure-store");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("k", "v");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("k");
  });

  it("opens for the exact string \"1\" and nothing else", async () => {
    stubLocalStorage();

    for (const off of ["", " ", "0", "true", "TRUE", "yes", "01", " 1 "]) {
      process.env[KEY] = off;
      await expect(getItemAsync("k")).resolves.toBe("from-native-module");
    }

    process.env[KEY] = "1";
    await expect(getItemAsync("k")).resolves.toBeNull();
  });
});

describe("with the flag on", () => {
  beforeEach(() => {
    process.env[KEY] = "1";
  });

  it("round-trips a value and reads absence as null", async () => {
    stubLocalStorage();

    await expect(getItemAsync("token")).resolves.toBeNull();
    await setItemAsync("token", "abc123");
    await expect(getItemAsync("token")).resolves.toBe("abc123");
    await deleteItemAsync("token");
    await expect(getItemAsync("token")).resolves.toBeNull();
  });

  it("namespaces its keys so a capture cannot collide with the origin", async () => {
    const map = stubLocalStorage();

    await setItemAsync("sb-127-auth-token", "session");

    expect([...map.keys()]).toEqual([
      "frapp.mobile.secure-store:sb-127-auth-token",
    ]);
  });

  it("falls back to the native module when there is no window at all", async () => {
    // Expo prerenders these routes in Node (`output: "static"` in app.json),
    // where `window` is undefined. That has to read as "no store" rather than
    // throwing a ReferenceError out of module scope.
    await expect(getItemAsync("k")).resolves.toBe("from-native-module");
  });

  it("falls back when the localStorage getter itself throws", async () => {
    // A browser with site data blocked throws on the *property access*, not on
    // the read, so the guard has to sit around the getter.
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get() {
        throw new Error("site data blocked");
      },
    });

    await expect(getItemAsync("k")).resolves.toBe("from-native-module");

    delete (globalThis as { window?: unknown }).window;
  });
});
