/**
 * Invite URLs the first-officer wizard shares.
 *
 * Web builds `${window.location.origin}/join?token=…` (`spec/product/onboarding.md`).
 * Mobile has no origin. Prefer `EXPO_PUBLIC_APP_URL` when a build inlines it
 * (Infisical reference `${APP_URL}`); otherwise the production dashboard origin
 * so a generated link still redeems. Do not invent a staging URL here.
 */

const PRODUCTION_APP_ORIGIN = "https://app.frapp.live";

export function webAppOrigin(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env.EXPO_PUBLIC_APP_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  return PRODUCTION_APP_ORIGIN;
}

export function webJoinUrl(
  token: string,
  origin: string = webAppOrigin(),
): string {
  return `${origin}/join?token=${encodeURIComponent(token)}`;
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
