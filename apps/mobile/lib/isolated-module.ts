/**
 * One home for the Expo Go isolation-module loader.
 *
 * [`spec/ui/mobile/README.md` § Run paths: Expo Go vs EAS](../../../spec/ui/mobile/README.md#run-paths-expo-go-vs-eas)
 * requires a package that does not run in Go to sit behind a runtime check with
 * a graceful fallback, so importing a screen never crashes Go. Four modules
 * implement that rule — `lib/keyboard.tsx`, `lib/apple-auth.ts`,
 * `lib/notifications/push.ts`, `lib/payments/stripe.ts` — and until this file
 * existed each carried its own copy of the machinery.
 *
 * What was identical across all four, and is now only here: the tri-state
 * cache, the loader indirection with its `set…LoaderForTests` seam, and the
 * `try`/`catch` that warns once and caches `null`. What differs per module, and
 * therefore stays at the call site: the **guard** (Go, `Platform`, or both) and
 * the second half of the warning sentence. Four copies of one rule is how the
 * rule drifts — four guards had already become three distinct shapes while the
 * machinery underneath stayed the same, and the two that had *not* diverged
 * (push and stripe) are single-homed as `isWebOrExpoGo` rather than left as a
 * pair waiting to.
 *
 * What does **not** live here is the platform split (`*-module.ts` /
 * `*-module.native.ts`) that three of the four use — `lib/keyboard.tsx` is the
 * documented exception, because its package touches no native module at import.
 * That split is a Metro *resolution* mechanism: the file name is the mechanism,
 * so it cannot be factored into a function. This factory does not disturb it,
 * or the ESLint rules that keep a raw specifier out of screen code, because
 * `load` is supplied by the caller and nothing here names a package.
 *
 * **This module imports nothing, deliberately.** The Expo Go predicate lives in
 * `lib/expo-go.ts` instead. Importing `expo-constants` here pulled it into the
 * graph of *every* isolation module, including `apple-auth.ts`, whose guard is
 * `Platform.OS` and which had never needed it — and `expo-constants` reads
 * `react-native`'s `NativeModules` at import, which the suite-wide
 * `react-native` mock in `vitest.setup.ts` does not provide. That is not a
 * hypothetical: it turned `apple-auth.spec.ts` red with `No "NativeModules"
 * export is defined on the "react-native" mock` before the split. A shared
 * helper must not hand its callers a dependency only some of them wanted.
 */

export interface IsolatedModule<T> {
  /**
   * The module, or `null` where it is unavailable. Loaded at most once — a
   * `null` result is cached too, so a missing package is not re-required on
   * every call.
   */
  load: () => T | null;
  /**
   * Test-only seam: specs inject a loader rather than reach the real package.
   * `null` restores the default one. Either way the cached attempt is dropped,
   * so the next `load()` starts over.
   *
   * The seam is not one workaround but two, and which one applies depends on
   * the module. For the three behind a platform split, vitest resolves
   * `./x-module` to the **web half** — a `return null` stub — so the default
   * loader can never produce the module under test. For `lib/keyboard.tsx`,
   * which has no split, the default loader runs a real CJS `require` that
   * `vi.mock` does not intercept. Both end at the same place: a spec that wants
   * a module here has to hand one over.
   */
  setLoaderForTests: (next: (() => T | null) | null) => void;
}

export function createIsolatedModule<T>(options: {
  /** The npm package name, used verbatim in the warning when a load throws. */
  packageName: string;
  /**
   * What the app does without it, completing the sentence
   * `"<packageName> failed to load; <whenUnavailable>"`. Ends with a period.
   */
  whenUnavailable: string;
  /**
   * The platform-split require — `requireStripe`, `requireNotifications`, … —
   * or any loader that returns the module.
   */
  load: () => T | null;
  /**
   * Known-unavailable *before* trying to load. Returning `true` means the
   * loader is never invoked, which for Expo Go is the crash-prevention
   * property itself and not merely a reported unavailability.
   */
  isUnavailable?: () => boolean;
}): IsolatedModule<T> {
  const {
    packageName,
    whenUnavailable,
    load: defaultLoader,
    isUnavailable,
  } = options;

  /** `undefined` = not yet attempted; `null` = attempted and unavailable. */
  let cachedModule: T | null | undefined;
  let loader = defaultLoader;

  return {
    load(): T | null {
      if (cachedModule !== undefined) return cachedModule;

      if (isUnavailable?.()) {
        cachedModule = null;
        return cachedModule;
      }

      try {
        // `?? null` is load-bearing, not defensive noise: `undefined` is this
        // cache's "not yet attempted" sentinel, so storing a loader's
        // `undefined` would re-invoke it on every call *and* hand callers an
        // `undefined` that fails their `=== null` availability test — an
        // enabled Pay button with no native module behind it. A `vi.fn()` with
        // no implementation is exactly that loader, and it type-checks.
        cachedModule = loader() ?? null;
      } catch (error) {
        // Outside Expo Go the module is expected to exist, so a load failure is
        // a real linking problem (a dev client built before this package
        // landed), not the Go fallback wearing its clothes.
        console.warn(
          `${packageName} failed to load; ${whenUnavailable}`,
          error,
        );
        cachedModule = null;
      }

      return cachedModule;
    },

    setLoaderForTests(next: (() => T | null) | null) {
      loader = next ?? defaultLoader;
      cachedModule = undefined;
    },
  };
}
