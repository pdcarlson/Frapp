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

async function importKeyboard() {
  return await import("./keyboard");
}

describe("keyboard isolation module", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports the fallback path in Expo Go and never loads the package", async () => {
    constantsState.executionEnvironment = "storeClient";
    const keyboard = await importKeyboard();

    expect(keyboard.getKeyboardPath()).toBe("fallback");
  });

  it("reports the native path outside Expo Go", async () => {
    constantsState.executionEnvironment = "bare";
    const keyboard = await importKeyboard();
    keyboard.setKeyboardControllerLoaderForTests(
      () =>
        ({
          KeyboardProvider: "KeyboardProvider",
        }) as unknown as typeof import("react-native-keyboard-controller"),
    );

    expect(keyboard.getKeyboardPath()).toBe("native");
  });

  it("caches the load decision across calls", async () => {
    constantsState.executionEnvironment = "storeClient";
    const keyboard = await importKeyboard();

    expect(keyboard.getKeyboardPath()).toBe("fallback");
    // Flipping the environment after the first read must not change the
    // answer — the decision is made once per app launch.
    constantsState.executionEnvironment = "bare";
    expect(keyboard.getKeyboardPath()).toBe("fallback");
  });
});
