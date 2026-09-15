import type { ReactNode } from "react";
import { isExpoGo } from "./expo-go";
import { createIsolatedModule } from "./isolated-module";

/**
 * Isolation module for `react-native-keyboard-controller`
 * (`spec/ui/mobile/README.md` § Run paths: Expo Go vs EAS, #937 Expo Go rules).
 *
 * The package registers a native module at import time, and Expo Go does not
 * ship it — an unguarded import crashes Go at launch. Nothing outside this
 * file may import the package (ESLint `no-restricted-imports` enforces it);
 * everything else goes through `KeyboardProviderGuarded` / `getKeyboardPath`,
 * and screens choose `KeyboardAvoidingView` when the path is "fallback".
 */
type KeyboardControllerModule =
  typeof import("react-native-keyboard-controller");

// Keep this handle unexported. `keyboard.spec.ts`'s source-shape guard
// bans a static import with the semicolon-bounded regex
// /^(import|export)[^;]*["']react-native-keyboard-controller(\/[^"']*)?["']/m,
// and `[^;]` spans newlines —
// so an `export` keyword here would reach the `packageName` string below and
// read as an import that does not exist. The cure a maintainer would reach for
// is loosening that regex, which is the guard that stops a real static import
// from crashing Expo Go at launch behind the suite-wide `vi.mock`.
const keyboardControllerModule = createIsolatedModule<KeyboardControllerModule>(
  {
    packageName: "react-native-keyboard-controller",
    whenUnavailable: "using the fallback keyboard path.",
    load: () =>
      // Lazy require: Metro bundles the factory but does not execute it until
      // this line runs, which the Expo Go guard below prevents in Go.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react-native-keyboard-controller") as KeyboardControllerModule,
    isUnavailable: isExpoGo,
  },
);

/**
 * Test-only seam: vitest's runtime executes the real CJS `require`, which
 * cannot be intercepted by `vi.mock`, so the spec injects a loader instead.
 *
 * Typed narrower than the factory's own seam on purpose. This is the one
 * isolation module with no platform split, so its real loader either yields the
 * module or throws — it cannot return `null`. Accepting a null-returning loader
 * would let a spec assert the fallback path through a state production cannot
 * reach, and never exercise the `try`/`catch` that must warn on a genuine link
 * failure.
 */
export const setKeyboardControllerLoaderForTests: (
  next: (() => KeyboardControllerModule) | null,
) => void = keyboardControllerModule.setLoaderForTests;

const loadKeyboardController = keyboardControllerModule.load;

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
