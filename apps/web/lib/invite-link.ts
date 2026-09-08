/**
 * Same-origin join URL the first-officer wizard and Members invite dialog copy.
 *
 * Callers pass `window.location.origin` — never a hard-coded host. `/join`
 * still accepts a pasted raw token; the link is what spec/behavior/members.md
 * says invites are shared as.
 */
export function buildJoinUrl(origin: string, token: string): string {
  return `${origin}/join?token=${encodeURIComponent(token)}`;
}
