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
  EncodingType: {
    UTF8: "utf8",
  },
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn().mockResolvedValue(true),
  shareAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    select: vi.fn((opts) => opts.ios),
  },
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    removeEventListener: vi.fn(),
    currentState: "active",
  },
  // s10 confirms "End session" through the native dialog, because
  // `spec/ui/mobile/README.md` names ending a session early as an action that
  // needs one and bans `window.confirm` outright. A spec that drives that path
  // reads the buttons off this mock rather than tapping an in-product dialog
  // that does not exist.
  Alert: {
    alert: vi.fn(),
  },
  // Enough of the styling/layout surface for Signet token factories and
  // component tests; string stand-ins render fine under react-test-renderer.
  StyleSheet: {
    create: <T>(styles: T) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1,
  },
  useColorScheme: () => "dark",
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  // The chat thread windows its messages with a FlatList. As a string stand-in
  // it renders its props but never invokes `renderItem`, so a test that needs
  // to assert on rows should call the screen's row component directly rather
  // than reaching into rendered output.
  FlatList: "FlatList",
  ActivityIndicator: "ActivityIndicator",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Share: {
    share: vi.fn().mockResolvedValue({ action: "sharedAction" }),
  },
}));

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
  };
  return {
    useRouter: () => router,
    // Runs the effect immediately and on every callback-identity change, which
    // is the focused-screen behavior; the real one additionally re-runs on
    // refocus, which a headless test never triggers.
    useFocusEffect: (callback: () => undefined | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
    useLocalSearchParams: vi.fn(() => ({})),
    usePathname: vi.fn(() => "/"),
    Link: "Link",
    Redirect: "Redirect",
    Tabs: "Tabs",
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

vi.mock("expo-network", () => ({
  getNetworkStateAsync: vi
    .fn()
    .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: vi.fn(() => ({ remove: vi.fn() })),
}));

// New-in-S1 native modules: mocked suite-wide so importing any file that
// touches the provider stack never loads native code in the node/jsdom env.
vi.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: "GestureHandlerRootView",
}));

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
  // Like `FlatList` above, this is a string stand-in that renders its props but
  // never invokes `renderItem` — a spec needing a row should render that row's
  // component directly.
  BottomSheetFlatList: "BottomSheetFlatList",
}));

vi.mock("expo-web-browser", () => ({
  openBrowserAsync: vi.fn().mockResolvedValue({ type: "dismiss" }),
}));

vi.mock("expo-font", () => ({
  useFonts: vi.fn(() => [true, null]),
  loadAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@expo-google-fonts/figtree", () => ({
  useFonts: vi.fn(() => [true, null]),
  Figtree_400Regular: "Figtree_400Regular",
  Figtree_600SemiBold: "Figtree_600SemiBold",
  Figtree_700Bold: "Figtree_700Bold",
}));

vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: vi.fn().mockResolvedValue(true),
  hideAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock("react-native-keyboard-controller", () => ({
  KeyboardProvider: "KeyboardProvider",
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
  getPermissionsAsync: vi
    .fn()
    .mockResolvedValue({ granted: false, canAskAgain: true, status: "undetermined" }),
  requestPermissionsAsync: vi
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: false, status: "granted" }),
  getExpoPushTokenAsync: vi.fn().mockResolvedValue({ type: "expo", data: "" }),
  getLastNotificationResponse: vi.fn(() => null),
  clearLastNotificationResponse: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  scheduleNotificationAsync: vi.fn().mockResolvedValue("local-1"),
  cancelScheduledNotificationAsync: vi.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: vi.fn().mockResolvedValue(undefined),
  setNotificationHandler: vi.fn(),
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
