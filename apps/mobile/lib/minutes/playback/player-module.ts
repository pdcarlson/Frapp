import type { PlayerModule } from "./player-types";

/**
 * Web / default half of the player's loader split (as
 * `recorder/native-module.ts`): this file never names `expo-audio`, so the
 * phone's minutes offer no playback where the package can't load.
 */
export function requirePlayerModule(): PlayerModule | null {
  return null;
}
