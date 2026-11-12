import type { RecorderNativeModules } from "./native-types";

/**
 * Web / default half of the recorder's loader split. `expo-audio` reads its
 * native module at import, which `expo export --platform web` would evaluate
 * at bundle time; this file never names the package. Same shape as
 * `lib/google-auth-module.ts`.
 */
export function requireRecorderModules(): RecorderNativeModules | null {
  return null;
}
