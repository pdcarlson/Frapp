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

import { extractInviteToken } from "@repo/validation";

export {
  extractInviteToken,
  extractInviteTokenFromQuery,
} from "@repo/validation";

let rememberedToken: string | null = null;

/** Survives the signed-out bounce from `/join` onto sign-in. */
export function rememberInviteToken(token: string | null): void {
  rememberedToken = token && token.length > 0 ? token : rememberedToken;
}

export function consumeRememberedInviteToken(): string | null {
  const token = rememberedToken;
  rememberedToken = null;
  return token;
}

let handledLinkUrl: string | null = null;

/**
 * The invite token in an opened link, once per link.
 *
 * `Linking.useURL()` answers with the URL that launched the app for as long as
 * the process lives, not only at the moment a link opens it. Read on every
 * visit to `/join`, an invite the member already redeemed would fill the field
 * again, and send them past s02's question (#3350), every time they came back.
 * A link that carries no token isn't marked, so a later one still counts.
 */
export function takeInviteTokenFromLink(url: string | null): string | null {
  if (!url || url === handledLinkUrl) return null;
  const token = extractInviteToken(url);
  if (token) handledLinkUrl = url;
  return token;
}
