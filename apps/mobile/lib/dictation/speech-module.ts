import type { SpeechModule } from "./speech-types";

/**
 * Web / default half of the speech loader split. `expo-speech-recognition`
 * reads its native module at import, which `expo export --platform web` would
 * evaluate at bundle time; this file never names the package. Same shape as
 * `lib/google-auth-module.ts`.
 */
export function requireSpeechModule(): SpeechModule | null {
  return null;
}
