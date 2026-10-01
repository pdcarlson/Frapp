import { createRequire } from "node:module";
import type { enableSyncToNative } from "@sentry/react-native/dist/js/scopeSync";

/**
 * What a spec needs to drive `@sentry/react-native`'s breadcrumb path down to
 * the native module under vitest: `lib/sentry/touch-breadcrumbs.spec.ts`
 * (#2982) and `lib/sentry/recorded-breadcrumbs.spec.ts` (#3104).
 *
 * `vi.mock` is hoisted per spec file, so each spec still calls it for the two
 * SDK modules below, with a factory that loads this module:
 *
 * ```ts
 * vi.mock("@sentry/react-native/dist/js/utils/rnlibraries", async () =>
 *   (await import("@/test/sentry-native-sync")).rnLibrariesModule(),
 * );
 * vi.mock("@sentry/react-native/dist/js/wrapper", async () =>
 *   (await import("@/test/sentry-native-sync")).nativeWrapperModule(),
 * );
 * ```
 *
 * Nothing here imports the SDK at runtime. A factory that loaded a module
 * importing `scopeSync` would import the `wrapper` it is in the middle of
 * mocking.
 */

type SdkScope = Parameters<typeof enableSyncToNative>[0];

/**
 * `@sentry/core` as `@sentry/react-native` resolves it, not as this workspace
 * would. Core keeps its client and scopes on a global keyed by its own
 * version, so a spec has to drive the version the SDK records through, or the
 * client it sets is one the SDK never sees. Resolving through the SDK keeps
 * the two equal whatever either is bumped to, and leaves this workspace no
 * `@sentry/core` dependency for Dependabot to move on its own.
 */
export const sdkCore = createRequire(
  createRequire(import.meta.url).resolve("@sentry/react-native/package.json"),
)("@sentry/core") as {
  getIsolationScope(): SdkScope;
  setCurrentClient(client: unknown): void;
};

/** Every breadcrumb the native module was sent, as it was sent. */
export const nativeRecorder = { breadcrumbs: [] as unknown[] };

/** The SDK's native module, replaced by a recorder. */
export function nativeWrapperModule() {
  return {
    NATIVE: {
      addBreadcrumb: (breadcrumb: unknown) => {
        nativeRecorder.breadcrumbs.push(structuredClone(breadcrumb));
      },
    },
  };
}

/**
 * `utils/rnlibraries` deep-imports React Native internals that vitest's
 * `react-native-web` alias cannot load. Nothing on the breadcrumb path calls
 * it.
 */
export function rnLibrariesModule() {
  return { ReactNativeLibraries: {} };
}

/**
 * The isolation scope, emptied and synced to native the way `Sentry.init`
 * (`sdk.js`) syncs it, with the recorder emptied too. The SDK's index pulls
 * in native views and the feedback widget, which vitest cannot load, so a
 * spec makes this call itself; re-check `sdk.js` when bumping
 * `@sentry/react-native`. The spec passes the SDK's `enableSyncToNative`,
 * which this module must not import (see above).
 */
export function syncedIsolationScope(
  enable: typeof enableSyncToNative,
): SdkScope {
  nativeRecorder.breadcrumbs = [];
  // The SDK patches this scope once; `clear()` empties it without going
  // through the patched `clearBreadcrumbs`, so native is not asked to.
  const scope = sdkCore.getIsolationScope();
  scope.clear();
  enable(scope);
  return scope;
}
