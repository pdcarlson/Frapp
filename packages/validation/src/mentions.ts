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
 * The lookbehind stops `email@example.com` from producing a token. It is
 * Unicode-aware rather than `\w`-based, or `josé@example.com` would slip
 * through: `é` is not `\w`, so it would read as a word boundary and hand back
 * `example.com`.
 *
 * The body is Unicode too, for the same reason in reverse — `\w` is ASCII, so
 * an ASCII-only pattern cannot match `@Ángela` at all, and a name like
 * `O'Brien` would tokenise as `O`. Apostrophes (both kinds), hyphens and dots
 * are allowed *inside* a token but the token must **end** on a letter or digit,
 * so `@jane.` at the end of a sentence yields `jane` rather than `jane.` —
 * which no tier would have matched, silently dropping the mention.
 *
 * The run is captured whole rather than capped at `MAX_TOKEN_LENGTH`, so that
 * an over-long run is *rejected* below instead of silently truncated to the
 * bound — a truncated token is still a valid prefix, and the prefix tier would
 * happily resolve it to a member the author never named. Message length is
 * already bounded upstream, so the open-ended run is safe.
 */
const MENTION_TOKEN =
  /(?<![\p{L}\p{N}\p{M}_@])@(\p{L}[\p{L}\p{M}\p{N}_'’.-]*[\p{L}\p{M}\p{N}]|\p{L}\p{M}*)/gu;

/**
 * Fold a name or token to its comparable core: lowercase, and everything that
 * is not a letter or digit removed.
 *
 * This is what lets `@obrien` reach "Sean O'Brien" and `@maryjane` reach
 * "Mary-Jane Watson". Comparing raw strings would make any name carrying an
 * apostrophe or hyphen reachable only by its first word.
 */
function fold(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

/**
 * A name or token as the resolver compares it (`fold`), for a caller that has
 * to ask "does this token name that role" before it has a full candidate set:
 * the API, deciding whether a send needs the sender's permissions at all.
 */
export function foldMentionName(value: string): string {
  return fold(value);
}

/**
 * Shortest token allowed to resolve by *prefix*.
 *
 * A one-character prefix is not a mention, it is a coin flip: `@A` would match
 * whichever single member happens to start with A. The exact tiers above still
 * accept a one-character token, so a member genuinely named a single character
 * stays reachable — this only stops the loosest tier from guessing.
 */
const MIN_PREFIX_LENGTH = 2;

/** Where one `@`-token sits in a message body. */
export interface MentionSpan {
  /** Index of the `@` itself. */
  start: number;
  /** Index one past the token's last character. */
  end: number;
  /** The token, without the leading `@` — what the resolver matches on. */
  token: string;
}

/**
 * Every `@`-token in a message body **with its position**, in source order.
 *
 * The positional twin of `extractMentionTokens`, and the reason this module is
 * shared at all: a surface that highlights mentions in rendered text needs to
 * know which characters to wrap, and re-deriving that from its own regex is how
 * a highlight starts disagreeing with the resolution that actually sent the
 * notification — a message that paints `@Sam` as a mention nobody was notified
 * about, or the reverse. Both functions walk `MENTION_TOKEN`, so they cannot.
 *
 * Unlike `extractMentionTokens` this does **not** deduplicate: three `@jane`s
 * in a sentence are three spans, because all three are on screen. It applies
 * the same `MAX_TOKEN_LENGTH` rejection, so a run the resolver refuses to
 * resolve is also a run nothing highlights.
 *
 * A span says only "this is a mention-shaped token". Whether it resolves to a
 * member needs `matchMentionCandidate` and a roster, which a renderer holding
 * nothing but `content` does not have — see `resolveMentions` for that half.
 */
export function findMentionSpans(content: string): MentionSpan[] {
  const spans: MentionSpan[] = [];
  for (const match of content.matchAll(MENTION_TOKEN)) {
    const token = match[1];
    if (!token || token.length > MAX_TOKEN_LENGTH) continue;
    // `match.index` is the `@`: the lookbehind is zero-width, so it does not
    // move the match start.
    const start = match.index;
    spans.push({ start, end: start + 1 + token.length, token });
  }
  return spans;
}

/** Every distinct `@`-token in a message body, in order of first appearance. */
export function extractMentionTokens(content: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const { token } of findMentionSpans(content)) {
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
  return matchTiers(candidates, token, Number.POSITIVE_INFINITY);
}

/**
 * How many of {@link matchMentionCandidate}'s tiers name a member *exactly*:
 * their id, their display name, or their display name folded. The rest (first
 * word, prefix) are shorthand, which a role named in full outranks.
 */
const EXACT_TIERS = 3;

/**
 * The resolver's tiers for `token`, most specific first. Empty for a token
 * that is blank once trimmed.
 */
function tierPredicates<T extends MentionCandidate>(
  token: string,
): Array<(m: T) => boolean> {
  const needle = token.trim().toLowerCase();
  if (needle.length === 0) return [];
  const folded = fold(token);

  const lower = (s: string) => s.toLowerCase();
  const firstWord = (s: string) => s.toLowerCase().split(/\s+/)[0] ?? "";

  return [
    (m) => m.user_id.toLowerCase() === needle,
    (m) => lower(m.display_name) === needle,
    // Folded comparison, so punctuation in a name is not a barrier to naming
    // them: `@obrien` → "Sean O'Brien", `@maryjane` → "Mary-Jane Watson".
    (m) => folded.length > 0 && fold(m.display_name) === folded,
    (m) => firstWord(m.display_name) === needle,
    (m) => folded.length > 0 && fold(firstWord(m.display_name)) === folded,
    // Prefix is the only guessing tier, so it carries the length floor. Without
    // it, any token that folds to a single character — which a truncated or
    // single-letter mention does — resolves to whichever member happens to
    // start that way, and a mention overrides an explicit mute.
    (m) =>
      folded.length >= MIN_PREFIX_LENGTH &&
      fold(m.display_name).startsWith(folded),
  ];
}

function matchTiers<T extends MentionCandidate>(
  candidates: readonly T[],
  token: string,
  tierLimit: number,
): T | null {
  const tiers = tierPredicates<T>(token);
  for (const pred of tiers.slice(0, tierLimit)) {
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
  roles: readonly MentionRole[] = [],
): string[] {
  if (candidates.length === 0) return [];

  const inChapter = new Set(candidates.map((member) => member.user_id));
  const resolved: string[] = [];
  const seen = new Set<string>();
  const add = (userId: string) => {
    if (seen.has(userId) || !inChapter.has(userId)) return;
    seen.add(userId);
    resolved.push(userId);
  };

  for (const token of extractMentionTokens(content)) {
    const role = matchMentionRole(candidates, roles, token);
    if (role !== undefined) {
      // A role token is consumed even when it reaches nobody, so a role this
      // sender may not ping never falls through to a member who happens to
      // share a prefix with it.
      if (role?.mentionable) role.member_ids.forEach(add);
      continue;
    }
    const member = matchMentionCandidate(candidates, token);
    if (member) add(member.user_id);
  }
  return resolved;
}

/**
 * A chapter role as `@`-resolution sees it (2026-11-06, owner direction:
 * "roles should be attable"). `@Officers` reaches every member holding the
 * role, so it overrides their mutes exactly as naming each of them would.
 */
export interface MentionRole {
  role_id: string;
  name: string;
  /** `users.id` of every member holding the role. */
  member_ids: readonly string[];
  /**
   * Whether this sender may ping it. The API decides (`spec/behavior/chat/
   * README.md` § Role mentions): `true` when the role's "anyone can @" switch
   * is on, or the sender can manage channels or roles.
   */
  mentionable: boolean;
}

/**
 * The role `token` names, `null` when it names a role but resolves to nobody,
 * or `undefined` when it names no role and member matching should run.
 *
 * Only a role's whole name matches, folded as a member's is, so `@VicePresident`
 * and `@vice-president` both reach "Vice President" and `@Off` reaches no role.
 * A role named in full outranks a member's shorthand (first word, prefix), but
 * not a member's own exact name: when "Rush" is both a role and a member, the
 * token is ambiguous and, like every ambiguity here, reaches nobody.
 */
function matchMentionRole(
  candidates: readonly MentionCandidate[],
  roles: readonly MentionRole[],
  token: string,
): MentionRole | null | undefined {
  if (roles.length === 0) return undefined;
  const folded = fold(token);
  if (folded.length === 0) return undefined;
  // A role nobody holds is not a target: it would reach nobody, and letting
  // it claim the token would take the name from a member it collides with.
  const hits = roles.filter(
    (role) => role.member_ids.length > 0 && fold(role.name) === folded,
  );
  if (hits.length === 0) return undefined;
  if (hits.length > 1) return null;
  // Any exact member hit, one or several, makes the token ambiguous.
  // `matchTiers` reads several as "no match", which would hand the role a
  // token that should reach nobody.
  const exact = tierPredicates<MentionCandidate>(token).slice(0, EXACT_TIERS);
  if (exact.some((pred) => candidates.some(pred))) return null;
  return hits[0]!;
}

/**
 * The text a mention picker inserts for a member: `display_name` with every
 * character that isn't a Unicode letter, digit, or mark removed.
 *
 * Stripping *only* whitespace is not enough. `MENTION_TOKEN` allows a narrow
 * set of mid-token punctuation (`'’.-_`) but **truncates the match** at the
 * first character outside it: it does not reject the token, it silently
 * shortens it. "Sam (VP)" stripped of spaces is `Sam(VP)`, which tokenizes as
 * just `Sam`, and if another member is named exactly "Sam" the exact-name tier
 * resolves to *that* member: a message that looks like it mentions "Sam (VP)"
 * mentions the wrong person.
 *
 * Every character kept here is one the tokenizer always accepts through to the
 * end, so the label round-trips intact, and it is `fold()`'s own character
 * class, so it resolves through the "name without spaces" tier: the member
 * picked is the member that resolves. What it cannot prevent is the resolver's
 * accepted ambiguity, two members whose names fold to the same string, which
 * fails closed (nobody mentioned, not the wrong person).
 *
 * Shared by both composers' pickers (web's tiptap suggestion, mobile's
 * `ChatComposer`), so a member picked on either sends the same body.
 */
export function mentionLabelFor(displayName: string): string {
  return displayName.replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

/** One member as a mention picker offers them. */
export interface MentionSuggestion<T extends MentionCandidate> {
  member: T;
  /** What picking them inserts after the `@` (`mentionLabelFor`). */
  label: string;
}

/**
 * A name or query as the picker compares it: lower case, with the curly
 * apostrophe read as the straight one. iOS swaps `'` for `’` as it is typed,
 * so without this `@O'Br` from an iPhone would match no "O'Brien".
 */
function matchable(value: string): string {
  return value.toLowerCase().replace(/’/g, "'");
}

/** Web's popup cap, and mobile's. */
const MAX_MENTION_SUGGESTIONS = 8;

/**
 * The members a picker offers for `query` (the text typed after `@`), in
 * roster order: those whose display name contains it, ignoring case.
 *
 * A member with no display name is left out, and so is one whose label opens
 * on a digit: every token must open on a letter, so a label like `123Squad`
 * would never be read as a mention at all (`spec/behavior/chat/README.md`
 * § Mentions: "Autocomplete SHOULD NOT present a digit-led display name as
 * reachable by typing").
 */
export function mentionSuggestions<T extends MentionCandidate>(
  roster: readonly T[],
  query: string,
  limit: number = MAX_MENTION_SUGGESTIONS,
): MentionSuggestion<T>[] {
  const needle = matchable(query.trim());
  const offered: MentionSuggestion<T>[] = [];
  for (const member of roster) {
    if (offered.length >= limit) break;
    if (member.display_name.length === 0) continue;
    const label = mentionLabelFor(member.display_name);
    if (!/^\p{L}/u.test(label)) continue;
    // The tokenizer drops a longer token, so the pick would reach nobody.
    if (label.length > MAX_TOKEN_LENGTH) continue;
    if (needle && !matchable(member.display_name).includes(needle)) continue;
    offered.push({ member, label });
  }
  return offered;
}

/** A role as a picker can offer it. */
export interface MentionRoleOption {
  name: string;
  /** Whether the viewer may ping it; a role they may not is never offered. */
  mentionable: boolean;
}

/** One row of a mention picker: a member, or a role. */
export type MentionPickerEntry<
  M extends MentionCandidate,
  R extends MentionRoleOption,
> =
  | { kind: "member"; member: M; label: string }
  | { kind: "role"; role: R; label: string };

/**
 * At most this many of a picker's rows are roles, so on a bare `@` at least
 * five of the eight rows are still members.
 */
const MAX_ROLE_SUGGESTIONS = 3;

/**
 * Every row a mention picker offers for `query`: matching members first, in
 * roster order, then the matching roles the viewer may ping, in the order
 * given (the chapter's role order). Both pickers draw this list, so web and
 * mobile offer the same rows for the same text.
 *
 * Roles take at most three rows of the eight, and the members fill the rest.
 * A role matches as a member does (its name contains the query) and is left
 * out under the same rule: its label must open on a letter to be typeable.
 */
export function mentionPickerEntries<
  M extends MentionCandidate,
  R extends MentionRoleOption,
>(
  roster: readonly M[],
  roles: readonly R[],
  query: string,
  limit: number = MAX_MENTION_SUGGESTIONS,
): MentionPickerEntry<M, R>[] {
  const needle = matchable(query.trim());
  const roleRows: MentionPickerEntry<M, R>[] = [];
  for (const role of roles) {
    if (roleRows.length >= Math.min(MAX_ROLE_SUGGESTIONS, limit)) break;
    if (!role.mentionable) continue;
    const label = mentionLabelFor(role.name);
    if (!/^\p{L}/u.test(label)) continue;
    if (label.length > MAX_TOKEN_LENGTH) continue;
    if (needle && !matchable(role.name).includes(needle)) continue;
    roleRows.push({ kind: "role", role, label });
  }
  const memberRows = mentionSuggestions(
    roster,
    query,
    limit - roleRows.length,
  ).map(({ member, label }): MentionPickerEntry<M, R> => ({
    kind: "member",
    member,
    label,
  }));
  return [...memberRows, ...roleRows];
}

/** The `@`-query a caret sits in: where its `@` is, and what follows it. */
export interface ActiveMentionQuery {
  /** Index of the `@`. */
  start: number;
  /** The text between the `@` and the caret. Empty right after typing `@`. */
  query: string;
  /**
   * Index one past the whole handle, which runs on past the caret when the
   * caret sits inside it. A pick replaces `start` to `end`.
   */
  end: number;
}

/**
 * An `@` the tokenizer would accept, then nothing yet or a run that opens on a
 * letter, up to the end of the string. Anchored at the end because it is run
 * over the text *before the caret*, so a space typed after a name, or a caret
 * moved out of it, closes the picker.
 *
 * The lookbehind and the opening letter are `MENTION_TOKEN`'s, so the picker
 * opens only where the handle being typed could be read as a mention: not
 * inside `email@example.com` or `@jane@`, and not on `@1` or `@.`. A bare `@`
 * opens it too, since that is where every handle starts.
 */
const ACTIVE_MENTION =
  /(?<![\p{L}\p{N}\p{M}_@])@((?:\p{L}[\p{L}\p{M}\p{N}_'’.-]*)?)$/u;

/** The rest of a handle after the caret: what a token's body can hold. */
const HANDLE_TAIL = /^[\p{L}\p{M}\p{N}_'’.-]*/u;

/**
 * The mention being typed at `caret`, or `null` when the caret is not in one.
 *
 * A plain text input has no editor plugin to say this (web's tiptap
 * suggestion does), so mobile's composer asks here on every change of text or
 * selection. The query never spans whitespace, as tiptap's default doesn't.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): ActiveMentionQuery | null {
  if (caret < 1 || caret > text.length) return null;
  const match = ACTIVE_MENTION.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[1] ?? "";
  if (query.length > MAX_TOKEN_LENGTH) return null;
  const tail =
    query.length > 0 ? (HANDLE_TAIL.exec(text.slice(caret))?.[0] ?? "") : "";
  return { start: match.index, query, end: caret + tail.length };
}
