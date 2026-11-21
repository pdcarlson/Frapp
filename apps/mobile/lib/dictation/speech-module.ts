import type { SpeechModule } from "./speech-types";

/**
 * Web / default half of the speech loader split. This file never names the
 * package, so the web bundle doesn't carry it: on web it would run the
 * browser's recogniser, and Ask has no web mic (#5276). The native half's
 * require is what Expo Go is kept from by `speech.ts`'s guard, since the
 * package reads its native module at import. Same shape as
 * `lib/google-auth-module.ts`.
 */
export function requireSpeechModule(): SpeechModule | null {
  return null;
}
