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
    create: <T,>(styles: T) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1,
  },
  useColorScheme: () => "dark",
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
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
