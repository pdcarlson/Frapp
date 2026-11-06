import React from "react";
import { vi } from "vitest";

// Mock global variables for Expo
globalThis.expo = globalThis.expo || {};
// @ts-expect-error mocking
globalThis.ExpoModulesCore_ExpoGlobal = {
  EventEmitter: class {},
};
// @ts-expect-error mocking
globalThis.ExpoModulesCore_NativeModulesProxy = {};

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  documentDirectory: "file:///document/",
  writeAsStringAsync: vi.fn().mockResolvedValue(undefined),
  // Chat photo upload PUTs raw bytes from a file URI rather than a DOM File
  // (`lib/chat/attachment-upload.ts`); a spec that exercises it overrides
  // these per test.
  getInfoAsync: vi.fn().mockResolvedValue({ exists: true, size: 1024 }),
  uploadAsync: vi.fn().mockResolvedValue({ status: 200, body: "" }),
  // Saving or sharing a chat image downloads it into the cache first
  // (`lib/chat/share-attachment.ts`).
  makeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
  downloadAsync: vi.fn(async (_url: string, fileUri: string) => ({
    uri: fileUri,
    status: 200,
    headers: {},
    mimeType: null,
  })),
  FileSystemUploadType: {
    BINARY_CONTENT: 0,
    MULTIPART: 1,
  },
  EncodingType: {
    UTF8: "utf8",
  },
}));

// Default-denied on purpose: a spec that wants the happy path says so, and
// nothing accidentally exercises a granted-library path it did not set up.
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: vi
    .fn()
    .mockResolvedValue({ granted: false, canAskAgain: true }),
  launchImageLibraryAsync: vi.fn().mockResolvedValue({ canceled: true }),
}));

// The chat event card (#3185) imports `lib/location.ts`, so every spec that
// renders a chat thread loads it, and the native module can't. Default-denied
// on purpose, as the image picker above is: a spec that wants a fix mocks
// `lib/location` (or this module) with the path it means to exercise.
vi.mock("expo-location", () => ({
  getForegroundPermissionsAsync: vi
    .fn()
    .mockResolvedValue({ granted: false, canAskAgain: true }),
  requestForegroundPermissionsAsync: vi
    .fn()
    .mockResolvedValue({ granted: false, canAskAgain: true }),
  getCurrentPositionAsync: vi.fn(),
  Accuracy: { Balanced: 3, High: 4 },
}));

// Chapter setup marks the chapter going live with a tap (#3351), and a
// reaction ticks (`lib/haptics.ts`).
vi.mock("expo-haptics", () => ({
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: vi.fn(() => ({
      renderAsync: vi.fn().mockResolvedValue({
        saveAsync: vi.fn().mockResolvedValue({ uri: "file:///out.jpg" }),
      }),
    })),
  },
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn().mockResolvedValue(true),
  shareAsync: vi.fn().mockResolvedValue(undefined),
}));

// `test/react-native-stub.ts` holds the stand-ins, so a spec can extend them
// (its `RenderingFlatList` draws rows) rather than restate the whole module.
vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("./test/react-native-stub");
  return reactNativeStub;
});

// expo-router ships untranspiled source, so importing any screen or any
// component that navigates fails to parse under vitest. Mocked suite-wide for
// the same reason the native modules below are: a spec should be able to import
// a screen without pulling the router's real module graph in. `useRouter` hands
// back stable `vi.fn()`s so a spec can assert on navigation via
// `vi.mocked(useRouter)().push`.
//
// That `router` is one shared object for the whole file, and `clearMocks` is off
// globally (see vitest.config.ts for why), so **a spec asserting on navigation
// must clear it itself** — `beforeEach(() => vi.clearAllMocks())` — or calls
// accumulate across tests and `toHaveBeenCalledWith` passes from an earlier one.
// The same applies to any `useLocalSearchParams` return value a spec stubs in.
vi.mock("expo-router", () => {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    // Nothing behind the screen unless a spec says otherwise
    // (`mockReturnValue(true)`, as the chapter picker's does).
    canGoBack: vi.fn(() => false),
  };
  // Every mounted focus effect, re-runnable as one "the member came back"
  // event. A tab screen is never unmounted, so state that must not outlive a
  // visit (a subscription refusal, #2297) is cleared on refocus, and a spec
  // can only prove that by refocusing: `act(() => __refocus())`. `__blur` is
  // the half before it, for a screen that must go quiet while another screen
  // is pushed over it: `act(() => __blur())`, then `__refocus` brings it back.
  const refocusers = new Set<() => void>();
  const blurrers = new Set<() => void>();
  // What `useIsFocused` reads: true from the first render, as the real hook is
  // on a focused screen, false after `__blur` and true again after
  // `__refocus`. One flag for the whole file, so a spec that blurs refocuses
  // before its test ends.
  let focused = true;
  const focusListeners = new Set<() => void>();
  const setFocused = (next: boolean) => {
    focused = next;
    for (const listener of [...focusListeners]) listener();
  };
  const subscribeFocus = (listener: () => void) => {
    focusListeners.add(listener);
    return () => {
      focusListeners.delete(listener);
    };
  };
  return {
    useRouter: () => router,
    useIsFocused: () =>
      React.useSyncExternalStore(subscribeFocus, () => focused),
    // Runs the effect on mount and on every callback-identity change, which
    // is the focused-screen behavior. `__refocus` below is the rest of it: the
    // real hook runs the cleanup on blur and the effect again on focus.
    useFocusEffect: (callback: () => undefined | (() => void)) => {
      React.useEffect(() => {
        let cleanup = callback();
        const refocus = () => {
          cleanup?.();
          cleanup = callback();
        };
        const blur = () => {
          cleanup?.();
          cleanup = undefined;
        };
        refocusers.add(refocus);
        blurrers.add(blur);
        return () => {
          refocusers.delete(refocus);
          blurrers.delete(blur);
          cleanup?.();
        };
      }, [callback]);
    },
    __refocus: () => {
      setFocused(true);
      for (const refocus of [...refocusers]) refocus();
    },
    __blur: () => {
      setFocused(false);
      for (const blur of [...blurrers]) blur();
    },
    useLocalSearchParams: vi.fn(() => ({})),
    useGlobalSearchParams: vi.fn(() => ({})),
    usePathname: vi.fn(() => "/"),
    Link: "Link",
    Redirect: "Redirect",
    // A host string cannot carry `.Screen`, and `app/(tabs)/_layout.tsx`
    // registers every route with `<Tabs.Screen … />` (`lib/tab-layout.spec.tsx`
    // renders it). Both render as host nodes named for what they stand in for,
    // so a spec can find them and read `screenOptions` and `options`.
    Tabs: Object.assign(
      (props: Record<string, unknown>) => React.createElement("Tabs", props),
      {
        Screen: (props: Record<string, unknown>) =>
          React.createElement("Tabs.Screen", props),
      },
    ),
    Stack: "Stack",
  };
});

// Chat adapter dependencies (#937 C1). Both are mocked suite-wide because the
// adapters are imported transitively by the chat screens, and loading either
// real module pulls native code into the node env.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
    getAllKeys: vi.fn().mockResolvedValue([]),
    multiGet: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("expo-linking", () => ({
  useURL: vi.fn(() => null),
  createURL: vi.fn((path: string) => `frapp://${path}`),
  parse: vi.fn(),
  // The update gate (#2526) hands the store link to the OS rather than an
  // in-app browser, so the App Store or Play app opens on the listing.
  openURL: vi.fn().mockResolvedValue(true),
}));

// `lib/client-version.ts` reads the native build on every API client, so any
// spec that mounts the client reaches this. Null is what a build with no
// native version reports, which sends no X-Client-Version header; a spec that
// wants a version mocks its own (`lib/client-version.spec.ts`).
vi.mock("expo-application", () => ({
  applicationId: null,
  nativeApplicationVersion: null,
  nativeBuildVersion: null,
}));

vi.mock("expo-network", () => ({
  getNetworkStateAsync: vi
    .fn()
    .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: vi.fn(() => ({ remove: vi.fn() })),
}));

// New-in-S1 native modules: mocked suite-wide so importing any file that
// touches the provider stack never loads native code in the node/jsdom env.
vi.mock("react-native-gesture-handler", () => {
  // The chat image viewer's pinch, pan and double-tap (#2874). A gesture
  // needs a device, so a builder here records its kind and the callbacks it
  // was given, and `GestureDetector` is a host node carrying the composed
  // gesture, so a spec can find a callback and run it with a made-up event.
  const builder = (kind: string) => {
    const gesture: Record<string, unknown> & {
      handlers: Record<string, (...args: unknown[]) => void>;
    } = { kind, handlers: {} };
    for (const method of ["onStart", "onChange", "onUpdate", "onEnd"]) {
      gesture[method] = (handler: (...args: unknown[]) => void) => {
        gesture.handlers[method] = handler;
        return gesture;
      };
    }
    for (const method of ["averageTouches", "numberOfTaps"]) {
      gesture[method] = () => gesture;
    }
    return gesture;
  };
  return {
    GestureHandlerRootView: "GestureHandlerRootView",
    GestureDetector: (props: Record<string, unknown>) =>
      React.createElement("GestureDetector", props),
    Gesture: {
      Pinch: () => builder("pinch"),
      Pan: () => builder("pan"),
      Tap: () => builder("tap"),
      Race: (...gestures: unknown[]) => ({ kind: "race", gestures }),
      Simultaneous: (...gestures: unknown[]) => ({
        kind: "simultaneous",
        gestures,
      }),
    },
  };
});

// The chat image viewer and the skeleton blocks' pulse animate directly (the
// sheets' own use is behind the `@gorhom/bottom-sheet` mock). A shared value is
// a plain box read and written through `get`/`set`, the React Compiler-safe
// accessors both use. An animated style re-runs its updater on every read, the
// way the UI thread does, so a spec that runs a gesture callback can read the
// result. An animation resolves to its target at once, so a pulse reads as its
// low point; `useReducedMotion` is a mock a spec can flip.
vi.mock("react-native-reanimated", () => {
  // Entering animations are builders: each modifier returns a new builder
  // that keeps what it was given, so a spec can read which animation a view
  // was handed (`entering.animation`, "ZoomIn" or "FadeIn") and its
  // reduced-motion setting (`entering.reduceMotionMode`). One builder for
  // every entering animation the app uses, so a modifier a screen starts
  // calling is added once.
  const entering = (config: object): object => ({
    ...config,
    duration: (ms: number) => entering({ ...config, durationMs: ms }),
    reduceMotion: (mode: string) =>
      entering({ ...config, reduceMotionMode: mode }),
  });
  return {
    default: { Image: "Animated.Image", View: "Animated.View" },
    useSharedValue: <T>(initial: T) =>
      React.useRef(
        (() => {
          let value = initial;
          return {
            get: () => value,
            set: (next: T) => {
              value = next;
            },
          };
        })(),
      ).current,
    useAnimatedStyle: <T extends object>(updater: () => T) =>
      new Proxy({} as T, {
        get: (_target, key) => updater()[key as keyof T],
        ownKeys: () => Reflect.ownKeys(updater()),
        getOwnPropertyDescriptor: (_target, key) => ({
          configurable: true,
          enumerable: true,
          value: updater()[key as keyof T],
        }),
      }),
    withTiming: <T>(value: T) => value,
    withRepeat: vi.fn(<T>(value: T) => value),
    cancelAnimation: vi.fn(),
    useReducedMotion: vi.fn(() => false),
    Easing: {
      ease: (t: number) => t,
      inOut: (easing: (t: number) => number) => easing,
    },
    // Setup's live mark zooms in; join's views and setup's steps fade in.
    ZoomIn: entering({ animation: "ZoomIn" }),
    FadeIn: entering({ animation: "FadeIn" }),
    ReduceMotion: { System: "system", Always: "always", Never: "never" },
  };
});

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: "SafeAreaProvider",
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("@gorhom/bottom-sheet", () => ({
  BottomSheetModalProvider: "BottomSheetModalProvider",
  BottomSheetModal: "BottomSheetModal",
  BottomSheetView: "BottomSheetView",
  BottomSheetTextInput: "BottomSheetTextInput",
  BottomSheetScrollView: "BottomSheetScrollView",
  // The Ask sheet (s17, C7) is the first sheet in the app to draw the scrim the
  // reference has always shown, so this stand-in arrives with it.
  BottomSheetBackdrop: "BottomSheetBackdrop",
  // Like `FlatList` (`test/react-native-stub.ts`), a string stand-in that
  // renders its props but never invokes `renderItem` — a spec needing a row
  // should render that row's component directly.
  BottomSheetFlatList: "BottomSheetFlatList",
}));

vi.mock("expo-web-browser", () => ({
  openBrowserAsync: vi.fn().mockResolvedValue({ type: "dismiss" }),
}));

// expo-router's own copy of React Navigation, which app code reaches only as
// `expo-router/react-navigation`: Metro refuses an app import of
// `@react-navigation/*` since SDK 56. Its real module graph doesn't parse here,
// for the reason the `expo-router` mock above gives. Only the screen's
// navigation context is stood in. Unprovided it reads `undefined`, as it does
// in a sheet on a device, and a spec that needs a screen provides one.
vi.mock("expo-router/react-navigation", () => ({
  NavigationContext: React.createContext(undefined),
}));

vi.mock("expo-font", () => ({
  useFonts: vi.fn(() => [true, null]),
  loadAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@expo-google-fonts/figtree", () => ({
  useFonts: vi.fn(() => [true, null]),
  Figtree_400Regular: "Figtree_400Regular",
  Figtree_400Regular_Italic: "Figtree_400Regular_Italic",
  Figtree_600SemiBold: "Figtree_600SemiBold",
  Figtree_700Bold: "Figtree_700Bold",
  Figtree_700Bold_Italic: "Figtree_700Bold_Italic",
}));

vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: vi.fn().mockResolvedValue(true),
  hideAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock("react-native-keyboard-controller", () => ({
  KeyboardProvider: "KeyboardProvider",
}));

// `lib/keyboard.tsx` reads the execution environment through `lib/expo-go.ts`,
// so every screen inside `KeyboardAvoidingArea` (#3346) loads `expo-constants`,
// whose real module needs a native bridge. The suite runs as Expo Go, the path
// that never loads the keyboard library, so anything gated on `isExpoGo` takes
// its Expo Go path by default. A spec that tests a store-build path mocks
// `expo-constants` itself with another `executionEnvironment`.
vi.mock("expo-constants", () => ({
  default: { executionEnvironment: "storeClient" },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

// `expo-notifications` is reached only through `lib/notifications/push.ts`,
// whose loader seam (`setPushLoaderForTests`) is how specs inject a fake. This
// suite-wide mock exists for the *other* direction: a screen that imports the
// runtime hook must not drag the real package into the node env. Keeping it
// here mirrors `react-native-keyboard-controller` above — and note
// `lib/notifications/push.spec.ts` pins the source shape precisely because a
// mock like this one would otherwise hide a static import that crashes Expo Go.
vi.mock("expo-notifications", () => ({
  setNotificationChannelAsync: vi.fn().mockResolvedValue(null),
  getPermissionsAsync: vi.fn().mockResolvedValue({
    granted: false,
    canAskAgain: true,
    status: "undetermined",
  }),
  requestPermissionsAsync: vi.fn().mockResolvedValue({
    granted: true,
    canAskAgain: false,
    status: "granted",
  }),
  getExpoPushTokenAsync: vi.fn().mockResolvedValue({ type: "expo", data: "" }),
  getLastNotificationResponse: vi.fn(() => null),
  clearLastNotificationResponse: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  addPushTokenListener: vi.fn(() => ({ remove: vi.fn() })),
  scheduleNotificationAsync: vi.fn().mockResolvedValue("local-1"),
  cancelScheduledNotificationAsync: vi.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: vi.fn().mockResolvedValue(undefined),
  setNotificationHandler: vi.fn(),
  setBadgeCountAsync: vi.fn().mockResolvedValue(true),
}));

// `react-native-svg` ships untranspiled source, so importing any component that
// draws a glyph — the tab bar (#937 S2) or the task checkbox (C3) — fails to
// parse under vitest with `SyntaxError: Unexpected token 'typeof'`. Mocked
// suite-wide for the same reason `expo-router` is: a spec should be able to
// import a component without pulling a native module graph in.
//
// The stand-ins keep their props, so a spec can still assert on a glyph's
// resolved `stroke`/`fill` — which is the whole point of the token reads in
// `components/tab-glyphs.tsx` and `components/tasks/task-glyphs.tsx`.
// Observability SDKs: native bindings do not exist under vitest. Specs that
// need a live PostHog surface bind `createMemoryPostHogAdapter` instead.
vi.mock("posthog-react-native", () => {
  class PostHog {
    identify() {}
    reset() {}
    group() {}
    register() {}
    resetGroupPropertiesForFlags() {}
    optOut() {}
    optIn() {}
    stopSessionRecording() {}
    capture() {}
    async screen() {}
    getSessionId() {
      return "";
    }
    getDistinctId() {
      return "";
    }
    isFeatureEnabled() {
      return false;
    }
    reloadFeatureFlags() {}
  }
  return { default: PostHog, PostHog };
});

vi.mock("@sentry/react-native", () => ({
  init: vi.fn(),
  wrap: (component: unknown) => component,
  setUser: vi.fn(),
  // Both QueryClients report failures through it (`lib/sentry/query-errors.ts`).
  captureException: vi.fn(),
  mobileReplayIntegration: vi.fn(),
}));

// The glass layer's native pieces (`components/glass-surface.tsx`). String
// stand-ins, so a spec can find them by type; the suite's stub runs as iOS,
// where Liquid Glass is reported unavailable unless a spec says otherwise.
vi.mock("expo-blur", () => ({
  BlurView: "BlurView",
  BlurTargetView: "BlurTargetView",
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: "GlassView",
  GlassContainer: "GlassContainer",
  isLiquidGlassAvailable: vi.fn(() => false),
  isGlassEffectAPIAvailable: vi.fn(() => false),
}));

vi.mock("react-native-svg", () => ({
  default: "Svg",
  Svg: "Svg",
  Path: "Path",
  Rect: "Rect",
  Circle: "Circle",
  G: "G",
  Defs: "Defs",
  LinearGradient: "LinearGradient",
  Stop: "Stop",
}));
