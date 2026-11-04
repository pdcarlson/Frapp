import type { ReactNode } from "react";
import {
  KeyboardAvoidingView as NativeKeyboardAvoidingView,
  Platform,
  View,
  type ViewProps,
} from "react-native";
import { isExpoGo } from "./expo-go";
import { createIsolatedModule } from "./isolated-module";

/**
 * Isolation module for `react-native-keyboard-controller`
 * (`spec/ui/mobile/README.md` § Run paths: Expo Go vs EAS, #937 Expo Go rules).
 *
 * The package registers a native module at import time, and Expo Go does not
 * ship it — an unguarded import crashes Go at launch. Nothing outside this
 * file may import the package (ESLint `no-restricted-imports` enforces it);
 * everything else goes through `KeyboardProviderGuarded` and
 * `KeyboardAvoidingArea`. (`getKeyboardPath`, which let a screen pick its own
 * avoiding behaviour, went with #3346: that per-screen choice is what switched
 * the chat thread's avoidance off on Android.)
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

/**
 * The keyboard-avoiding wrapper for a screen whose text field sits low enough
 * for the keyboard to cover it (#3346).
 *
 * **Android, store builds.** `KeyboardProviderGuarded` mounts the library's
 * `KeyboardProvider` app-wide, and while it is active the library stops the
 * window from resizing for the keyboard (its `EdgeToEdgeReactViewGroup` only
 * pads for the IME when the provider is *not* active). The screens used to
 * assume "on Android the window already resizes" and switched React Native's
 * `KeyboardAvoidingView` off there, so on the first Play build the keyboard
 * covered the chat composer. The library's own `KeyboardAvoidingView` is the
 * one that tracks the keyboard under its provider, so Android uses it, with
 * `padding`.
 *
 * **iOS, and the fallback path** (Expo Go, web, tests). Unchanged: React
 * Native's view, `padding` on iOS and no behaviour elsewhere, which is what
 * each screen passed before this wrapper existed.
 *
 * **`iosInsetFromScrollView`.** A screen whose `ScrollView` sets
 * `automaticallyAdjustKeyboardInsets` already gets the keyboard inset, and
 * the focused field scrolled into view, on iOS; a padding view around it would
 * count the keyboard twice. With this set the area is a plain `View` on iOS
 * and still avoids on Android, where that prop does nothing (sign-in).
 */
export function KeyboardAvoidingArea({
  children,
  iosInsetFromScrollView = false,
  ...viewProps
}: ViewProps & { children: ReactNode; iosInsetFromScrollView?: boolean }) {
  if (Platform.OS === "ios" && iosInsetFromScrollView) {
    return <View {...viewProps}>{children}</View>;
  }

  const keyboardController =
    Platform.OS === "android" ? loadKeyboardController() : null;

  if (keyboardController) {
    const { KeyboardAvoidingView } = keyboardController;
    return (
      // `automaticOffset` measures the view's position in the window natively,
      // so the overlap is right wherever the screen nests it (under a safe-area
      // inset, above the tab bar) without a hand-kept `keyboardVerticalOffset`.
      <KeyboardAvoidingView {...viewProps} behavior="padding" automaticOffset>
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <NativeKeyboardAvoidingView
      {...viewProps}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {children}
    </NativeKeyboardAvoidingView>
  );
}
