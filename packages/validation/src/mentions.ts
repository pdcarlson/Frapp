/**
 * `@`-mention parsing, shared by every surface that needs to agree on who a
 * mention refers to.
 *
 * Resolution runs **server-side at send time** and the result is stored on the
 * message. That is a security boundary, not a convenience: mentions override a
 * per-channel mute in the push rules, so a client-supplied mention list would
 * let any member force a push to any other member in a channel they had
 * deliberately muted. This module is shared so the API's authoritative pass and
 * any client-side preview highlight cannot disagree about what an `@`-token
 * means — but only the API's result is ever persisted.
 */

/** The minimum a mention candidate needs to be resolvable against. */
export interface MentionCandidate {
  /** `users.id` — the application id, not `supabase_auth_id`. */
  user_id: string;
  display_name: string;
}

/**
 * Longest plausible mention token. Display names are the only thing a token can
 * resolve to, and a bound keeps a pathological message from turning into a
 * quadratic scan against the whole member list.
 */
const MAX_TOKEN_LENGTH = 64;

/**
 * `@` followed by a run of name-ish characters.
 *
 * Deliberately does not span whitespace: `@Jane Doe` yields the token `Jane`,
 * which the `firstWord` tier below resolves when it is unambiguous. Matching
 * across spaces would make `@jane and bob` try to resolve "jane and bob".
 *
 * The leading boundary stops `email@example.com` from producing a token.
 *
 * The run is captured whole rather than capped at `MAX_TOKEN_LENGTH`, so that
 * an over-long run is *rejected* below instead of silently truncated to the
 * bound — a truncated token is still a valid prefix, and the prefix tier would
 * happily resolve it to a member the author never named. Message length is
 * already bounded upstream, so the open-ended run is safe.
 */
const MENTION_TOKEN = /(^|[^\w@])@([\w][\w.-]*)/g;

/** Every distinct `@`-token in a message body, in order of first appearance. */
export function extractMentionTokens(content: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of content.matchAll(MENTION_TOKEN)) {
    const token = match[2];
    if (!token || token.length > MAX_TOKEN_LENGTH) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

/**
 * Resolve one token to a member, fail-closed.
 *
 * Tiers, most specific first: exact user id → exact display name → name without
 * spaces → first word → unique prefix. **Ambiguity at any tier returns `null`**
 * rather than falling through to a looser one — if two members share a first
 * name, `@jane` resolves to neither, because silently picking one would send a
 * notification to the wrong person and, worse, look correct to the sender.
 *
 * Mirrors the tiering the web slash-command dispatcher already uses, so a
 * mention and a `/`-command addressed the same way reach the same member.
 */
export function matchMentionCandidate<T extends MentionCandidate>(
  candidates: readonly T[],
  token: string,
): T | null {
  const needle = token.trim().toLowerCase();
  if (needle.length === 0) return null;

  const lower = (s: string) => s.toLowerCase();
  const noSpace = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const firstWord = (s: string) => s.toLowerCase().split(/\s+/)[0] ?? "";

  const tiers: Array<(m: T) => boolean> = [
    (m) => m.user_id.toLowerCase() === needle,
    (m) => lower(m.display_name) === needle,
    (m) => noSpace(m.display_name) === needle,
    (m) => firstWord(m.display_name) === needle,
    (m) => lower(m.display_name).startsWith(needle),
  ];

  for (const pred of tiers) {
    const hits = candidates.filter(pred);
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * Every `users.id` mentioned in `content`, resolved against `candidates`.
 *
 * Unresolvable tokens are dropped silently — an `@` in prose is not an error,
 * and a message that fails to send because someone wrote "email me @ noon"
 * would be a worse bug than a missed highlight. Order follows first appearance;
 * duplicates collapse.
 *
 * `candidates` MUST be scoped to the chapter (and ideally the channel) the
 * message is being sent to. Passing a wider set would let a member mention
 * someone they cannot see, which the push tier would then act on.
 */
export function resolveMentions(
  content: string,
  candidates: readonly MentionCandidate[],
): string[] {
  if (candidates.length === 0) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const token of extractMentionTokens(content)) {
    const member = matchMentionCandidate(candidates, token);
    if (!member || seen.has(member.user_id)) continue;
    seen.add(member.user_id);
    resolved.push(member.user_id);
  }
  return resolved;
}
