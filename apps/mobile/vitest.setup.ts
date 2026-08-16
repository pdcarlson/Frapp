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
