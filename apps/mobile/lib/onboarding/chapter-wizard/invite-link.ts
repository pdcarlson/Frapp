import { mintJoinUrl, PRODUCTION_APP_ORIGIN } from "@repo/validation";

/**
 * Invite URLs the first-officer wizard shares.
 *
 * Web builds `${window.location.origin}/join?token=…` (`spec/product/onboarding.md`).
 * Mobile has no origin. Prefer `EXPO_PUBLIC_APP_URL` when a build inlines it
 * (set in EAS or `apps/mobile/.env.local`, never Infisical: ENV_REFERENCE.md
 * § References); otherwise the production dashboard origin so a generated link
 * still redeems. Do not invent a staging URL here.
 */

export function webAppOrigin(
  // A static `process.env.EXPO_PUBLIC_*` read, the only form babel-preset-expo
  // inlines into a build (`lib/ask/flag.ts`). Read through an alias of
  // `process.env` it was always undefined on device, so a staging build
  // shared production join links for its staging tokens.
  fromEnv: string | undefined = process.env.EXPO_PUBLIC_APP_URL,
): string {
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  return PRODUCTION_APP_ORIGIN;
}

/** The web app's host, as a line of copy names it: `app.frapp.live`. */
export function webAppHost(origin: string = webAppOrigin()): string {
  return origin.replace(/^https?:\/\//, "");
}

export function webJoinUrl(
  token: string,
  origin: string = webAppOrigin(),
): string {
  return mintJoinUrl(origin, token);
}

export function inviteTokenOf(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if (!("token" in result)) return null;
  const token = (result as { token?: unknown }).token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function onboardedChapterId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if (!("id" in result)) return null;
  const id = (result as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
