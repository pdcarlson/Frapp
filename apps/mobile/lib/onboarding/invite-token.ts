/**
 * Invite tokens arrive as a pasted secret, a `?token=` query on `/join`, or a
 * full web/app URL (`app.frapp.live/join?token=…`, `frapp://join?token=…`).
 *
 * Extraction lives in `@repo/validation` so web `/join` and this screen cannot
 * drift. Remembered-token state is mobile-only: it survives the signed-out
 * bounce from `/join` onto sign-in.
 *
 * The drawn s02 six-cell code is a Canvas shorthand. Joining is single-use
 * invite tokens (`spec/behavior/onboarding.md`), not a shared 6-character
 * chapter code — `screens.md` already omits the drawn "Join code" row for the
 * same reason.
 */

export { extractInviteToken } from "@repo/validation";

let rememberedToken: string | null = null;

/** Survives the signed-out bounce from `/join` onto sign-in. */
export function rememberInviteToken(token: string | null): void {
  rememberedToken = token && token.length > 0 ? token : rememberedToken;
}

export function peekRememberedInviteToken(): string | null {
  return rememberedToken;
}

export function consumeRememberedInviteToken(): string | null {
  const token = rememberedToken;
  rememberedToken = null;
  return token;
}
