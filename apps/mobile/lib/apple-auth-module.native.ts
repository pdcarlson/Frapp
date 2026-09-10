import type { AppleAuthModule } from "./apple-auth-types";

/** iOS/Android half of the loader split — see `apple-auth-module.ts`. */
export function requireAppleAuth(): AppleAuthModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-apple-authentication") as AppleAuthModule;
}
