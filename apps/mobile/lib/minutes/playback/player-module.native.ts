import type { PlayerModule } from "./player-types";

/** iOS/Android half of the player's loader split: see `player-module.ts`. */
export function requirePlayerModule(): PlayerModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-audio") as PlayerModule;
}
