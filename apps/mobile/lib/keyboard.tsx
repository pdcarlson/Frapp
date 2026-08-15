import type { ReactNode } from "react";
import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * Isolation module for `react-native-keyboard-controller`
 * (spec/ui/mobile/patterns.md, #937 Expo Go rules).
 *
 * The package registers a native module at import time, and Expo Go does not
 * ship it — an unguarded import crashes Go at launch. Nothing outside this
 * file may import the package (ESLint `no-restricted-imports` enforces it);
 * everything else goes through `KeyboardProviderGuarded` / `getKeyboardPath`,
 * and screens choose `KeyboardAvoidingView` when the path is "fallback".
 */
type KeyboardControllerModule = typeof import("react-native-keyboard-controller");

/** `undefined` = not yet attempted; `null` = attempted and unavailable. */
let cachedModule: KeyboardControllerModule | null | undefined;

const defaultLoader = (): KeyboardControllerModule =>
  // Lazy require: Metro bundles the factory but does not execute it until
  // this line runs, which the StoreClient guard below prevents in Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-keyboard-controller") as KeyboardControllerModule;

let loader = defaultLoader;

/**
 * Test-only seam: vitest's runtime executes the real CJS `require`, which
 * cannot be intercepted by `vi.mock`, so the spec injects a loader instead.
 */
export function setKeyboardControllerLoaderForTests(
  next: (() => KeyboardControllerModule) | null,
) {
  loader = next ?? defaultLoader;
  cachedModule = undefined;
}

function loadKeyboardController(): KeyboardControllerModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  // Read inside the function, not at module scope, so tests can mock
  // expo-constants without import-order sensitivity.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    cachedModule = null;
    return cachedModule;
  }

  try {
    cachedModule = loader();
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

/** Which keyboard path is live: the native controller, or the RN fallback. */
export function getKeyboardPath(): "native" | "fallback" {
  return loadKeyboardController() ? "native" : "fallback";
}

/**
 * Renders the real `KeyboardProvider` where the native module exists, and a
 * pass-through everywhere else (Expo Go, web, tests).
 */
export function KeyboardProviderGuarded({ children }: { children: ReactNode }) {
  const keyboardController = loadKeyboardController();

  if (!keyboardController) {
    return <>{children}</>;
  }

  const { KeyboardProvider } = keyboardController;
  return <KeyboardProvider>{children}</KeyboardProvider>;
}
