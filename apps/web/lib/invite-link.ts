import { mintJoinUrl } from "@repo/validation";

/**
 * Same-origin join URL the first-officer wizard and Members invite dialog copy.
 *
 * Callers pass `window.location.origin` — never a hard-coded host. `/join`
 * accepts a pasted raw token **or this URL** (`extractInviteToken` in
 * `@repo/validation`); the link is what spec/behavior/members.md says invites
 * are shared as.
 *
 * Public `http:` origins throw before the token is attached. Loopback `http:`
 * is local Infisical `APP_URL`. Encoding and the https fence live in
 * `mintJoinUrl` so the API email helper and mobile wizard cannot drift.
 */
export function buildJoinUrl(origin: string, token: string): string {
  return mintJoinUrl(origin, token);
}
