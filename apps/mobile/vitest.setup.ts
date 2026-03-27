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
}));
