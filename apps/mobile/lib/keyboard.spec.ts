import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The module caches its load attempt, so each test re-imports a fresh copy.
const constantsState = vi.hoisted(() => ({
  executionEnvironment: "storeClient",
}));

vi.mock("expo-constants", () => ({
  default: {
    get executionEnvironment() {
      return constantsState.executionEnvironment;
    },
  },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

type KeyboardControllerModule =
  typeof import("react-native-keyboard-controller");

const FAKE_MODULE = {
  KeyboardProvider: "KeyboardProvider",
} as unknown as KeyboardControllerModule;

async function importKeyboard() {
  return await import("./keyboard");
}

describe("keyboard isolation module", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports the fallback path in Expo Go and never invokes the loader", async () => {
    constantsState.executionEnvironment = "storeClient";
    const keyboard = await importKeyboard();
    const loader = vi.fn(() => FAKE_MODULE);
    keyboard.setKeyboardControllerLoaderForTests(loader);

    expect(keyboard.getKeyboardPath()).toBe("fallback");
    // The crash-prevention property itself: in Expo Go the package must never
    // be loaded, not merely reported as unavailable.
    expect(loader).not.toHaveBeenCalled();
  });

  it("reports the native path outside Expo Go", async () => {
    constantsState.executionEnvironment = "bare";
    const keyboard = await importKeyboard();
    keyboard.setKeyboardControllerLoaderForTests(() => FAKE_MODULE);

    expect(keyboard.getKeyboardPath()).toBe("native");
  });

  it("caches the fallback decision across calls", async () => {
    constantsState.executionEnvironment = "storeClient";
    const keyboard = await importKeyboard();
    const loader = vi.fn(() => FAKE_MODULE);
    keyboard.setKeyboardControllerLoaderForTests(loader);

    expect(keyboard.getKeyboardPath()).toBe("fallback");
    // Flipping the environment after the first read must not change the
    // answer — the decision is made once per app launch.
    constantsState.executionEnvironment = "bare";
    expect(keyboard.getKeyboardPath()).toBe("fallback");
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads the native module exactly once across calls", async () => {
    constantsState.executionEnvironment = "bare";
    const keyboard = await importKeyboard();
    const loader = vi.fn(() => FAKE_MODULE);
    keyboard.setKeyboardControllerLoaderForTests(loader);

    expect(keyboard.getKeyboardPath()).toBe("native");
    expect(keyboard.getKeyboardPath()).toBe("native");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keyboard.tsx never imports the package statically", () => {
    // The suite-wide vi.mock of react-native-keyboard-controller would make a
    // static ESM import invisible to every test while crashing Expo Go at
    // launch (lint exempts lib/keyboard.tsx by design), so pin the source
    // shape itself: only the lazy require inside the loader is allowed.
    // fileURLToPath, not URL.pathname — pathname keeps percent-encoding, so a
    // checkout under a path with a space would ENOENT here.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "keyboard.tsx"),
      "utf8",
    );

    // `export ... from` is a static import to Metro too, and subpath
    // specifiers load the package just the same — ban all of them.
    expect(source).not.toMatch(
      /^(import|export)[^;]*["']react-native-keyboard-controller(\/[^"']*)?["']/m,
    );
    expect(source).toMatch(/require\("react-native-keyboard-controller"\)/);
  });
});
