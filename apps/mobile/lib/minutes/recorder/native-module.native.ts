import type { RecorderNativeModules } from "./native-types";

/** iOS/Android half of the loader split: see `native-module.ts`. */
export function requireRecorderModules(): RecorderNativeModules | null {
  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    audio: require("expo-audio") as RecorderNativeModules["audio"],
    files: require("expo-file-system") as RecorderNativeModules["files"],
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
}
